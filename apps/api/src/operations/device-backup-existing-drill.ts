import { createHash, type KeyObject } from "node:crypto";
import pg from "pg";
import { withTenantDb, readTenantBackupSchema, tenantResetOwnershipPredicate, resetDigest, tenantResetTableNames, tenantDatabaseLockKey } from "@o-okul/db";
import { openDeviceBackup } from "./device-backup-archive.js";
import { projectDeviceBackup, validateDeviceBackupPayload } from "./device-backup.service.js";
import { readDeviceRestoreForeignKeys } from "./device-backup-references.js";
import { deviceRestoreTablePolicy } from "./device-backup-impact.js";
import { encryptTcIdentity, hashTcIdentity } from "../student/tc-identity.js";

const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
/** Database-only offline drill. Never an API/worker entry point or an apply authorization. */
export async function restoreExistingDeviceBackupDrill(input: { databaseUrl: string; tenantId: string; file: Buffer; password: string; trustedKeys: Map<string, KeyObject>; operationId: string; failBeforeCommit?: boolean; failAfterCommit?: boolean }) {
  if (!/^[a-f0-9]{32}$/.test(input.operationId)) throw new Error("DEVICE_EXISTING_OPERATION_REQUIRED");
  const archiveDigest=createHash("sha256").update(input.file).digest("hex");
  const url = new URL(input.databaseUrl);
  if (url.protocol !== "postgresql:" || !["localhost","127.0.0.1"].includes(url.hostname) || url.search || url.hash || !["/o_okul_reset_drill","/o_okul_device_backup_test"].includes(url.pathname) || !/^device-backup-[a-f0-9-]+-a$/.test(input.tenantId)) throw new Error("DEVICE_EXISTING_DISPOSABLE_REQUIRED");
  const opened = await openDeviceBackup(input.file,input.tenantId,input.password,input.trustedKeys);
  let archive;
  try { archive = validateDeviceBackupPayload(JSON.parse(opened.payload.toString("utf8")),input.tenantId); }
  finally { opened.payload.fill(0); }
  if (archive.files.length) throw new Error("DEVICE_EXISTING_FILES_UNSUPPORTED");
  const pool = new pg.Pool({ connectionString: input.databaseUrl, max: 1, options: "-c default_transaction_isolation=serializable", connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  try {
    const result=await withTenantDb(pool,{tenantId:input.tenantId,bypassRls:false},async db=>{
    await db.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=public,pg_catalog");
    await db.query("SELECT set_config('app.current_tenant_id',$1,true),set_config('app.bypass_rls','false',true),pg_advisory_xact_lock(hashtextextended($2,0))",[input.tenantId,tenantDatabaseLockKey(input.tenantId)]);
    const role=(await db.query<{rolsuper:boolean;rolbypassrls:boolean}>("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
    if (!role || role.rolsuper || role.rolbypassrls) throw new Error("DEVICE_EXISTING_UNPRIVILEGED_REQUIRED");
    const tenant=(await db.query<{status:string}>('SELECT status FROM "Tenant" WHERE id=$1 FOR UPDATE',[input.tenantId])).rows[0];
    if (tenant?.status !== "SUSPENDED") throw new Error("DEVICE_EXISTING_SUSPENDED_REQUIRED");
    // Only inactive synthetic data: this does not stand in for production queue/provider quiescence.
    for (const table of ["AuthSession","IdentityInvitation","PasswordResetToken","SecretDeliveryOutbox","TenantMutationActivity"] as const) {
      if ((await db.query(`SELECT 1 FROM ${ident(table)} t WHERE ${tenantResetOwnershipPredicate(table)} LIMIT 1`,[input.tenantId])).rows.length) throw new Error("DEVICE_EXISTING_ACTIVITY_PRESENT");
    }
    if ((await db.query('SELECT id FROM "User" WHERE "tenantId"=$1 AND "accountStatus"<>\'DISABLED\' LIMIT 1',[input.tenantId])).rows.length) throw new Error("DEVICE_EXISTING_ACTIVE_IDENTITY");
    const schema=await readTenantBackupSchema(db);
    if (schema !== archive.schemaDigest) throw new Error("DEVICE_EXISTING_SCHEMA_MISMATCH");
    const current=validateDeviceBackupPayload(await projectDeviceBackup(input.tenantId,schema,db),input.tenantId);
    if (current.files.length) throw new Error("DEVICE_EXISTING_FILES_UNSUPPORTED");
    for (const table of ["Student","Teacher","Guardian","Employee"]) {
      if ([...(archive.tables[table] ?? []),...(current.tables[table] ?? [])].some(e=>JSON.parse(e.row).userId!=null)) throw new Error("DEVICE_EXISTING_ACCOUNT_LINKS_UNSUPPORTED");
    }
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
        if (deviceRestoreTablePolicy(table)==="REPLACE") continue;
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
    const before=await protectedDigest();
    const receipt=(await db.query<{archive_digest:string;schema_digest:string;result_digest:string}>("SELECT archive_digest,schema_digest,result_digest FROM device_existing_restore.receipts WHERE operation_id=$1 AND tenant_id=$2",[input.operationId,input.tenantId])).rows[0];
    if(receipt){
      if(receipt.archive_digest!==archiveDigest || receipt.schema_digest!==schema)throw new Error("DEVICE_EXISTING_RECEIPT_MISMATCH");
      if(receipt.result_digest!==resetDigest({tables:current.tables,protectedDigest:before}))throw new Error("DEVICE_EXISTING_RECEIPT_STATE_CHANGED");
      return {databaseRowsRestored:true,protectedRowsUnchanged:true,globalStateVerified:false,mutations:0,replay:true,restoreVerified:false,canRestore:false};
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
        const updates=fields.filter(f=>f!=="id"&&f!=="tenantId").map(f=>`${ident(f)}=EXCLUDED.${ident(f)}`).join(",");
        tasks.push({sql:`INSERT INTO ${ident(table)} (${columns}) SELECT ${columns} FROM jsonb_populate_record(NULL::${ident(table)},$1::jsonb || $2::jsonb) ON CONFLICT (id) DO UPDATE SET ${updates} WHERE ${ident(table)}."tenantId"=EXCLUDED."tenantId"`,values:[entry.row,JSON.stringify(extra)]});
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
    if (before!==await protectedDigest()) throw new Error("DEVICE_EXISTING_PROTECTED_ROWS_CHANGED");
    const actual=await projectDeviceBackup(input.tenantId,schema,db);
    if (resetDigest(actual.tables)!==resetDigest(archive.tables)) throw new Error("DEVICE_EXISTING_POSTCONDITION_FAILED");
    await db.query("INSERT INTO device_existing_restore.receipts (operation_id,tenant_id,archive_digest,schema_digest,result_digest) VALUES ($1,$2,$3,$4,$5)",[input.operationId,input.tenantId,archiveDigest,schema,resetDigest({tables:actual.tables,protectedDigest:before})]);
    if(input.failBeforeCommit)throw new Error("DEVICE_EXISTING_INJECTED_FAILURE");
    return {databaseRowsRestored:true,protectedRowsUnchanged:true,globalStateVerified:false,mutations:tasks.length,replay:false,restoreVerified:false,canRestore:false};
    });
    if(input.failAfterCommit)throw new Error("DEVICE_EXISTING_LOST_ACK");
    return result;
  }finally{await pool.end();}
}
