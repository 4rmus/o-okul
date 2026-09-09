import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { Queue } from "bullmq";
import { CreateBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { readTenantBackupSchema, resetBytesHash, resetS3Client, withTenantDb } from "@o-okul/db";
import { createAdminMfaStepUpProof } from "../auth/totp-mfa.js";
import { parseRedisUrl } from "../config/env.js";
import type { RequestContext } from "../context/request-context.js";
import { deviceBackupKeyId } from "./device-backup-archive.js";
import { DeviceBackupService, projectDeviceBackup } from "./device-backup.service.js";
import { DeviceRestoreService } from "./device-restore.service.js";
import { runDeviceRestoreWorkerOnce } from "./device-restore-worker.js";

const appUrl=process.env.DEVICE_EXISTING_CUSTODY_URL,workerUrl=process.env.DEVICE_EXISTING_APP_URL,adminUrl=process.env.DEVICE_EXISTING_ADMIN_URL,endpoint=process.env.DEVICE_EXISTING_OBJECT_ENDPOINT,redisUrl=process.env.DEVICE_EXISTING_REDIS_URL;
if(process.env.DEVICE_EXISTING_OBJECTS_REQUIRED==="1"&&(!appUrl||!workerUrl||!adminUrl||!endpoint||!redisUrl))throw new Error("DEVICE_RESTORE_INTEGRATION_CONFIG_REQUIRED");
(appUrl&&workerUrl&&adminUrl&&endpoint&&redisUrl?describe:describe.skip)("device restore admission and dedicated worker",()=>{
  it("binds Idempotency-Key and MFA to the institution request, freezes once and restores through the configured worker",async()=>{
    for(const value of [appUrl!,workerUrl!,adminUrl!]){const u=new URL(value);expect(u.hostname).toBe("127.0.0.1");expect(u.pathname).toBe("/o_okul_reset_drill");}
    const admin=new pg.Pool({connectionString:adminUrl}),app=new pg.Pool({connectionString:appUrl});
    const tenantId="device-backup-"+randomUUID()+"-a",other="device-backup-"+randomUUID()+"-a",actorId="restore-system-"+randomUUID();
    const keys=generateKeyPairSync("ed25519"),custodyKey=randomBytes(32),password="restore integration archive password";
    const objects={endpoint:endpoint!,bucket:"device-existing-"+randomBytes(12).toString("hex"),region:"us-east-1",accessKeyId:process.env.DEVICE_EXISTING_OBJECT_ACCESS_KEY!,secretAccessKey:process.env.DEVICE_EXISTING_OBJECT_SECRET_KEY!};
    const s3=resetS3Client(objects);
    for(const [name,value]of Object.entries({DATABASE_URL:appUrl!,PERSISTENCE_DRIVER:"postgres",TENANT_STORE:"postgres",REDIS_URL:redisUrl!,TENANT_DEVICE_RESTORE_ENABLED:"1",TENANT_DEVICE_RESTORE_TENANT_ID:tenantId,TENANT_DEVICE_RESTORE_DATABASE_URL:workerUrl!,TENANT_DEVICE_RESTORE_CUSTODY_KEY:custodyKey.toString("base64"),TENANT_DEVICE_BACKUP_SIGNING_PRIVATE_KEY:keys.privateKey.export({type:"pkcs8",format:"pem"}).toString(),S3_ENDPOINT:objects.endpoint,S3_BUCKET:objects.bucket,S3_ACCESS_KEY_ID:objects.accessKeyId,S3_SECRET_ACCESS_KEY:objects.secretAccessKey,UPLOAD_AV_SCANNER:"disabled"}))vi.stubEnv(name,value);
    const backups=new DeviceBackupService(),restores=new DeviceRestoreService(backups);
    const owner:RequestContext={tenantId,userId:tenantId+"-user",sessionId:tenantId+"-session",membershipId:tenantId+"-member",membershipVersion:1,tenantLifecycleVersion:0,activePersona:"STAFF",roles:["TENANT_ADMIN"],bypassRls:false};
    const system:RequestContext={tenantId:null,userId:actorId,sessionId:actorId+"-session",membershipVersion:1,roles:["SYSTEM_ADMIN"],bypassRls:true};
    const queue=new Queue("exam-evaluation",{connection:parseRedisUrl(redisUrl!)});
    try{
      await s3.send(new CreateBucketCommand({Bucket:objects.bucket}));
      for(const id of [tenantId,other]){
        await admin.query('INSERT INTO "Tenant" (id,name,slug,status,"updatedAt") VALUES ($1,$1,$1,\'ACTIVE\',now())',[id]);
        await admin.query('INSERT INTO "User" (id,"tenantId",name,"passwordHash","accountStatus","updatedAt") VALUES ($1,$2,\'Owner\',\'!preserve-credentials!\',\'ACTIVE\',now())',[id+"-user",id]);
        await admin.query('INSERT INTO "TenantMembership" (id,"tenantId","userId",role,"staffRole","scopeMode","updatedAt") VALUES ($1,$2,$3,\'TENANT_ADMIN\',\'TENANT_ADMIN\',\'TENANT\',now())',[id+"-member",id,id+"-user"]);
        await admin.query('INSERT INTO "AuthSession" (id,"tenantId","userId","membershipId","activePersona",roles,"tokenFamilyId","refreshTokenHash","expiresAt","updatedAt") VALUES ($1,$2,$3,$4,\'STAFF\',ARRAY[\'TENANT_ADMIN\'],$1,$1,now()+interval \'1 day\',now())',[id+"-session",id,id+"-user",id+"-member"]);
        await admin.query('INSERT INTO "LicenseTerm" (id,"tenantId","planCode","startsAt","endsAt","activeStudentLimit") VALUES ($1,$2,\'FIXTURE\',now()-interval \'1 day\',now()+interval \'1 day\',100)',[id+"-term",id]);
        await admin.query('UPDATE "Tenant" SET plan=t."planCode","licenseStartsAt"=t."startsAt","licenseEndsAt"=t."endsAt","seatLimit"=100 FROM "LicenseTerm" t WHERE "Tenant".id=$1 AND t.id=$2',[id,id+"-term"]);
        await admin.query('INSERT INTO "Exam" (id,"tenantId",title,"updatedAt") VALUES ($1,$2,\'Archived exam\',now())',[id+"-exam",id]);
      }
      await admin.query('INSERT INTO "Tenant" (id,name,slug,status,"updatedAt") VALUES (\'system\',\'System fixture\',\'system\',\'ACTIVE\',now()) ON CONFLICT(id) DO NOTHING');
      await admin.query('INSERT INTO "User" (id,"tenantId",name,"passwordHash","accountStatus","updatedAt") VALUES ($1,\'system\',\'System fixture\',\'!fixture!\',\'ACTIVE\',now())',[actorId]);
      await admin.query('INSERT INTO "AuthSession" (id,"tenantId","userId",roles,"tokenFamilyId","refreshTokenHash","expiresAt","updatedAt") VALUES ($1,\'system\',$2,ARRAY[\'SYSTEM_ADMIN\'],$1,$1,now()+interval \'1 day\',now())',[actorId+"-session",actorId]);
      const bytes=Buffer.from("synthetic archived bytes"),sha256=resetBytesHash(bytes),key=`raw-imports/${tenantId}/${tenantId}-exam/v1/${sha256}/source`;
      await admin.query('INSERT INTO "RawImport" (id,"tenantId","examId","sourceType","fileName","s3Key",sha256,"parserConfigVersion","updatedAt") VALUES ($1,$2,$3,\'TXT\',\'fixture.txt\',$4,$5,\'v1\',now())',[tenantId+"-raw",tenantId,tenantId+"-exam",key,sha256]);
      await s3.send(new PutObjectCommand({Bucket:objects.bucket,Key:key,Body:bytes}));
      const file=await backups.download(owner,password);
      await admin.query('UPDATE "Exam" SET title=\'Current exam\' WHERE id=$1',[tenantId+"-exam"]);
      const preview=await backups.preview(owner,file,password);
      await expect(restores.request({...owner,roles:["TEACHER"]},file,password,preview.plan!.token,"bad-role")).rejects.toMatchObject({status:403});
      await expect(restores.request(owner,file,password,"invalid","bad-plan")).rejects.toMatchObject({status:409});
      const op=await restores.request(owner,file,password,preview.plan!.token,"device-restore-idempotency-a");
      expect(op.state).toBe("AWAITING_APPROVAL");
      expect(await restores.request(owner,file,password,preview.plan!.token,"device-restore-idempotency-a")).toEqual(op);
      const workerConfig={databaseUrl:workerUrl!,tenantId,objects,custodyKey,trustedKeys:new Map([[deviceBackupKeyId(keys.publicKey),keys.publicKey]])};
      expect(await runDeviceRestoreWorkerOnce(workerConfig)).toEqual({state:"IDLE"});
      await expect(restores.approve(system,tenantId,op.operationId,"invalid")).rejects.toMatchObject({status:401});
      const proof=createAdminMfaStepUpProof({userId:actorId,sessionId:system.sessionId!,membershipVersion:1,purpose:"TENANT_DEVICE_RESTORE",target:{tenantId,operationId:op.operationId,archiveDigest:op.archiveDigest,expectedLifecycleVersion:op.expectedLifecycleVersion}}).stepUpToken;
      const wrongProof=createAdminMfaStepUpProof({userId:actorId,sessionId:system.sessionId!,membershipVersion:1,purpose:"TENANT_DEVICE_RESTORE",target:{tenantId,operationId:randomBytes(16).toString("hex"),archiveDigest:op.archiveDigest,expectedLifecycleVersion:op.expectedLifecycleVersion}}).stepUpToken;
      await expect(restores.approve(system,tenantId,op.operationId,wrongProof)).rejects.toMatchObject({status:401});
      await admin.query('UPDATE "Exam" SET title=\'Changed after request\' WHERE id=$1',[tenantId+"-exam"]);
      await expect(restores.approve(system,tenantId,op.operationId,proof)).rejects.toThrow("DEVICE_RESTORE_SOURCE_CHANGED");
      await admin.query('UPDATE "Exam" SET title=\'Current exam\' WHERE id=$1',[tenantId+"-exam"]);
      const queued=await queue.add("fixture",{tenantId},{jobId:"device-restore-pending-"+randomUUID()});
      await expect(restores.approve(system,tenantId,op.operationId,proof)).rejects.toThrow("DEVICE_RESTORE_PENDING_WORK");
      expect((await admin.query('SELECT status FROM "Tenant" WHERE id=$1',[tenantId])).rows[0].status).toBe("ACTIVE");
      await queued.remove();
      const resetId=randomBytes(16).toString("hex");
      await admin.query('INSERT INTO "TenantFreshResetOperation" (id,"tenantId","actorUserId","idempotencyKey","requestHash","expectedLifecycleVersion","preflightDigest",reason,status) VALUES ($1,$2,$3,$1,$4,0,$4,\'OPERATIONS_REVIEW\',\'BLOCKED\')',[resetId,tenantId,actorId,"a".repeat(64)]);
      await expect(restores.approve(system,tenantId,op.operationId,proof)).rejects.toThrow("DEVICE_RESTORE_RESET_IN_PROGRESS");
      await admin.query('UPDATE "TenantFreshResetOperation" SET status=\'COMPLETED\',phase=\'DONE\' WHERE id=$1',[resetId]);
      await expect(restores.current(owner,other)).rejects.toMatchObject({status:403});
      expect((await restores.approve(system,tenantId,op.operationId,proof)).state).toBe("QUEUED");
      expect((await restores.approve(system,tenantId,op.operationId,proof)).state).toBe("QUEUED");
      expect((await admin.query('SELECT status,"lifecycleVersion" FROM "Tenant" WHERE id=$1',[tenantId])).rows[0]).toEqual({status:"SUSPENDED",lifecycleVersion:1});
      expect((await admin.query('SELECT status FROM "AuthSession" WHERE id=$1',[owner.sessionId])).rows[0].status).toBe("REVOKED");
      expect(await runDeviceRestoreWorkerOnce(workerConfig)).toMatchObject({state:"COMPLETED"});
      expect((await admin.query('SELECT status,"lifecycleVersion" FROM "Tenant" WHERE id=$1',[tenantId])).rows[0]).toEqual({status:"ACTIVE",lifecycleVersion:2});
      expect((await admin.query('SELECT title FROM "Exam" WHERE id=$1',[tenantId+"-exam"])).rows[0].title).toBe("Archived exam");
      expect((await admin.query('SELECT status FROM "AuthSession" WHERE id=$1',[owner.sessionId])).rows[0].status).toBe("REVOKED");
      expect((await admin.query('SELECT "passwordHash" FROM "User" WHERE id=$1',[owner.userId])).rows[0].passwordHash).toBe("!preserve-credentials!");
      expect((await admin.query('SELECT status,"lifecycleVersion" FROM "Tenant" WHERE id=$1',[other])).rows[0]).toEqual({status:"ACTIVE",lifecycleVersion:0});
      expect((await restores.current(system,tenantId)).operation?.state).toBe("COMPLETED");
      expect(await runDeviceRestoreWorkerOnce(workerConfig)).toEqual({state:"IDLE"});
      expect((await admin.query('SELECT envelope IS NOT NULL AND recovery_envelope IS NOT NULL AS retained FROM device_existing_restore.work WHERE operation_id=$1',[op.operationId])).rows[0].retained).toBe(true);
      await withTenantDb(app,{tenantId,readOnly:true},async db=>{expect((await projectDeviceBackup(tenantId,await readTenantBackupSchema(db),db)).tables.RawImport).toHaveLength(1);});
    }finally{await queue.close();s3.destroy();await restores.onApplicationShutdown();await backups.onApplicationShutdown();await Promise.all([app.end(),admin.end()]);custodyKey.fill(0);vi.unstubAllEnvs();}
  },120000);
});
