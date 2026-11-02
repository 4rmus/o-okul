import { expect, test, type Page, type Route } from "@playwright/test";

// K1: sınav tek çalışma alanında yürür. Çerçeve başlığı, Stepper'ı ve tek birincil sonraki işi taşır; gömülü optik
// ve rapor ekranları kendi başlığını, sınav seçicisini ve tekrar eden durum şeridini çizmez.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const examId = "exam-k1";
const examTitle = "K1 Birleşik Deneme";
const requiredViewports = [
  { width: 320, height: 812 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
] as const;

test.describe("Sınav çalışma alanı birleşimi", () => {
  test("liste satırındaki sınav adı çalışma alanını açar", async ({ page }) => {
    await installK1Api(page);
    await page.goto("/kurum/sinavlar", { waitUntil: "domcontentloaded" });

    const examTable = page.getByRole("table", { name: "Sınav yönetimi" });
    await expect(examTable.getByRole("link", { name: examTitle })).toHaveAttribute("href", `/kurum/sinavlar/${examId}`);
    await examTable.getByRole("link", { name: examTitle }).click();
    await expect(page).toHaveURL(`${appOrigin}/kurum/sinavlar/${examId}`);
    await expect(page.getByRole("heading", { level: 1, name: examTitle })).toBeVisible();
  });

  test("gömülü optik ekranı başlığı, sınav seçiciyi ve durum şeridini çerçeveye bırakır", async ({ page }) => {
    await installK1Api(page);

    for (const viewport of requiredViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/kurum/sinavlar/${examId}/optik/duzen`, { waitUntil: "domcontentloaded" });

      const main = page.locator("main:visible");
      await expect(main.getByRole("heading", { level: 1, name: examTitle })).toBeVisible();
      await expect(main.locator("h1:visible")).toHaveCount(1);
      await expect(page.getByRole("heading", { name: "Optik İşlemleri" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Sınav seçimi" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Optik iş akışı" })).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Sınav adımları" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "1. Optik düzen" })).toHaveAttribute("aria-selected", "true");
      // Önerilen iş bu sayfada: çerçeve kendine dönen bağlantı çizmez.
      await expect(page.getByRole("group", { name: "Sonraki önerilen iş" }).getByRole("link")).toHaveCount(0);
      await expectNoHorizontalOverflow(page, `optik-embedded-${viewport.width}`);
    }
  });

  test("gömülü rapor ekranı başlığı, sınav seçiciyi ve durum şeridini çerçeveye bırakır", async ({ page }) => {
    await installK1Api(page);

    for (const viewport of requiredViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/kurum/sinavlar/${examId}/rapor/genel`, { waitUntil: "domcontentloaded" });

      const main = page.locator("main:visible");
      await expect(main.getByRole("heading", { level: 1, name: examTitle })).toBeVisible();
      await expect(main.locator("h1:visible")).toHaveCount(1);
      await expect(page.getByRole("heading", { name: "Sınav Raporu" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Rapor çalışma alanı" })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Sınav", exact: true })).toHaveCount(0);
      const reportStrip = page.getByRole("region", { name: "Rapor iş akışı" });
      await expect(reportStrip.locator(".next-report-status-main")).toHaveCount(0);
      await expect(reportStrip.locator(".next-report-status-pills > span")).toHaveCount(3);
      await expect(reportStrip).not.toContainText("Seçim");
      await expect(page.locator(".next-report-work-context")).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Genel Bakış" })).toHaveAttribute("aria-selected", "true");
      await expectNoHorizontalOverflow(page, `rapor-embedded-${viewport.width}`);
    }
  });

  test("bağımsız optik ve rapor ekranları kendi başlığını ve sınav seçicisini korur", async ({ page }) => {
    await installK1Api(page);

    await page.goto("/kurum/optik", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Optik İşlemleri" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Optik iş akışı" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sınav adımları" })).toHaveCount(0);

    await page.goto("/kurum/raporlar", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Sınav Raporu" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Sınav", exact: true })).toBeVisible();
    await expect(page.locator(".next-report-status-pills > span")).toHaveCount(4);
    await expect(page.locator(".next-report-status-main")).toHaveCount(1);
  });

  test("değerlendirme sürerken çalışma alanı yoklanır, ilerleme görünür ve iş bitince yoklama durur", async ({ page }) => {
    const evidence = await installK1Api(page, { evaluationRounds: 2 });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/kurum/sinavlar/${examId}/degerlendirme`, { waitUntil: "domcontentloaded" });

    const nextStep = page.getByRole("group", { name: "Sonraki önerilen iş" });
    await expect(nextStep.getByRole("status")).toContainText("Değerlendirme sürüyor: 1/4 satır tamamlandı.");
    await expect(nextStep.getByRole("status")).toContainText("İlerleme %25.");
    await expect(page.getByRole("navigation", { name: "Sınav adımları" })).toContainText("1/4 değerlendirildi");
    await expect(page.getByRole("region", { name: "Değerlendirme sayıları" })).toContainText("1");

    await expect(nextStep).toContainText("Değerlendirme tamamlandı; raporu hazırlayın.", { timeout: 20_000 });
    await expect(nextStep.getByRole("link", { name: "Raporu hazırla" })).toHaveAttribute("href", `/kurum/sinavlar/${examId}/rapor/genel`);
    await expect(page.getByRole("region", { name: "Değerlendirme durumu" })).toContainText("Tamamlandı");
    const settledRequests = evidence.workspaceRequests;
    expect(settledRequests).toBeGreaterThanOrEqual(3);
    await page.waitForTimeout(6_500);
    expect(evidence.workspaceRequests).toBe(settledRequests);
    expect(evidence.mutationRequests).toEqual([]);
  });

  for (const workspaceStatus of [404, 403] as const) {
    test(`sınav ${workspaceStatus} döndüğünde çerçeve nötr başlık çizer, bulunamadı mesajı yalnız alt sayfadadır`, async ({ page }) => {
      const evidence = await installK1Api(page, { workspaceStatus });

      for (const viewport of requiredViewports) {
        await page.setViewportSize(viewport);
        await page.goto(`/kurum/sinavlar/${examId}`, { waitUntil: "domcontentloaded" });

        const main = page.locator("main:visible");
        const frame = page.getByRole("region", { name: "Sınav çalışma alanı" });
        await expect(main.getByRole("heading", { level: 1, name: "Sınav çalışma alanı" })).toBeVisible();
        await expect(main.locator("h1:visible")).toHaveCount(1);
        await expect(page.getByRole("region", { name: "Sınav çalışma alanı hatası" })).toContainText("Sınav bulunamadı veya erişilemiyor");
        await expect(frame.locator(".next-status-note")).toHaveCount(0);
        await expect(page.getByText("Sınav hazırlık durumu şu an alınamadı", { exact: false })).toHaveCount(0);
        await expect(page.getByText("işlemlere aşağıdan devam", { exact: false })).toHaveCount(0);
        await expect(page.getByRole("navigation", { name: "Sınav adımları" })).toHaveCount(0);
        await expectNoHorizontalOverflow(page, `exam-unavailable-${workspaceStatus}-${viewport.width}`);
      }
      expect(evidence.mutationRequests).toEqual([]);
    });
  }

  test("listeye dönen adımlar sınavı seçer ve çalışma alanına dönüş bağlantısı sunar", async ({ page }) => {
    await installK1Api(page, { nextAction: "ADD_PARTICIPANTS" });

    for (const viewport of requiredViewports) {
      await page.setViewportSize(viewport);
      await page.goto(`/kurum/sinavlar/${examId}`, { waitUntil: "domcontentloaded" });

      const steps = page.getByRole("navigation", { name: "Sınav adımları" });
      const managementHref = `/kurum/sinavlar?examId=${examId}&from=workspace`;
      await expect(steps.getByRole("link", { name: /Katılımcılar/ })).toHaveAttribute("href", managementHref);
      await expect(steps.getByRole("link", { name: /Cevap anahtarı/ })).toHaveAttribute("href", managementHref);
      const nextLink = page.getByRole("group", { name: "Sonraki önerilen iş" }).getByRole("link", { name: "Katılımcı ekle" });
      await expect(nextLink).toHaveAttribute("href", managementHref);
      await expect(page.getByRole("link", { name: "Sınav yönetimini aç" })).toHaveAttribute("href", managementHref);

      await nextLink.click();
      await expect(page).toHaveURL(`${appOrigin}${managementHref}`);
      const returnBar = page.getByRole("group", { name: "Sınav çalışma alanı bağlamı" });
      await expect(returnBar.getByRole("link", { name: "Çalışma alanına dön" })).toBeVisible();
      await expect(returnBar.getByRole("link", { name: "Çalışma alanına dön" })).toHaveAttribute("href", `/kurum/sinavlar/${examId}`);
      await expect(returnBar).toContainText(examTitle);
      await expect(page.getByRole("region", { name: "Sınav katılımcıları" })).toContainText(`${examTitle} katılımcıları`);
      await expectNoHorizontalOverflow(page, `exam-return-${viewport.width}`);

      await returnBar.getByRole("link", { name: "Çalışma alanına dön" }).click();
      await expect(page).toHaveURL(`${appOrigin}/kurum/sinavlar/${examId}`);
    }

    await page.goto("/kurum/sinavlar", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("table", { name: "Sınav yönetimi" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Çalışma alanına dön" })).toHaveCount(0);
  });
});

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} yatay taşma`).toBeLessThanOrEqual(1);
}

async function installK1Api(
  page: Page,
  options: { evaluationRounds?: number; nextAction?: "OPEN_OPTICAL" | "ADD_PARTICIPANTS"; workspaceStatus?: 403 | 404 } = {},
) {
  const evidence = { mutationRequests: [] as string[], unknownRequests: [] as string[], workspaceRequests: 0 };
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const pathName = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");

    if (pathName === "/auth/refresh" && request.method() === "POST") {
      await fulfillData(route, authFixture);
      return;
    }
    if (request.method() !== "GET") {
      evidence.mutationRequests.push(`${request.method()} ${pathName}`);
      await fulfillData(route, {}, 405);
      return;
    }
    if (pathName === `/exams/${examId}/workspace`) {
      evidence.workspaceRequests += 1;
      if (options.workspaceStatus) {
        await fulfillData(route, { code: options.workspaceStatus === 404 ? "EXAM_NOT_FOUND" : "FORBIDDEN" }, options.workspaceStatus);
        return;
      }
      await fulfillData(route, workspaceFor(evidence.workspaceRequests, options));
      return;
    }
    if (pathName === "/me/profile") {
      await fulfillData(route, {
        userId: authFixture.session.userId,
        tenantId: authFixture.session.tenantId,
        roles: authFixture.session.roles,
        activePersona: authFixture.session.activePersona,
        capabilities: [],
        mustChangePassword: false,
      });
      return;
    }
    if (pathName === "/me/tenant") {
      await fulfillData(route, tenantFixture);
      return;
    }
    if (pathName === "/exams") {
      await fulfillData(route, [examFixture], 200, listMeta(1));
      return;
    }
    if (/^\/exams\/[^/]+\/reports\/snapshots$/.test(pathName) || /^\/exams\/[^/]+\/participants$/.test(pathName)) {
      await fulfillData(route, [], 200, listMeta(0));
      return;
    }
    const listPaths = ["/academic-terms", "/alanlar", "/campuses", "/classes", "/courses", "/grade-levels", "/optical-form-templates", "/students", "/me/notification-devices"];
    if (listPaths.includes(pathName)) {
      await fulfillData(route, [], 200, listMeta(0));
      return;
    }

    evidence.unknownRequests.push(`${request.method()} ${pathName}`);
    await fulfillData(route, [], 200, listMeta(0));
  });
  return evidence;
}

