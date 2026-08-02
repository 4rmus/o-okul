import { describe, expect, it } from "vitest";
import { assertRole, hasRole, isSystemAdmin } from "./roles.js";

describe("roles", () => {
  it("üst rol alt rol yetkisini kapsar", () => {
    expect(hasRole(["TENANT_ADMIN"], "TEACHER")).toBe(true);
    expect(hasRole(["TEACHER"], "TENANT_ADMIN")).toBe(false);
    expect(hasRole(["ASSISTANT_ADMIN"], "TEACHER")).toBe(true);
  });

  it("FINANCE_STAFF yalnız kendi legacy rol kontrolünü geçer", () => {
    expect(hasRole(["FINANCE_STAFF"], "FINANCE_STAFF")).toBe(true);
    expect(hasRole(["FINANCE_STAFF"], "ASSISTANT_ADMIN")).toBe(false);
    expect(hasRole(["FINANCE_STAFF"], "TEACHER")).toBe(false);
    expect(hasRole(["FINANCE_STAFF"], "STUDENT")).toBe(false);
    expect(hasRole(["FINANCE_STAFF"], "GUARDIAN")).toBe(false);
  });

  it("yetkisiz rolde hata verir", () => {
    expect(() => assertRole(["STUDENT"], "TEACHER")).toThrow("FORBIDDEN");
  });

  it("system admin rolünü ayırt eder", () => {
    expect(isSystemAdmin(["SYSTEM_ADMIN"])).toBe(true);
    expect(isSystemAdmin(["TENANT_ADMIN"])).toBe(false);
  });
});
