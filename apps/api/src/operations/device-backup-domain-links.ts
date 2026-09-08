import type { Queryable } from "@o-okul/db";
import type { TenantDeviceBackupPreview } from "@o-okul/shared-types";
import type { DeviceBackupPayload } from "./device-backup.service.js";
import { missingBoundSubjectRole } from "../auth/subject-binding.js";
type Impact = NonNullable<TenantDeviceBackupPreview["impact"]>;
export type DeviceDomainRows = {
  sessions: Array<{userId:string;subjectType:string|null;subjectId:string|null;roles:string[]}>;
  invitations: Array<{id:string;subjectType:string;subjectId:string;pending:boolean}>;
  resets: Array<{id:string;userId:string}>;
  outbox: Array<{purpose:string;sourceId:string;sourceScope:string|null;tenantLifecycleVersion:number|null;currentVersion:number;status:string;attempts:number}>;
  truncated: string[];
};
export async function readDeviceDomainRows(db: Queryable, tenantId: string): Promise<DeviceDomainRows> {
  // Bound each metadata read; secrets and recipient payloads never enter this planner.
  const sessions = (await db.query<DeviceDomainRows["sessions"][number]>(`SELECT /* device_restore_domain */ "userId","subjectType","subjectId",roles FROM "AuthSession" WHERE "tenantId"=$1 AND status='ACTIVE' AND "expiresAt">now() ORDER BY id LIMIT 2001`,[tenantId])).rows;
  const invitations = (await db.query<DeviceDomainRows["invitations"][number]>(`SELECT /* device_restore_domain */ id,"subjectType","subjectId",(status='PENDING' AND "expiresAt">now()) AS pending FROM "IdentityInvitation" WHERE "tenantId"=$1 ORDER BY id LIMIT 2001`,[tenantId])).rows;
  const resets = (await db.query<DeviceDomainRows["resets"][number]>(`SELECT /* device_restore_domain */ p.id,p."userId" FROM "PasswordResetToken" p JOIN "User" u ON u.id=p."userId" WHERE u."tenantId"=$1 ORDER BY p.id LIMIT 2001`,[tenantId])).rows;
  const outbox = (await db.query<DeviceDomainRows["outbox"][number]>(`SELECT /* device_restore_domain */ o.purpose,o."sourceId",o."sourceScope",o."tenantLifecycleVersion",t."lifecycleVersion" AS "currentVersion",o.status,o.attempts FROM "SecretDeliveryOutbox" o JOIN "Tenant" t ON t.id=o."tenantId" WHERE o."tenantId"=$1 ORDER BY o.id LIMIT 2001`,[tenantId])).rows;
  const truncated = Object.entries({AuthSession:sessions,IdentityInvitation:invitations,PasswordResetToken:resets,SecretDeliveryOutbox:outbox}).filter(([,rows])=>rows.length>2000).map(([name])=>name);
  return {sessions:sessions.slice(0,2000),invitations:invitations.slice(0,2000),resets:resets.slice(0,2000),outbox:outbox.slice(0,2000),truncated};
}
export function deviceDomainLinks(archive: DeviceBackupPayload, current: DeviceBackupPayload, policies: Impact["tables"], metadata: DeviceDomainRows): NonNullable<Impact["domainLinks"]> {
  const proposed = new Map(Object.entries(policies).map(([table,p])=>[table,new Map((p.policy==="PRESERVE"?current:archive).tables[table]!.map(e=>{const row=JSON.parse(e.row) as Record<string,unknown>;return [String(row.id),row];}))]));
  const conflicts = new Map<string,{source:string;target:string;links:number}>(), unverified = new Set(metadata.truncated.map(n=>n+":limit"));
  const priorSubjects = new Map<string,Map<string,Record<string,unknown>>>();
  let checkedLinks=0,pendingDeliveries=0;
  const fail=(source:string,target:string)=>{const key=source+":"+target;conflicts.set(key,{source,target,links:(conflicts.get(key)?.links??0)+1});};
  const link=(source:string,target:string,id:unknown,active=false,userId?:string)=>{
    if(typeof id!=="string"||!id){unverified.add(source+":missing-reference");return;}
    const rows=proposed.get(target);if(!rows){unverified.add(source+":unavailable-target");return;}
    checkedLinks++;const row=rows.get(id);
    const requiresActiveStatus=source==="IdentityInvitation"&&["Student","Employee"].includes(target);
    if(!row || (active && (row.deletedAt!=null || (requiresActiveStatus && row.status!=="ACTIVE"))) || (userId!==undefined && row.userId!==userId))fail(source,target);
    else if(active){
      let prior=priorSubjects.get(target);
      if(!prior){prior=new Map((current.tables[target]??[]).map(e=>{const value=JSON.parse(e.row) as Record<string,unknown>;return [String(value.id),value];}));priorSubjects.set(target,prior);}
      const before=prior.get(id);
      if(!before || before.deletedAt!=null || (requiresActiveStatus && before.status!=="ACTIVE") || (userId!==undefined && before.userId!==userId))fail(source,target+"Access");
    }
  };
  const subjects:Record<string,string>={STUDENT:"Student",TEACHER:"Teacher",GUARDIAN:"Guardian",EMPLOYEE:"Employee"};
  const subject=(source:string,type:unknown,id:unknown,active:boolean,userId?:string)=>{
    const target=typeof type==="string"&&Object.hasOwn(subjects,type)?subjects[type]:undefined;
    if(!target){unverified.add(source+":subject-type");return;}link(source,target,id,active,userId);
  };
  for(const session of metadata.sessions){
    link("AuthSession","User",session.userId);
    if(missingBoundSubjectRole({roles:session.roles,subjectType:session.subjectType??undefined,subjectId:session.subjectId??undefined})){unverified.add("AuthSession:subject-context");continue;}
    if(session.subjectType!=null||session.subjectId!=null)subject("AuthSession",session.subjectType,session.subjectId,true,session.userId);
  }
  for(const invitation of metadata.invitations)if(invitation.pending)subject("IdentityInvitation",invitation.subjectType,invitation.subjectId,true);
  for(const reset of metadata.resets)link("PasswordResetToken","User",reset.userId);
  for(const row of current.tables.AnnouncementReceipt??[]){const r=JSON.parse(row.row);link("AnnouncementReceipt","User",r.userId);subject("AnnouncementReceipt",r.subjectType,r.subjectId,false);}
  for(const row of current.tables.Announcement??[]){const r=JSON.parse(row.row);for(const [field,target]of Object.entries({campusId:"Campus",gradeLevelId:"GradeLevel",classId:"Class",courseId:"Course",termId:"AcademicTerm"}))if(r[field]!=null)link("Announcement",target,r[field]);}
  const oldTemplates=new Map((current.tables.MessageTemplate??[]).map(e=>{const r=JSON.parse(e.row);return [r.id,r];}));
  for(const row of current.tables.SmsBatchDeliveryReport??[]){
    const r=JSON.parse(row.row);link("SmsBatchDeliveryReport","MessageTemplate",r.templateId);
    const old=oldTemplates.get(r.templateId),next=proposed.get("MessageTemplate")?.get(r.templateId);
    if(old&&next){const previous=old;if(["body","channel","deletedAt"].some(k=>previous[k]!==next[k]))fail("SmsBatchDeliveryReport","MessageTemplateContent");}
  }
  for(const table of ["AnnouncementDeliveryReport","SmsBatchDeliveryReport"])for(const row of current.tables[table]??[]){const r=JSON.parse(row.row);const count=table==="SmsBatchDeliveryReport"?r.sentCount:r.deliveredCount;const complete=r.status==="completed"&&Number.isSafeInteger(r.recipientCount)&&r.recipientCount>=0&&count===r.recipientCount&&r.failedCount===0&&r.providerErrorCode==null;if(!complete)pendingDeliveries++;if(!["queued","running","processing","uncertain","completed","failed"].includes(r.status))unverified.add(table+":status");}
  const invitationIds=new Set(metadata.invitations.map(r=>r.id)),resetIds=new Set(metadata.resets.map(r=>r.id));
  for(const row of metadata.outbox){
    const pending=["PENDING","PROCESSING","UNCERTAIN"].includes(row.status)||(row.status==="FAILED"&&row.attempts>0);if(pending)pendingDeliveries++;
    if(row.sourceScope!=="TENANT"||row.tenantLifecycleVersion==null||(pending&&row.tenantLifecycleVersion!==row.currentVersion))unverified.add("SecretDeliveryOutbox:provenance");
    const ids=row.purpose==="IDENTITY_INVITATION"?invitationIds:row.purpose==="PASSWORD_RESET"?resetIds:undefined;
    if(!ids){unverified.add("SecretDeliveryOutbox:purpose");continue;}checkedLinks++;if(!ids.has(row.sourceId)){const target=row.purpose==="IDENTITY_INVITATION"?"IdentityInvitation":"PasswordResetToken";if(metadata.truncated.includes(target))unverified.add("SecretDeliveryOutbox:source-inventory");else fail("SecretDeliveryOutbox",target);}
    if(!["PENDING","PROCESSING","UNCERTAIN","FAILED","EXPIRED","DELIVERED"].includes(row.status))unverified.add("SecretDeliveryOutbox:status");
  }
  return {checkedLinks,conflicts:[...conflicts.values()].sort((a,b)=>(a.source+":"+a.target).localeCompare(b.source+":"+b.target)),pendingDeliveries,unverified:[...unverified].sort()};
}