function workspaceFor(requestCount: number, options: { evaluationRounds?: number; nextAction?: "OPEN_OPTICAL" | "ADD_PARTICIPANTS" }) {
  if (options.evaluationRounds !== undefined) {
    const done = requestCount > options.evaluationRounds;
    return {
      ...workspaceBase,
      readiness: [
        ...readyBase,
        { key: "OPTICAL_LAYOUT", status: "READY" },
        { key: "IMPORT", status: "READY" },
        { key: "MATCHING", status: "READY" },
        done ? { key: "EVALUATION", status: "READY" } : { key: "EVALUATION", status: "BLOCKED", blocker: "EVALUATION_PENDING" },
        { key: "REPORT", status: "BLOCKED", blocker: "REPORT_MISSING" },
      ],
      nextAction: done ? "GENERATE_REPORT" : "WAIT_EVALUATION",
      progress: { openQuarantineCount: 0, matchedCount: 4, evaluatedCount: done ? 4 : 1 },
    };
  }
  if (options.nextAction === "ADD_PARTICIPANTS") {
    return {
      ...workspaceBase,
      participantSummary: { total: 0, registered: 0, attended: 0, absent: 0 },
      readiness: [
        { key: "EXAM", status: "READY" },
        { key: "ANSWER_KEY", status: "READY" },
        { key: "PARTICIPANTS", status: "BLOCKED", blocker: "PARTICIPANTS_MISSING" },
        { key: "PUBLISHED", status: "READY" },
        { key: "OPTICAL_ENTRY", status: "BLOCKED", blocker: "PARTICIPANTS_MISSING" },
        ...blockedOptical,
      ],
      nextAction: "ADD_PARTICIPANTS",
    };
  }
  return { ...workspaceBase, readiness: [...readyBase, ...blockedOptical], nextAction: "OPEN_OPTICAL" };
}

