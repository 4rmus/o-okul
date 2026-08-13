import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const examId = "exam-gate-c";
const requiredViewports = [
  { width: 320, height: 812 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
] as const;

test("Gate C internal tenant Shell v2 ve salt okunur sınav paritesini beş viewport'ta gösterir", async ({ page }) => {
  const evidence = await installGateCApi(page, "enabled");

  for (const viewport of requiredViewports) {
    await page.setViewportSize(viewport);
    await page.goto(`/kurum/sinavlar/${examId}`, { waitUntil: "domcontentloaded" });

    await expect(page.locator(".next-app-shell")).toHaveAttribute("data-shell-version", "v2");
    await expect(page.locator(".next-sidebar-group-toggle").filter({ hasText: "Sınav" })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1, name: "Gate C Denemesi" })).toBeVisible();
    const workspace = page.getByRole("region", { name: "Salt okunur sınav çalışma alanı" });
    await expect(workspace.getByText("90 soru", { exact: false })).toBeVisible();
    await expect(workspace.getByText("21", { exact: true }).first()).toBeVisible();
    await expect(workspace.getByText("Optik akışına geçiş", { exact: true })).toBeVisible();
    await expect(workspace.getByText("Hazır", { exact: true })).toHaveCount(5);
    await expect(workspace.getByRole("button")).toHaveCount(0);
    await expect(workspace.getByRole("link", { name: "Optik işlemlerine geç" })).toHaveAttribute(
      "href",
      `/kurum/optik?examId=${examId}`,
    );
    await expect(workspace.getByRole("link", { name: "Rapor görünümünü aç" })).toHaveAttribute(
      "href",
      `/kurum/raporlar?examId=${examId}`,
    );
  }

  expect(evidence.workspaceRequests).toBeGreaterThan(0);
  expect(evidence.mutationRequests).toEqual([]);
  expect(evidence.unknownRequests).toEqual([]);
});

for (const mode of ["disabled", "error", "malformed"] as const) {
  test(`Gate C ${mode} rollout sonucunda workspace çağırmadan aynı legacy sınava döner`, async ({ page }) => {
    const evidence = await installGateCApi(page, mode);
    await page.addInitScript(() => {
      window.localStorage.setItem("web.exam-workspace-v2", "true");
      window.localStorage.setItem("web.shell-v2", "true");
    });

    await page.goto(`/kurum/sinavlar/${examId}?shellV2=1&web.exam-workspace-v2=true`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page).toHaveURL((url) =>
      url.pathname === "/kurum/sinavlar" && url.searchParams.get("examId") === examId,
    );
    await expect(page.locator(".next-app-shell")).toHaveAttribute("data-shell-version", "legacy");
    await expect(page.getByRole("region", { name: "Sınav katılımcıları" })).toContainText("Gate C Denemesi");
    expect(evidence.workspaceRequests).toBe(0);
    expect(evidence.mutationRequests).toEqual([]);
    expect(evidence.unknownRequests).toEqual([]);
  });
}

for (const sessionCase of [
  { label: "operations staff", roles: ["OPERATIONS_STAFF"], activePersona: "STAFF" },
  { label: "teacher persona", roles: ["TENANT_ADMIN", "TEACHER"], activePersona: "TEACHER" },
] as const) {
  test(`Gate C ${sessionCase.label} için linki ve doğrudan workspace erişimini kapatır`, async ({ page }) => {
    const evidence = await installGateCApi(page, "enabled", {
      activePersona: sessionCase.activePersona,
      roles: [...sessionCase.roles],
    });
    await page.goto(`/kurum/sinavlar?examId=${examId}`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("link", { name: "Salt okunur çalışma alanını aç" })).toHaveCount(0);
    await page.goto(`/kurum/sinavlar/${examId}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(`${appOrigin}/kurum`);
    expect(evidence.workspaceRequests).toBe(0);
    expect(evidence.mutationRequests).toEqual([]);
  });
}

test("Gate C personasız tek-rol legacy admin için ortak workspace kuralını korur", async ({ page }) => {
  const evidence = await installGateCApi(page, "enabled", {
    activePersona: undefined,
    membershipId: undefined,
    roles: ["TENANT_ADMIN"],
  });

  await page.goto(`/kurum/sinavlar/${examId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "Gate C Denemesi" })).toBeVisible();
  expect(evidence.workspaceRequests).toBeGreaterThan(0);
  expect(evidence.mutationRequests).toEqual([]);
});

