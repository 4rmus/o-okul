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
  await page.getByRole("textbox", { name: "Şifre", exact: true }).fill("YeniAb12");
  await page.getByRole("textbox", { name: "Şifre tekrar" }).fill("YeniAb12");
  await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();

  await expect(page.getByRole("status")).toContainText("Hesabınız etkinleştirildi");
  expect(acceptBody).toEqual({ token: "activation-secret", password: "YeniAb12" });
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
  await page.getByRole("textbox", { name: "Şifre", exact: true }).fill("YeniAb12");
  await page.getByRole("textbox", { name: "Şifre tekrar" }).fill("YeniAb12");
  await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();

  await expect(page.getByRole("status")).toContainText("Öğrenci numaranız (101)");
  expect(activationBody).toEqual({
    tenantSlug: "okul-a",
    studentNo: "101",
    code: "ABCDEFGHJKL2",
    password: "YeniAb12",
  });
});

// UAT F-08: only an expiry error may say the link expired.
for (const { status, code, message } of [
  { status: 400, code: "IDENTITY_INVITATION_EXPIRED", message: "Davet bağlantısının süresi doldu." },
  { status: 400, code: "IDENTITY_INVITATION_NOT_PENDING", message: "daha önce kullanılmış" },
  { status: 404, code: "IDENTITY_INVITATION_NOT_FOUND", message: "Davet bağlantısı geçersiz." },
  { status: 400, code: "SUBJECT_NATIONAL_ID_REQUIRED", message: "Kurum yöneticinizden yeni davet isteyin." },
  { status: 503, code: "TENANT_ACTIVITY_UNRESOLVED", message: "Kurum yöneticinizden yeni davet isteyin." },
  { status: 400, code: "PASSWORD_COMMON_REJECTED", message: "Şifre kabul edilmedi." },
  { status: 500, code: "INTERNAL_SERVER_ERROR", message: "Beklenmeyen bir hata oluştu." },
]) {
  test(`davet kabul hatası ${code} için doğru mesajı gösterir`, async ({ page }) => {
    await page.route("**/api/v1/identity-invitations/accept", (route) => route.fulfill({
      contentType: "application/json",
      status,
      body: JSON.stringify({ error: { code } }),
    }));

    await page.goto("/aktivasyon#token=activation-secret");
    await page.getByRole("textbox", { name: "Şifre", exact: true }).fill("YeniAb12");
    await page.getByRole("textbox", { name: "Şifre tekrar" }).fill("YeniAb12");
    await page.getByRole("button", { name: "Hesabı etkinleştir" }).click();

    const alert = page.locator(".next-form-error");
    await expect(alert).toContainText(message);
    if (code !== "IDENTITY_INVITATION_EXPIRED") await expect(alert).not.toContainText("süresi");
  });
}
