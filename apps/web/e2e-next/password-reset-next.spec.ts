import { expect, test } from "@playwright/test";

test("parola yenileme isteği kurum kodunu korur ve nötr sonuç gösterir", async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined;

  await page.route("**/api/v1/auth/password-reset/request", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({ data: { status: "ACCEPTED" } }),
    });
  });

  await page.goto("/k/dna-egitim/giris");
  await page.getByRole("link", { name: "Parolamı unuttum" }).click();

  await expect(page).toHaveURL(/\/parolami-unuttum\?tenant=dna-egitim$/);
  await expect(page.getByLabel("Kurum kodu")).toHaveValue("dna-egitim");
  await page.getByLabel("Kullanıcı Adı").fill("10000000146");
  await page.getByRole("button", { name: "Yenileme bağlantısı gönder" }).click();

  await expect(page.getByRole("status")).toContainText("Bilgiler eşleşiyor");
  expect(requestBody).toEqual({
    tenantSlug: "dna-egitim",
    nationalId: "10000000146",
  });
});

test("tek kullanımlık bağlantı yeni parolayı onaylar", async ({ page }) => {
  let confirmBody: Record<string, unknown> | undefined;

  await page.route("**/api/v1/auth/password-reset/confirm", async (route) => {
    confirmBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({ data: { resetAt: "2026-07-28T09:00:00.000Z" } }),
    });
  });

  await page.goto("/parola-sifirla?token=reset-token");
  await page.getByRole("textbox", { name: "Yeni parola", exact: true }).fill("new-password");
  await page.getByRole("textbox", { name: "Yeni parola tekrar" }).fill("new-password");
  await page.getByRole("button", { name: "Parolayı yenile" }).click();

  await expect(page.getByRole("status")).toContainText("Parolanız yenilendi");
  expect(confirmBody).toEqual({ token: "reset-token", password: "new-password" });
});
