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
      [1, 9_900],
      [99, 9_900],
      [100, 9_900],
      [101, 9_995],
      [250, 24_150],
      [251, 24_240],
      [500, 46_650],
      [501, 46_735],
      [1000, 89_150],
      [1001, 89_230],
      [2000, 169_150],
      [2001, 169_225],
      [3000, 244_150],
    ];
    for (const [students, total] of expected) expect(totalFor(students), `${students} öğrenci`).toBe(total);
    expect(estimateAnnualPrice(99)).toMatchObject({ billedStudents: 100, minimumApplied: true });
    expect(estimateAnnualPrice(100)).toMatchObject({ billedStudents: 100, minimumApplied: false });
    expect(estimateAnnualPrice(1000)).toMatchObject({
      lines: [{ students: 100, unitPrice: 99 }, { students: 150, unitPrice: 95 }, { students: 250, unitPrice: 90 }, { students: 500, unitPrice: 85 }],
    });
    for (const students of [3001, 3002, 100_000]) expect(estimateAnnualPrice(students)).toEqual({ kind: "quote" });
    for (const students of [0, -1, 1.5, Number.NaN]) expect(estimateAnnualPrice(students)).toEqual({ kind: "invalid" });
  });

  test("öğrenci sayısı arttıkça yıllık tutar hiç düşmez", () => {
    let previous = totalFor(1);
    for (let students = 2; students <= 3000; students += 1) {
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
    await expect(tiers.locator("tbody tr")).toHaveCount(7);
    await expect(tiers.getByRole("columnheader", { name: "Kademe" })).toBeVisible();
    await expect(tiers.getByRole("columnheader", { name: "Aralıktaki öğrenci başı" })).toBeVisible();
    for (const [range, price] of [["1–100 (ilk 100)", "99 TL"], ["101–250 (sonraki 150)", "95 TL"], ["251–500 (sonraki 250)", "90 TL"], ["501–1000 (sonraki 500)", "85 TL"], ["1001–2000 (sonraki 1000)", "80 TL"], ["2001–3000 (sonraki 1000)", "75 TL"], ["3001 ve üzeri", "Teklif alın"]] as const) {
      await expect(tiers.locator("tbody tr", { hasText: range })).toContainText(price);
    }
    await expect(page.getByText("KDV hariç, yıllık", { exact: true })).toBeVisible();
    await expect(page.getByText("Kurulum ücreti yok, tüm modüller dahil.", { exact: true })).toBeVisible();
    await expect(page.getByText("En küçük paket 100 öğrencidir; daha az öğrencisi olan kurum 100 öğrenci üzerinden öder.", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nasıl hesaplanır?" })).toBeVisible();
    await expect(page.getByText("Örnek, 1000 öğrenci: 100 × 99 TL + 150 × 95 TL + 250 × 90 TL + 500 × 85 TL = 89.150 TL.", { exact: true })).toBeVisible();

    const input = page.getByLabel("Aktif öğrenci sayısı");
    const result = page.locator("output");
    await input.fill("50");
    await expect(result).toContainText("9.900 TL");
    await expect(result).toContainText("En küçük paket 100 öğrenci: 100 × 99 TL");
    await input.fill("250");
    await expect(result).toContainText("24.150 TL");
    await input.fill("251");
    await expect(result).toContainText("24.240 TL");
    await expect(result).toContainText("100 × 99 TL + 150 × 95 TL + 1 × 90 TL");
    await input.fill("1000");
    await expect(result).toContainText("89.150 TL");
    await input.fill("3000");
    await expect(result).toContainText("244.150 TL");
    await expect(result).toContainText("1.000 × 80 TL + 1.000 × 75 TL");
    await input.fill("3001");
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
