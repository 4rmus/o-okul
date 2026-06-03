import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
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

  it("tenant oluşturma ve lisans güncellemesini audit log'a yazar", async () => {
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
    ]);
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
  });
});

const systemContext: RequestContext = {
  userId: "user-system",
  tenantId: null,
  roles: ["SYSTEM_ADMIN"],
  capabilities: ["tenant:*"],
  bypassRls: true,
};

const tenantAdminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  capabilities: ["academic:*"],
  bypassRls: false,
};
