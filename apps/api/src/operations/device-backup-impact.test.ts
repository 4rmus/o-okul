import { describe, expect, it } from "vitest";
import { deviceBackupImpact } from "./device-backup-impact.js";
import type { DeviceBackupPayload } from "./device-backup.service.js";
const entry = (id: string, fields: Record<string, unknown> = {}) => ({ row: JSON.stringify({id,tenantId:"fixture",...fields}) });
const snapshot = (tables: DeviceBackupPayload["tables"]): DeviceBackupPayload => ({format:"tenant-device-backup-v1",tenantId:"fixture",schemaDigest:"a".repeat(64),tables,files:[]});
describe("read-only restore impact", () => {
  it("counts operational replacement separately from protected history and emits no PII", () => {
    const current=snapshot({Exam:[entry("keep"),entry("edit"),entry("remove")],PaymentTransaction:[entry("payment",{amount:"9007199254740993.01",private:"sensitive"})],User:[entry("user",{name:"old"})]});
    const archive=snapshot({Exam:[entry("keep"),entry("edit",{title:"new"}),entry("add")],PaymentTransaction:[entry("payment",{amount:"9007199254740993.02"})],User:[entry("user",{name:"new"})]});
    const before=JSON.stringify([archive,current]);const result=deviceBackupImpact(archive,current,10);
    expect(result).toMatchObject({additions:1,changes:1,removals:1,canApply:false,tables:{PaymentTransaction:{policy:"PRESERVE",changed:1},User:{policy:"PRESERVE"}}});
    expect(result.blockers).toEqual(expect.arrayContaining(["DEVICE_RESTORE_FINANCE_DIFFERENCE","DEVICE_RESTORE_IDENTITY_RECONCILIATION_REQUIRED","DEVICE_RESTORE_PROTECTED_DEPENDENCIES_UNVERIFIED"]));
    expect(JSON.stringify(result)).not.toMatch(/sensitive|9007199254740993|payment|old|new/);
    expect(JSON.stringify([archive,current])).toBe(before);
  });
  it("never rolls back consent or delivery history and flags account-link changes", () => {
    const a=snapshot({WhatsAppConsentEvent:[],AnnouncementDeliveryReport:[],Student:[entry("student",{userId:"different"})]});
    const c=snapshot({WhatsAppConsentEvent:[entry("consent")],AnnouncementDeliveryReport:[entry("sent")],Student:[entry("student",{userId:"current"})]});
    const r=deviceBackupImpact(a,c,null);
    expect(r.blockers).toEqual(expect.arrayContaining(["DEVICE_RESTORE_CONSENT_DIFFERENCE","DEVICE_RESTORE_DELIVERY_HISTORY_DIFFERENCE","DEVICE_RESTORE_ACCOUNT_LINK_CHANGE","DEVICE_RESTORE_CURRENT_LICENSE_UNVERIFIED"]));
    expect(r.removals).toBe(0);
  });
  it("uses active, undeleted students with exactly one open active enrollment for quota", () => {
    const a=snapshot({Student:[entry("a",{status:"ACTIVE",deletedAt:null}),entry("b",{status:"ACTIVE",deletedAt:null}),entry("deleted",{status:"ACTIVE",deletedAt:"date"})],StudentEnrollment:[entry("ea",{studentId:"a",status:"ACTIVE",endsAt:null}),entry("eb",{studentId:"b",status:"ACTIVE",endsAt:null}),entry("ed",{studentId:"deleted",status:"ACTIVE",endsAt:null})]});
    expect(deviceBackupImpact(a,a,1)).toMatchObject({activeStudents:2,activeStudentLimit:1});
    expect(deviceBackupImpact(a,a,1).blockers).toContain("DEVICE_RESTORE_STUDENT_LIMIT_EXCEEDED");
    a.tables.StudentEnrollment!.push(entry("duplicate",{studentId:"a",status:"ACTIVE",endsAt:null}));
    expect(deviceBackupImpact(a,a,10).blockers).toContain("DEVICE_RESTORE_ENROLLMENT_CONFLICT");
  });
  it("fails closed on unknown policy and mismatched institution/schema/catalog", () => {
    const a=snapshot({FutureFinancialHistory:[entry("future")]});
    expect(deviceBackupImpact(a,a,1)).toMatchObject({additions:0,tables:{FutureFinancialHistory:{policy:"PRESERVE"}}});
    expect(deviceBackupImpact(a,a,1).blockers).toContain("DEVICE_RESTORE_POLICY_UNCLASSIFIED");
    for(const c of [{...a,tenantId:"other"},{...a,schemaDigest:"b".repeat(64)},snapshot({})]) expect(()=>deviceBackupImpact(a,c,1)).toThrow("DEVICE_RESTORE_COMPARISON_MISMATCH");
  });
});
