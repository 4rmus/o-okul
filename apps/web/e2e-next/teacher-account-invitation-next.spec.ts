import { expect, test, type Page, type Route } from "@playwright/test";
import type { IdentityInvitationRecord, TeacherRecord } from "@o-okul/shared-types";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

const webOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": webOrigin,
};

interface MockState {
  createError?: string;
  creates: Array<Record<string, unknown>>;
  invitationListRequests: number;
  invitationQueries: string[];
  invitations: IdentityInvitationRecord[];
  resends: string[];
  revokes: string[];
  roles: string[];
  teachers: TeacherRecord[];
}

function mockState(overrides: Partial<MockState> = {}): MockState {
  return {
    creates: [],
    invitationListRequests: 0,
    invitationQueries: [],
    invitations: [],
    resends: [],
    revokes: [],
    roles: ["TENANT_ADMIN"],
    teachers: [teacher("teacher-a", "Ayşe", "Demir")],
    ...overrides,
  };
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) {
  test(`hesabı olmayan öğretmene davet gönderir ve bekleyen daveti yeniden gönderir (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const state = mockState();
    await openTeacherDetail(page, state, "teacher-a");

    const profile = page.getByRole("region", { name: "Öğretmen profil kartı" });
    await expect(profile.getByText("Hesap yok", { exact: true })).toBeVisible();
    await expect(profile.getByRole("button", { name: "Yeniden gönder" })).toHaveCount(0);
    await profile.getByRole("button", { name: "Hesap daveti gönder" }).click();

    const dialog = page.getByRole("dialog", { name: "Ayşe Demir hesap daveti" });
    const email = dialog.getByLabel("E-posta");
    await expect(email).toBeFocused();
    await expectNoHorizontalOverflow(page, `teacher invitation dialog ${viewport.width}`);

    await dialog.getByRole("button", { name: "Daveti gönder" }).click();
    await expect(email).toHaveJSProperty("validity.valueMissing", true);
    await email.fill("ayse-demir");
    await dialog.getByRole("button", { name: "Daveti gönder" }).click();
    await expect(email).toHaveJSProperty("validity.typeMismatch", true);
    expect(state.creates).toHaveLength(0);

    await email.fill("ayse.demir@example.test");
    await dialog.getByRole("button", { name: "Daveti gönder" }).click();
    await expect(dialog).toBeHidden();
    expect(state.creates).toEqual([{ email: "ayse.demir@example.test", subjectId: "teacher-a", subjectType: "TEACHER" }]);
    await expect(page.locator('.uh-toast-region[aria-live="polite"]')).toContainText("Davet gönderildi; kabul edilince öğretmen portalı açılır.");

    await expect(profile.getByText("Davet bekliyor", { exact: true })).toBeVisible();
    await expect(profile.getByRole("button", { name: "Hesap daveti gönder" })).toHaveCount(0);
    await profile.getByRole("button", { name: "Yeniden gönder" }).click();
    await expect.poll(() => state.resends).toEqual(["invitation-created"]);
    await expectNoHorizontalOverflow(page, `teacher detail pending ${viewport.width}`);
    // UAT F-03: the pending invitation can be withdrawn; the teacher drops back to "Hesap yok" and can be invited again.
    await profile.getByRole("button", { name: "Daveti iptal et" }).click();
    await expect.poll(() => state.revokes).toEqual(["invitation-created"]);
    await expect(page.locator('.uh-toast-region[aria-live="polite"]')).toContainText("Davet iptal edildi; bağlantı artık çalışmaz.");
    await expect(profile.getByText("Hesap yok", { exact: true })).toBeVisible();
    await expect(profile.getByRole("button", { name: "Daveti iptal et" })).toHaveCount(0);
    await expect(profile.getByRole("button", { name: "Hesap daveti gönder" })).toBeVisible();
    // The detail page asks only for this teacher's invitations, never the tenant-wide teacher list.
    expect(state.invitationQueries.length).toBeGreaterThan(0);
    expect(new Set(state.invitationQueries)).toEqual(new Set(["teacher-a"]));
  });
}

for (const [code, message] of [
  ["SUBJECT_ALREADY_LINKED", "Bu öğretmenin portal hesabı zaten bağlı."],
  ["SUBJECT_NOT_FOUND", "Öğretmen kaydı bulunamadı. Sayfayı yenileyin."],
  ["EMAIL_REQUIRED", "Geçerli bir e-posta adresi yazın."],
  ["UNEXPECTED_FAILURE", "Davet gönderilemedi. Bilgileri kontrol edip tekrar deneyin."],
] as const) {
  test(`davet hatası ${code} kısa Türkçe mesaja çevrilir`, async ({ page }) => {
    const state = mockState({ createError: code });
    await openTeacherDetail(page, state, "teacher-a");
    await page.getByRole("button", { name: "Hesap daveti gönder" }).click();
    const dialog = page.getByRole("dialog", { name: "Ayşe Demir hesap daveti" });
    await dialog.getByLabel("E-posta").fill("ayse.demir@example.test");
    await dialog.getByRole("button", { name: "Daveti gönder" }).click();
    await expect(dialog).toContainText(message);
    await expect(dialog).toBeVisible();
  });
}

// UAT F-17: a write rejected for an expired licence shows one app-wide warning that names the reason.
test("lisans süresi dolan kurumda reddedilen yazma işlemi nedeni açıklayan uyarı gösterir (UAT F-17)", async ({ page }) => {
  const state = mockState({ createError: "TENANT_LICENSE_EXPIRED_READ_ONLY" });
  await openTeacherDetail(page, state, "teacher-a");
  await page.getByRole("button", { name: "Hesap daveti gönder" }).click();
  const dialog = page.getByRole("dialog", { name: "Ayşe Demir hesap daveti" });
  await dialog.getByLabel("E-posta").fill("ayse.demir@example.test");
  await dialog.getByRole("button", { name: "Daveti gönder" }).click();
  const toast = page.locator(".uh-toast-region");
  await expect(toast).toContainText("Lisans süresi dolduğu için kurum salt okunur");
  await expect(toast).toContainText("lisansın yenilenmesi gerekir");
  // A second rejected attempt right away does not stack another copy of the same warning.
  await dialog.getByRole("button", { name: "Daveti gönder" }).click();
  await expect.poll(() => state.creates.length).toBe(2);
  await expect(toast.getByText("Lisans süresi dolduğu için kurum salt okunur", { exact: false })).toHaveCount(1);
});

test("bağlı öğretmende davet işlemi görünmez ve davet listesi istenmez", async ({ page }) => {
  const state = mockState({ teachers: [teacher("teacher-a", "Ayşe", "Demir", "user-teacher-a")] });
  await openTeacherDetail(page, state, "teacher-a");
  const profile = page.getByRole("region", { name: "Öğretmen profil kartı" });
  await expect(profile.getByText("Portal bağlı", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Öğretmen detay operasyon özeti" })).toContainText("Portal bağlı");
  await expect(profile.getByRole("button", { name: "Hesap daveti gönder" })).toHaveCount(0);
  await expect(profile.getByRole("button", { name: "Yeniden gönder" })).toHaveCount(0);
  await expect(profile.getByRole("button", { name: "Daveti iptal et" })).toHaveCount(0);
  expect(state.invitationListRequests).toBe(0);
});

test("kullanıcı yönetimi yetkisi olmayan rol davet göndermez", async ({ page }) => {
  const state = mockState({ roles: ["ASSISTANT_ADMIN"] });
  await openTeacherDetail(page, state, "teacher-a");
  const profile = page.getByRole("region", { name: "Öğretmen profil kartı" });
  await expect(profile.getByText("Hesap yok", { exact: true })).toBeVisible();
  await expect(profile.getByRole("button", { name: "Hesap daveti gönder" })).toHaveCount(0);
  expect(state.invitationListRequests).toBe(0);
});

test("öğretmen listesi hesap durumunu bağlı, davet bekliyor ve hesap yok olarak gösterir", async ({ page }) => {
  // teacher-c also carries an expired PENDING invitation; it must not count as "Davet bekliyor".
  const state = mockState({
    invitations: [
      invitation("invitation-b", "teacher-b"),
      { ...invitation("invitation-guardian", "teacher-c"), subjectType: "GUARDIAN", role: "GUARDIAN" },
      { ...invitation("invitation-expired", "teacher-c"), expiresAt: "2026-01-01T00:00:00.000Z" },
    ],
    teachers: [
      teacher("teacher-a", "Ayşe", "Demir", "user-teacher-a"),
      teacher("teacher-b", "Burak", "Kaya"),
      teacher("teacher-c", "Cem", "Ak"),
    ],
  });
  await openTeacherDetail(page, state, undefined);
  const table = page.getByRole("table", { name: "Öğretmen operasyon listesi" });
  await expect(table.getByRole("row", { name: /Ayşe Demir/ })).toContainText("Portal bağlı");
  await expect(table.getByRole("row", { name: /Burak Kaya/ })).toContainText("Davet bekliyor");
  await expect(table.getByRole("row", { name: /Cem Ak/ })).toContainText("Hesap yok");
  await expect(page.locator("body")).not.toContainText("TC + telefon");
  expect(new Set(state.invitationQueries)).toEqual(new Set(["TEACHER"]));
});

async function openTeacherDetail(page: Page, state: MockState, teacherId: string | undefined) {
  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    await route.continue();
  });
  await page.route("**/auth/refresh", async (route) => {
    await json(route, authResponse(state.roles));
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }
    if (path === "/identity-invitations" && request.method() === "GET") {
      state.invitationListRequests += 1;
      // Exact cursor-list filters: the detail page asks for one subjectId, the list page for the TEACHER subject type.
      const params = new URL(request.url()).searchParams;
      state.invitationQueries.push(params.get("subjectId") ?? params.get("subjectType") ?? "");
      await json(route, state.invitations);
      return;
    }
    if (path === "/identity-invitations" && request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.creates.push(body);
      if (state.createError) {
        await route.fulfill({ body: JSON.stringify({ error: { code: state.createError } }), contentType: "application/json", headers: corsHeaders, status: 400 });
        return;
      }
      const created = invitation("invitation-created", String(body.subjectId));
      state.invitations = [created, ...state.invitations];
      await json(route, created);
      return;
    }
    const resend = /^\/identity-invitations\/([^/]+)\/resend$/u.exec(path);
    if (resend && request.method() === "POST") {
      state.resends.push(resend[1]!);
      await json(route, invitation(resend[1]!, "teacher-a"));
      return;
    }
    const revoke = /^\/identity-invitations\/([^/]+)\/revoke$/u.exec(path);
    if (revoke && request.method() === "POST") {
      state.revokes.push(revoke[1]!);
      state.invitations = state.invitations.filter((candidate) => candidate.id !== revoke[1]);
      await json(route, { ...invitation(revoke[1]!, "teacher-a"), status: "REVOKED" });
      return;
    }
    if (path === "/teachers" && request.method() === "GET") {
      await json(route, state.teachers, { limit: 20, page: 1, total: state.teachers.length, totalPages: 1 });
      return;
    }
    const teacherMatch = /^\/teachers\/([^/]+)$/u.exec(path);
    if (teacherMatch && request.method() === "GET") {
      await json(route, state.teachers.find((candidate) => candidate.id === teacherMatch[1]));
      return;
    }
    if (path === "/me/tenant") {
      await json(route, { id: "tenant-a", name: "DNA Eğitim", plan: "TRIAL", slug: "dna-egitim", status: "ACTIVE" });
      return;
    }
    if (path === "/me/institution-dashboard") {
      await json(route, {
        activeStudentCount: 0,
        attention: { attendanceAlertCount: 0, openImportQuarantineCount: 0, openSupportTicketCount: 0 },
        generatedAt: "2026-10-11T10:00:00.000Z",
        institution: { name: "DNA Eğitim" },
      });
      return;
    }
    await json(route, []);
  });

  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: webOrigin, value: "csrf-token" }]);
  await page.goto(teacherId ? `/kurum/ogretmenler/${teacherId}` : "/kurum/ogretmenler");
}

async function json(route: Route, data: unknown, meta?: Record<string, unknown>) {
  await route.fulfill({
    body: JSON.stringify({ data, ...(meta ? { meta } : {}) }),
    contentType: "application/json",
    headers: corsHeaders,
    status: 200,
  });
}

function authResponse(roles: string[]) {
  return {
    accessToken: "next-access-token",
    session: { id: "session-a", membershipVersion: 1, roles, status: "ACTIVE", tenantId: "tenant-a", userId: "user-admin-a" },
  };
}

// The API never returns userId for teachers; it exposes only hasAccount (UAT F-09).
function teacher(id: string, firstName: string, lastName: string, userId?: string): TeacherRecord {
  return { id, tenantId: "tenant-a", firstName, lastName, branch: "Matematik", hasAccount: Boolean(userId) };
}

function invitation(id: string, subjectId: string): IdentityInvitationRecord {
  return {
    id,
    tenantId: "tenant-a",
    subjectType: "TEACHER",
    subjectId,
    email: "ogretmen@example.test",
    name: "Öğretmen Daveti",
    role: "TEACHER",
    kind: "EMAIL_LINK",
    status: "PENDING",
    expiresAt: "2099-10-12T10:00:00.000Z",
    createdAt: "2026-10-11T10:00:00.000Z",
    updatedAt: "2026-10-11T10:00:00.000Z",
  };
}
