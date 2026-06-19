import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { AuditLogService, type AuditLogRecord, type CreateAuditLogInput } from "./audit-log.service.js";

describe("AuditLogService", () => {
  it("denetim safe-list projection raw audit payload alanlarını dışarı taşımaz", async () => {
    const service = new AuditLogService(new FakeAuditLogStore([
      {
        action: "auth.login admin-a@example.test 12345678901 rolePreviewToken=legacy-token",
        actorUserId: "user-a",
        createdAt: "2026-06-18T08:00:00.000Z",
        diff: { redirect: "https://example.test/secret?rolePreviewToken=legacy-token" },
        entityId: "+905551110001",
        entityType: "Auth admin-a@example.test",
        id: "audit-1",
        tenantId: "tenant-a",
      },
      {
        action: "user.guardian finance permission changed +905551110001",
        actorUserId: "user-a",
        createdAt: "2026-06-18T08:05:00.000Z",
        diff: { oldValue: "guardian finance permission", path: "/tmp/export/12345678901" },
        entityId: "12345678901",
        entityType: "User guardian finance permission",
        id: "audit-2",
        tenantId: "tenant-a",
      },
      {
        action: "support_ticket.created Gizli destek konusu",
        actorUserId: "user-a",
        createdAt: "2026-06-18T08:10:00.000Z",
        diff: { subject: "Gizli destek konusu" },
        entityId: "support-ticket-a",
        entityType: "SupportTicket",
        id: "audit-3",
        tenantId: "tenant-a",
      },
    ]));

    const records = await service.safeList(tenantAdminContext);

    expect(records).toEqual([
      {
        actionLabel: "Oturum açıldı",
        actorLabel: "Kullanıcı kaydı",
        category: "identity",
        createdAt: "2026-06-18T08:00:00.000Z",
        entityLabel: "Kimlik kaydı",
        id: "audit-1",
      },
      {
        actionLabel: "Finans görünürlüğü güncellendi",
        actorLabel: "Kullanıcı kaydı",
        category: "finance",
        createdAt: "2026-06-18T08:05:00.000Z",
        entityLabel: "Finans görünürlüğü kaydı",
        id: "audit-2",
      },
      {
        actionLabel: "Operasyon kaydı",
        actorLabel: "Kullanıcı kaydı",
        category: "operation",
        createdAt: "2026-06-18T08:10:00.000Z",
        entityLabel: "Operasyon kaydı",
        id: "audit-3",
      },
    ]);
    expect(Object.keys(records[0]!).sort()).toEqual([
      "actionLabel",
      "actorLabel",
      "category",
      "createdAt",
      "entityLabel",
      "id",
    ].sort());
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("actorUserId");
    expect(serialized).not.toContain("entityId");
    expect(serialized).not.toContain("diff");
    expect(serialized).not.toContain("tenantId");
    expect(serialized).not.toContain("user-a");
    expect(serialized).not.toContain("admin-a@example.test");
    expect(serialized).not.toContain("12345678901");
    expect(serialized).not.toContain("+905551110001");
    expect(serialized).not.toContain("rolePreviewToken");
    expect(serialized).not.toContain("guardian finance permission");
    expect(serialized).not.toContain("support-ticket-a");
    expect(serialized).not.toContain("support_ticket.created");
    expect(serialized).not.toContain("Gizli destek konusu");
  });

  it("öğrenci denetim özetini raw audit alanlarını döndürmeden üretir", async () => {
    const service = new AuditLogService(new FakeAuditLogStore([
      {
        action: "student.profile_updated",
        actorUserId: "user-a",
        createdAt: "2026-06-18T08:00:00.000Z",
        diff: { fieldsChanged: ["phone"] },
        entityId: "student-a",
        entityType: "Student",
        id: "audit-1",
        tenantId: "tenant-a",
      },
      {
        action: "guardian_student.updated",
        actorUserId: "user-a",
        createdAt: "2026-06-18T08:05:00.000Z",
        diff: { guardianId: "guardian-a", studentId: "student-a" },
        entityId: "guardian-link-a",
        entityType: "GuardianStudent",
        id: "audit-2",
        tenantId: "tenant-a",
      },
      {
        action: "student.deleted",
        actorUserId: "user-a",
        createdAt: "2026-06-18T08:10:00.000Z",
        entityId: "student-b",
        entityType: "Student",
        id: "audit-3",
        tenantId: "tenant-a",
      },
      {
        action: "support_ticket.created",
        actorUserId: "user-a",
        createdAt: "2026-06-18T08:15:00.000Z",
        diff: { subject: "Gizli destek metni" },
        entityId: "support-ticket-a",
        entityType: "SupportTicket",
        id: "audit-4",
        tenantId: "tenant-a",
      },
    ]));

    const summary = await service.studentSummary(tenantAdminContext, "student-a", 5);

    expect(summary).toEqual([
      {
        actionLabel: "Veli ilişkisi güncellendi",
        createdAt: "2026-06-18T08:05:00.000Z",
        id: "audit-2",
      },
      {
        actionLabel: "Profil güncellendi",
        createdAt: "2026-06-18T08:00:00.000Z",
        id: "audit-1",
      },
    ]);
    expect(Object.keys(summary[0]!).sort()).toEqual(["actionLabel", "createdAt", "id"].sort());
    expect(JSON.stringify(summary)).not.toContain("entityId");
    expect(JSON.stringify(summary)).not.toContain("actorUserId");
    expect(JSON.stringify(summary)).not.toContain("diff");
    expect(JSON.stringify(summary)).not.toContain("student-a");
    expect(JSON.stringify(summary)).not.toContain("guardian-a");
    expect(JSON.stringify(summary)).not.toContain("Gizli destek metni");
    expect(JSON.stringify(summary)).not.toContain("guardian_student.updated");
    expect(JSON.stringify(summary)).not.toContain("student.profile_updated");
  });

  it("audit diff değerlerini yazarken ve okurken redakte eder", async () => {
    const service = new AuditLogService(new FakeAuditLogStore([]));

    const created = await service.record({
      action: "support_ticket.created",
      actorUserId: "user-a",
      diff: {
        email: "veli@example.test",
        fieldsChanged: ["phone"],
        firstName: "Sakli",
        nested: {
          message: "Gizli destek metni",
          status: "OPEN",
        },
        path: "/tmp/export/12345678901",
        phone: "+905551110001",
        subject: "Gizli konu",
        unsafePayload: {
          firstName: "SakliNested",
          status: "OPEN",
        },
      },
      entityId: "support-ticket-a",
      entityType: "SupportTicket",
      tenantId: "tenant-a",
    });
    const listed = await service.list(tenantAdminContext);

    expect(created.diff).toEqual({
      email: "[REDACTED]",
      fieldsChanged: ["phone"],
      firstName: "[REDACTED]",
      nested: "[REDACTED]",
      path: "[REDACTED]",
      phone: "[REDACTED]",
      subject: "[REDACTED]",
      unsafePayload: "[REDACTED]",
    });
    expect(listed[0]?.diff).toEqual(created.diff);
    expect(JSON.stringify(listed)).not.toContain("veli@example.test");
    expect(JSON.stringify(listed)).not.toContain("+905551110001");
    expect(JSON.stringify(listed)).not.toContain("12345678901");
    expect(JSON.stringify(listed)).not.toContain("Gizli destek metni");
    expect(JSON.stringify(listed)).not.toContain("Sakli");
  });
});

const tenantAdminContext: RequestContext = {
  bypassRls: false,
  roles: ["TENANT_ADMIN"],
  tenantId: "tenant-a",
  userId: "user-a",
};

class FakeAuditLogStore {
  constructor(private readonly records: AuditLogRecord[]) {}

  async list() {
    return this.records;
  }

  async create(input: CreateAuditLogInput & { createdAt: string }) {
    const record = { id: "audit-created", ...input };
    this.records.push(record);
    return record;
  }
}
