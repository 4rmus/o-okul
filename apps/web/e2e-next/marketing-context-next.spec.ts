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
    await expect(page.getByText("Öğrenci başı yıllık 75 TL–99 TL, KDV hariç.", { exact: false })).toBeVisible();
    const plans = page.getByRole("region", { name: "Paketler" });
    await expect(plans.getByRole("listitem")).toHaveCount(5);
    for (const [students, average, total] of [["100 aktif öğrenciye kadar", "99 TL", "9.900 TL"], ["250 aktif öğrenciye kadar", "96,60 TL", "24.150 TL"], ["500 aktif öğrenciye kadar", "93,30 TL", "46.650 TL"], ["1.000 aktif öğrenciye kadar", "89,15 TL", "89.150 TL"], ["2.000 aktif öğrenciye kadar", "84,58 TL", "169.150 TL"]] as const) {
      const card = plans.getByRole("listitem").filter({ hasText: students });
      await expect(card).toContainText(average);
      await expect(card).toContainText(`Yıllık ${total}`);
      await expect(card.getByRole("link", { name: "Demo talep et" })).toHaveAttribute("href", "/iletisim#demo");
    }
    await expect(plans.getByText("1–100: 99 TL, 101–250: 95 TL, 251–500: 90 TL, 501–1.000: 85 TL, 1.001–2.000: 80 TL, 2.001–3.000: 75 TL", { exact: false })).toBeVisible();
    await expect(page.getByText("Kurulum ücreti yok, tüm modüller her pakette dahil", { exact: false })).toBeVisible();
    await expect(page.getByRole("list", { name: "Her pakette bulunan modüller" }).getByRole("listitem")).toHaveCount(6);
    await expect(page.getByText("En küçük paket 100 öğrencidir; daha az öğrencisi olan kurum 100 öğrenci üzerinden öder.", { exact: false })).toBeVisible();
    await expect(page.getByText("aylık ödeme seçeneği yoktur", { exact: false })).toBeVisible();
    await expect(page.getByText("Örnek, 1.000 öğrenci: 100 × 99 TL + 150 × 95 TL + 250 × 90 TL + 500 × 85 TL = 89.150 TL.", { exact: false })).toBeVisible();

    const input = page.getByLabel("Aktif öğrenci sayısı");
    const result = page.locator("output");
    await expect(input).toHaveValue("500");
    await expect(result).toContainText("46.650 TL");
    await expect(result).toContainText("Öğrenci başı ortalama 93,30 TL");
    await input.fill("50");
    await expect(result).toContainText("9.900 TL");
    await expect(result).toContainText("En küçük paket 100 öğrenci: tutar 100 öğrenci üzerinden hesaplandı.");
    await expect(result).toContainText("100 öğrenci × 99 TL");
    await input.fill("250");
    await expect(result).toContainText("24.150 TL");
    await expect(result).toContainText("Öğrenci başı ortalama 96,60 TL");
    await input.fill("251");
    await expect(result).toContainText("24.240 TL");
    await expect(result).toContainText("1 öğrenci × 90 TL");
    await page.getByRole("group", { name: "Hazır öğrenci sayıları" }).getByRole("button", { name: "1.000", exact: true }).click();
    await expect(input).toHaveValue("1000");
    await expect(result).toContainText("89.150 TL");
    await expect(result).toContainText("Öğrenci başı ortalama 89,15 TL");
    await input.fill("3000");
    await expect(result).toContainText("244.150 TL");
    await expect(result).toContainText("1.000 öğrenci × 80 TL");
    await expect(result).toContainText("1.000 öğrenci × 75 TL");
    await expect(result).toContainText("Öğrenci başı ortalama 81,38 TL");
    await page.getByRole("group", { name: "Hazır öğrenci sayıları" }).getByRole("button", { name: "3.000+" }).click();
    await expect(input).toHaveValue("3001");
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
