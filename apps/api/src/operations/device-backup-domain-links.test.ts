import { expect, it } from "vitest";
import { deviceBackupImpact } from "./device-backup-impact.js";
import { readDeviceDomainRows, type DeviceDomainRows } from "./device-backup-domain-links.js";
import type { DeviceBackupPayload } from "./device-backup.service.js";
import type { Queryable } from "@o-okul/db";
const row=(id:string,fields:Record<string,unknown>={})=>({row:JSON.stringify({id,tenantId:"a",...fields})});
const data=(tables:DeviceBackupPayload["tables"]):DeviceBackupPayload=>({format:"tenant-device-backup-v1",tenantId:"a",schemaDigest:"a".repeat(64),tables,files:[]});
const empty=():DeviceDomainRows=>({sessions:[],invitations:[],resets:[],outbox:[],truncated:[]});
it("detects active subject loss/rebinding and pending invitation loss without exposing IDs",()=>{
  const current=data({User:[row("secret-user")],Student:[row("secret-student",{userId:"secret-user",status:"ACTIVE",deletedAt:null})]});
  for(const students of [[],[row("secret-student",{userId:"other",status:"ACTIVE"})],[row("secret-student",{userId:"secret-user",status:"ACTIVE",deletedAt:"2026-01-01"})]]) {
    const archive=data({User:current.tables.User!,Student:students});const metadata={...empty(),sessions:[{userId:"secret-user",subjectType:"STUDENT",subjectId:"secret-student",roles:["STUDENT"]}],invitations:[{id:"private-invitation",subjectType:"STUDENT",subjectId:"missing",pending:true}]};
    const result=deviceBackupImpact(archive,current,100,undefined,metadata);
    expect(result.domainLinks?.conflicts).toEqual(expect.arrayContaining([{source:"AuthSession",target:"Student",links:1},{source:"IdentityInvitation",target:"Student",links:1}]));
    expect(result.blockers).toContain("DEVICE_RESTORE_DOMAIN_LINK_CONFLICT");expect(JSON.stringify(result.domainLinks)).not.toMatch(/secret-|private-/);expect(result.canApply).toBe(false);
  }
});
it("ignores closed invitations but marks unknown/missing active subject context unverified",()=>{
  const snapshot=data({User:[row("u")],Student:[]});
  const metadata={...empty(),invitations:[{id:"old",subjectType:"UNKNOWN",subjectId:"deleted",pending:false}],sessions:[{userId:"u",subjectType:null,subjectId:null,roles:["STUDENT"]},{userId:"u",subjectType:"constructor",subjectId:"x",roles:["TENANT_ADMIN"]}]};
  const result=deviceBackupImpact(snapshot,snapshot,null,undefined,metadata);
  expect(result.domainLinks?.unverified).toEqual(["AuthSession:subject-context","AuthSession:subject-type"]);
  expect(result.domainLinks?.conflicts).toEqual([]);
});
it("checks preserved receipt/audience/template history and treats failed or inconsistent reports as unresolved",()=>{
  const current=data({User:[row("u")],Student:[row("s")],Class:[row("c")],Announcement:[row("a",{classId:"c"})],AnnouncementReceipt:[row("r",{userId:"u",subjectType:"STUDENT",subjectId:"s"})],MessageTemplate:[row("t",{body:"current",channel:"SMS",deletedAt:null})],SmsBatchDeliveryReport:[row("report",{templateId:"t",status:"failed",recipientCount:1,sentCount:0,failedCount:1})]});
  const archive=data({...current.tables,Class:[],Student:[],MessageTemplate:[row("t",{body:"old",channel:"SMS",deletedAt:null})]});
  const result=deviceBackupImpact(archive,current,100,undefined,empty());
  expect(result.domainLinks?.conflicts).toEqual(expect.arrayContaining([{source:"Announcement",target:"Class",links:1},{source:"AnnouncementReceipt",target:"Student",links:1},{source:"SmsBatchDeliveryReport",target:"MessageTemplateContent",links:1}]));
  expect(result.domainLinks?.pendingDeliveries).toBe(1);expect(result.blockers).toContain("DEVICE_RESTORE_DELIVERIES_UNRESOLVED");
});
it("verifies outbox provenance/source links without guessing truncated or unknown records",()=>{
  const snapshot=data({User:[]});const metadata={...empty(),truncated:["IdentityInvitation"],outbox:[{purpose:"IDENTITY_INVITATION",sourceId:"unseen",sourceScope:null,tenantLifecycleVersion:null,currentVersion:2,status:"UNCERTAIN",attempts:1},{purpose:"OTHER",sourceId:"private",sourceScope:"TENANT",tenantLifecycleVersion:1,currentVersion:2,status:"PENDING",attempts:0}]};
  const before=JSON.stringify(metadata), result=deviceBackupImpact(snapshot,snapshot,100,undefined,metadata);
  expect(result.domainLinks).toMatchObject({pendingDeliveries:2,conflicts:[]});expect(result.domainLinks?.unverified).toEqual(expect.arrayContaining(["IdentityInvitation:limit","SecretDeliveryOutbox:provenance","SecretDeliveryOutbox:purpose","SecretDeliveryOutbox:source-inventory"]));expect(JSON.stringify(metadata)).toBe(before);
});
it("bounds every scoped metadata read and never selects secrets or contact payloads",async()=>{
  const calls:Array<{sql:string;values:unknown[]}> = [];
  const db={query:async(sql:string,values:unknown[])=>{calls.push({sql,values});return {rows:sql.includes('FROM "IdentityInvitation"')?Array.from({length:2001},(_,i)=>({id:String(i),subjectType:"STUDENT",subjectId:"s",pending:false})):[]};}} as unknown as Queryable;
  const result=await readDeviceDomainRows(db,"a");expect(result.invitations).toHaveLength(2000);expect(result.truncated).toEqual(["IdentityInvitation"]);expect(calls).toHaveLength(4);
  for(const c of calls){expect(c.values).toEqual(["a"]);expect(c.sql).toContain("LIMIT 2001");expect(c.sql).not.toMatch(/SELECT\s+\*|"tokenHash"|"refreshTokenHash"|"payloadEncrypted"|"passwordHash"|"email"|"phone"/);}
});
it("blocks restoring access through an old active session or pending invitation",()=>{
  const current=data({User:[row("u")],Student:[row("s",{userId:"u",status:"ACTIVE",deletedAt:"2026-01-01"})]});
  const archive=data({User:current.tables.User!,Student:[row("s",{userId:"u",status:"ACTIVE",deletedAt:null})]});
  const metadata={...empty(),sessions:[{userId:"u",subjectType:"STUDENT",subjectId:"s",roles:["STUDENT"]}],invitations:[{id:"i",subjectType:"STUDENT",subjectId:"s",pending:true}]};
  const impact=deviceBackupImpact(archive,current,10,undefined,metadata);
  expect(impact.domainLinks?.conflicts).toEqual(expect.arrayContaining([{source:"AuthSession",target:"StudentAccess",links:1},{source:"IdentityInvitation",target:"StudentAccess",links:1}]));
});

it("uses invitation eligibility without treating student status alone as a missing session binding",()=>{
  const current=data({User:[row("u")],Student:[row("s",{userId:"u",status:"WITHDRAWN",deletedAt:null})]});
  const metadata={...empty(),sessions:[{userId:"u",subjectType:"STUDENT",subjectId:"s",roles:["STUDENT"]}],invitations:[{id:"i",subjectType:"STUDENT",subjectId:"s",pending:true}]};
  const result=deviceBackupImpact(current,current,10,undefined,metadata);
  expect(result.domainLinks?.conflicts).toEqual([{source:"IdentityInvitation",target:"Student",links:1}]);
});
