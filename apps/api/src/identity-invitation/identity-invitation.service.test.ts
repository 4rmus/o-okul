import { describe, expect, it, vi } from "vitest";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
import { InMemoryTeacherStore } from "../school/teacher-store.js";
import { InMemorySessionStore } from "../auth/session-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { InMemoryTenantStore } from "../tenant/tenant-store.js";
import { InMemoryUserManagementStore } from "../user-management/user-management-store.js";
import { IdentityInvitationService, hashActivationToken } from "./identity-invitation.service.js";
import { InMemoryIdentityInvitationStore, type IdentityInvitationStore } from "./identity-invitation-store.js";

describe("IdentityInvitationService", () => {
  it("süresi dolan daveti kabul etmez", async () => {
    const expiredInvitation = {
      id: "invite-expired",
      tenantId: "tenant-a",
      subjectType: "STUDENT" as const,
      subjectId: "student-a",
      email: "expired@example.test",
      name: "Expired Student",
      role: "STUDENT" as const,
      status: "PENDING" as const,
      expiresAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
    };
    const store: IdentityInvitationStore = {
      list: vi.fn(),
      create: vi.fn(),
      findById: vi.fn(),
      findByTokenHash: vi.fn(async (tokenHash) =>
        tokenHash === hashActivationToken("expired-token") ? expiredInvitation : undefined,
      ),
      resend: vi.fn(),
      markAccepted: vi.fn(),
    };
    const service = new IdentityInvitationService(
      store,
      new InMemoryUserManagementStore(),
      new InMemoryStudentStore(),
      new InMemoryGuardianStore(),
      new InMemoryTeacherStore(),
      new InMemoryTenantStore(),
    );

    await expect(service.accept({ token: "expired-token", password: "password1" })).rejects.toThrow(
      "IDENTITY_INVITATION_EXPIRED",
    );
  });

  it("davet audit kaydında ham e-posta tutmaz", async () => {
    const students = new InMemoryStudentStore();
    const student = await students.create({
      tenantId: "tenant-a",
      firstName: "Davet",
      lastName: "Ogrenci",
    });
    const auditLogs = { record: vi.fn() };
    const service = new IdentityInvitationService(
      new InMemoryIdentityInvitationStore(),
      new InMemoryUserManagementStore(),
      students,
      new InMemoryGuardianStore(),
      new InMemoryTeacherStore(),
      new InMemoryTenantStore(),
      auditLogs as never,
    );

    await service.create(
      { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      { subjectType: "STUDENT", subjectId: student.id, email: "Student.Invite@example.test" },
    );

    const diff = auditLogs.record.mock.calls[0]?.[0]?.diff;
    expect(diff).toEqual(expect.objectContaining({ emailProvided: true, role: "STUDENT" }));
    expect(diff).not.toHaveProperty("email");
    expect(JSON.stringify(diff)).not.toContain("student.invite@example.test");
  });
});
