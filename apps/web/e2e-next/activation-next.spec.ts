import { expect, test } from "@playwright/test";

test("tek kullanımlık davet bağlantısı URL'den silinir ve hesabı etkinleştirir", async ({ page }) => {
  let acceptBody: Record<string, unknown> | undefined;
  await page.route("**/api/v1/identity-invitations/accept", async (route) => {
    acceptBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({ data: { status: "ACCEPTED", acceptedAt: "2026-08-01T12:00:00.000Z" } }),
    });
  });

  await page.goto("/aktivasyon#token=activation-secret");
  await expect(page).toHaveURL(/\/aktivasyon$/);
  expect(page.url()).not.toContain("activation-secret");
  await page.getByRole("textbox", { name: "Şifre", exact: true }).fill("secure-password-123");
  await page.getByRole("textbox", { name: "Şifre tekrar" }).fill("secure-password-123");
  await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();

  await expect(page.getByRole("status")).toContainText("Hesabınız etkinleştirildi");
  expect(acceptBody).toEqual({ token: "activation-secret", password: "secure-password-123" });
});

test("öğrenci aktivasyon kodu URL'den silinir ve öğrenci numarasıyla hesabı etkinleştirir", async ({ page }) => {
  let activationBody: Record<string, unknown> | undefined;
  await page.route("**/api/v1/auth/activate", async (route) => {
    activationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({ data: { status: "ACCEPTED", acceptedAt: "2026-08-01T12:00:00.000Z", loginName: "101" } }),
    });
  });

  await page.goto("/aktivasyon#tenant=okul-a&student=101&code=ABCDEFGHJKL2");
  await expect(page).toHaveURL(/\/aktivasyon$/);
  expect(page.url()).not.toContain("ABCDEFGHJKL2");
  await expect(page.getByRole("textbox", { name: "Kurum kodu" })).toHaveValue("okul-a");
  await expect(page.getByRole("textbox", { name: "Öğrenci numarası" })).toHaveValue("101");
  await expect(page.getByRole("textbox", { name: "Aktivasyon kodu" })).toHaveValue("ABCDEFGHJKL2");
  await page.getByRole("textbox", { name: "Şifre", exact: true }).fill("secure-password-123");
  await page.getByRole("textbox", { name: "Şifre tekrar" }).fill("secure-password-123");
  await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();

  await expect(page.getByRole("status")).toContainText("Öğrenci numaranız (101)");
  expect(activationBody).toEqual({
    tenantSlug: "okul-a",
    studentNo: "101",
    code: "ABCDEFGHJKL2",
    password: "secure-password-123",
  });
});
