import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryTenantStore } from "./tenant-store.js";
import { TenantService } from "./tenant.service.js";
import { InMemoryLicenseTermStore } from "../license/license-term-store.js";

describe("TenantService", () => {
  it("SystemAdmin tenant oluşturur ve listeler", async () => {
    const store = new InMemoryTenantStore();
    const service = new TenantService(store);

    const tenant = await service.create(systemContext, {
      id: "tenant-new",
      name: "Yeni Kurum",
      slug: "yeni-kurum",
      plan: "STANDARD",
      seatLimit: 100,
    });

    expect(tenant).toMatchObject({
      id: "tenant-new",
      plan: "STANDARD",
      seatLimit: 100,
      status: "ACTIVE",
    });
    await expect(service.list(systemContext)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "tenant-new" })]));
  });

  it("tenant oluşturma, durum güncelleme ve silmeyi audit log'a yazar", async () => {
    const records: unknown[] = [];
    const auditLogs = {
      record: async (input: unknown) => {
        records.push(input);
      },
    };
    const service = new TenantService(new InMemoryTenantStore(), auditLogs as never);

    await service.create(systemContext, {
      id: "tenant-audit",
      name: "Audit Kurum",
      slug: "audit-kurum",
      plan: "TRIAL",
    });
    await service.update(systemContext, "tenant-audit", {
      status: "SUSPENDED",
    });
    await service.delete(systemContext, "tenant-audit");

    expect(records).toEqual([
      expect.objectContaining({
        tenantId: "tenant-audit",
        actorUserId: "user-system",
        entityType: "Tenant",
        entityId: "tenant-audit",
        action: "tenant.created",
      }),
      expect.objectContaining({
        tenantId: "tenant-audit",
        actorUserId: "user-system",
        entityType: "Tenant",
        entityId: "tenant-audit",
        action: "tenant.updated",
        diff: expect.objectContaining({
          status: "SUSPENDED",
        }),
      }),
      expect.objectContaining({
        tenantId: "tenant-audit",
        actorUserId: "user-system",
        entityType: "Tenant",
        entityId: "tenant-audit",
        action: "tenant.deleted",
        diff: expect.objectContaining({ status: "DELETED" }),
      }),
    ]);
  });

  it("tenant silme audit kaydını fiziksel silmeden önce yazar", async () => {
    const events: string[] = [];
    const store = {
      list: async () => [],
      findById: async () => undefined,
      findBySlug: async () => undefined,
      findForAdmin: async () => {
        events.push("find");
        return {
          id: "tenant-delete-order",
          name: "Delete Order Tenant",
          slug: "delete-order-tenant",
          plan: "TRIAL",
          status: "ACTIVE",
        };
      },
      create: async () => {
        throw new Error("unexpected");
      },
      update: async () => undefined,
      delete: async () => {
        events.push("delete");
        return {
          id: "tenant-delete-order",
          name: "Delete Order Tenant",
          slug: "delete-order-tenant",
          plan: "TRIAL",
          status: "DELETED",
        };
      },
    };
    const auditLogs = {
      record: async () => {
        events.push("audit");
      },
    };
    const service = new TenantService(store as never, auditLogs as never);

    await expect(service.delete(systemContext, "tenant-delete-order")).resolves.toMatchObject({
      id: "tenant-delete-order",
      status: "DELETED",
    });
    expect(events).toEqual(["find", "audit", "delete"]);
  });

  it("system tenant silinmez ve audit kaydı yazılmaz", async () => {
    const events: string[] = [];
    const store = {
      list: async () => [],
      findById: async () => undefined,
      findBySlug: async () => undefined,
      findForAdmin: async () => ({
        id: "system",
        name: "System",
        slug: "system",
        plan: "SYSTEM",
        status: "ACTIVE",
      }),
      create: async () => {
        throw new Error("unexpected");
      },
      update: async () => undefined,
      delete: async () => {
        events.push("delete");
        return undefined;
      },
    };
    const auditLogs = {
      record: async () => {
        events.push("audit");
      },
    };
    const service = new TenantService(store as never, auditLogs as never);

    await expect(service.delete(systemContext, "system")).rejects.toThrow("TENANT_NOT_FOUND");
    expect(events).toEqual([]);
  });

  it("SystemAdmin kurum oluştururken ilk tenant admin üyeliğini provision eder", async () => {
    const service = new TenantService(new InMemoryTenantStore());

    const result = await service.create(systemContext, {
      id: "tenant-first-admin",
      name: "İlk Adminli Kurum",
      slug: "ilk-adminli-kurum",
      firstAdmin: {
        name: "İlk Yönetici",
        email: "FIRST.ADMIN@example.test",
        nationalId: "10000000450",
      },
    });

    expect(result).toEqual({
      tenant: expect.objectContaining({ id: "tenant-first-admin" }),
      admin: expect.objectContaining({
        email: "first.admin@example.test",
        name: "İlk Yönetici",
        roles: ["TENANT_ADMIN"],
        tenantId: "tenant-first-admin",
      }),
    });
  });

  it("SystemAdmin canonical onboarding ile lisans, kampüs ve ilk sahip çalışanını birlikte oluşturur", async () => {
    const auditRecords: unknown[] = [];
    const service = new TenantService(new InMemoryTenantStore(), { record: async (input: unknown) => { auditRecords.push(input); } } as never);

    const result = await service.create(systemContext, {
      id: "tenant-owner-onboarding",
      name: "Sahipli Kurum",
      slug: "sahipli-kurum",
      campuses: [{ name: "Merkez Kampüs", code: "MRK", unitType: "SCHOOL" }],
      licenseTerm: {
        planCode: "PRO",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2027-08-01T00:00:00.000Z",
        activeStudentLimit: 500,
        auditReference: "contract-owner-1",
      },
      firstOwner: {
        name: "İlk Sahip",
        email: "OWNER@example.test",
      },
    }, "tenant-owner-onboarding-1");

    expect(result).toMatchObject({
      tenant: {
        id: "tenant-owner-onboarding",
        plan: "PRO",
        licenseStartsAt: "2026-08-01T00:00:00.000Z",
        licenseEndsAt: "2027-08-01T00:00:00.000Z",
        seatLimit: 500,
      },
      campuses: [{ tenantId: "tenant-owner-onboarding", name: "Merkez Kampüs", code: "MRK", unitType: "SCHOOL" }],
      licenseTerm: { tenantId: "tenant-owner-onboarding", planCode: "PRO", activeStudentLimit: 500 },
      owner: {
        tenantId: "tenant-owner-onboarding",
        roles: ["TENANT_OWNER"],
      },
    });
    await service.create(systemContext, {
      id: "tenant-owner-onboarding",
      name: "Sahipli Kurum",
      slug: "sahipli-kurum",
      campuses: [{ name: "Merkez Kampüs", code: "MRK", unitType: "SCHOOL" }],
      licenseTerm: {
        planCode: "PRO",
        startsAt: "2026-08-01T00:00:00.000Z",
        endsAt: "2027-08-01T00:00:00.000Z",
        activeStudentLimit: 500,
        auditReference: "contract-owner-1",
      },
      firstOwner: { name: "İlk Sahip", email: "OWNER@example.test" },
    }, "tenant-owner-onboarding-1");
    expect(auditRecords).toHaveLength(2);
  });

  it("ilk tenant admin audit kaydı raw e-posta yazmaz", async () => {
    const records: unknown[] = [];
    const auditLogs = {
      record: async (input: unknown) => {
        records.push(input);
      },
    };
    const service = new TenantService(new InMemoryTenantStore(), auditLogs as never);

    await service.create(systemContext, {
      id: "tenant-first-admin-audit",
      name: "İlk Admin Audit Kurum",
      slug: "ilk-admin-audit-kurum",
      firstAdmin: {
        name: "Audit Yönetici",
        email: "audit.admin@example.test",
        nationalId: "10000000450",
      },
    });

    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "tenant.first_admin_created",
        diff: expect.objectContaining({
          emailProvided: true,
          roles: ["TENANT_ADMIN"],
        }),
      }),
    ]));
    expect(JSON.stringify(records)).not.toContain("audit.admin@example.test");
  });

  it("SystemAdmin ilk tenant admin yanıtında parola veya token döndürmez", async () => {
    const service = new TenantService(new InMemoryTenantStore());

    const result = await service.create(systemContext, {
      id: "tenant-phone-admin",
      name: "Telefon Admin Kurum",
      slug: "telefon-admin-kurum",
      firstAdmin: {
        name: "Telefon Yönetici",
        email: "PHONE.ADMIN@example.test",
        nationalId: "10000000450",
      },
    });

    expect(result).toEqual({
      tenant: expect.objectContaining({ id: "tenant-phone-admin" }),
      admin: expect.objectContaining({
        email: "phone.admin@example.test",
        roles: ["TENANT_ADMIN"],
        tenantId: "tenant-phone-admin",
      }),
    });
    if (!("admin" in result)) {
      throw new Error("FIRST_ADMIN_RESULT_MISSING");
    }
    expect(result.admin).not.toHaveProperty("activationToken");
  });

  it("slug çakışmasını anlaşılır tenant hatasına çevirir", async () => {
    const store = {
      createWithFirstAdmin: async () => {
        throw { code: "23505", constraint: "Tenant_slug_key" };
      },
    };
    const service = new TenantService(store as never);

    await expect(service.create(systemContext, {
      name: "Çakışan Kurum",
      slug: "demo",
      firstAdmin: {
        name: "Demo Admin",
        email: "demo-admin@example.test",
        nationalId: "10000000450",
      },
    })).rejects.toThrow("TENANT_SLUG_ALREADY_EXISTS");
  });

  it("tenant admin kurum yönetimi yapamaz", async () => {
    const service = new TenantService(new InMemoryTenantStore());

    await expect(service.list(tenantAdminContext)).rejects.toThrow(BadRequestException);
  });

  it("tenant kendi lisans dönemlerini canonical durumuyla listeler", async () => {
    const service = new TenantService(
      new InMemoryTenantStore(),
      undefined,
      new InMemoryLicenseTermStore([{
        id: "license-scheduled",
        tenantId: "tenant-a",
        planCode: "PRO",
        startsAt: "2099-01-01T00:00:00.000Z",
        endsAt: "2100-01-01T00:00:00.000Z",
        activeStudentLimit: 500,
      }]),
    );

    await expect(service.listCurrentLicenseTerms(tenantAdminContext)).resolves.toEqual([
      expect.objectContaining({ id: "license-scheduled", tenantId: "tenant-a", state: "SCHEDULED" }),
    ]);
  });

  it("geçersiz lisans tarihi reddedilir", async () => {
    const service = new TenantService(new InMemoryTenantStore());

    await expect(service.create(systemContext, {
      name: "Hatalı Kurum",
      slug: "hatali-kurum",
      licenseEndsAt: "not-a-date",
    })).rejects.toThrow("TENANT_LICENSE_END_INVALID");

    await expect(service.create(systemContext, {
      name: "Hatalı Kurum",
      slug: "hatali-kurum-2",
      licenseEndsAt: "2026-02-29T00:00:00.000Z",
    })).rejects.toThrow("TENANT_LICENSE_END_INVALID");
  });
});

const systemContext: RequestContext = {
  userId: "user-system",
  tenantId: null,
  roles: ["SYSTEM_ADMIN"],
  capabilities: ["tenant:*"],
  bypassRls: false,
};

const tenantAdminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  capabilities: ["academic:*"],
  bypassRls: false,
};
