import { expect, it } from "vitest";
import { deviceBackupImpact } from "./device-backup-impact.js";
import type { DeviceBackupPayload } from "./device-backup.service.js";
import type { DeviceRestoreForeignKey } from "./device-backup-references.js";
const row=(id:string,fields:Record<string,unknown>={})=>({row:JSON.stringify({id,tenantId:"a",...fields})});
const data=(tables:DeviceBackupPayload["tables"]):DeviceBackupPayload=>({format:"tenant-device-backup-v1",tenantId:"a",schemaDigest:"a".repeat(64),tables,files:[]});
const fk:DeviceRestoreForeignKey={table:"PaymentPlan",references:"Student",targetSchema:"public",columns:["tenantId","studentId"],targetColumns:["tenantId","id"],match:"s",validated:true};
it("checks retained finance against replacement students, including tenant scope",()=>{
  const current=data({PaymentPlan:[row("private-payment",{studentId:"private-student",totalAmount:123456})],Student:[row("private-student")]});
  for(const students of [[],[row("private-student",{tenantId:"b"})]]) {
    const archive=data({PaymentPlan:[],Student:students});const before=JSON.stringify([current,archive]);
    const impact=deviceBackupImpact(archive,current,10,[fk]);
    expect(impact.references).toEqual({checkedLinks:1,conflicts:[{table:"PaymentPlan",references:"Student",links:1}],unverified:[]});
    expect(impact.blockers).toContain("DEVICE_RESTORE_REFERENCE_CONFLICT");
    expect(JSON.stringify(impact)).not.toMatch(/private-payment|private-student|123456/);
    expect(JSON.stringify([current,archive])).toBe(before);
  }
});
it("a valid FK does not turn domain references or restore permission into a pass",()=>{
  const current=data({PaymentPlan:[row("payment",{studentId:"student"})],Student:[row("student",{name:"old"})]});
  const archive=data({PaymentPlan:[],Student:[row("student",{name:"new"})]});
  const result=deviceBackupImpact(archive,current,10,[fk]);
  expect(result.references).toEqual({checkedLinks:1,conflicts:[],unverified:[]});
  expect(result.blockers).toContain("DEVICE_RESTORE_DOMAIN_REFERENCES_UNVERIFIED");expect(result.canApply).toBe(false);
});
it("implements MATCH SIMPLE/FULL null rules without treating missing fields as null",()=>{
  const current=data({PaymentPlan:[row("payment",{studentId:null})],Student:[]});
  expect(deviceBackupImpact(current,current,10,[fk]).references?.checkedLinks).toBe(0);
  expect(deviceBackupImpact(current,current,10,[{...fk,match:"f"}]).references?.conflicts[0]?.links).toBe(1);
  const missing=data({PaymentPlan:[row("payment")],Student:[]});
  expect(deviceBackupImpact(missing,missing,10,[fk]).references?.unverified).toEqual(["PaymentPlan → Student"]);
});
it("reports incomplete/excluded metadata and unsupported key types rather than clearing blockers",()=>{
  const current=data({PaymentPlan:[row("p",{studentId:"s"})],Student:[row("s")]});
  expect(deviceBackupImpact(current,current,10,[]).references?.unverified).toEqual(["CATALOG_EMPTY"]);
  for(const change of [{validated:false},{targetSchema:"other"},{match:"p"},{columns:[]},{table:"IdentityInvitation"}]) expect(deviceBackupImpact(current,current,10,[{...fk,...change}]).blockers).toContain("DEVICE_RESTORE_FOREIGN_KEYS_UNVERIFIED");
  const unsafe=data({PaymentPlan:[row("p",{studentId:"s"})],Student:[row("s",{id:9007199254740992})]});
  expect(deviceBackupImpact(unsafe,unsafe,10,[fk]).references?.unverified).toEqual(["PaymentPlan → Student"]);
});
it("does not equate distinct fractional reference keys after JSON number rounding",()=>{
  const current=data({PaymentPlan:[{row:'{"id":"p","tenantId":"a","number":1.0000000000000000001}'}],Student:[{row:'{"id":"s","tenantId":"a","number":1.0000000000000000002}'}]});
  const numeric={...fk,columns:["tenantId","number"],targetColumns:["tenantId","number"]};
  expect(deviceBackupImpact(current,current,10,[numeric]).references?.unverified).toEqual(["PaymentPlan → Student"]);
});
