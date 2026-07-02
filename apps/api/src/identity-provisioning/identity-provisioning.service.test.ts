import { describe, expect, it } from "vitest";
import { InMemoryAuthUserStore, verifyPassword } from "../auth/auth-user-store.js";
import type { RequestContext } from "../context/request-context.js";
import { hashTcIdentity } from "../student/tc-identity.js";
import { IdentityProvisioningService } from "./identity-provisioning.service.js";

describe("IdentityProvisioningService", () => {
  it("TC ve telefondan tenant kullanıcısı üretir ve ilk şifreyi telefon yapar", async () => {
    const users = new InMemoryAuthUserStore();
    const service = new IdentityProvisioningService(users);
    const nationalId = "10000000146";

    const provisioned = await service.provisionTenantSubject({
      tenantId: "tenant-a",
      subjectType: "STUDENT",
      subjectId: "student-provisioned",
      displayName: "Ada Ogrenci",
      nationalId,
      phone: "0 555 123 45 67",
    });

    expect(provisioned).toMatchObject({ initialPassword: "5551234567" });
    const user = await users.findByTenantAndNationalIdHash("tenant-a", hashTcIdentity(nationalId));
    expect(user).toMatchObject({
      id: provisioned?.userId,
      name: "Ada Ogrenci",
      roles: ["STUDENT"],
      mustChangePassword: true,
    });
    expect(verifyPassword("5551234567", user?.passwordHash ?? "")).toBe(true);
  });

  it("TC ve telefon yoksa e-posta davetine düşer", async () => {
    const invitations = {
      create: async (context: RequestContext, body: unknown) => ({
        context,
        invitation: { id: "invite-teacher-a" },
        body,
      }),
    };
    const service = new IdentityProvisioningService(new InMemoryAuthUserStore(), invitations as never);

    const result = await service.provisionOrInvite(adminContext, {
      tenantId: "tenant-a",
      subjectType: "TEACHER",
      subjectId: "teacher-invited",
      displayName: "Davet Ogretmen",
      email: "Teacher.Invite@example.test",
    });

    expect(result).toEqual({ status: "INVITED", invitationId: "invite-teacher-a" });
  });
});

const adminContext: RequestContext = {
  userId: "admin-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  capabilities: ["staff:manage"],
  bypassRls: false,
};
