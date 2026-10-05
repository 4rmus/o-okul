import { expect, test } from "@playwright/test";
import { estimateAnnualPrice } from "../app/fiyatlar/pricing.js";

const trialPromise = /kartsız|kart bilgisi|deneme hesab|deneme talep|7 gün/i;

function totalFor(students: number) {
  const estimate = estimateAnnualPrice(students);
  if (estimate.kind !== "price") throw new Error(`${students} öğrenci için fiyat beklenirdi; ${estimate.kind}`);
  return estimate.total;
}

test.describe("Kademeli fiyat hesabı (pricing.ts)", () => {
  test("kademe sınırları, minimum ve teklif eşiği", () => {
    const expected: Array<[number, number]> = [
      [1, 25_000],
      [89, 25_000],
      [90, 25_200],
      [250, 70_000],
      [251, 70_250],
      [500, 132_500],
      [501, 132_720],
      [1000, 242_500],
      [1001, 242_690],
      [3000, 622_500],
      [3001, 622_660],
      [7000, 1_262_500],
    ];
    for (const [students, total] of expected) expect(totalFor(students), `${students} öğrenci`).toBe(total);
    expect(estimateAnnualPrice(89)).toMatchObject({ minimumApplied: true });
    expect(estimateAnnualPrice(90)).toMatchObject({ minimumApplied: false });
    expect(estimateAnnualPrice(1000)).toMatchObject({
      lines: [{ students: 250, unitPrice: 280 }, { students: 250, unitPrice: 250 }, { students: 500, unitPrice: 220 }],
    });
    for (const students of [7001, 7002, 100_000]) expect(estimateAnnualPrice(students)).toEqual({ kind: "quote" });
    for (const students of [0, -1, 1.5, Number.NaN]) expect(estimateAnnualPrice(students)).toEqual({ kind: "invalid" });
  });

  test("öğrenci sayısı arttıkça yıllık tutar hiç düşmez", () => {
    let previous = totalFor(1);
    for (let students = 2; students <= 7000; students += 1) {
      const current = totalFor(students);
      expect(current >= previous, `${students} öğrenci (${current}) < ${students - 1} öğrenci (${previous})`).toBe(true);
      previous = current;
    }
  });
});

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

  test("kartsız deneme çağrısı fiyat, landing ve iletişimde yayında değil (ürün sahibi kararı 2026-10-05)", async ({ page }) => {
    for (const path of ["/", "/fiyatlar", "/iletisim"]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      expect(await page.locator("main").textContent(), path).not.toMatch(trialPromise);
      for (const href of await page.locator("a[href^='mailto:']").evaluateAll((links) => links.map((link) => decodeURIComponent(link.getAttribute("href") ?? "")))) {
        expect(href, `${path} mailto`).not.toMatch(trialPromise);
      }
    }
  });

  test("fiyat sayfası kademeleri gösterir ve hesaplayıcı minimum ile teklif kuralını uygular", async ({ page }) => {
    await page.goto("/fiyatlar");

    await expect(page.getByRole("heading", { level: 1, name: "Aktif öğrenci sayınıza göre yıllık fiyat." })).toBeVisible();
    const tiers = page.getByRole("table");
    await expect(tiers.locator("tbody tr")).toHaveCount(6);
    await expect(tiers.getByRole("columnheader", { name: "Kademe" })).toBeVisible();
    await expect(tiers.getByRole("columnheader", { name: "Aralıktaki öğrenci başı" })).toBeVisible();
    for (const [range, price] of [["1–250 (ilk 250)", "280 TL"], ["251–500 (sonraki 250)", "250 TL"], ["501–1000 (sonraki 500)", "220 TL"], ["1001–3000 (sonraki 2000)", "190 TL"], ["3001–7000 (sonraki 4000)", "160 TL"], ["7001 ve üzeri", "Teklif alın"]] as const) {
      await expect(tiers.locator("tbody tr", { hasText: range })).toContainText(price);
    }
    await expect(page.getByText("KDV hariç, yıllık", { exact: true })).toBeVisible();
    await expect(page.getByText("Kurulum ücreti yok, tüm modüller dahil.", { exact: true })).toBeVisible();
    await expect(page.getByText("Toplam yıllık tutar en az 25.000 TL olur.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nasıl hesaplanır?" })).toBeVisible();
    await expect(page.getByText("Örnek, 1000 öğrenci: 250 × 280 TL + 250 × 250 TL + 500 × 220 TL = 242.500 TL.", { exact: true })).toBeVisible();

    const input = page.getByLabel("Aktif öğrenci sayısı");
    const result = page.locator("output");
    await input.fill("50");
    await expect(result).toContainText("25.000 TL");
    await expect(result).toContainText("Yıllık en az 25.000 TL uygulanır.");
    await input.fill("250");
    await expect(result).toContainText("70.000 TL");
    await input.fill("251");
    await expect(result).toContainText("70.250 TL");
    await expect(result).toContainText("250 × 280 TL + 1 × 250 TL");
    await input.fill("1000");
    await expect(result).toContainText("242.500 TL");
    await input.fill("7000");
    await expect(result).toContainText("1.262.500 TL");
    await expect(result).toContainText("2.000 × 190 TL + 4.000 × 160 TL");
    await input.fill("7001");
    await expect(result).toContainText("Teklif alın");
    await expect(result.getByRole("link", { name: "Teklif talebi hazırla" })).toHaveAttribute("href", "/iletisim#teklif");
    await input.fill("0");
    await expect(page.getByText("1 veya daha büyük bir tam sayı girin.")).toBeVisible();

    await expect(page.getByRole("link", { name: "Demo talep et" }).last()).toHaveAttribute("href", "/iletisim#demo");
    await expect(page.getByRole("link", { name: "Teklif talebi hazırla" }).last()).toHaveAttribute("href", "/iletisim#teklif");
    await expect(page.locator("form")).toHaveCount(0);
  });

  test("yönlendirmeli demo ve teklif yalnız yerel e-posta eylemleri sunar", async ({ page }) => {
    await page.goto("/iletisim#demo");

    await expect(page.getByRole("heading", { level: 1, name: "Demo veya teklif talebinizi hazırlayın." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Teklif iste" })).toHaveAttribute("href", /^mailto:demo@o-okul\.com\?subject=Teklif/);
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
