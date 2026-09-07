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

    const tenant = await service.create(systemContext, canonicalTenantBody("tenant-new", "Yeni Kurum", "yeni-kurum"), "tenant-new-1");

    expect(tenant).toMatchObject({
      tenant: { id: "tenant-new", plan: "PRO", seatLimit: 100, status: "ACTIVE" },
      owner: { roles: ["TENANT_OWNER"] },
    });
    await expect(service.list(systemContext)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: "tenant-new" })]));
  });

  it("canonical tenant oluşturma ve profil güncellemeyi audit log'a yazar", async () => {
    const records: unknown[] = [];
    const auditLogs = {
      record: async (input: unknown) => {
        records.push(input);
      },
    };
    const service = new TenantService(new InMemoryTenantStore(), auditLogs as never);

    await service.create(systemContext, canonicalTenantBody("tenant-audit", "Audit Kurum", "audit-kurum"), "tenant-audit-1");
    await service.update(systemContext, "tenant-audit", { name: "Güncel Audit Kurum" });

    expect(records).toEqual([
      expect.objectContaining({
        tenantId: "tenant-audit",
        actorUserId: "user-system",
        entityType: "Tenant",
        entityId: "tenant-audit",
        action: "tenant.created",
      }),
      expect.objectContaining({ action: "tenant.first_owner_invited" }),
      expect.objectContaining({
        tenantId: "tenant-audit",
        actorUserId: "user-system",
        entityType: "Tenant",
        entityId: "tenant-audit",
        action: "tenant.updated",
        diff: expect.objectContaining({
          name: "Güncel Audit Kurum",
        }),
      }),
    ]);
  });

  it("system tenant mutationlarını reddeder", async () => {
    const service = new TenantService(new InMemoryTenantStore(), undefined, new InMemoryLicenseTermStore());

    await expect(service.create(systemContext, canonicalTenantBody("system", "System", "system"), "system-1"))
      .rejects.toThrow("SYSTEM_TENANT_IMMUTABLE");
    await expect(service.update(systemContext, "system", { name: "System Updated" }))
      .rejects.toThrow("SYSTEM_TENANT_IMMUTABLE");
    await expect(service.updateCurrent({ ...systemContext, tenantId: "system" }, { name: "System Updated" }))
      .rejects.toThrow("SYSTEM_TENANT_IMMUTABLE");
    await expect(service.updateStatus(systemContext, "system", { status: "SUSPENDED", expectedLifecycleVersion: 0, reason: "SECURITY_REVIEW", confirmationText: "system" }))
      .rejects.toThrow("SYSTEM_TENANT_IMMUTABLE");
    await expect(service.createLicenseTerm(systemContext, "system", {
      planCode: "SYSTEM",
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2027-01-01T00:00:00.000Z",
      activeStudentLimit: 1,
    })).rejects.toThrow("SYSTEM_TENANT_IMMUTABLE");
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
      licenseTerm: {
        tenantId: "tenant-owner-onboarding",
        planCode: "PRO",
        activeStudentLimit: 500,
        auditReference: expect.stringMatching(/^license-[0-9a-f-]{36}$/),
      },
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
      },
      firstOwner: { name: "İlk Sahip", email: "OWNER@example.test" },
    }, "tenant-owner-onboarding-1");
    expect(auditRecords).toHaveLength(2);
  });

  it("slug çakışmasını anlaşılır tenant hatasına çevirir", async () => {
    const store = {
      createOnboarding: async () => {
        throw { code: "23505", constraint: "Tenant_slug_key" };
      },
    };
    const service = new TenantService(store as never);

    await expect(service.create(
      systemContext,
      canonicalTenantBody(undefined, "Çakışan Kurum", "demo"),
      "duplicate-slug-1",
    )).rejects.toThrow("TENANT_SLUG_ALREADY_EXISTS");
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
      ...canonicalTenantBody(undefined, "Hatalı Kurum", "hatali-kurum"),
      licenseTerm: {
        planCode: "PRO",
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: "not-a-date",
        activeStudentLimit: 100,
      },
    }, "invalid-license-1")).rejects.toThrow("TENANT_LICENSE_TERM_INVALID");
  });
});

function canonicalTenantBody(id: string | undefined, name: string, slug: string) {
  return {
    ...(id ? { id } : {}),
    name,
    slug,
    campuses: [{ name: "Merkez Kampüs", code: "MRK", unitType: "SCHOOL" as const }],
    firstOwner: { name: "İlk Sahip", email: `${slug}@example.test` },
    licenseTerm: {
      planCode: "PRO",
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2027-08-01T00:00:00.000Z",
      activeStudentLimit: 100,
    },
  };
}

const systemContext: RequestContext = {
  userId: "user-system",
  tenantId: null,
  roles: ["SYSTEM_ADMIN"],
  capabilities: ["tenant:manage", "tenant:lifecycle"],
  bypassRls: false,
};

const tenantAdminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  capabilities: ["academic:*"],
  bypassRls: false,
};
