import { describe, expect, it, vi } from "vitest";
import * as tenantMutationActivity from "../context/tenant-mutation-activity.js";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
import { InMemoryTeacherStore, type TeacherStore } from "../school/teacher-store.js";
import { InMemorySessionStore } from "../auth/session-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { InMemoryTenantStore } from "../tenant/tenant-store.js";
import { InMemoryUserManagementStore } from "../user-management/user-management-store.js";
import type { RequestContext } from "../context/request-context.js";
import { IdentityInvitationService, createInvitationDeliveryUrl, hashActivationToken } from "./identity-invitation.service.js";
import { InMemoryIdentityInvitationStore, type IdentityInvitationStore } from "./identity-invitation-store.js";
import { InMemoryEmployeeAccountActivationStore } from "./employee-account-activation-store.js";

vi.mock("../context/tenant-mutation-activity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../context/tenant-mutation-activity.js")>();
  return { ...actual, runVerifiedTenantMutation: vi.fn(actual.runVerifiedTenantMutation) };
});

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
      listPage: vi.fn(),
      create: vi.fn(),
      findById: vi.fn(),
      findByTokenHash: vi.fn(async (tokenHash) =>
        tokenHash === hashActivationToken("expired-token") ? expiredInvitation : undefined,
      ),
      resend: vi.fn(),
      markAccepted: vi.fn(),
      revoke: vi.fn(),
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

  it("T.C. kimlik numarası olmayan veli hesabını davetle bağlar, öğrenci için T.C. şartı sürer", async () => {
    const guardians = new InMemoryGuardianStore();
    const students = new InMemoryStudentStore();
    const guardian = await guardians.create({ tenantId: "tenant-a", firstName: "Toplu", lastName: "Veli" });
    const student = await students.create({ tenantId: "tenant-a", firstName: "Tcsiz", lastName: "Ogrenci" });
    const service = new IdentityInvitationService(
      new InMemoryIdentityInvitationStore(),
      new InMemoryUserManagementStore(),
      students,
      guardians,
      new InMemoryTeacherStore(),
      new InMemoryTenantStore(),
    );
    const context: RequestContext = { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false };

    const issued = await service.create(context, { subjectType: "GUARDIAN", subjectId: guardian.id, email: "kv3.veli@example.test" });
    await service.accept({ token: issued.activationToken, password: "Secure-password-123" });
    await expect(guardians.findById(guardian.id)).resolves.toMatchObject({ userId: expect.any(String) });

    const studentInvite = await service.create(context, { subjectType: "STUDENT", subjectId: student.id, email: "kv3.ogrenci@example.test" });
    await expect(service.accept({ token: studentInvite.activationToken, password: "Secure-password-123" }))
      .rejects.toThrow("SUBJECT_NATIONAL_ID_REQUIRED");
  });

  it("kampüs kapsamlı çalışan yeni hesap daveti üretemez", async () => {
    const invitations = new InMemoryIdentityInvitationStore();
    const users = new InMemoryUserManagementStore();
    const employee = await users.createEmployee("tenant-a", {
      firstName: "Dar",
      lastName: "Kapsam",
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

    await expect(service.createEmployeeInvitation(
      {
        tenantId: "tenant-a",
        userId: "admin-a",
        roles: ["TENANT_ADMIN"],
        activePersona: "STAFF",
        campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
        bypassRls: false,
      },
      employee.id,
      { email: "dar@example.test", role: "OPERATIONS_STAFF" },
    )).rejects.toThrow("EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    await expect(invitations.list("tenant-a")).resolves.toEqual([]);
  });

  it.each(["TENANT_ADMIN", "OPERATIONS_STAFF"])(
    "kampüs kapsamlı %s genel davetleri listeleyemez, oluşturamaz veya tekrar gönderemez",
    async (role) => {
      const invitations = new InMemoryIdentityInvitationStore();
      const list = vi.spyOn(invitations, "list");
      const create = vi.spyOn(invitations, "create");
      const findById = vi.spyOn(invitations, "findById");
      const resend = vi.spyOn(invitations, "resend");
      const service = new IdentityInvitationService(
        invitations,
        new InMemoryUserManagementStore(),
        new InMemoryStudentStore(),
        new InMemoryGuardianStore(),
        new InMemoryTeacherStore(),
        new InMemoryTenantStore(),
      );
      const context: RequestContext = {
        tenantId: "tenant-a",
        userId: "staff-a",
        roles: [role],
        activePersona: "STAFF",
        campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
        bypassRls: false,
      };

      await expect(service.list(context)).rejects.toThrow("EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
      for (const subjectType of ["TEACHER", "STUDENT", "GUARDIAN"] as const) {
        await expect(service.create(context, {
          subjectType,
          subjectId: `${subjectType.toLowerCase()}-outside-campus`,
          email: `${subjectType.toLowerCase()}@example.test`,
        })).rejects.toThrow("EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
      }
      await expect(service.resend(context, "invitation-outside-campus")).rejects.toThrow(
        "EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED",
      );

      expect(list).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(findById).not.toHaveBeenCalled();
      expect(resend).not.toHaveBeenCalled();
    },
  );

  it("eşzamanlı çalışan davetlerinde yalnız bir pending davet üretir", async () => {
    const invitations = new InMemoryIdentityInvitationStore();
    const users = new InMemoryUserManagementStore();
    const employee = await users.createEmployee("tenant-a", {
      firstName: "Eşzamanlı",
      lastName: "Davet",
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
    const invite = () => service.createEmployeeInvitation(
      { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      employee.id,
      { email: "race@example.test", role: "OPERATIONS_STAFF" },
    );

    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, invite));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(19);
    await expect(invitations.list("tenant-a")).resolves.toEqual([
      expect.objectContaining({ subjectId: employee.id, subjectType: "EMPLOYEE", status: "PENDING" }),
    ]);
  });

  it("owner/admin başlangıç davetini MFA istemeden owner capability ile sınırlar", async () => {
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
      roles: ["TENANT_ADMIN"],
      bypassRls: false,
    };

    await expect(service.createEmployeeInvitation(
      adminContext,
      adminEmployee.id,
      { email: "ada.admin@example.test", role: "TENANT_ADMIN" },
    )).resolves.toMatchObject({ invitation: { role: "TENANT_ADMIN" } });
    await expect(service.createEmployeeInvitation(
      adminContext,
      ownerEmployee.id,
      { email: "oya.owner@example.test", role: "TENANT_OWNER" },
    )).rejects.toThrow("TENANT_OWNER_MANAGE_REQUIRED");
  });


  it("T.C. kimlik numarası olmayan öğretmeni davetle bağlar ve konuyu davetin kurumu ile arar (UAT F-08)", async () => {
    const teachers = new InMemoryTeacherStore();
    const teacher = await teachers.create({ tenantId: "tenant-a", firstName: "Tcsiz", lastName: "Ogretmen" });
    const findById = vi.spyOn(teachers, "findById");
    const service = new IdentityInvitationService(
      new InMemoryIdentityInvitationStore(),
      new InMemoryUserManagementStore(),
      new InMemoryStudentStore(),
      new InMemoryGuardianStore(),
      teachers,
      new InMemoryTenantStore(),
    );
    const context: RequestContext = { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false };

    const issued = await service.create(context, { subjectType: "TEACHER", subjectId: teacher.id, email: "f08.ogretmen@example.test" });
    findById.mockClear();
    await expect(service.accept({ token: issued.activationToken, password: "Secure-password-123" }))
      .resolves.toMatchObject({ status: "ACCEPTED", subjectType: "TEACHER" });
    expect(findById).toHaveBeenCalledWith(teacher.id, "tenant-a");
    await expect(teachers.findById(teacher.id)).resolves.toMatchObject({ userId: expect.any(String) });
  });

  it("öğretmeni hesaplı çalışan kaydına ikinci hesap daveti üretmez (UAT F-13)", async () => {
    const users = new InMemoryUserManagementStore();
    const employee = await users.createEmployee("tenant-a", { firstName: "Uat", lastName: "Ogretmen", status: "ACTIVE" });
    const teachers = new InMemoryTeacherStore();
    vi.spyOn(teachers, "findByEmployeeId").mockResolvedValue({
      id: "teacher-f13", tenantId: "tenant-a", firstName: "Uat", lastName: "Ogretmen", userId: "teacher-user-f13",
    });
    const service = new IdentityInvitationService(
      new InMemoryIdentityInvitationStore(),
      users,
      new InMemoryStudentStore(),
      new InMemoryGuardianStore(),
      teachers,
      new InMemoryTenantStore(),
    );

    await expect(service.createEmployeeInvitation(
      { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      employee.id,
      { email: "f13.ogretmen@example.test", role: "OPERATIONS_STAFF" },
    )).rejects.toThrow("EMPLOYEE_ALREADY_LINKED_VIA_TEACHER");
    expect(teachers.findByEmployeeId).toHaveBeenCalledWith("tenant-a", employee.id);
  });

  it.each([
    ["LINKED", "teacher.employee_account_linked"],
    ["CONFLICT", "teacher.employee_account_link_conflict"],
    ["NO_EMPLOYEE", undefined],
  ] as const)("öğretmen daveti kabulünde bağlı çalışan kaydını aynı hesaba bağlar: %s (UAT F-13)", async (link, action) => {
    const teachers = new InMemoryTeacherStore();
    const teacher = await teachers.create({ tenantId: "tenant-a", firstName: "Uat", lastName: "Ogretmen" });
    const linkEmployeeUser = vi.spyOn(teachers, "linkEmployeeUser").mockResolvedValue(link);
    const auditLogs = { record: vi.fn() };
    const service = new IdentityInvitationService(
      new InMemoryIdentityInvitationStore(),
      new InMemoryUserManagementStore(),
      new InMemoryStudentStore(),
      new InMemoryGuardianStore(),
      teachers,
      new InMemoryTenantStore(),
      auditLogs as never,
    );
    const context: RequestContext = { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false };
    const issued = await service.create(context, { subjectType: "TEACHER", subjectId: teacher.id, email: "f13.ogretmen@example.test" });

    const accepted = await service.accept({ token: issued.activationToken, password: "Secure-password-123" });

    expect(linkEmployeeUser).toHaveBeenCalledWith("tenant-a", teacher.id, accepted.acceptedUserId);
    const actions = auditLogs.record.mock.calls.map(([entry]) => (entry as { action: string }).action);
    if (action) expect(actions).toContain(action);
    expect(actions.filter((candidate) => candidate.startsWith("teacher.employee_account"))).toHaveLength(action ? 1 : 0);
  });

  it("4xx ön koşul hatasında tenant mutation activity açmaz (UAT F-08)", async () => {
    const students = new InMemoryStudentStore();
    const teachers = new InMemoryTeacherStore();
    const student = await students.create({ tenantId: "tenant-a", firstName: "Tcsiz", lastName: "Ogrenci" });
    const teacher = await teachers.create({ tenantId: "tenant-a", firstName: "Silinen", lastName: "Ogretmen" });
    const service = new IdentityInvitationService(
      new InMemoryIdentityInvitationStore(),
      new InMemoryUserManagementStore(),
      students,
      new InMemoryGuardianStore(),
      teachers,
      new InMemoryTenantStore(),
    );
    const context: RequestContext = { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false };
    const studentInvite = await service.create(context, { subjectType: "STUDENT", subjectId: student.id, email: "f08.ogrenci@example.test" });
    const teacherInvite = await service.create(context, { subjectType: "TEACHER", subjectId: teacher.id, email: "f08.silinen@example.test" });
    await teachers.softDelete(teacher.id, new Date().toISOString());
    const runMutation = vi.mocked(tenantMutationActivity.runVerifiedTenantMutation);
    runMutation.mockClear();

    await expect(service.accept({ token: studentInvite.activationToken, password: "Secure-password-123" }))
      .rejects.toThrow("SUBJECT_NATIONAL_ID_REQUIRED");
    await expect(service.accept({ token: teacherInvite.activationToken, password: "Secure-password-123" }))
      .rejects.toThrow("SUBJECT_NOT_FOUND");
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("daveti iptal eder, audit kaydında ham e-posta tutmaz ve bekleyen olmayan daveti reddeder (UAT F-03)", async () => {
    const students = new InMemoryStudentStore();
    const student = await students.create({ tenantId: "tenant-a", firstName: "Iptal", lastName: "Ogrenci" });
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
    const context: RequestContext = { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false };
    const issued = await service.create(context, { subjectType: "STUDENT", subjectId: student.id, email: "Iptal.Ogrenci@example.test" });

    const revoked = await service.revoke(context, issued.invitation.id);
    expect(revoked).toMatchObject({ id: issued.invitation.id, status: "REVOKED" });
    const audit = auditLogs.record.mock.calls.at(-1)?.[0];
    expect(audit).toMatchObject({ action: "identity_invitation.revoked", entityId: issued.invitation.id, actorUserId: "admin-a" });
    expect(JSON.stringify(audit.diff)).not.toContain("iptal.ogrenci@example.test");

    await expect(service.revoke(context, issued.invitation.id)).rejects.toThrow("IDENTITY_INVITATION_NOT_PENDING");
    await expect(service.revoke(context, "missing")).rejects.toThrow("IDENTITY_INVITATION_NOT_FOUND");
    await expect(service.revoke({ ...context, tenantId: "tenant-b" }, issued.invitation.id)).rejects.toThrow("IDENTITY_INVITATION_NOT_FOUND");
    // UAT F-20: a withdrawn link says it was withdrawn, not that it was used.
    await expect(service.accept({ token: issued.activationToken, password: "Secure-password-123" })).rejects.toThrow("IDENTITY_INVITATION_REVOKED");
  });

  it("kabul sırasında davet iptal edilirse öğretmen bağı ve rol geri alınır (UAT F-03 inceleme)", async () => {
    const teachers = new InMemoryTeacherStore();
    const users = new InMemoryUserManagementStore();
    const invitations = new InMemoryIdentityInvitationStore();
    const teacher = await teachers.create({ tenantId: "tenant-a", firstName: "Yaris", lastName: "Ogretmen" });
    const service = new IdentityInvitationService(invitations, users, new InMemoryStudentStore(), new InMemoryGuardianStore(), teachers, new InMemoryTenantStore());
    const context: RequestContext = { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false };
    const issued = await service.create(context, { subjectType: "TEACHER", subjectId: teacher.id, email: "yaris.ogretmen@example.test" });

    // The admin's revoke commits between bindSubject and markAccepted.
    const markAccepted = invitations.markAccepted.bind(invitations);
    vi.spyOn(invitations, "markAccepted").mockImplementation(async (id, userId, acceptedAt) => {
      await service.revoke(context, issued.invitation.id);
      return markAccepted(id, userId, acceptedAt);
    });
    const removeTenantRole = vi.spyOn(users, "removeTenantRole");

    await expect(service.accept({ token: issued.activationToken, password: "Secure-password-123" })).rejects.toThrow("IDENTITY_INVITATION_REVOKED");
    await expect(teachers.findById(teacher.id)).resolves.toMatchObject({ userId: undefined });
    expect(removeTenantRole).toHaveBeenCalledWith("tenant-a", expect.any(String), "TEACHER");
    // The account the accept created is removed again.
    await expect(users.findTenantUserByEmail("tenant-a", "yaris.ogretmen@example.test")).resolves.toBeUndefined();
    await expect(invitations.findById("tenant-a", issued.invitation.id)).resolves.toMatchObject({ status: "REVOKED" });
  });

  it("unbindUser yalnız bağ hâlâ aynı hesabı gösteriyorsa çözer", async () => {
    const teachers = new InMemoryTeacherStore();
    const teacher = await teachers.create({ tenantId: "tenant-a", firstName: "Bag", lastName: "Ogretmen" });
    await teachers.bindUser("tenant-a", teacher.id, "user-b");
    await expect(teachers.unbindUser("tenant-a", teacher.id, "user-a")).resolves.toBe(false);
    await expect(teachers.findById(teacher.id)).resolves.toMatchObject({ userId: "user-b" });
    await expect(teachers.unbindUser("tenant-b", teacher.id, "user-b")).resolves.toBe(false);
    await expect(teachers.unbindUser("tenant-a", teacher.id, "user-b")).resolves.toBe(true);
    await expect(teachers.findById(teacher.id)).resolves.toMatchObject({ userId: undefined });
  });

  it("başka hesaba bağlı konunun e-posta daveti kabul edilmez, bağ değişmez", async () => {
    const teachers = new InMemoryTeacherStore();
    const invitations = new InMemoryIdentityInvitationStore();
    const teacher = await teachers.create({ tenantId: "tenant-a", firstName: "Bagli", lastName: "Ogretmen" });
    const service = new IdentityInvitationService(invitations, new InMemoryUserManagementStore(), new InMemoryStudentStore(), new InMemoryGuardianStore(), teachers, new InMemoryTenantStore());
    const context: RequestContext = { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false };
    const issued = await service.create(context, { subjectType: "TEACHER", subjectId: teacher.id, email: "bagli.ogretmen@example.test" });
    // Linked to another account after the invitation was sent (e.g. another accept path).
    await teachers.bindUser("tenant-a", teacher.id, "user-other");
    const runMutation = vi.mocked(tenantMutationActivity.runVerifiedTenantMutation);
    runMutation.mockClear();

    await expect(service.accept({ token: issued.activationToken, password: "Secure-password-123" })).rejects.toThrow("SUBJECT_ALREADY_LINKED");
    await expect(teachers.findById(teacher.id)).resolves.toMatchObject({ userId: "user-other" });
    expect(runMutation).not.toHaveBeenCalled();
    await expect(invitations.findById("tenant-a", issued.invitation.id)).resolves.toMatchObject({ status: "PENDING" });
  });

  describe("UAT F-20: çalışan daveti e-posta çakışması ve iptal edilen bağlantı", () => {
    const adminContext: RequestContext = { tenantId: "tenant-a", userId: "admin-a", roles: ["TENANT_ADMIN"], bypassRls: false };

    async function setup(teachers = new InMemoryTeacherStore()) {
      const invitations = new InMemoryIdentityInvitationStore();
      const users = new InMemoryUserManagementStore();
      const tenants = new InMemoryTenantStore();
      const employee = await users.createEmployee("tenant-a", { firstName: "Uat", lastName: "Muhasebe", status: "ACTIVE" });
      const service = new IdentityInvitationService(
        invitations,
        users,
        new InMemoryStudentStore(),
        new InMemoryGuardianStore(),
        teachers,
        tenants,
        undefined,
        new InMemoryEmployeeAccountActivationStore(users, tenants, invitations, teachers),
      );
      return { employee, invitations, service, users };
    }

    it.each([
      ["başka çalışana bağlı hesap", "Admin-A@Example.test", "EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND"],
      ["öğrenci hesabı", "student-a@example.test", "EMPLOYEE_EMAIL_ACCOUNT_INCOMPATIBLE"],
      ["veli hesabı", "guardian-a@example.test", "EMPLOYEE_EMAIL_ACCOUNT_INCOMPATIBLE"],
    ])("%s e-postasına davet oluşturmadan 409 ile reddeder", async (_label, email, code) => {
      const { employee, invitations, service } = await setup();
      const create = vi.spyOn(invitations, "create");

      const rejected = service.createEmployeeInvitation(adminContext, employee.id, { email, role: "FINANCE_STAFF" });
      await expect(rejected).rejects.toThrow(code);
      await expect(rejected).rejects.toMatchObject({ status: 409 });
      expect(create).not.toHaveBeenCalled();
      await expect(invitations.list("tenant-a")).resolves.toEqual([]);
    });

    it("öğretmeni başka çalışan kaydına bağlı hesabın e-postasını reddeder", async () => {
      const teachers = new InMemoryTeacherStore();
      const { employee, users, service } = await setup(teachers);
      const teacherEmployee = await users.createEmployee("tenant-a", { firstName: "Ayse", lastName: "Ogretmen", status: "ACTIVE" });
      // The in-memory teacher store has no Teacher -> Employee link; the PostgreSQL test covers the real join.
      vi.spyOn(teachers as TeacherStore, "findByEmployeeId").mockImplementation(async (_tenantId: string, employeeId: string) => (
        employeeId === teacherEmployee.id
          ? { id: "teacher-a", tenantId: "tenant-a", firstName: "Ayse", lastName: "Ogretmen", userId: "teacher-tenant-a" }
          : undefined
      ));

      await expect(service.createEmployeeInvitation(adminContext, employee.id, { email: "teacher-a@example.test", role: "FINANCE_STAFF" }))
        .rejects.toThrow("EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND");
    });

    it("çalışan kaydına bağlı olmayan öğretmen hesabına davet açar ve kabulde iki rol birleşir", async () => {
      const { employee, service, users } = await setup();

      const issued = await service.createEmployeeInvitation(adminContext, employee.id, { email: "teacher-a@example.test", role: "FINANCE_STAFF" });
      await service.accept({ token: issued.activationToken, password: "Secure-password-123" });

      await expect(users.findTenantUserByEmail("tenant-a", "teacher-a@example.test")).resolves.toMatchObject({
        id: "teacher-tenant-a",
        roles: expect.arrayContaining(["FINANCE_STAFF", "TEACHER"]),
      });
      await expect(users.findEmployee("tenant-a", employee.id)).resolves.toMatchObject({ userId: "teacher-tenant-a" });
    });

    it("sonradan bağlanan e-postaya tekrar göndermeyi reddeder; eski bağlantı aktivasyonda da reddedilir", async () => {
      const { employee, invitations, service, users } = await setup();
      const first = await users.createEmployee("tenant-a", { firstName: "Ilk", lastName: "Calisan", status: "ACTIVE" });
      const firstInvite = await service.createEmployeeInvitation(adminContext, first.id, { email: "ortak@example.test", role: "OPERATIONS_STAFF" });
      const secondInvite = await service.createEmployeeInvitation(adminContext, employee.id, { email: "ortak@example.test", role: "FINANCE_STAFF" });
      await service.accept({ token: firstInvite.activationToken, password: "Secure-password-123" });
      const resend = vi.spyOn(invitations, "resend");

      await expect(service.resend(adminContext, secondInvite.invitation.id)).rejects.toThrow("EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND");
      expect(resend).not.toHaveBeenCalled();
      // Activation keeps its own check (race safety) and its 400 class.
      await expect(service.accept({ token: secondInvite.activationToken, password: "Secure-password-123" }))
        .rejects.toMatchObject({ message: "EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND", status: 400 });
    });

    it("iptal edilen çalışan davetini REVOKED, kullanılmış daveti NOT_PENDING ile reddeder", async () => {
      const { employee, service, users } = await setup();
      const other = await users.createEmployee("tenant-a", { firstName: "Diger", lastName: "Calisan", status: "ACTIVE" });
      const revoked = await service.createEmployeeInvitation(adminContext, employee.id, { email: "iptal.f20@example.test", role: "FINANCE_STAFF" });
      await service.revoke(adminContext, revoked.invitation.id);
      const used = await service.createEmployeeInvitation(adminContext, other.id, { email: "kullanildi.f20@example.test", role: "FINANCE_STAFF" });
      await service.accept({ token: used.activationToken, password: "Secure-password-123" });

      await expect(service.accept({ token: revoked.activationToken, password: "Secure-password-123" }))
        .rejects.toMatchObject({ message: "IDENTITY_INVITATION_REVOKED", status: 400 });
      await expect(service.accept({ token: used.activationToken, password: "Secure-password-123" }))
        .rejects.toMatchObject({ message: "IDENTITY_INVITATION_NOT_PENDING", status: 400 });
    });

    it("süresi geçmiş iptal edilmiş bağlantı için süre dolumunu bildirir", async () => {
      const { employee, invitations, service } = await setup();
      const issued = await service.createEmployeeInvitation(adminContext, employee.id, { email: "eski.f20@example.test", role: "FINANCE_STAFF" });
      await service.revoke(adminContext, issued.invitation.id);
      const stored = await invitations.findById("tenant-a", issued.invitation.id);
      vi.spyOn(invitations, "findByTokenHash").mockResolvedValue({ ...stored!, expiresAt: "2026-01-01T00:00:00.000Z" });

      await expect(service.accept({ token: issued.activationToken, password: "Secure-password-123" })).rejects.toThrow("IDENTITY_INVITATION_EXPIRED");
    });
  });
});