async function fulfillData(
  route: Route,
  data: unknown,
  status = 200,
  meta?: { total: number; page: number; limit: number; totalPages: number },
) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
    contentType: "application/json",
    status,
  });
}

function listMeta(total: number) {
  return { total, page: 1, limit: Math.max(total, 1), totalPages: total > 0 ? 1 : 0 };
}

const authFixture = {
  accessToken: "k1-access-token",
  session: {
    id: "session-k1",
    userId: "assistant-k1",
    tenantId: "tenant-k1",
    membershipId: "membership-k1",
    activePersona: "STAFF",
    roles: ["ASSISTANT_ADMIN"],
    membershipVersion: 1,
    status: "ACTIVE",
  },
};

const tenantFixture = {
  id: "tenant-k1",
  name: "K1 Akademi",
  slug: "k1-akademi",
  status: "ACTIVE",
  plan: "ENTERPRISE",
  institutionType: "Dershane",
  activeSeatCount: 1,
  seatLimit: 10,
};

const examFixture = {
  id: examId,
  tenantId: "tenant-k1",
  title: examTitle,
  status: "PUBLISHED",
  examType: "LGS",
  startsAt: "2026-08-10T09:00:00.000Z",
  answerKeySummary: { status: "PUBLISHED", version: "k1-v1", questionCount: 90, branchCount: 4 },
  createdAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T09:00:00.000Z",
};

const readyBase = [
  { key: "EXAM", status: "READY" },
  { key: "ANSWER_KEY", status: "READY" },
  { key: "PARTICIPANTS", status: "READY" },
  { key: "PUBLISHED", status: "READY" },
  { key: "OPTICAL_ENTRY", status: "READY" },
];

const blockedOptical = [
  { key: "OPTICAL_LAYOUT", status: "BLOCKED", blocker: "OPTICAL_LAYOUT_MISSING" },
  { key: "IMPORT", status: "BLOCKED", blocker: "IMPORT_MISSING" },
  { key: "MATCHING", status: "BLOCKED", blocker: "IMPORT_MISSING" },
  { key: "EVALUATION", status: "BLOCKED", blocker: "IMPORT_MISSING" },
  { key: "REPORT", status: "BLOCKED", blocker: "REPORT_MISSING" },
];

const workspaceBase = {
  exam: examFixture,
  participantSummary: { total: 4, registered: 0, attended: 4, absent: 0 },
  progress: { openQuarantineCount: 0, matchedCount: 0, evaluatedCount: 0 },
};
