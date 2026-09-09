import { createHash, randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import pg from "pg";
import { resetS3Config, requireNoTenantMutationActivity, tenantDatabaseLockKey, withTenantDb } from "@o-okul/db";
import type { TenantDeviceRestoreOperation } from "@o-okul/shared-types";
import { hashIdempotencyRequest } from "../http/idempotency.js";
import { verifyAdminMfaStepUpProof } from "../auth/totp-mfa.js";
import type { RequestContext } from "../context/request-context.js";
import { waitForApiMutations } from "../context/tenant-mutation-activity.js";
import { assertInstitutionAdmin, assertResetAdmin } from "../tenant/tenant-fresh-reset.service.js";
import { deviceBackupSigningKeys } from "./device-backup-archive.js";
import { assertSourceActor, DeviceBackupService, projectDeviceBackup, readDeviceDomainRows, readDeviceRestoreSourceDigest } from "./device-backup.service.js";
import { readTenantBackupSchema } from "@o-okul/db";
import { deviceDomainLinks } from "./device-backup-domain-links.js";
import { deviceRestoreTablePolicy } from "./device-backup-impact.js";
import { assertDeviceRestoreQueuesEmpty, storeDeviceRestoreWork, type DeviceRestoreRequest } from "./device-restore-worker.js";

type Stored = {operation_id:string;tenant_id:string;archive_digest:string;state:TenantDeviceRestoreOperation["state"];request:DeviceRestoreRequest;error_code:string|null;created_at:Date};
const columns="operation_id,tenant_id,archive_digest,state,request,error_code,created_at";
const status=(row:Stored):TenantDeviceRestoreOperation=>({operationId:row.operation_id,tenantId:row.tenant_id,archiveDigest:row.archive_digest,expectedLifecycleVersion:row.request.expectedLifecycleVersion,state:row.state,tableCounts:row.request.tableCounts,fileCount:row.request.fileCount,errorCode:row.error_code,createdAt:row.created_at.toISOString()});

@Injectable()
export class DeviceRestoreService {
  private pool?:pg.Pool;
  constructor(private readonly backups:DeviceBackupService){}
  private source(){return this.pool??=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});}
  enabled(tenantId:string){return process.env.TENANT_DEVICE_RESTORE_ENABLED==="1" && process.env.TENANT_DEVICE_RESTORE_TENANT_ID===tenantId;}
  private config(tenantId:string){
    if(!this.enabled(tenantId))throw new ServiceUnavailableException("DEVICE_RESTORE_DISABLED");
    const databaseUrl=process.env.DATABASE_URL,custodyKey=Buffer.from(process.env.TENANT_DEVICE_RESTORE_CUSTODY_KEY??"","base64");
    if(!databaseUrl||custodyKey.length!==32)throw new ServiceUnavailableException("DEVICE_RESTORE_CONFIG_REQUIRED");
    return {databaseUrl,tenantId,custodyKey,trustedKeys:deviceBackupSigningKeys().publicKeys,objects:resetS3Config()};
  }
  async current(context:RequestContext,tenantId=context.tenantId!){
    if(context.roles.includes("SYSTEM_ADMIN"))assertResetAdmin(context,tenantId);else{assertInstitutionAdmin(context);if(context.tenantId!==tenantId)throw new ForbiddenException();}
    if(!this.enabled(tenantId))return {available:false,operation:null};
    return withTenantDb(this.source(),{tenantId,readOnly:true},async db=>{
      const row=(await db.query<Stored>(`SELECT ${columns} FROM device_existing_restore.work WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`,[tenantId])).rows[0];
      return {available:true,operation:row?status(row):null};
    });
  }
  async request(context:RequestContext,file:Buffer,password:string,planToken:string,idempotencyKey:string){
    assertInstitutionAdmin(context);
    if(!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey))throw new ConflictException("IDEMPOTENCY_KEY_REQUIRED");
    const tenantId=context.tenantId!,config=this.config(tenantId),operationId=hashIdempotencyRequest("tenant.device-restore.request",{tenantId,actorUserId:context.userId,idempotencyKey}).slice(0,32);
    try{return await withTenantDb(this.source(),{tenantId},async db=>{
      if(!(await db.query<{locked:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",[tenantDatabaseLockKey(tenantId)])).rows[0]?.locked)throw new ConflictException("DEVICE_RESTORE_BUSY");
      await assertSourceActor(db,context);
      const previous=(await db.query<Stored>(`SELECT ${columns} FROM device_existing_restore.work WHERE tenant_id=$1 AND operation_id=$2`,[tenantId,operationId])).rows[0];
      if(previous){if(previous.archive_digest!==createHash("sha256").update(file).digest("hex"))throw new ConflictException("DEVICE_RESTORE_CUSTODY_CONFLICT");return status(previous);}
      const preview=await this.backups.preview(context,file,password,planToken);
      if(!preview.schemaCompatible||!preview.plan||!preview.impact||preview.impact.activeStudentLimit==null||preview.impact.activeStudents>preview.impact.activeStudentLimit)throw new ConflictException("DEVICE_RESTORE_PREFLIGHT_BLOCKED");
      if(Object.values(preview.tableCounts).reduce((sum,n)=>sum+n,0)>2000 || Object.values(preview.impact.tables).reduce((sum,t)=>sum+t.changed+t.removed+t.unchanged,0)>2000)throw new ConflictException("DEVICE_RESTORE_ROW_LIMIT");
      const tenant=(await db.query<{slug:string;lifecycleVersion:number}>('SELECT slug,"lifecycleVersion" FROM "Tenant" WHERE id=$1',[tenantId])).rows[0];
      if(!tenant||tenant.lifecycleVersion>2147483645||["dna","demoo","system"].includes(tenant.slug))throw new ForbiddenException("DEVICE_RESTORE_PROTECTED_TENANT");
      const request:DeviceRestoreRequest={actorUserId:context.userId,sessionId:context.sessionId!,membershipId:context.membershipId!,membershipVersion:context.membershipVersion!,expectedLifecycleVersion:tenant.lifecycleVersion,sourceDigest:await readDeviceRestoreSourceDigest(db,tenantId),tableCounts:preview.tableCounts,fileCount:preview.fileCount};
      await storeDeviceRestoreWork(db,config,operationId,file,password,request);
      return status((await db.query<Stored>(`SELECT ${columns} FROM device_existing_restore.work WHERE operation_id=$1 AND tenant_id=$2`,[operationId,tenantId])).rows[0]!);
    });}finally{config.custodyKey.fill(0);}
  }
  async cancel(context:RequestContext,operationId:string){
    assertInstitutionAdmin(context);
    return withTenantDb(this.source(),{tenantId:context.tenantId},async db=>{
      await assertSourceActor(db,context);
      const result=await db.query<Stored>(`UPDATE device_existing_restore.work SET state='ABORTED',updated_at=now() WHERE operation_id=$1 AND tenant_id=$2 AND state='AWAITING_APPROVAL' RETURNING ${columns}`,[operationId,context.tenantId]);
      if(!result.rows[0])throw new ConflictException("DEVICE_RESTORE_REQUEST_CHANGED");return status(result.rows[0]);
    });
  }
  async approve(context:RequestContext,tenantId:string,operationId:string,proof:string){
    assertResetAdmin(context,tenantId);this.config(tenantId).custodyKey.fill(0);
    if(!context.sessionId||context.membershipVersion==null)throw new UnauthorizedException("MFA_STEP_UP_REQUIRED");
    return withTenantDb(this.source(),{tenantId,bypassRls:true},async db=>{
      if(!(await db.query<{locked:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",[tenantDatabaseLockKey(tenantId)])).rows[0]?.locked)throw new ConflictException("DEVICE_RESTORE_BUSY");
      const actor=(await db.query(`SELECT s.id FROM "AuthSession" s JOIN "User" u ON u.id=s."userId" WHERE s.id=$1 AND s."userId"=$2 AND s."tenantId"='system' AND u."tenantId"='system' AND s.status='ACTIVE' AND s."expiresAt">now() AND s."membershipVersion"=$3 AND u."membershipVersion"=$3 AND u."accountStatus"='ACTIVE' AND 'SYSTEM_ADMIN'=ANY(s.roles) FOR SHARE OF s,u`,[context.sessionId,context.userId,context.membershipVersion])).rows;
      if(actor.length!==1)throw new UnauthorizedException("DEVICE_RESTORE_ADMIN_CHANGED");
      const op=(await db.query<Stored>(`SELECT ${columns} FROM device_existing_restore.work WHERE operation_id=$1 AND tenant_id=$2 FOR UPDATE`,[operationId,tenantId])).rows[0];
      if(!op)throw new ConflictException("DEVICE_RESTORE_REQUEST_CHANGED");
      try{verifyAdminMfaStepUpProof(proof,{userId:context.userId,sessionId:context.sessionId!,membershipVersion:context.membershipVersion!,purpose:"TENANT_DEVICE_RESTORE",target:{tenantId,operationId,archiveDigest:op.archive_digest,expectedLifecycleVersion:op.request.expectedLifecycleVersion}});}catch{throw new UnauthorizedException("MFA_STEP_UP_INVALID");}
      if(op.state!=="AWAITING_APPROVAL")return status(op);
      const tenant=(await db.query<{slug:string;status:string;lifecycleVersion:number}>('SELECT slug,status,"lifecycleVersion" FROM "Tenant" WHERE id=$1 FOR UPDATE',[tenantId])).rows[0];
      if(!tenant||["dna","demoo","system"].includes(tenant.slug)||tenant.status!=="ACTIVE"||tenant.lifecycleVersion!==op.request.expectedLifecycleVersion||tenant.lifecycleVersion>2147483645)throw new ConflictException("DEVICE_RESTORE_TENANT_CHANGED");
      await assertSourceActor(db,{tenantId,userId:op.request.actorUserId,sessionId:op.request.sessionId,membershipId:op.request.membershipId,membershipVersion:op.request.membershipVersion,roles:["TENANT_ADMIN"],activePersona:"STAFF",bypassRls:false});
      if(await readDeviceRestoreSourceDigest(db,tenantId)!==op.request.sourceDigest)throw new ConflictException("DEVICE_RESTORE_SOURCE_CHANGED");
      await requireNoTenantMutationActivity(db,tenantId);
      if((await db.query('SELECT id FROM "TenantFreshResetOperation" WHERE "tenantId"=$1 AND status<>\'COMPLETED\' LIMIT 1',[tenantId])).rows.length)throw new ConflictException("DEVICE_RESTORE_RESET_IN_PROGRESS");
      await assertDeviceRestoreQueuesEmpty(tenantId);
      const projection=await projectDeviceBackup(tenantId,await readTenantBackupSchema(db),db),policies=Object.fromEntries(Object.keys(projection.tables).map(table=>[table,{policy:deviceRestoreTablePolicy(table)!,added:0,changed:0,removed:0,unchanged:0}]));
      const domain=deviceDomainLinks(projection,projection,policies,await readDeviceDomainRows(db,tenantId));
      if(domain.pendingDeliveries||domain.unverified.length||domain.conflicts.length)throw new ConflictException("DEVICE_RESTORE_DELIVERIES_UNRESOLVED");
      await db.query('UPDATE "Tenant" SET status=\'SUSPENDED\',"lifecycleVersion"="lifecycleVersion"+1,"suspendedAt"=now(),"suspendedReason"=\'INSTITUTION_REQUEST\',"updatedAt"=now() WHERE id=$1',[tenantId]);
      await db.query('UPDATE "AuthSession" SET status=\'REVOKED\',"updatedAt"=now() WHERE "tenantId"=$1 AND status=\'ACTIVE\'',[tenantId]);
      const approval={actorUserId:context.userId,sessionId:context.sessionId,membershipVersion:context.membershipVersion,lifecycleVersion:tenant.lifecycleVersion+1,sourceDigest:await readDeviceRestoreSourceDigest(db,tenantId),approvedAt:new Date().toISOString()};
      await db.query("UPDATE device_existing_restore.work SET state='QUEUED',approval=$3::jsonb,updated_at=now() WHERE operation_id=$1 AND tenant_id=$2",[operationId,tenantId,JSON.stringify(approval)]);
      await db.query('INSERT INTO "AuditLog" (id,"tenantId","actorUserId","entityType","entityId",action,diff) VALUES ($1,$2,$3,\'DeviceRestore\',$4,\'tenant.device_restore.approved\',$5::jsonb)',[randomUUID(),tenantId,context.userId,operationId,JSON.stringify({archiveDigest:op.archive_digest,lifecycleVersion:approval.lifecycleVersion})]);
      return {...status(op),state:"QUEUED" as const};
    });
  }
  async onApplicationShutdown(){await waitForApiMutations();await this.pool?.end();}
}
