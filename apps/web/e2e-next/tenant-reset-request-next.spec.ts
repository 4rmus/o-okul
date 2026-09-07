import { expect, test } from "@playwright/test";
import type { TenantResetInstitutionRequest } from "@o-okul/shared-types";
const origin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const headers = { "access-control-allow-credentials": "true", "access-control-allow-origin": origin, "access-control-allow-headers": "authorization,content-type,x-csrf-token", "access-control-allow-methods": "GET,POST,OPTIONS" };
for (const width of [390, 1280]) test(`institution reset request requires confirmation and supports withdrawal (${width})`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  let request: TenantResetInstitutionRequest | null = null; let posts = 0;
  const auth = { accessToken: "next-access-token", session: { id: "session-a", userId: "admin-a", tenantId: "tenant-a", membershipId: "member-a", membershipVersion: 1, roles: ["TENANT_ADMIN"], activePersona: "STAFF", status: "ACTIVE" } };
  await page.route("**/api/v1/**", async (route) => {
    const call = route.request(); const path = new URL(call.url()).pathname.replace("/api/v1", "");
    if (call.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const fulfill = (data: unknown) => route.fulfill({ headers, contentType: "application/json", body: JSON.stringify({ data }) });
    if (path === "/auth/refresh" || path === "/auth/me") return fulfill(auth);
    if (path === "/tenants/current/reset-request" && call.method() === "POST") {
      posts++; expect(call.postDataJSON()).toEqual({ expectedRequestId: null, preset: "CLEAN_SETUP_V1" });
      request = { id: "a".repeat(32), tenantId: "tenant-a", requestedBy: "admin-a", requestedAt: "2026-09-07T00:00:00.000Z", lifecycleVersion: 0, status: "PENDING", operationId: null };
      return fulfill({ request });
    }
    if (path === "/tenants/current/reset-request/revoke") { posts++; expect(call.postDataJSON()).toEqual({ expectedRequestId: request!.id }); request = { ...request!, status: "REVOKED" }; return fulfill({ request }); }
    if (path === "/tenants/current/reset-request") return fulfill({ request });
    if (path === "/setup/tenant") return fulfill({ id: "tenant-a", name: "Test Kurum", institutionType: "Dershane" });
    return fulfill([]);
  });
  await page.context().addCookies([{ name: "csrfToken", url: origin, value: "csrf-token" }]);
  await page.goto("/kurum/lisans-donemleri");
  const send = page.getByRole("button", { name: "Yenileme talebi gönder" });
  await expect(send).toBeDisabled(); expect(posts).toBe(0);
  await page.getByLabel("Kurumumun çalışma verilerinin temizlenmesini talep ediyorum.").check();
  await send.click();
  await expect(page.getByText(/Sistem yöneticisi değerlendirmesi bekleniyor/)).toBeVisible(); expect(posts).toBe(1);
  await page.getByRole("button", { name: "Talebi geri çek", exact: true }).click();
  await expect(page.getByText(/Talep geri çekildi/)).toBeVisible(); expect(posts).toBe(2);
  await expect(send).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
