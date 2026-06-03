import { describe, expect, it } from "vitest";
import { capabilitiesForRoles, hasCapability } from "./role-capabilities.js";

describe("role capabilities", () => {
  it("TENANT_ADMIN finans ve akademik yönetim yetkilerine sahiptir", () => {
    const context = { roles: ["TENANT_ADMIN"], capabilities: capabilitiesForRoles(["TENANT_ADMIN"]) };

    expect(hasCapability(context, "finance:manage")).toBe(true);
    expect(hasCapability(context, "academic:manage")).toBe(true);
  });

  it("ASSISTANT_ADMIN akademik yönetir ama finansı göremez", () => {
    const context = { roles: ["ASSISTANT_ADMIN"], capabilities: capabilitiesForRoles(["ASSISTANT_ADMIN"]) };

    expect(hasCapability(context, "academic:manage")).toBe(true);
    expect(hasCapability(context, "staff:manage")).toBe(true);
    expect(hasCapability(context, "student:manage")).toBe(true);
    expect(hasCapability(context, "finance:manage")).toBe(false);
  });

  it("TEACHER yönetim capability'lerini alamaz", () => {
    const context = { roles: ["TEACHER"], capabilities: capabilitiesForRoles(["TEACHER"]) };

    expect(hasCapability(context, "academic:manage")).toBe(false);
    expect(hasCapability(context, "student:manage")).toBe(false);
    expect(hasCapability(context, "finance:manage")).toBe(false);
  });
});
