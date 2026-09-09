import { createHash, randomUUID, type KeyObject } from "node:crypto";
import pg from "pg";
import { Queue } from "bullmq";
import { parseRedisUrl } from "../config/env.js";
import { decryptResetPackage, encryptResetPackage, requireNoTenantMutationActivity, tenantResetQueues, freshResetQueue, resetDigest, withTenantDb, type Queryable, type ResetS3Config } from "@o-okul/db";
import { deviceBackupFileLimit, deviceBackupPasswordSchema } from "./device-backup-archive.js";
import { restoreDeployedDeviceBackup, restoreExistingDeviceBackupDrill } from "./device-backup-existing-drill.js";

export type DeviceRestoreWorkerConfig = { databaseUrl: string; tenantId: string; custodyKey: Buffer; trustedKeys: Map<string,KeyObject>; objects: ResetS3Config };
export type DeviceRestoreRequest = { actorUserId:string;sessionId:string;membershipId:string;membershipVersion:number;expectedLifecycleVersion:number;sourceDigest:string;tableCounts:Record<string,number>;fileCount:number };
type Work = { operation_id: string; tenant_id: string; archive_digest: string; target: string; envelope: Buffer; approval:{actorUserId:string;lifecycleVersion:number}|null; state: "AWAITING_APPROVAL" | "QUEUED" | "RUNNING" | "COMPLETED" | "ABORTED" | "BLOCKED" };
const sha = (file: Buffer) => createHash("sha256").update(file).digest("hex");
const target = (config: DeviceRestoreWorkerConfig) => {
  const database = new URL(config.databaseUrl);
  return resetDigest({ database: { hostname:database.hostname,port:database.port || "5432",database:database.pathname }, objects:{endpoint:config.objects.endpoint,bucket:config.objects.bucket} });
};

/** Private custody only: neither the archive nor its password belongs in a queue payload/log. */
export async function storeDeviceRestoreWork(db: Queryable, config: DeviceRestoreWorkerConfig, operationId: string, file: Buffer, password: string, request: DeviceRestoreRequest) {
  if (!/^[a-f0-9]{32}$/.test(operationId) || file.length > deviceBackupFileLimit || !file.length || config.custodyKey.length !== 32 || !deviceBackupPasswordSchema.safeParse(password).success) throw new Error("DEVICE_RESTORE_CUSTODY_INVALID");
  const archiveDigest = sha(file), binding = target(config);
  const previous = (await db.query<Work>("SELECT operation_id,tenant_id,archive_digest,target,state FROM device_existing_restore.work WHERE operation_id=$1 AND tenant_id=$2",[operationId,config.tenantId])).rows[0];
  if (previous) {
    if (previous.archive_digest !== archiveDigest || previous.target !== binding) throw new Error("DEVICE_RESTORE_CUSTODY_CONFLICT");
    return { operationId, state: previous.state };
  }
  const bytes = Buffer.from(JSON.stringify({ domain:"device-restore-work-v1",operationId,tenantId:config.tenantId,archiveDigest,target:binding,request,file:file.toString("base64"),password }));
  try {
    const envelope = encryptResetPackage(bytes,config.custodyKey);
    await db.query("INSERT INTO device_existing_restore.work (operation_id,tenant_id,archive_digest,target,envelope,request,state) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'AWAITING_APPROVAL')",[operationId,config.tenantId,archiveDigest,binding,envelope,JSON.stringify(request)]);
  } finally { bytes.fill(0); }
  return { operationId, state:"AWAITING_APPROVAL" };
}

