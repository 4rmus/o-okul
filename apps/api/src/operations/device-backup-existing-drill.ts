import { createUploadAvScannerFromEnv } from "../upload/upload-av-scanner.js";
import { createHash, type KeyObject } from "node:crypto";
import pg from "pg";
import { withTenantDb, readTenantBackupSchema, tenantResetOwnershipPredicate, resetDigest, tenantResetTableNames, tenantDatabaseLockKey, resetS3Client, encryptResetPackage, decryptResetPackage, type ResetS3Config, type Queryable } from "@o-okul/db";
import { openDeviceBackup } from "./device-backup-archive.js";
import { projectDeviceBackup, validateDeviceBackupPayload, readDeviceDomainRows, readDeviceRestoreSourceDigest, type DeviceBackupPayload } from "./device-backup.service.js";
import { readDeviceRestoreForeignKeys } from "./device-backup-references.js";
import { deviceDomainLinks } from "./device-backup-domain-links.js";
import { deviceRestoreTablePolicy } from "./device-backup-impact.js";
import { cleanExistingRestoreObjects, collectExistingRestoreFiles, mapExistingRestorePhotos, prepareExistingRestoreObjects, stageExistingRestoreObjects } from "./device-backup-existing-objects.js";
import { encryptTcIdentity, hashTcIdentity } from "../student/tc-identity.js";

