import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { IdentityProvisioningService } from "./identity-provisioning.service.js";

describe("IdentityProvisioningService", () => {
  it("TC ve telefon olsa bile parola tabanlı hesap üretmez", async () => {
    const service = new IdentityProvisioningService();

    const result = await service.provisionOrInvite(adminContext, {
      tenantId: "tenant-a",
      subjectType: "STUDENT",
      subjectId: "student-provisioned",
      displayName: "Ada Ogrenci",
      nationalId: "10000000146",
      phone: "0 555 123 45 67",
    });

    expect(result).toEqual({ status: "SKIPPED" });
  });

  it("TC ve telefon yoksa e-posta davetine düşer", async () => {
    const invitations = {
      create: async (context: RequestContext, body: unknown) => ({
        context,
        invitation: { id: "invite-teacher-a" },
        body,
      }),
    };
    const service = new IdentityProvisioningService(invitations as never);

    const result = await service.provisionOrInvite(adminContext, {
      tenantId: "tenant-a",
      subjectType: "TEACHER",
      subjectId: "teacher-invited",
      displayName: "Davet Ogretmen",
      email: "Teacher.Invite@example.test",
    });

    expect(result).toEqual({ status: "INVITED", invitationId: "invite-teacher-a" });
  });

  it("TC var ama telefon yoksa kullanıcı üretmez, e-posta davetine düşer", async () => {
    const invitations = {
      create: async (context: RequestContext, body: unknown) => ({
        context,
        invitation: { id: "invite-teacher-without-phone" },
        body,
      }),
    };
    const service = new IdentityProvisioningService(invitations as never);

    const result = await service.provisionOrInvite(adminContext, {
      tenantId: "tenant-a",
      subjectType: "TEACHER",
      subjectId: "teacher-without-phone",
      displayName: "Telefonsuz Ogretmen",
      nationalId: "10000009999",
      email: "teacher.without.phone@example.test",
    });

    expect(result).toEqual({ status: "INVITED", invitationId: "invite-teacher-without-phone" });
  });
});

const adminContext: RequestContext = {
  userId: "admin-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  capabilities: ["staff:manage"],
  bypassRls: false,
};
