import { describe, expect, it, vi } from "vitest";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
import { InMemoryTeacherStore } from "../school/teacher-store.js";
import { InMemorySessionStore } from "../auth/session-store.js";
import { createAdminMfaStepUpProof } from "../auth/totp-mfa.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { InMemoryTenantStore } from "../tenant/tenant-store.js";
import { InMemoryUserManagementStore } from "../user-management/user-management-store.js";
import type { RequestContext } from "../context/request-context.js";
import { IdentityInvitationService, createInvitationDeliveryUrl, hashActivationToken } from "./identity-invitation.service.js";
import { InMemoryIdentityInvitationStore, type IdentityInvitationStore } from "./identity-invitation-store.js";
import { InMemoryEmployeeAccountActivationStore } from "./employee-account-activation-store.js";

describe("IdentityInvitationService", () => {
  it("çalışan davet tokenını yalnız URL fragmentinde taşır", () => {
    const url = createInvitationDeliveryUrl("invite-token");

    expect(url.searchParams.has("token")).toBe(false);
    expect(url.hash).toBe("#token=invite-token");
  });

  it("süresi dolan daveti kabul etmez", async () => {
    const expiredInvitation = {
      id: "invite-expired",
      tenantId: "tenant-a",
      subjectType: "STUDENT" as const,
      subjectId: "student-a",
      email: "expired@example.test",
      name: "Expired Student",
      role: "STUDENT" as const,
      kind: "EMAIL_LINK" as const,
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
      revokePendingForSubject: vi.fn(),
    };
    const service = new IdentityInvitationService(
      store,
      new InMemoryUserManagementStore(),
      new InMemoryStudentStore(),
      new InMemoryGuardianStore(),
      new InMemoryTeacherStore(),
      new InMemoryTenantStore(),
    );

    await expect(service.accept({ token: "expired-token", password: "Secure-password-123" })).rejects.toThrow(
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

    const issued = await service.create(
      { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      { subjectType: "STUDENT", subjectId: student.id, email: "Student.Invite@example.test" },
    );

    const ttlMs = Date.parse(issued.invitation.expiresAt) - Date.now();
    expect(ttlMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    const diff = auditLogs.record.mock.calls[0]?.[0]?.diff;
    expect(diff).toEqual(expect.objectContaining({ emailProvided: true, role: "STUDENT" }));
    expect(diff).not.toHaveProperty("email");
    expect(JSON.stringify(diff)).not.toContain("student.invite@example.test");
  });

  it("aktif olmayan öğrenci için portal daveti üretmez", async () => {
    const students = new InMemoryStudentStore();
    const student = await students.create({
      tenantId: "tenant-a",
      firstName: "Pasif",
      lastName: "Ogrenci",
      status: "PASSIVE",
    });
    const invitations = new InMemoryIdentityInvitationStore();
    const service = new IdentityInvitationService(
      invitations,
      new InMemoryUserManagementStore(),
      students,
      new InMemoryGuardianStore(),
      new InMemoryTeacherStore(),
      new InMemoryTenantStore(),
    );

    await expect(service.create(
      { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      { subjectType: "STUDENT", subjectId: student.id, email: "passive@example.test" },
    )).rejects.toThrow("STUDENT_PORTAL_ACCESS_REQUIRES_ACTIVE_PROFILE");
    await expect(invitations.list("tenant-a")).resolves.toEqual([]);
  });

  it("aktif çalışan profilini T.C. kimlik numarası olmadan davet edip canonical hesaba bağlar", async () => {
    const invitations = new InMemoryIdentityInvitationStore();
    const users = new InMemoryUserManagementStore();
    const employee = await users.createEmployee("tenant-a", {
      firstName: "Ada",
      lastName: "Operasyon",
      workEmail: "ada@example.test",
      status: "ACTIVE",
    });
    const tenants = new InMemoryTenantStore();
    const service = new IdentityInvitationService(
      invitations,
      users,
      new InMemoryStudentStore(),
      new InMemoryGuardianStore(),
      new InMemoryTeacherStore(),
      tenants,
      undefined,
      new InMemoryEmployeeAccountActivationStore(users, tenants, invitations),
    );

    const issued = await service.createEmployeeInvitation(
      { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      employee.id,
      { email: "ada@example.test", role: "OPERATIONS_STAFF" },
    );
    await service.accept({ token: issued.activationToken, password: "Secure-password-123" });

    await expect(users.findEmployee("tenant-a", employee.id)).resolves.toMatchObject({
      userId: expect.any(String),
      accountStatus: "ACTIVE",
      access: { staffRole: "OPERATIONS_STAFF", status: "ACTIVE" },
    });
    expect(issued.invitation).toMatchObject({ subjectType: "EMPLOYEE", role: "OPERATIONS_STAFF" });
  });

  it("owner/admin başlangıç davetini bağlı step-up kanıtı ve owner capability ile sınırlar", async () => {
    const invitations = new InMemoryIdentityInvitationStore();
    const users = new InMemoryUserManagementStore();
    const adminEmployee = await users.createEmployee("tenant-a", {
      firstName: "Ada",
      lastName: "Admin",
      status: "ACTIVE",
    });
    const ownerEmployee = await users.createEmployee("tenant-a", {
      firstName: "Oya",
      lastName: "Owner",
      status: "ACTIVE",
    });
    const service = new IdentityInvitationService(
      invitations,
      users,
      new InMemoryStudentStore(),
      new InMemoryGuardianStore(),
      new InMemoryTeacherStore(),
      new InMemoryTenantStore(),
    );
    const adminContext: RequestContext = {
      tenantId: "tenant-a",
      userId: "admin-a",
      sessionId: "session-admin-a",
      membershipVersion: 4,
      roles: ["TENANT_ADMIN"],
      bypassRls: false,
    };
    const proof = createAdminMfaStepUpProof({
      userId: adminContext.userId,
      sessionId: adminContext.sessionId ?? "",
      membershipVersion: adminContext.membershipVersion ?? 0,
      purpose: "OWNER_ADMIN_CHANGE",
    });

    await expect(service.createEmployeeInvitation(
      adminContext,
      adminEmployee.id,
      { email: "ada.admin@example.test", role: "TENANT_ADMIN" },
    )).rejects.toThrow("STEP_UP_MFA_REQUIRED");
    await expect(service.createEmployeeInvitation(
      adminContext,
      adminEmployee.id,
      { email: "ada.admin@example.test", role: "TENANT_ADMIN" },
      "forged-proof",
    )).rejects.toThrow("STEP_UP_MFA_INVALID");
    await expect(service.createEmployeeInvitation(
      adminContext,
      adminEmployee.id,
      { email: "ada.admin@example.test", role: "TENANT_ADMIN" },
      proof.stepUpToken,
    )).resolves.toMatchObject({ invitation: { role: "TENANT_ADMIN" } });
    await expect(service.createEmployeeInvitation(
      adminContext,
      ownerEmployee.id,
      { email: "oya.owner@example.test", role: "TENANT_OWNER" },
      proof.stepUpToken,
    )).rejects.toThrow("TENANT_OWNER_MANAGE_REQUIRED");
  });

});