const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
/** Disposable existing-tenant recovery engine; production remains independently gated. */
export type ExistingDeviceRestoreInput = { databaseUrl: string; tenantId: string; file: Buffer; password: string; trustedKeys: Map<string, KeyObject>; operationId: string; failBeforeCommit?: boolean; failAfterCommit?: boolean; objects?: ResetS3Config; custodyKey?: Buffer; assertQuiescence?: () => Promise<void>; recover?: boolean; crash?: "after-first-put" | "before-commit" | "after-commit" | "after-first-delete" };
export async function restoreExistingDeviceBackupDrill(input: ExistingDeviceRestoreInput) {
  assertLocalDeviceRestore(input);
  return restoreDeviceBackup(input);
}
function assertLocalDeviceRestore(input: ExistingDeviceRestoreInput) {
  const url=new URL(input.databaseUrl);
  if (url.protocol!=="postgresql:" || !["localhost","127.0.0.1"].includes(url.hostname) || url.search || url.hash || !["/o_okul_reset_drill","/o_okul_device_backup_test"].includes(url.pathname) || !/^device-backup-[a-f0-9-]+-a$/.test(input.tenantId)) throw new Error("DEVICE_EXISTING_DISPOSABLE_REQUIRED");
}
export async function restoreDeployedDeviceBackup(input: ExistingDeviceRestoreInput) {
  if (process.env.TENANT_DEVICE_RESTORE_ENABLED!=="1" || process.env.TENANT_DEVICE_RESTORE_TENANT_ID!==input.tenantId || process.env.TENANT_DEVICE_RESTORE_DATABASE_URL!==input.databaseUrl || input.crash || !input.custodyKey || !input.objects || !input.assertQuiescence) throw new Error("DEVICE_RESTORE_DEPLOYMENT_DISABLED");
  return restoreDeviceBackup(input,true);
}
async function restoreDeviceBackup(input: ExistingDeviceRestoreInput, deployed=false) {
  if (!/^[a-f0-9]{32}$/.test(input.operationId)) throw new Error("DEVICE_EXISTING_OPERATION_REQUIRED");
  const archiveDigest=createHash("sha256").update(input.file).digest("hex");
  const opened = await openDeviceBackup(input.file,input.tenantId,input.password,input.trustedKeys);
  let archive: DeviceBackupPayload;
  try { archive = validateDeviceBackupPayload(JSON.parse(opened.payload.toString("utf8")),input.tenantId); }
  finally { opened.payload.fill(0); }
  if (input.objects && !deployed) {
    const endpoint = new URL(input.objects.endpoint);
    if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port || Number(endpoint.port) < 1024 || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || endpoint.username || endpoint.password || !/^device-existing-[a-f0-9]{24}$/.test(input.objects.bucket)) throw new Error("DEVICE_EXISTING_DISPOSABLE_OBJECTS_REQUIRED");
  } else if (!input.objects && archive.files.length) throw new Error("DEVICE_EXISTING_FILES_UNSUPPORTED");
  const pool = new pg.Pool({ connectionString: input.databaseUrl, max: 1, options: "-c default_transaction_isolation=serializable", connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  const connection = await pool.connect();
  const session = { connect: async () => ({ query: connection.query.bind(connection), release() {} }), query: connection.query.bind(connection) };
  const s3 = input.objects ? resetS3Client(input.objects, { maxAttempts: 1, requestHandler: { connectionTimeout: 3000, requestTimeout: 5000, socketTimeout: 5000 } }) : undefined;
  const scope = { tenantId: input.tenantId, bypassRls: false };
  let intent: Awaited<ReturnType<typeof prepareExistingRestoreObjects>> = [];
  const filesDigest = (files: typeof archive.files) => resetDigest(files.map(f => [f.key,f.sha256]).sort(([a],[b]) => a!.localeCompare(b!)));
  try {
    // Session fence survives the durable intent commit and is released only after reconciliation.
    const locked = (await connection.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [tenantDatabaseLockKey(input.tenantId)])).rows[0]?.locked;
    if (!locked) throw new Error("DEVICE_EXISTING_BUSY");
    await withTenantDb(session,scope,async db=>{
      const role=(await db.query<{valid:boolean}>(`SELECT current_user='o_okul_device_restore_worker' AND session_user=current_user AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AND NOT has_schema_privilege(current_user,'public','CREATE') AND NOT has_schema_privilege(current_user,'device_existing_restore','CREATE') AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner=r.oid) AS valid FROM pg_roles r WHERE rolname=current_user`)).rows[0];
      if(role?.valid!==true)throw new Error("DEVICE_EXISTING_UNPRIVILEGED_REQUIRED");
      const row=(await db.query<{status:string;slug:string}>('SELECT status,slug FROM "Tenant" WHERE id=$1',[input.tenantId])).rows[0];
      if(row?.status!=="SUSPENDED" || ["dna","demoo","system"].includes(row.slug))throw new Error("DEVICE_EXISTING_SUSPENDED_REQUIRED");
      if(deployed){
        const work=(await db.query<{archive_digest:string;approval:{actorUserId:string;lifecycleVersion:number;sourceDigest:string}|null;currentVersion:number;committed:boolean}>(`SELECT w.archive_digest,w.approval,t."lifecycleVersion" AS "currentVersion",EXISTS(SELECT 1 FROM device_existing_restore.receipts r WHERE r.operation_id=w.operation_id AND r.tenant_id=w.tenant_id) AS committed FROM device_existing_restore.work w JOIN "Tenant" t ON t.id=w.tenant_id WHERE w.operation_id=$1 AND w.tenant_id=$2 AND w.state='RUNNING'`,[input.operationId,input.tenantId])).rows[0];
        if(work?.archive_digest!==archiveDigest || !work.approval?.actorUserId || work.approval.lifecycleVersion!==work.currentVersion)throw new Error("DEVICE_RESTORE_CUSTODY_CONFLICT");
        if(!work.committed && await readDeviceRestoreSourceDigest(db,input.tenantId)!==work.approval.sourceDigest)throw new Error("DEVICE_RESTORE_SOURCE_CHANGED");
        const terms=(await db.query<{valid:boolean}>(`SELECT (t."planCode"=x.plan AND t."startsAt"=x."licenseStartsAt" AND t."endsAt"=x."licenseEndsAt" AND t."activeStudentLimit"=x."seatLimit") AS valid FROM "LicenseTerm" t JOIN "Tenant" x ON x.id=t."tenantId" WHERE t."tenantId"=$1 AND t."cancelledAt" IS NULL AND t."startsAt"<=now() AND now()<t."endsAt" LIMIT 2`,[input.tenantId])).rows;
        if(terms.length!==1 || terms[0]?.valid!==true)throw new Error("DEVICE_RESTORE_LICENSE_UNVERIFIED");
      }
    });
    if (s3 && input.objects) {
      await withTenantDb(session,scope,async db=>{
        const bound=(await db.query<{archive_digest:string;target:string}>("SELECT archive_digest,target FROM device_existing_restore.object_jobs WHERE operation_id=$1 AND tenant_id=$2",[input.operationId,input.tenantId])).rows[0];
        if(bound && (bound.archive_digest!==archiveDigest || bound.target!==resetDigest({endpoint:input.objects!.endpoint,bucket:input.objects!.bucket})))throw new Error("DEVICE_EXISTING_OBJECT_BINDING_MISMATCH");
      });
      archive = await mapExistingRestorePhotos(archive, connection);
      const protectedFiles=await withTenantDb(session,scope,async db=>{
        const current=await collectExistingRestoreFiles(await projectDeviceBackup(input.tenantId,archive.schemaDigest,db),s3,input.objects!.bucket);
        return current.files.filter(f=>f.key.startsWith("support-ticket-attachments/"));
      });
      archive.files=[...archive.files.filter(f=>!f.key.startsWith("support-ticket-attachments/")),...protectedFiles];
      intent = await withTenantDb(session, scope, db => prepareExistingRestoreObjects(db,s3,input.objects!.bucket,input.objects!.endpoint,input.tenantId,input.operationId,archiveDigest,archive.files,input.recover));
      if (input.recover) {
        const committed = await withTenantDb(session, scope, async db => (await db.query("SELECT operation_id FROM device_existing_restore.receipts WHERE operation_id=$1 AND tenant_id=$2",[input.operationId,input.tenantId])).rows.length > 0);
        if (!committed) {
          await withTenantDb(session, scope, db => db.query("UPDATE device_existing_restore.object_jobs SET state='CLEANING' WHERE operation_id=$1 AND tenant_id=$2",[input.operationId,input.tenantId]));
          await cleanExistingRestoreObjects(s3,input.objects.bucket,input.operationId,intent,input.crash);
          await withTenantDb(session, scope, db => db.query("UPDATE device_existing_restore.object_jobs SET state='ABORTED' WHERE operation_id=$1 AND tenant_id=$2",[input.operationId,input.tenantId]));
          let oldStateVerified=false;
          if(input.custodyKey)await withTenantDb(session,scope,async db=>{
            const work=(await db.query<{recovery_envelope:Buffer|null}>("SELECT recovery_envelope FROM device_existing_restore.work WHERE operation_id=$1 AND tenant_id=$2",[input.operationId,input.tenantId])).rows[0];
            if(!work?.recovery_envelope)return;
            const bytes=decryptResetPackage(work.recovery_envelope,input.custodyKey!);
            try{
              const saved=JSON.parse(bytes.toString("utf8"));
              const current=await collectExistingRestoreFiles(await projectDeviceBackup(input.tenantId,await readTenantBackupSchema(db),db),s3,input.objects!.bucket);
              if(saved.domain!=="device-restore-recovery-v1"||saved.operationId!==input.operationId||saved.tenantId!==input.tenantId||saved.archiveDigest!==archiveDigest||resetDigest(saved.payload)!==resetDigest(current))throw new Error("DEVICE_RESTORE_RECOVERY_CONFLICT");
              oldStateVerified=true;
            }finally{bytes.fill(0);}
          });
          return { aborted: true, objectStorageVerified: true, oldStateVerified, restoreVerified: false, canRestore: false };
        }
      }
    }
    if (input.custodyKey && s3 && input.objects) await withTenantDb(session,scope,async db=>{
      const work=(await db.query<{recovery_envelope:Buffer|null;archive_digest:string}>("SELECT recovery_envelope,archive_digest FROM device_existing_restore.work WHERE operation_id=$1 AND tenant_id=$2 AND state='RUNNING'",[input.operationId,input.tenantId])).rows[0];
      if(!work || work.archive_digest!==archiveDigest)throw new Error("DEVICE_RESTORE_CUSTODY_CONFLICT");
      if(work.recovery_envelope){
        const bytes=decryptResetPackage(work.recovery_envelope,input.custodyKey!);
        try { const saved=JSON.parse(bytes.toString("utf8"));if(saved.domain!=="device-restore-recovery-v1"||saved.operationId!==input.operationId||saved.tenantId!==input.tenantId||saved.archiveDigest!==archiveDigest)throw new Error("DEVICE_RESTORE_RECOVERY_CONFLICT"); }
        finally {bytes.fill(0);}
      }else{
        const current=validateDeviceBackupPayload(await collectExistingRestoreFiles(await projectDeviceBackup(input.tenantId,await readTenantBackupSchema(db),db),s3,input.objects!.bucket),input.tenantId);
        const bytes=Buffer.from(JSON.stringify({domain:"device-restore-recovery-v1",operationId:input.operationId,tenantId:input.tenantId,archiveDigest,payload:current}));
        try {await db.query("UPDATE device_existing_restore.work SET recovery_envelope=$3 WHERE operation_id=$1 AND tenant_id=$2 AND recovery_envelope IS NULL",[input.operationId,input.tenantId,encryptResetPackage(bytes,input.custodyKey!)]);}
        finally {bytes.fill(0);}
      }
    });
    if(deployed)await input.assertQuiescence!();
    const result=await withTenantDb(session,{tenantId:input.tenantId,bypassRls:false},async db=>{
type Usage = { id:string;tenantId:string;usageDate:string;licenseTermId:string;activeStudentCount:number;peakActiveStudentCount:number;createdAt:string;reconciledAt:string;updatedAt:string };
async function readRestoreLicenseUsage(db:Queryable,tenantId:string){
  const rows=(await db.query<{row:Usage}>('SELECT to_jsonb(t) AS row FROM "LicenseUsage" t WHERE "tenantId"=$1 ORDER BY "usageDate",id LIMIT 2001',[tenantId])).rows.map(r=>r.row);
  if(rows.length>2000)throw new Error("DEVICE_RESTORE_LICENSE_USAGE_LIMIT");return rows;
}
/** Only the DB-derived current-day count may advance; historical peaks and past rows never rewind. */
async function verifyRestoreLicenseUsage(db:Queryable,tenantId:string,before:Usage[]){
  const after=await readRestoreLicenseUsage(db,tenantId);
  if(resetDigest(before)===resetDigest(after))return;
  const current=(await db.query<{today:string;term:string;limit:number;count:number}>(`SELECT current_date::text AS today,t.id AS term,t."activeStudentLimit" AS "limit",(SELECT count(*)::int FROM "Student" s WHERE s."tenantId"=$1 AND s.status='ACTIVE' AND s."deletedAt" IS NULL AND 1=(SELECT count(*) FROM "StudentEnrollment" e WHERE e."tenantId"=$1 AND e."studentId"=s.id AND e.status='ACTIVE' AND e."endsAt" IS NULL)) AS count FROM "LicenseTerm" t WHERE t."tenantId"=$1 AND t."cancelledAt" IS NULL AND t."startsAt"<=now() AND now()<t."endsAt" LIMIT 2`,[tenantId])).rows;
  if(current.length!==1)throw new Error("DEVICE_RESTORE_LICENSE_USAGE_CHANGED");
  const {today,term,limit,count}=current[0]!;
  const previous=before.find(r=>r.usageDate===today),next=after.find(r=>r.usageDate===today);
  const sameIdentity=(r:Usage)=>[r.id,r.tenantId,r.usageDate,r.createdAt];
  if(resetDigest(before.filter(r=>r.usageDate!==today))!==resetDigest(after.filter(r=>r.usageDate!==today)) || !next || count>limit || next.licenseTermId!==term || next.activeStudentCount!==count || next.peakActiveStudentCount<Math.max(previous?.peakActiveStudentCount??0,count) || next.peakActiveStudentCount>Math.max(previous?.peakActiveStudentCount??0,limit) || (previous && resetDigest(sameIdentity(previous))!==resetDigest(sameIdentity(next))))throw new Error("DEVICE_RESTORE_LICENSE_USAGE_CHANGED");
}

    await db.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public,pg_catalog");
    await db.query("SELECT set_config('app.current_tenant_id',$1,true),set_config('app.bypass_rls','false',true),pg_advisory_xact_lock(hashtextextended($2,0))",[input.tenantId,tenantDatabaseLockKey(input.tenantId)]);
    const tenant=(await db.query<{status:string}>('SELECT status FROM "Tenant" WHERE id=$1 FOR UPDATE',[input.tenantId])).rows[0];
    if (tenant?.status !== "SUSPENDED") throw new Error("DEVICE_EXISTING_SUSPENDED_REQUIRED");
    // Durable in-flight work remains a blocker; terminal history is checked below.
    for (const table of ["TenantMutationActivity"] as const) {
      if ((await db.query(`SELECT 1 FROM ${ident(table)} t WHERE ${tenantResetOwnershipPredicate(table)} LIMIT 1`,[input.tenantId])).rows.length) throw new Error("DEVICE_EXISTING_ACTIVITY_PRESENT");
    }
    const schema=await readTenantBackupSchema(db);
    if (schema !== archive.schemaDigest) throw new Error("DEVICE_EXISTING_SCHEMA_MISMATCH");
    const projection = await projectDeviceBackup(input.tenantId,schema,db);
    if (s3 && input.objects) await collectExistingRestoreFiles(projection,s3,input.objects.bucket);
    const current=validateDeviceBackupPayload(projection,input.tenantId);
    // Operational data rewinds; identity, finance, consent and other protected history stay current.
    for(const table of Object.keys(archive.tables)) if(deviceRestoreTablePolicy(table)==="PRESERVE") archive.tables[table]=current.tables[table]!;
    if(filesDigest(archive.files.filter(f=>f.key.startsWith("support-ticket-attachments/")))!==filesDigest(current.files.filter(f=>f.key.startsWith("support-ticket-attachments/")))) throw new Error("DEVICE_RESTORE_PRESERVED_FILES_DIFFERENCE");
    for (const table of ["Student","Teacher","Guardian","Employee"]) {
      const previous = new Map((current.tables[table] ?? []).map(e => {const row=JSON.parse(e.row);return [row.id,row.userId ?? null];}));
      const proposed = new Map((archive.tables[table] ?? []).map(e => {const row=JSON.parse(e.row);return [row.id,row.userId ?? null];}));
      for (const id of new Set([...previous.keys(),...proposed.keys()])) if ((previous.get(id) ?? null) !== (proposed.get(id) ?? null)) throw new Error("DEVICE_EXISTING_ACCOUNT_LINK_CHANGE");
      const oldEntries=new Map((current.tables[table] ?? []).map(e=>[JSON.parse(e.row).id,e]));
      for (const entry of archive.tables[table] ?? []) {
        const row=JSON.parse(entry.row),previousEntry=oldEntries.get(row.id),old=previousEntry?JSON.parse(previousEntry.row):undefined;
        if(old?.deletedAt!=null && resetDigest(previousEntry)!==resetDigest(entry))throw new Error("DEVICE_RESTORE_RETIRED_PROFILE_CONFLICT");
        if (row.userId != null && (!old || (old.deletedAt != null && row.deletedAt == null) || (old.status !== "ACTIVE" && row.status === "ACTIVE"))) throw new Error("DEVICE_EXISTING_ACCOUNT_ACCESS_REACTIVATION");
      }
    }
    const policies = Object.fromEntries(Object.keys(archive.tables).map(table => [table,{policy:deviceRestoreTablePolicy(table)!,added:0,changed:0,removed:0,unchanged:0}]));
    const domain = deviceDomainLinks(archive,current,policies,await readDeviceDomainRows(db,input.tenantId));
    if (domain.conflicts.length || domain.unverified.length || domain.pendingDeliveries) throw new Error("DEVICE_EXISTING_DOMAIN_UNVERIFIED");
    const triggers=await db.query<{enabled:string}>("SELECT t.tgenabled::text AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal");
    if (!triggers.rows.length || triggers.rows.some(t=>t.enabled!=="O")) throw new Error("DEVICE_EXISTING_TRIGGERS_UNVERIFIED");
    if (Object.values(archive.tables).reduce((n,r)=>n+r.length,0)>2000 || Object.values(current.tables).reduce((n,r)=>n+r.length,0)>2000) throw new Error("DEVICE_EXISTING_ROW_LIMIT");
    for (const table of Object.keys(archive.tables)) {
      const policy=deviceRestoreTablePolicy(table);
      if (!policy) throw new Error("DEVICE_EXISTING_POLICY_UNCLASSIFIED");
      if (policy==="PRESERVE" && resetDigest(archive.tables[table])!==resetDigest(current.tables[table])) throw new Error("DEVICE_EXISTING_PRESERVED_DIFFERENCE");
    }
    const protectedDigest=async()=>{
      const rows: Record<string,string[]>={};
      for (const table of tenantResetTableNames) {
        if (deviceRestoreTablePolicy(table)==="REPLACE" || table==="LicenseUsage") continue;
        if (["PlatformAccount","PlatformSession","PlatformIdempotencyKey"].includes(table)) {
          const allowed=(await db.query<{allowed:boolean}>("SELECT has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",[ident(table)])).rows[0]?.allowed;
          if(allowed!==false)throw new Error("DEVICE_EXISTING_GLOBAL_WRITE_PRIVILEGE");
          continue;
        }
        const found=await db.query<{row:string}>(`SELECT to_jsonb(t)::text AS row FROM ${ident(table)} t WHERE ${tenantResetOwnershipPredicate(table)} ORDER BY to_jsonb(t)::text COLLATE "C" LIMIT 2001`,table==="PlatformSession"?[]:[input.tenantId]);
        if(found.rows.length>2000)throw new Error("DEVICE_EXISTING_ROW_LIMIT");
        rows[table]=found.rows.map(r=>r.row);
      }
      return resetDigest(rows);
    };
    const before=await protectedDigest(),usageBefore=await readRestoreLicenseUsage(db,input.tenantId);
    const stateDigest = async (tables: typeof archive.tables, files: typeof archive.files) => resetDigest({ tables, protectedDigest: before, usage:await readRestoreLicenseUsage(db,input.tenantId), ...(s3 ? {files:filesDigest(files)} : {}) });
    if(deployed){
      const scanner=createUploadAvScannerFromEnv();
      const bodies=[...archive.files.map(f=>({body:Buffer.from(f.contentBase64,"base64"),sha256:f.sha256})),...["HomeworkMaterialFile","SupportTicketAttachment"].flatMap(table=>(archive.tables[table]??[]).map(e=>JSON.parse(e.row)).filter(row=>row.contentBase64!=null).map(row=>({body:Buffer.from(row.contentBase64,"base64"),sha256:String(row.sha256)})))];
      for(const file of bodies)try{await scanner.scan({surface:"device_restore",tenantId:input.tenantId,fileName:"archive-file",contentType:"application/octet-stream",...file});}finally{file.body.fill(0);}
    }
    const receipt=(await db.query<{archive_digest:string;schema_digest:string;result_digest:string}>("SELECT archive_digest,schema_digest,result_digest FROM device_existing_restore.receipts WHERE operation_id=$1 AND tenant_id=$2",[input.operationId,input.tenantId])).rows[0];
    if(receipt){
      if(receipt.archive_digest!==archiveDigest || receipt.schema_digest!==schema)throw new Error("DEVICE_EXISTING_RECEIPT_MISMATCH");
      if(receipt.result_digest!==await stateDigest(current.tables,current.files))throw new Error("DEVICE_EXISTING_RECEIPT_STATE_CHANGED");
      if (s3 && input.objects) await stageExistingRestoreObjects(s3,input.objects.bucket,input.operationId,archive.files,intent,true);
      return {objectStorageVerified:Boolean(s3),databaseRowsRestored:true,protectedRowsUnchanged:true,globalStateVerified:false,mutations:0,replay:true,restoreVerified:false,canRestore:false};
    }
    const changedTables=new Set<string>();
    const tasks: Array<{sql:string;values:unknown[]}>=[];
    for (const [table,entries] of Object.entries(archive.tables)) {
      if (deviceRestoreTablePolicy(table)!=="REPLACE") continue;
      if (resetDigest(entries)!==resetDigest(current.tables[table])) changedTables.add(table);
      const old=new Map(current.tables[table]!.map(e=>[JSON.parse(e.row).id as string,e]));
      const next=new Set(entries.map(e=>JSON.parse(e.row).id as string));
      for (const id of old.keys()) if (!next.has(id)) tasks.push({sql:`DELETE FROM ${ident(table)} WHERE id=$1 AND "tenantId"=$2`,values:[id,input.tenantId]});
      for (const entry of entries) {
        const row=JSON.parse(entry.row) as Record<string,unknown>;
        if (resetDigest(old.get(row.id as string) ?? null)===resetDigest(entry)) continue;
        const extra: Record<string,unknown>={};
        if (Object.hasOwn(entry,"nationalId")) { extra.nationalIdEncrypted=entry.nationalId==null?null:encryptTcIdentity(entry.nationalId);extra.nationalIdHash=entry.nationalId==null?null:hashTcIdentity(entry.nationalId); }
        const fields=[...Object.keys(row),...Object.keys(extra)];
        const columns=fields.map(ident).join(",");
        const changed = (await db.query<{key:string}>("SELECT key FROM jsonb_each($1::jsonb) entry WHERE entry.value IS DISTINCT FROM ($2::jsonb -> entry.key)",[entry.row,old.get(row.id as string)?.row ?? "{}"])).rows.map(r=>r.key);
        const updateFields=[...changed,...(entry.nationalId !== old.get(row.id as string)?.nationalId ? Object.keys(extra) : [])].filter(f=>f!=="id"&&f!=="tenantId");
        const updates=updateFields.map(f=>`${ident(f)}=EXCLUDED.${ident(f)}`).join(",");
        tasks.push({sql:`INSERT INTO ${ident(table)} (${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::${ident(table)},$1::jsonb || $2::jsonb) ON CONFLICT (id) ${updates ? `DO UPDATE SET ${updates} WHERE ${ident(table)}."tenantId"=EXCLUDED."tenantId"` : "DO NOTHING"}`,values:[entry.row,JSON.stringify(extra)]});
      }
    }
    for (const fk of await readDeviceRestoreForeignKeys(db)) {
      if (!changedTables.has(fk.references)) continue;
      const owner=fk.columns.indexOf("tenantId");
      if (!fk.validated || fk.targetSchema!=="public" || owner<0 || fk.targetColumns[owner]!=="tenantId") throw new Error("DEVICE_EXISTING_FK_OWNER_UNVERIFIED");
    }
    let pending=tasks;
    // ponytail: bounded FK retries for <=2000 offline rows; production needs explicit dependency scheduling.
    while(pending.length){
      const retry: typeof pending=[];
      for(const task of pending){
        await db.query("SAVEPOINT device_row");
        try{await db.query(task.sql,task.values);}
        catch(e){await db.query("ROLLBACK TO SAVEPOINT device_row");if((e as {code?:string}).code!=="23503")throw e;retry.push(task);}
        await db.query("RELEASE SAVEPOINT device_row");
      }
      if(retry.length===pending.length)throw new Error("DEVICE_EXISTING_DEPENDENCY_UNRESOLVED");
      pending=retry;
    }
    await verifyRestoreLicenseUsage(db,input.tenantId,usageBefore);
    if (before!==await protectedDigest()) throw new Error("DEVICE_EXISTING_PROTECTED_ROWS_CHANGED");
    if(deployed)await input.assertQuiescence!();
    if (s3 && input.objects) await stageExistingRestoreObjects(s3,input.objects.bucket,input.operationId,archive.files,intent,false,input.crash);
    const actual=await projectDeviceBackup(input.tenantId,schema,db);
    if (resetDigest(actual.tables)!==resetDigest(archive.tables)) throw new Error("DEVICE_EXISTING_POSTCONDITION_FAILED");
    if (s3 && input.objects) {
      await collectExistingRestoreFiles(actual,s3,input.objects.bucket);
      validateDeviceBackupPayload(actual,input.tenantId);
      if (filesDigest(actual.files)!==filesDigest(archive.files)) throw new Error("DEVICE_EXISTING_FILE_POSTCONDITION");
      await db.query("UPDATE device_existing_restore.object_jobs SET state='COMPLETE' WHERE operation_id=$1 AND tenant_id=$2",[input.operationId,input.tenantId]);
    }
    await db.query("INSERT INTO device_existing_restore.receipts (operation_id,tenant_id,archive_digest,schema_digest,result_digest) VALUES ($1,$2,$3,$4,$5)",[input.operationId,input.tenantId,archiveDigest,schema,await stateDigest(actual.tables,actual.files)]);
    if(deployed)await input.assertQuiescence!();
    if(input.crash === "before-commit") process.kill(process.pid,"SIGKILL");
    if(input.failBeforeCommit)throw new Error("DEVICE_EXISTING_INJECTED_FAILURE");
    return {objectStorageVerified:Boolean(s3),databaseRowsRestored:true,protectedRowsUnchanged:true,globalStateVerified:false,mutations:tasks.length,replay:false,restoreVerified:false,canRestore:false};
    });
    if(input.crash === "after-commit") process.kill(process.pid,"SIGKILL");
    if(input.failAfterCommit)throw new Error("DEVICE_EXISTING_LOST_ACK");
    return result;
  }finally{
    s3?.destroy();
    // Destroy the connection: no session-level lock can leak back into a pool.
    connection.release(true);
    await pool.end();
  }
}
