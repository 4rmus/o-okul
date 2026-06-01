import { describe, expect, it } from "vitest";
import { assertRole, hasRole, isSystemAdmin } from "./roles.js";

describe("roles", () => {
  it("üst rol alt rol yetkisini kapsar", () => {
    expect(hasRole(["TENANT_ADMIN"], "TEACHER")).toBe(true);
    expect(hasRole(["TEACHER"], "TENANT_ADMIN")).toBe(false);
  });

  it("yetkisiz rolde hata verir", () => {
    expect(() => assertRole(["STUDENT"], "TEACHER")).toThrow("FORBIDDEN");
  });

  it("system admin rolünü ayırt eder", () => {
    expect(isSystemAdmin(["SYSTEM_ADMIN"])).toBe(true);
    expect(isSystemAdmin(["TENANT_ADMIN"])).toBe(false);
  });
});
