import { expect, test } from "@playwright/test";
import { tenantLoginUrl } from "./helpers/tenant-login.js";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

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

  await page.goto(tenantLoginUrl(appOrigin, "dna-egitim"));
  await page.getByRole("link", { name: "Şifremi unuttum" }).click();

  await expect(page).toHaveURL(new URL("/parolami-unuttum", tenantLoginUrl(appOrigin, "dna-egitim")).toString());
  await expect(page.getByLabel("Kurum kodu")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Girişe dön" })).toHaveAttribute("href", "/giris");
  await expect(page.getByLabel("Şifre yenileme güven bilgisi")).toContainText("mesaj teslimatının durumu burada açıklanmaz");
  await page.getByLabel("Kullanıcı Adı").fill("admin@example.test");
  await page.getByRole("button", { name: "Yenileme bağlantısı gönder" }).click();

  await expect(page.getByRole("status")).toContainText("İsteğiniz alındı");
  await expect(page.getByRole("status")).not.toContainText("gönderildi");
  expect(requestBody).toEqual({
    loginName: "admin@example.test",
  });
});

test("ortak parola yenileme ekranı kurum koduyla kanonik giriş adresini üretir", async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/v1/auth/password-reset/request", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { accepted: true }, requestId: "req-reset-root" }),
      status: 202,
    });
  });

  await page.goto("/parolami-unuttum");
  await page.getByLabel("Kurum kodu").fill("dna-egitim");
  await expect(page.getByRole("link", { name: "Girişe dön" })).toHaveAttribute(
    "href",
    tenantLoginUrl(appOrigin, "dna-egitim"),
  );
  await page.getByLabel("Kullanıcı Adı").fill("admin@example.test");
  await page.getByRole("button", { name: "Yenileme bağlantısı gönder" }).click();
  expect(requestBody).toEqual({ loginName: "admin@example.test", tenantSlug: "dna-egitim" });
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

  await page.goto("/parola-sifirla?tenant=dna-egitim#token=reset-token");
  await expect(page).toHaveURL(/\/parola-sifirla\?tenant=dna-egitim$/);
  expect(page.url()).not.toContain("reset-token");
  await page.getByRole("textbox", { name: "Yeni şifre", exact: true }).fill("YeniAb12");
  await page.getByRole("textbox", { name: "Yeni şifre tekrar" }).fill("YeniAb12");
  await page.getByRole("button", { name: "Şifreyi yenile" }).click();

  await expect(page.getByRole("status")).toContainText("Şifreniz yenilendi");
  await expect(page.getByRole("link", { name: "Giriş yap" })).toHaveAttribute(
    "href",
    tenantLoginUrl(appOrigin, "dna-egitim"),
  );
  expect(confirmBody).toEqual({ token: "reset-token", password: "YeniAb12" });
});