/** One exact institution, one durable claim. PostgreSQL is the queue and recovery authority. */
export async function runDeviceRestoreWorkerOnce(config: DeviceRestoreWorkerConfig, crash?: Parameters<typeof restoreExistingDeviceBackupDrill>[0]["crash"]) {
  const database = new URL(config.databaseUrl);
  const deployed=process.env.TENANT_DEVICE_RESTORE_ENABLED==="1";
  if(deployed && (process.env.TENANT_DEVICE_RESTORE_TENANT_ID!==config.tenantId || process.env.TENANT_DEVICE_RESTORE_DATABASE_URL!==config.databaseUrl || !process.env.REDIS_URL || crash))throw new Error("DEVICE_RESTORE_DEPLOYMENT_DISABLED");
  if (!deployed && (database.protocol !== "postgresql:" || !["127.0.0.1","localhost"].includes(database.hostname) || database.pathname !== "/o_okul_reset_drill" || database.search || database.hash || !/^device-backup-[a-f0-9-]+-a$/.test(config.tenantId) || config.custodyKey.length !== 32)) throw new Error("DEVICE_RESTORE_WORKER_DISPOSABLE_REQUIRED");
  const pool = new pg.Pool({connectionString:config.databaseUrl,max:1,connectionTimeoutMillis:5000,statement_timeout:15000});
  const connection = await pool.connect();
  const session = {query:connection.query.bind(connection),connect:async()=>({query:connection.query.bind(connection),release(){}})};
  const tx = <T>(run: (db: Queryable) => Promise<T>) => withTenantDb(session,{tenantId:config.tenantId},run);
  let work: Work | undefined;
  try {
    const locked = (await connection.query<{locked:boolean}>("SELECT pg_try_advisory_lock(hashtextextended($1,2)) AS locked",["device-restore-worker:"+config.tenantId])).rows[0]?.locked;
    if (!locked) return {state:"BUSY"};
    await tx(db=>db.query("SELECT device_existing_restore.purge_expired_custody()"));
    work = await tx(async db => (await db.query<Work>("SELECT * FROM device_existing_restore.work WHERE tenant_id=$1 AND state IN ('QUEUED','RUNNING') ORDER BY created_at,operation_id LIMIT 1",[config.tenantId])).rows[0]);
    if (!work) return {state:"IDLE"};
    if (work.target !== target(config) || work.tenant_id !== config.tenantId || !/^[a-f0-9]{32}$/.test(work.operation_id)) throw new Error("DEVICE_RESTORE_CUSTODY_CONFLICT");
    const bytes = decryptResetPackage(work.envelope,config.custodyKey);
    let payload;
    try { payload = JSON.parse(bytes.toString("utf8")); } finally { bytes.fill(0); }
    if (payload.domain !== "device-restore-work-v1" || payload.operationId !== work.operation_id || payload.tenantId !== work.tenant_id || payload.archiveDigest !== work.archive_digest || payload.target !== work.target || typeof payload.file !== "string" || payload.file.length > Math.ceil(deviceBackupFileLimit/3)*4 || !deviceBackupPasswordSchema.safeParse(payload.password).success) throw new Error("DEVICE_RESTORE_CUSTODY_CONFLICT");
    const file = Buffer.from(payload.file,"base64");
    if (file.toString("base64") !== payload.file || sha(file) !== work.archive_digest) throw new Error("DEVICE_RESTORE_CUSTODY_CONFLICT");
    const recover = work.state === "RUNNING";
    await tx(db=>db.query("UPDATE device_existing_restore.work SET state='RUNNING',updated_at=now() WHERE operation_id=$1 AND tenant_id=$2",[work!.operation_id,config.tenantId]));
    let result;
    try {
      result = await (deployed ? restoreDeployedDeviceBackup : restoreExistingDeviceBackupDrill)({databaseUrl:config.databaseUrl,tenantId:config.tenantId,operationId:work.operation_id,file,password:payload.password,trustedKeys:config.trustedKeys,objects:config.objects,custodyKey:config.custodyKey,assertQuiescence:deployed?()=>assertDeviceRestoreQueuesEmpty(config.tenantId):undefined,recover,crash});
    } finally { file.fill(0); payload.password=""; payload.file=""; }
    const state = "aborted" in result && result.aborted ? result.oldStateVerified ? "ABORTED" : "BLOCKED" : "COMPLETED";
    await withTenantDb(session,{tenantId:config.tenantId},async db=>{
      if(deployed){
        const tenant=(await db.query<{status:string;lifecycleVersion:number}>('SELECT status,"lifecycleVersion" FROM "Tenant" WHERE id=$1 FOR UPDATE',[config.tenantId])).rows[0];
        if(!work!.approval||tenant?.status!=="SUSPENDED"||tenant.lifecycleVersion!==work!.approval.lifecycleVersion)throw new Error("DEVICE_RESTORE_FINAL_STATE_CHANGED");
        await requireNoTenantMutationActivity(db,config.tenantId);await assertDeviceRestoreQueuesEmpty(config.tenantId);
      }
      await db.query("UPDATE device_existing_restore.work SET state=$3,error_code=CASE WHEN $3='COMPLETED' THEN NULL ELSE error_code END,result=$4::jsonb,updated_at=now() WHERE operation_id=$1 AND tenant_id=$2",[work!.operation_id,config.tenantId,state,JSON.stringify(result)]);
      if(deployed && (state==="COMPLETED" || ("oldStateVerified" in result && result.oldStateVerified))){
        await db.query('UPDATE "Tenant" SET status=\'ACTIVE\',"lifecycleVersion"="lifecycleVersion"+1,"suspendedAt"=NULL,"suspendedReason"=NULL,"updatedAt"=now() WHERE id=$1',[config.tenantId]);
        await db.query('INSERT INTO "AuditLog" (id,"tenantId","actorUserId","entityType","entityId",action,diff) VALUES ($1,$2,$3,\'DeviceRestore\',$4,\'tenant.device_restore.finished\',$5::jsonb)',[randomUUID(),config.tenantId,work!.approval!.actorUserId,work!.operation_id,JSON.stringify({state,lifecycleVersion:work!.approval!.lifecycleVersion+1})]);
      }
    });
    return {operationId:work.operation_id,state,result};
  } catch (error) {
    // Keep RUNNING after ambiguous execution: the next process consults the commit receipt.
    const code = error instanceof Error && /^DEVICE_[A-Z_]+$/.test(error.message) ? error.message : "DEVICE_RESTORE_EXECUTION_FAILED";
    if (work) try { await tx(db=>db.query("UPDATE device_existing_restore.work SET error_code=$3,updated_at=now() WHERE operation_id=$1 AND tenant_id=$2",[work!.operation_id,config.tenantId,code])); } catch { /* Durable state survives a lost connection. */ }
    throw new Error(code);
  } finally { connection.release(true);await pool.end(); }
}

export async function assertDeviceRestoreQueuesEmpty(tenantId: string) {
  if(!process.env.REDIS_URL)throw new Error("DEVICE_RESTORE_QUEUE_CONFIG_REQUIRED");
  const connection=parseRedisUrl(process.env.REDIS_URL);
  for(const name of [...tenantResetQueues,freshResetQueue]){
    const queue=new Queue(name,{connection,prefix:process.env.QUEUE_PREFIX,skipMetasUpdate:true});
    try{
      if((await queue.getJobSchedulers(0,-1)).length || (await queue.getRepeatableJobs(0,-1)).length)throw new Error("DEVICE_RESTORE_SCHEDULED_WORK_UNVERIFIED");
      for(let start=0;;start+=100){
        if(start>=10000)throw new Error("DEVICE_RESTORE_QUEUE_INVENTORY_LIMIT");
        const jobs=await queue.getJobs(["active","wait","delayed","prioritized","paused","waiting-children","failed"],start,start+99);
        for(const job of jobs){const owner=job.data?.tenantId??job.data?.snapshot?.tenantId;if(!owner||owner===tenantId)throw new Error("DEVICE_RESTORE_PENDING_WORK");}
        if(jobs.length<100)break;
      }
    }finally{await queue.close();}
  }
}
