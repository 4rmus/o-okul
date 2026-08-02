import { describe, expect, it, vi } from "vitest";
import type { SessionStore } from "../auth/session-store.js";
import { createAdminMfaStepUpProof } from "../auth/totp-mfa.js";
import type { RequestContext } from "../context/request-context.js";
import { readListMeta } from "../listing/list-query.js";
import type { UserManagementStore } from "./user-management-store.js";
import { UserManagementService } from "./user-management.service.js";

const context: RequestContext = {
  userId: "owner-a",
  sessionId: "session-a",
  tenantId: "tenant-a",
  membershipVersion: 3,
  roles: ["TENANT_OWNER"],
  bypassRls: false,
};

const update = {
  campusIds: [],
  expectedVersion: 1,
  hasTeacherPersona: false,
  scopeMode: "TENANT" as const,
  staffRole: "TENANT_ADMIN" as const,
  status: "ACTIVE" as const,
};

describe("UserManagementService step-up", () => {
  it("bağlama uyan kanıtı store'a doğrulanmış olarak geçirir", async () => {
    const result = {
      employee: {
        id: "employee-a",
        tenantId: "tenant-a",
        firstName: "Ada",
        lastName: "Yılmaz",
        status: "ACTIVE",
      },
      sessionsRevoked: 0,
    };
    const store = { updateTenantMembership: vi.fn(async () => result) } as unknown as UserManagementStore;
    const service = new UserManagementService(store, {} as SessionStore);
    const proof = createAdminMfaStepUpProof({
      userId: context.userId,
      sessionId: context.sessionId ?? "",
      membershipVersion: context.membershipVersion ?? 0,
      purpose: "OWNER_ADMIN_CHANGE",
    });

    await expect(service.updateMembership(context, "membership-a", update, proof.stepUpToken)).resolves.toEqual(result);
    expect(store.updateTenantMembership).toHaveBeenCalledWith("tenant-a", "membership-a", expect.objectContaining({
      actorCanManageOwners: true,
      stepUpVerified: true,
    }));
  });

  it("başka oturuma bağlı veya bozuk kanıtı store'a ulaşmadan reddeder", async () => {
    const store = { updateTenantMembership: vi.fn() } as unknown as UserManagementStore;
    const service = new UserManagementService(store, {} as SessionStore);
    const otherSessionProof = createAdminMfaStepUpProof({
      userId: context.userId,
      sessionId: "session-b",
      membershipVersion: context.membershipVersion ?? 0,
      purpose: "OWNER_ADMIN_CHANGE",
    });

    await expect(service.updateMembership(context, "membership-a", update, otherSessionProof.stepUpToken))
      .rejects.toThrow("STEP_UP_MFA_INVALID");
    await expect(service.updateMembership(context, "membership-a", update, "forged-token"))
      .rejects.toThrow("STEP_UP_MFA_INVALID");
    expect(store.updateTenantMembership).not.toHaveBeenCalled();
  });

  it("çalışan cursor sayfasını tenant bağlamıyla alır ve cursor metadatasını korur", async () => {
    const records = [{ id: "employee-a", tenantId: "tenant-a", firstName: "Ada", lastName: "Yılmaz", status: "ACTIVE" }];
    const store = {
      listEmployeeAccessPage: vi.fn(async () => ({ records, meta: { limit: 50, nextCursor: "next-cursor" } })),
    } as unknown as UserManagementStore;
    const service = new UserManagementService(store, {} as SessionStore);
    const result = await service.listEmployees(context, { direction: "next", limit: 50, q: "ada", sort: "lastName" });

    expect(store.listEmployeeAccessPage).toHaveBeenCalledWith("tenant-a", { direction: "next", limit: 50, q: "ada", sort: "lastName" });
    expect(readListMeta(result)).toEqual({ limit: 50, nextCursor: "next-cursor" });
  });
});
