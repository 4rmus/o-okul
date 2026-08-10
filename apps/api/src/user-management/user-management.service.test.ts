import { describe, expect, it, vi } from "vitest";
import type { SessionStore } from "../auth/session-store.js";
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

describe("UserManagementService", () => {
  it("kampüs kapsamlı çalışan IAM okuma ve yazılarını store'a ulaşmadan reddeder", async () => {
    const store = {
      createEmployee: vi.fn(),
      listEmployeeAccessPage: vi.fn(),
      listTenantUsers: vi.fn(),
      updateTenantMembership: vi.fn(),
    } as unknown as UserManagementStore;
    const service = new UserManagementService(store, {} as SessionStore);
    const campusContext: RequestContext = {
      ...context,
      activePersona: "STAFF",
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
    };

    await expect(service.list(campusContext)).rejects.toThrow("EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    await expect(service.listEmployees(campusContext, { direction: "next", limit: 50, sort: "lastName" })).rejects.toThrow("EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    await expect(service.createEmployee(campusContext, { firstName: "Ada", lastName: "Dar", status: "ACTIVE" })).rejects.toThrow("EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    await expect(service.updateMembership(campusContext, "membership-a", update)).rejects.toThrow("EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    expect(store.listTenantUsers).not.toHaveBeenCalled();
    expect(store.listEmployeeAccessPage).not.toHaveBeenCalled();
    expect(store.createEmployee).not.toHaveBeenCalled();
    expect(store.updateTenantMembership).not.toHaveBeenCalled();
  });

  it("kurum üyeliği değişikliğini MFA istemeden owner capability bilgisiyle store'a geçirir", async () => {
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
    await expect(service.updateMembership(context, "membership-a", update)).resolves.toEqual(result);
    expect(store.updateTenantMembership).toHaveBeenCalledWith("tenant-a", "membership-a", expect.objectContaining({
      actorCanManageOwners: true,
    }));
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
