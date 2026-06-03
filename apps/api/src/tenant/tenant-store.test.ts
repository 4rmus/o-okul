import { describe, expect, it } from "vitest";
import { InMemoryTenantStore } from "./tenant-store.js";

describe("InMemoryTenantStore", () => {
  it("expired tenant normal tenant çözümlemesinde görünmez ama admin görünümünde görünür", async () => {
    const store = new InMemoryTenantStore();
    await store.create({
      id: "tenant-expired",
      name: "Expired Tenant",
      slug: "tenant-expired",
      licenseEndsAt: "2020-01-01T00:00:00.000Z",
    });

    await expect(store.findById("tenant-expired")).resolves.toBeUndefined();
    await expect(store.findForAdmin("tenant-expired")).resolves.toMatchObject({
      id: "tenant-expired",
      status: "ACTIVE",
    });
  });

  it("inactive tenant normal tenant çözümlemesinde görünmez", async () => {
    const store = new InMemoryTenantStore();
    await store.create({
      id: "tenant-suspended",
      name: "Suspended Tenant",
      slug: "tenant-suspended",
      status: "SUSPENDED",
    });

    await expect(store.findById("tenant-suspended")).resolves.toBeUndefined();
  });
});
