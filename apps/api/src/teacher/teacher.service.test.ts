import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AccountPiiPurgeService } from "../account-pii/account-pii-purge.service.js";
import type { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import type { IdentityProvisioningService } from "../identity-provisioning/identity-provisioning.service.js";
import type { GradeLevelCourseStore } from "../school/grade-level-course-store.js";
import type { SchoolService } from "../school/school.service.js";
import type { TeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import type { TeacherStore } from "../school/teacher-store.js";
import type { StudentStore } from "../student/student-store.js";
import { TeacherService } from "./teacher.service.js";

const context: RequestContext = {
  userId: "admin-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};
const teacher = { id: "teacher-a", tenantId: "tenant-a", firstName: "Ayse", lastName: "Ogretmen", userId: "user-teacher-a" };

function setup(store: Partial<TeacherStore>) {
  const calls: string[] = [];
  const auditLogs = { record: vi.fn(async () => undefined) };
  const identityProvisioning = {
    deactivateProfile: vi.fn(async () => {
      calls.push("deactivate");
      return { userId: "user-teacher-a", roleRemoved: true, sessionsClosed: true, invitationsRevoked: 0 };
    }),
  };
  const accountPii = { purgeLinkedAccount: vi.fn(async () => "NONE" as const) };
  const service = new TeacherService(
    { findById: vi.fn(async () => teacher), ...store } as unknown as TeacherStore,
    {} as TeacherAssignmentStore,
    {} as StudentStore,
    {} as GradeLevelCourseStore,
    {} as SchoolService,
    auditLogs as unknown as AuditLogService,
    identityProvisioning as unknown as IdentityProvisioningService,
    undefined,
    accountPii as unknown as AccountPiiPurgeService,
  );
  return { service, calls, auditLogs, identityProvisioning };
}

describe("TeacherService Employee sync (DEC-20261102-08)", () => {
  it("öğretmen silinmeden önce bağlı Çalışan'ı pasifleştirir ve sonucu denetime yazar", async () => {
    const calls: string[] = [];
    const endLinkedEmployee = vi.fn(async () => {
      calls.push("endEmployee");
      return "ENDED" as const;
    });
    const { service, calls: serviceCalls, auditLogs } = setup({ endLinkedEmployee });

    await service.deleteTeacher(context, "teacher-a");

    expect(endLinkedEmployee).toHaveBeenCalledWith("tenant-a", "teacher-a", expect.any(String));
    expect([...calls, ...serviceCalls]).toEqual(["endEmployee", "deactivate"]);
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "teacher.deleted",
      diff: expect.objectContaining({ isLinkedEmployeeEnded: true }),
    }));
  });

  it("personel rolü süren Çalışan pasifleşmez; Çalışan yoksa denetimde alan yok", async () => {
    const kept = setup({ endLinkedEmployee: vi.fn(async () => "STAFF_ACCESS_KEPT" as const) });
    await kept.service.deleteTeacher(context, "teacher-a");
    expect(kept.auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({
      diff: expect.objectContaining({ isLinkedEmployeeEnded: false }),
    }));

    const none = setup({ endLinkedEmployee: vi.fn(async () => "NO_EMPLOYEE" as const) });
    await none.service.deleteTeacher(context, "teacher-a");
    const diff = (none.auditLogs.record.mock.calls[0] as unknown as [{ diff: Record<string, unknown> }])[0].diff;
    expect(diff).not.toHaveProperty("isLinkedEmployeeEnded");
  });

  it("kişisel veri imhası bağlı Çalışan kimliğini denetime yazar", async () => {
    const purged = { ...teacher, firstName: "Anonim", lastName: "Ogretmen" };
    const { service, auditLogs } = setup({ purgePii: vi.fn(async () => ({ teacher: purged, employeeId: "employee-a" })) });

    await expect(service.purgeTeacherPii(context, "teacher-a")).resolves.toEqual(purged);
    expect(auditLogs.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "kvkk.teacher_pii_purged",
      diff: expect.objectContaining({
        fieldsPurged: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone"],
        linkedEmployeeId: "employee-a",
      }),
    }));
  });

  it("bağlı Çalışan'ın ulusal kimlik çakışması 409 döner", async () => {
    const { service } = setup({
      findByNationalIdHash: vi.fn(async () => undefined),
      update: vi.fn(async () => {
        throw new Error("TEACHER_NATIONAL_ID_CONFLICT");
      }),
    });

    await expect(service.updateTeacher(context, "teacher-a", { nationalId: "10000000146" })).rejects.toBeInstanceOf(ConflictException);
  });
});