async function installGateCApi(
  page: Page,
  mode: "enabled" | "disabled" | "error" | "malformed",
  sessionOverride: Partial<typeof authFixture.session> = {},
) {
  const auth = {
    ...authFixture,
    session: { ...authFixture.session, ...sessionOverride },
  };
  const evidence = {
    mutationRequests: [] as string[],
    unknownRequests: [] as string[],
    workspaceRequests: 0,
  };
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");

    if (pathName === "/auth/refresh" && request.method() === "POST") {
      await fulfillData(route, auth);
      return;
    }
    if (request.method() !== "GET") {
      evidence.mutationRequests.push(`${request.method()} ${pathName}`);
      await fulfillData(route, {}, 405);
      return;
    }
    if (pathName === "/me/feature-rollouts") {
      if (mode === "error") {
        await fulfillData(route, { code: "ROLLOUT_UNAVAILABLE" }, 500);
      } else if (mode === "malformed") {
        await fulfillData(route, {
          enabledFeatureKeys: ["web.shell-v2", "web.exam-workspace-v2", 42],
          tenantId: "spoof",
        });
      } else {
        await fulfillData(route, {
          enabledFeatureKeys: mode === "enabled" ? ["web.shell-v2", "web.exam-workspace-v2"] : [],
        });
      }
      return;
    }
    if (pathName === `/exams/${examId}/workspace`) {
      evidence.workspaceRequests += 1;
      await fulfillData(route, workspaceFixture);
      return;
    }
    if (pathName === "/me/profile") {
      await fulfillData(route, {
        userId: auth.session.userId,
        tenantId: auth.session.tenantId,
        roles: auth.session.roles,
        activePersona: auth.session.activePersona,
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
      await fulfillData(route, [otherExamFixture, workspaceFixture.exam], 200, listMeta(2));
      return;
    }
    if (pathName === `/exams/${examId}/participants`) {
      await fulfillData(route, participantFixtures, 200, listMeta(participantFixtures.length));
      return;
    }
    if (/^\/exams\/[^/]+\/participants$/.test(pathName)) {
      await fulfillData(route, [], 200, listMeta(0));
      return;
    }
    const listFixtures: Record<string, unknown[]> = {
      "/academic-terms": [],
      "/alanlar": [],
      "/campuses": [],
      "/classes": [],
      "/grade-levels": [],
      "/students": [],
    };
    if (pathName in listFixtures) {
      const data = listFixtures[pathName] ?? [];
      await fulfillData(route, data, 200, listMeta(data.length));
      return;
    }

    evidence.unknownRequests.push(`${request.method()} ${pathName}`);
    await fulfillData(route, { code: "UNHANDLED_GATE_C_API" }, 501);
  });
  return evidence;
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
  accessToken: "gate-c-access-token",
  session: {
    id: "session-gate-c",
    userId: "assistant-gate-c",
    tenantId: "tenant-gate-c",
    membershipId: "membership-gate-c",
    activePersona: "STAFF",
    roles: ["ASSISTANT_ADMIN"],
    membershipVersion: 1,
    status: "ACTIVE",
  },
};

const tenantFixture = {
  id: "tenant-gate-c",
  name: "Gate C Akademi",
  slug: "gate-c-akademi",
  status: "ACTIVE",
  plan: "ENTERPRISE",
  institutionType: "Dershane",
  activeSeatCount: 1,
  seatLimit: 10,
};

const workspaceFixture = {
  exam: {
    id: examId,
    tenantId: "tenant-gate-c",
    title: "Gate C Denemesi",
    status: "PUBLISHED",
    examType: "LGS",
    startsAt: "2026-08-10T09:00:00.000Z",
    answerKeySummary: { status: "PUBLISHED", version: "gate-c-v1", questionCount: 90, branchCount: 4 },
    createdAt: "2026-08-10T08:00:00.000Z",
    updatedAt: "2026-08-10T09:00:00.000Z",
  },
  participantSummary: { total: 21, registered: 0, attended: 21, absent: 0 },
  readiness: [
    { key: "EXAM", status: "READY" },
    { key: "ANSWER_KEY", status: "READY" },
    { key: "PARTICIPANTS", status: "READY" },
    { key: "PUBLISHED", status: "READY" },
    { key: "OPTICAL_ENTRY", status: "READY" },
  ],
  nextAction: "OPEN_OPTICAL",
};

const otherExamFixture = {
  ...workspaceFixture.exam,
  id: "exam-other",
  title: "İlk Sıradaki Başka Sınav",
};

const participantFixtures = Array.from({ length: 21 }, (_, index) => ({
  id: `participant-${index + 1}`,
  tenantId: "tenant-gate-c",
  examId,
  studentId: `synthetic-student-${index + 1}`,
  status: "ATTENDED",
  createdAt: "2026-08-10T08:00:00.000Z",
  updatedAt: "2026-08-10T09:00:00.000Z",
}));
