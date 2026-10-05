import { expect, test } from "@playwright/test";

test.describe("Public marketing context", () => {
  test("landing özel K12 konumunu, optik akışı, fiyat bağlantısını ve CTA ayrımını korur", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Öğrenci takibini tek platformda toplayın." })).toBeVisible();
    await expect(page.getByText("Özel okullar ve eğitim kurumları için", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Öğrenci kaydında toplanan bilgiler" }).locator("li")).toHaveCount(5);
    await expect(page.getByText("TXT/DAT yükleme", { exact: false }).first()).toBeVisible();
    await expect(page.locator("#optik-akis article")).toHaveCount(5);
    await expect(page.getByText("Başarı %", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Net ve Soru", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Verileriniz Türkiye'deki sunucularda barındırılır.", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Demo talep et" }).first()).toHaveAttribute("href", "/iletisim#demo");
    await expect(page.getByRole("link", { name: "Fiyatları gör" })).toHaveAttribute("href", "/fiyatlar");
    await expect(page.getByRole("link", { name: "Giriş yap", exact: true })).toHaveAttribute("href", "/login");
    await expect(page.getByText(/veli portal|veli uygulama|e-Okul|KVKK uyumlu|yurt ?dışına/i)).toHaveCount(0);
  });

  test("fiyat sayfası kademeleri gösterir ve hesaplayıcı minimum ile teklif kuralını uygular", async ({ page }) => {
    await page.goto("/fiyatlar");

    await expect(page.getByRole("heading", { level: 1, name: "Aktif öğrenci sayınıza göre yıllık fiyat." })).toBeVisible();
    const tiers = page.getByRole("table");
    await expect(tiers.locator("tbody tr")).toHaveCount(6);
    for (const [range, price] of [["1–250", "280 TL"], ["251–500", "250 TL"], ["501–1000", "220 TL"], ["1001–3000", "190 TL"], ["3001–7000", "160 TL"], ["7001 ve üzeri", "Teklif alın"]] as const) {
      await expect(tiers.locator("tbody tr", { hasText: range })).toContainText(price);
    }
    await expect(page.getByText("KDV hariç, yıllık", { exact: true })).toBeVisible();
    await expect(page.getByText("Kurulum ücreti yok, tüm modüller dahil.", { exact: true })).toBeVisible();
    await expect(page.getByText("1–250 öğrenci kademesinde yıllık en az 25.000 TL uygulanır.", { exact: true })).toBeVisible();

    const input = page.getByLabel("Aktif öğrenci sayısı");
    const result = page.locator("output");
    await input.fill("50");
    await expect(result).toContainText("25.000 TL");
    await expect(result).toContainText("Yıllık en az 25.000 TL uygulanır.");
    await input.fill("250");
    await expect(result).toContainText("70.000 TL");
    await input.fill("300");
    await expect(result).toContainText("75.000 TL");
    await expect(result).toContainText("Öğrenci başı 250 TL × 300 öğrenci");
    await input.fill("7000");
    await expect(result).toContainText("1.120.000 TL");
    await input.fill("7001");
    await expect(result).toContainText("Teklif alın");
    await expect(result.getByRole("link", { name: "Teklif talebi hazırla" })).toHaveAttribute("href", "/iletisim#teklif");
    await input.fill("0");
    await expect(page.getByText("1 veya daha büyük bir tam sayı girin.")).toBeVisible();

    await expect(page.getByRole("link", { name: "Deneme talep et" })).toHaveAttribute("href", "/iletisim#teklif");
    await expect(page.getByText(/7 gün/).first()).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
  });

  test("yönlendirmeli demo ve teklif yalnız yerel e-posta eylemleri sunar", async ({ page }) => {
    await page.goto("/iletisim#demo");

    await expect(page.getByRole("heading", { level: 1, name: "Demo veya teklif talebinizi hazırlayın." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Teklif veya deneme iste" })).toHaveAttribute("href", /^mailto:demo@o-okul\.com\?subject=Teklif/);
    await expect(page.getByRole("heading", { name: "Hazırlık listesi" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Kişisel veri göndermeyin/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "E-posta taslağı oluştur" })).toHaveAttribute("href", /^mailto:demo@o-okul\.com/);
    await expect(page.getByRole("button", { name: "E-posta adresini kopyala" })).toBeVisible();
    await expect(page.getByText("demo@o-okul.com", { exact: true })).toBeVisible();
    await expect(page.locator("form")).toHaveCount(0);
  });

  for (const width of [320, 375, 414, 768, 1280, 1440]) {
    test(`landing ve fiyat sayfası ${width}px genişlikte yatay taşmaz`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      let sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(sizes.content).toBeLessThanOrEqual(sizes.viewport);
      await page.goto("/fiyatlar");
      sizes = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
      expect(sizes.content).toBeLessThanOrEqual(sizes.viewport);
    });
  }
});
