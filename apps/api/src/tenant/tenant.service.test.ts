import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { PasswordResetRecord, PasswordResetStore } from "../auth/password-reset-store.js";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryTenantStore } from "./tenant-store.js";
import { TenantService } from "./tenant.service.js";

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

  it("tenant oluşturma, lisans güncelleme ve silmeyi audit log'a yazar", async () => {
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
      plan: "PRO",
      licenseEndsAt: "2030-01-01T00:00:00.000Z",
      seatLimit: 120,
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
          plan: "PRO",
          seatLimit: 120,
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

  it("SystemAdmin kurum oluştururken ilk tenant admin üyeliğini provision eder", async () => {
    const service = new TenantService(new InMemoryTenantStore());

    const result = await service.create(systemContext, {
      id: "tenant-first-admin",
      name: "İlk Adminli Kurum",
      slug: "ilk-adminli-kurum",
      firstAdmin: {
        name: "İlk Yönetici",
        email: "FIRST.ADMIN@example.test",
        mode: "password",
        password: "password1",
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
        mode: "password",
        password: "password1",
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

  it("SystemAdmin ilk tenant admin için davet token kaydı üretir ama ham token döndürmez", async () => {
    const passwordResetCreates: Array<{ userId: string; tokenHash: string; expiresAt: string }> = [];
    const passwordResets: PasswordResetStore = {
      create: async (input) => {
        passwordResetCreates.push(input);
        return {
          id: "password-reset-test",
          userId: input.userId,
          tokenHash: input.tokenHash,
          status: "PENDING",
          expiresAt: input.expiresAt,
          createdAt: input.expiresAt,
          updatedAt: input.expiresAt,
        } satisfies PasswordResetRecord;
      },
      findByTokenHash: async () => undefined,
      markUsed: async () => undefined,
      revokePendingForUser: async () => undefined,
    };
    const service = new TenantService(new InMemoryTenantStore(), undefined, undefined, passwordResets);

    const result = await service.create(systemContext, {
      id: "tenant-invited-admin",
      name: "Davetli Admin Kurum",
      slug: "davetli-admin-kurum",
      firstAdmin: {
        name: "Davetli Yönetici",
        email: "INVITED.ADMIN@example.test",
        mode: "invitation",
      },
    });

    expect(result).toEqual({
      tenant: expect.objectContaining({ id: "tenant-invited-admin" }),
      admin: expect.objectContaining({
        activationTokenExpiresAt: expect.any(String),
        activationTokenIssued: true,
        email: "invited.admin@example.test",
        roles: ["TENANT_ADMIN"],
        tenantId: "tenant-invited-admin",
      }),
    });
    if (!("admin" in result)) {
      throw new Error("FIRST_ADMIN_RESULT_MISSING");
    }
    expect(result.admin).not.toHaveProperty("activationToken");
    expect(passwordResetCreates).toEqual([
      expect.objectContaining({
        userId: result.admin.id,
        tokenHash: expect.any(String),
        expiresAt: result.admin.activationTokenExpiresAt,
      }),
    ]);
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
        mode: "password",
        password: "password1",
      },
    })).rejects.toThrow("TENANT_SLUG_ALREADY_EXISTS");
  });

  it("ilk admin e-postası çakışmasını anlaşılır tenant hatasına çevirir", async () => {
    const store = {
      createWithFirstAdmin: async () => {
        throw Object.assign(new Error("TENANT_FIRST_ADMIN_EMAIL_ALREADY_EXISTS"), {
          code: "TENANT_FIRST_ADMIN_EMAIL_ALREADY_EXISTS",
        });
      },
    };
    const service = new TenantService(store as never);

    await expect(service.create(systemContext, {
      name: "Çakışan Admin Kurumu",
      slug: "cakisan-admin-kurumu",
      firstAdmin: {
        name: "Demo Admin",
        email: "demo-admin@example.test",
        mode: "password",
        password: "password1",
      },
    })).rejects.toThrow("TENANT_FIRST_ADMIN_EMAIL_ALREADY_EXISTS");
  });

  it("tenant admin kurum yönetimi yapamaz", async () => {
    const service = new TenantService(new InMemoryTenantStore());

    await expect(service.list(tenantAdminContext)).rejects.toThrow(BadRequestException);
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
