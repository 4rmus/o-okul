import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

// DEC-20261102-08 (G3): /kurum/raporlar/seviyeler draws one Başarı % line per exam type from level reports only;
// STALE level reports and published exams without a level report are listed apart and never plotted.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
};
const tenantId = "tenant-level";
const gradeLevels = [
  { id: "grade-8", tenantId, name: "8. SINIF", code: "8" },
  { id: "grade-7", tenantId, name: "7. SINIF", code: "7" },
];
const terms = [{ id: "term-1", tenantId, academicYearId: "year-1", name: "1. Dönem", startsAt: "2026-09-01", endsAt: "2027-01-31", isActive: true }];
const levelAnalytics = {
  tenantId,
  gradeLevelId: "grade-8",
  series: [
    {
      examType: "LGS",
      points: [
        { examId: "exam-lgs-1", examTitle: "LGS Deneme 1", examType: "LGS", startsAt: "2026-09-10T07:00:00.000Z", snapshotId: "level-lgs-1", participantCount: 40, successRate: 61.5, net: 55.35, questionCount: 90 },
        { examId: "exam-lgs-2", examTitle: "LGS Deneme 2", examType: "LGS", startsAt: "2026-10-10T07:00:00.000Z", snapshotId: "level-lgs-2", participantCount: 38, successRate: 64.25, net: 57.8, questionCount: 90 },
      ],
    },
    {
      examType: "TYT",
      points: [
        { examId: "exam-tyt-1", examTitle: "TYT Deneme 1", examType: "TYT", startsAt: "2026-09-15T07:00:00.000Z", snapshotId: "level-tyt-1", participantCount: 25, successRate: 58.33, net: 70, questionCount: 120 },
      ],
    },
  ],
  needsRefresh: [
    { examId: "exam-lgs-3", examTitle: "LGS Deneme 3", examType: "LGS", startsAt: "2026-11-01T07:00:00.000Z", snapshotId: "level-lgs-3", staleAt: "2026-11-02T08:00:00.000Z" },
  ],
  withoutLevelReport: [
    { examId: "exam-lgs-4", examTitle: "LGS Deneme 4", examType: "LGS", startsAt: "2026-10-20T07:00:00.000Z" },
  ],
};

