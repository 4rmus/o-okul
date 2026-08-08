import { expect, test } from "@playwright/test";

test.describe("Public marketing context", () => {
  test("landing optik akışı, sınırları ve CTA ayrımını korur", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Optik veriyi kontrol edin, rapora dönüştürün." })).toBeVisible();
    await expect(page.getByText("TXT/DAT yükleme", { exact: false }).first()).toBeVisible();
    await expect(page.locator("#optik-akis article")).toHaveCount(5);
    await expect(page.getByText("Başarı %", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Net ve Soru", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Demo talep et" }).first()).toHaveAttribute("href", "/iletisim#demo");
    await expect(page.getByRole("link", { name: "Optikten rapora akışı gör" })).toHaveAttribute("href", "#optik-akis");
    await expect(page.getByRole("link", { name: "Giriş yap", exact: true })).toHaveAttribute("href", "/login");
    await expect(page.getByText(/veli portal/i)).toHaveCount(0);
  });

  test("yönlendirmeli demo yalnız yerel e-posta eylemleri sunar", async ({ page }) => {
    await page.goto("/iletisim#demo");

    await expect(page.getByRole("heading", { level: 1, name: "Demo görüşmesini kendi optik akışınıza göre hazırlayın." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hazırlık listesi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Kişisel veri göndermeyin/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "E-posta taslağı oluştur" })).toHaveAttribute("href", /^mailto:demo@o-okul\.com/);
    await expect(page.getByRole("button", { name: "E-posta adresini kopyala" })).toBeVisible();
    await expect(page.getByText("demo@o-okul.com", { exact: true })).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
  });

  for (const width of [320, 375, 414, 768, 1280, 1440]) {
    test(`landing ${width}px genişlikte yatay taşmaz`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(sizes.content).toBeLessThanOrEqual(sizes.viewport);
    });
  }
});
