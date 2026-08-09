import { describe, expect, it } from "vitest";
import { capabilitiesForRoles, hasCapability } from "./role-capabilities.js";

describe("role capabilities", () => {
  it("TENANT_ADMIN finans ve akademik yönetim yetkilerine sahiptir", () => {
    const context = { roles: ["TENANT_ADMIN"], capabilities: capabilitiesForRoles(["TENANT_ADMIN"]) };

    expect(hasCapability(context, "finance:manage")).toBe(true);
    expect(hasCapability(context, "academic:manage")).toBe(true);
    expect(hasCapability(context, "audit:read")).toBe(true);
    expect(hasCapability(context, "operation:manage")).toBe(true);
    expect(hasCapability(context, "privacy:manage")).toBe(true);
    expect(hasCapability(context, "role-preview:manage")).toBe(true);
    expect(hasCapability(context, "setup:manage")).toBe(true);
    expect(hasCapability(context, "support:manage")).toBe(true);
    expect(hasCapability(context, "user:manage")).toBe(true);
  });

  it("ASSISTANT_ADMIN akademik ve destek yönetir ama finans ve kullanıcı yönetemez", () => {
    const context = { roles: ["ASSISTANT_ADMIN"], capabilities: capabilitiesForRoles(["ASSISTANT_ADMIN"]) };

    expect(hasCapability(context, "academic:manage")).toBe(true);
    expect(hasCapability(context, "staff:manage")).toBe(true);
    expect(hasCapability(context, "student:manage")).toBe(true);
    expect(hasCapability(context, "support:manage")).toBe(true);
    expect(hasCapability(context, "setup:manage")).toBe(true);
    expect(hasCapability(context, "audit:read")).toBe(false);
    expect(hasCapability(context, "finance:manage")).toBe(false);
    expect(hasCapability(context, "operation:manage")).toBe(false);
    expect(hasCapability(context, "privacy:manage")).toBe(false);
    expect(hasCapability(context, "role-preview:manage")).toBe(false);
    expect(hasCapability(context, "user:manage")).toBe(false);
  });

  it("FINANCE_STAFF yalnız finans capability'lerine sahiptir", () => {
    const context = { roles: ["FINANCE_STAFF"], capabilities: capabilitiesForRoles(["FINANCE_STAFF"]) };

    expect(hasCapability(context, "finance:manage")).toBe(true);
    expect(hasCapability(context, "academic:manage")).toBe(false);
    expect(hasCapability(context, "search:read")).toBe(false);
    expect(hasCapability(context, "support:manage")).toBe(false);
  });

  it("SYSTEM_ADMIN sistem ve audit yetkilerine sahiptir", () => {
    const context = { roles: ["SYSTEM_ADMIN"], capabilities: capabilitiesForRoles(["SYSTEM_ADMIN"]) };

    expect(hasCapability(context, "system:manage")).toBe(true);
    expect(hasCapability(context, "tenant:manage")).toBe(true);
    expect(hasCapability(context, "audit:read")).toBe(true);
    expect(hasCapability(context, "search:read")).toBe(false);
  });

  it("TEACHER yönetim capability'lerini alamaz", () => {
    const context = { roles: ["TEACHER"], capabilities: capabilitiesForRoles(["TEACHER"]) };

    expect(hasCapability(context, "academic:manage")).toBe(false);
    expect(hasCapability(context, "student:list")).toBe(true);
    expect(hasCapability(context, "student:read")).toBe(true);
    expect(hasCapability(context, "student:manage")).toBe(false);
    expect(hasCapability(context, "finance:manage")).toBe(false);
    expect(hasCapability(context, "search:read")).toBe(true);
  });

  it.each(["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF"])(
    "%s arama capability'sine sahiptir",
    (role) => {
      expect(hasCapability({ roles: [role] }, "search:read")).toBe(true);
    },
  );

  it("öğrenci ve veli yalnız scope kontrollü öğrenci okuma capability'sini alır", () => {
    expect(hasCapability({ roles: ["STUDENT"] }, "student:read")).toBe(true);
    expect(hasCapability({ roles: ["GUARDIAN"] }, "student:read")).toBe(true);
    expect(hasCapability({ roles: ["STUDENT"] }, "student:list")).toBe(false);
    expect(hasCapability({ roles: ["GUARDIAN"] }, "student:list")).toBe(false);
    expect(hasCapability({ roles: ["STUDENT"] }, "student:manage")).toBe(false);
    expect(hasCapability({ roles: ["GUARDIAN"] }, "student:manage")).toBe(false);
    expect(hasCapability({ roles: ["STUDENT"] }, "search:read")).toBe(false);
    expect(hasCapability({ roles: ["GUARDIAN"] }, "search:read")).toBe(false);
  });
});