test.describe("Seviye analitiği (DEC-20261102-08 G3)", () => {
  test("seviye seçilince sınav türü başına Başarı % çizgisi, Net/Soru bağlamı ve ayrı listeler görünür", async ({ page }) => {
    const requests = await open(page, "/kurum/raporlar/seviyeler");
    const region = page.getByRole("region", { exact: true, name: "Seviye analitiği" });
    await expect(page.getByRole("heading", { level: 1, name: "Seviye Analitiği", exact: true })).toBeVisible();
    await expect(region.getByRole("heading", { name: "Seviye seçin" })).toBeVisible();
    expect(requests.analytics).toEqual([]);

    await region.getByLabel("Seviye", { exact: true }).selectOption("grade-8");

    const lgs = region.getByRole("region", { exact: true, name: "LGS Başarı % gidişi" });
    await expect(lgs).toBeVisible();
    await expect(region.getByRole("region", { exact: true, name: "TYT Başarı % gidişi" })).toBeVisible();
    await expect(lgs.locator(".uh-chart-loading")).toHaveCount(0);
    await expect(lgs.locator("canvas")).toHaveCount(1);
    const lgsTable = lgs.getByRole("table", { name: "LGS seviye raporları" });
    for (const header of ["Sınav", "Tarih", "Katılımcı", "Başarı %", "Net", "Soru"]) {
      await expect(lgsTable.getByRole("columnheader", { exact: true, name: header })).toBeVisible();
    }
    const firstRow = lgsTable.getByRole("row", { name: /LGS Deneme 1/ });
    await expect(firstRow).toContainText("%61,5");
    await expect(firstRow).toContainText("55,35");
    await expect(firstRow).toContainText("90");
    await expect(firstRow).toContainText("40");

    const stale = region.getByRole("region", { exact: true, name: "Yenilenmesi gereken seviye raporları" });
    await expect(stale.getByRole("link", { name: "LGS Deneme 3" })).toHaveAttribute("href", "/kurum/sinavlar/exam-lgs-3/rapor/genel");
    await expect(lgsTable).not.toContainText("LGS Deneme 3");
    const missing = region.getByRole("region", { exact: true, name: "Bu seviye için seviye raporu üretilmemiş sınavlar" });
    await expect(missing.getByRole("link", { name: "LGS Deneme 4" })).toBeVisible();
    await expect(lgsTable).not.toContainText("LGS Deneme 4");

    expect(requests.analytics.at(-1)).toBe("gradeLevelId=grade-8");
    await region.getByLabel("Sınav türü", { exact: true }).selectOption("LGS");
    await region.getByLabel("Dönem", { exact: true }).selectOption("term-1");
    await expect.poll(() => requests.analytics.at(-1)).toBe("examType=LGS&gradeLevelId=grade-8&termId=term-1");
  });

  test("seviye raporu olmayan seviyede boş durum ve üretilmemiş sınavlar açıklanır", async ({ page }) => {
    await open(page, "/kurum/raporlar/seviyeler", 1280, {
      ...levelAnalytics,
      gradeLevelId: "grade-7",
      series: [],
      needsRefresh: [],
    });
    const region = page.getByRole("region", { exact: true, name: "Seviye analitiği" });
    await region.getByLabel("Seviye", { exact: true }).selectOption("grade-7");

    await expect(region.getByRole("heading", { name: "Çizilecek seviye raporu yok" })).toBeVisible();
    await expect(region).toContainText("7. SINIF için seviye raporu hazır olan yayınlanmış sınav bulunmuyor.");
    await expect(region.getByRole("region", { exact: true, name: "Bu seviye için seviye raporu üretilmemiş sınavlar" })).toContainText("LGS Deneme 4");
    await expect(region.locator("canvas")).toHaveCount(0);
  });

  test("Sınav Raporu sayfası seviye analitiğine bağlantı verir", async ({ page }) => {
    await open(page, "/kurum/raporlar");
    await expect(page.getByRole("heading", { level: 1, name: "Sınav Raporu", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Diğer rapor görünümleri" }).getByRole("link", { name: "Seviye analitiği" }))
      .toHaveAttribute("href", "/kurum/raporlar/seviyeler");
  });

  for (const width of [320, 375, 768, 1440]) {
    test(`seviye analitiği ${width}px genişlikte yatay taşma yapmaz`, async ({ page }) => {
      await open(page, "/kurum/raporlar/seviyeler", width);
      const region = page.getByRole("region", { exact: true, name: "Seviye analitiği" });
      await region.getByLabel("Seviye", { exact: true }).selectOption("grade-8");
      await expect(region.getByRole("table", { name: "TYT seviye raporları" })).toBeVisible();
      await expect(region.locator(".uh-chart-loading")).toHaveCount(0);
      await expectNoHorizontalOverflow(page, `seviye analitiği ${width}px`);
    });
  }
});

async function open(page: Page, path: string, width = 1280, analytics: unknown = levelAnalytics) {
  const requests = { analytics: [] as string[] };
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/v1/**", (route) => handle(route, analytics, requests));
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
  return requests;
}

async function handle(route: Route, analytics: unknown, requests: { analytics: string[] }) {
  const request = route.request();
  if (request.method() === "OPTIONS") {
    await route.fulfill({ headers: corsFor(route), status: 204 });
    return;
  }
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, "");
  if (path === "/reports/grade-level-analytics") {
    url.searchParams.sort();
    requests.analytics.push(url.searchParams.toString());
    await fulfill(route, analytics);
    return;
  }
  const responses: Record<string, unknown> = {
    "/auth/refresh": {
      accessToken: "level-access-token",
      session: { id: "session-level", membershipVersion: 1, roles: ["TENANT_ADMIN"], status: "ACTIVE", tenantId, userId: "user-level-admin" },
    },
    "/me/tenant": { id: tenantId, name: "Seviye Koleji", institutionType: "Özel okul", slug: "seviye-koleji" },
    "/me/notification-devices": [],
    "/me/feature-rollouts": { enabledFeatureKeys: [] },
    "/grade-levels": gradeLevels,
    "/academic-terms": terms,
  };
  await fulfill(route, path in responses ? responses[path] : []);
}

async function fulfill(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    headers: { ...corsFor(route), "content-type": "application/json" },
    status: 200,
  });
}

function corsFor(route: Route) {
  return { ...corsHeaders, "access-control-allow-origin": route.request().headers().origin ?? appOrigin };
}
