import { expect, test, type Page, type Route } from "@playwright/test";
import type { AnnouncementRecord } from "@o-okul/shared-types";

import { collectPortalUnreadAnnouncements } from "../app/(app)/_shell/portal-announcement-unread.js";

// DEC-20261102-06: öğrenci ve veli kabuğunda "Okunmamış duyurular" göstergesi. Yeni uç yok; mevcut portal listesi
// ve okundu uçları kullanılır. Velide aynı duyuru bir kez sayılır; salt okunur lisansta sayı kalır, okundu kapanır.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const fixedNow = new Date("2026-06-17T08:00:00.000Z");
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token,x-role-preview-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

type SubjectType = "GUARDIAN" | "STUDENT" | "TEACHER";

interface BellMock {
  getRequests: string[];
  postRequests: string[];
  readIds: Set<string>;
  readOnlyLicense: boolean;
}

const sharedAnnouncement: AnnouncementRecord = { audience: "SCHOOL", body: "Gizli metin: toplantı ayrıntısı", id: "announcement-shared", publishedAt: "2026-06-16T09:00:00.000Z", tenantId: "tenant-bell", title: "Veli toplantısı" };
const wardAAnnouncement: AnnouncementRecord = { audience: "GUARDIANS", body: "Gizli metin: gezi", id: "announcement-ward-a", publishedAt: "2026-06-15T09:00:00.000Z", tenantId: "tenant-bell", title: "8-A gezi bilgisi" };
const wardBAnnouncement: AnnouncementRecord = { audience: "GUARDIANS", body: "Gizli metin: kulüp", id: "announcement-ward-b", publishedAt: "2026-06-14T09:00:00.000Z", tenantId: "tenant-bell", title: "6-B kulüp günü" };
const readAnnouncement: AnnouncementRecord = { ...wardBAnnouncement, id: "announcement-read", readAt: "2026-06-15T10:00:00.000Z", title: "Okunmuş duyuru" };

test.describe("Portal okunmamış duyuru göstergesi", () => {
  test("birleştirme aynı duyuruyu bir kez sayar, okunmuş kopya okunmuş sayılır, en yeni önce gelir", () => {
    const unread = collectPortalUnreadAnnouncements([
      { announcements: [sharedAnnouncement, wardAAnnouncement], studentId: "student-a" },
      { announcements: [sharedAnnouncement, wardBAnnouncement, readAnnouncement], studentId: "student-b" },
    ]);
    expect(unread.map((item) => item.id)).toEqual(["announcement-shared", "announcement-ward-a", "announcement-ward-b"]);
    expect(unread[0]?.studentId).toBe("student-a");
    expect(unread[2]?.studentId).toBe("student-b");
    expect(Object.keys(unread[0] ?? {})).not.toContain("body");

    const readOnOneWard = collectPortalUnreadAnnouncements([
      { announcements: [sharedAnnouncement], studentId: "student-a" },
      { announcements: [{ ...sharedAnnouncement, readAt: "2026-06-16T10:00:00.000Z" }], studentId: "student-b" },
    ]);
    expect(readOnOneWard).toEqual([]);
  });

  test("öğrenci: sayı, başlık ve tarih listesi, gövde yok; kabuk yüklenirken tek liste isteği; okundu sayıyı düşürür", async ({ page }) => {
    const mock = await openPortal(page, "STUDENT", "/ogrenci/odevler");

    const bell = page.getByRole("button", { name: "Okunmamış duyurular: 2" });
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute("aria-expanded", "false");
    expect(countGets(mock, "/me/student/announcements")).toBe(1);

    await bell.click();
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    const popover = page.getByRole("region", { exact: true, name: "Okunmamış duyurular" });
    await expect(popover).toBeVisible();
    await expect(popover.getByRole("link", { name: /Veli toplantısı/ })).toHaveAttribute("href", "/ogrenci/duyurular");
    await expect(popover).toContainText("16.06.2026");
    await expect(popover).toContainText("8-A gezi bilgisi");
    await expect(popover).not.toContainText("Gizli metin");
    await expect(popover.getByRole("link", { name: "Tüm duyurular" })).toHaveAttribute("href", "/ogrenci/duyurular");

    await popover.getByRole("button", { name: "Veli toplantısı okundu işaretle" }).click();
    await expect(page.getByRole("button", { name: "Okunmamış duyurular: 1" })).toBeVisible();
    expect(mock.postRequests).toEqual(["/me/student/announcements/announcement-shared/read"]);
    await expect(popover).not.toContainText("Veli toplantısı");

    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Okunmamış duyurular: 1" })).toBeFocused();
  });

  test("veli: iki çocukta aynı duyuru bir kez sayılır, her çocuk için en çok bir liste isteği", async ({ page }) => {
    const mock = await openPortal(page, "GUARDIAN", "/veli/odevler");

    const bell = page.getByRole("button", { name: "Okunmamış duyurular: 3" });
    await expect(bell).toBeVisible();
    expect(countGets(mock, "/me/guardian/students/student-a/announcements")).toBe(1);
    expect(countGets(mock, "/me/guardian/students/student-b/announcements")).toBe(1);

    await bell.click();
    const popover = page.getByRole("region", { exact: true, name: "Okunmamış duyurular" });
    await expect(popover.getByRole("listitem")).toHaveCount(3);
    await expect(popover.getByRole("link", { name: /Veli toplantısı/ })).toHaveCount(1);
    await expect(popover.getByRole("link", { name: /6-B kulüp günü/ })).toHaveAttribute("href", "/veli/duyurular");
    await expect(popover).not.toContainText("Okunmuş duyuru");
    await expect(popover).not.toContainText("Gizli metin");

    await popover.getByRole("button", { name: "6-B kulüp günü okundu işaretle" }).click();
    await expect(page.getByRole("button", { name: "Okunmamış duyurular: 2" })).toBeVisible();
    expect(mock.postRequests).toEqual(["/me/guardian/students/student-b/announcements/announcement-ward-b/read"]);
  });

  test("salt okunur lisans: sayı görünür kalır, okundu işaretleme sunulmaz", async ({ page }) => {
    const mock = await openPortal(page, "STUDENT", "/ogrenci/odevler", { readOnlyLicense: true });

    const bell = page.getByRole("button", { name: "Okunmamış duyurular: 2" });
    await bell.click();
    const popover = page.getByRole("region", { exact: true, name: "Okunmamış duyurular" });
    await popover.getByRole("button", { name: "Veli toplantısı okundu işaretle" }).click();

    await expect(popover).toContainText("Lisans salt okunur; okundu işaretleme kapalı.");
    await expect(popover.getByRole("button", { name: /okundu işaretle/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Okunmamış duyurular: 2" })).toBeVisible();
    await expect(popover.getByRole("listitem")).toHaveCount(2);
    expect(mock.postRequests).toHaveLength(1);
  });

  test("öğretmen kabuğunda gösterge çizilmez", async ({ page }) => {
    const mock = await openPortal(page, "TEACHER", "/ogretmen/ders-akisi");

    await expect(page.getByRole("heading", { level: 1, name: "Öğretmen Portalı" })).toBeVisible();
    await expect(page.locator(".next-portal-bell")).toHaveCount(0);
    expect(countGets(mock, "/me/teacher/announcements")).toBe(0);
  });

  test("mobil 375 px: gösterge üst çubukta, açılır liste ekrana sığar", async ({ page }) => {
    await openPortal(page, "STUDENT", "/ogrenci/odevler", { viewport: { height: 812, width: 375 } });

    const bell = page.getByRole("button", { name: "Okunmamış duyurular: 2" });
    await expect(bell).toBeVisible();
    await bell.click();
    const popover = page.getByRole("region", { exact: true, name: "Okunmamış duyurular" });
    await expect(popover).toBeVisible();
    const box = await popover.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
});

function countGets(mock: BellMock, path: string) {
  return mock.getRequests.filter((requestPath) => requestPath === path).length;
}

async function openPortal(
  page: Page,
  subjectType: SubjectType,
  path: string,
  options: { readOnlyLicense?: boolean; viewport?: { height: number; width: number } } = {},
): Promise<BellMock> {
  const mock: BellMock = { getRequests: [], postRequests: [], readIds: new Set(), readOnlyLicense: Boolean(options.readOnlyLicense) };
  await page.setViewportSize(options.viewport ?? { height: 900, width: 1280 });
  await page.clock.setFixedTime(fixedNow);
  await page.route("**/api/v1/**", async (route) => {
    const method = route.request().method();
    if (method === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    const pathName = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
    if (method === "GET") mock.getRequests.push(pathName);
    if (method === "POST" && pathName.endsWith("/read")) {
      mock.postRequests.push(pathName);
      if (mock.readOnlyLicense) {
        await route.fulfill({
          body: JSON.stringify({ error: { code: "TENANT_LICENSE_EXPIRED_READ_ONLY" } }),
          headers: { ...corsHeaders, "content-type": "application/json" },
          status: 403,
        });
        return;
      }
      const announcementId = pathName.split("/").at(-2) ?? "";
      mock.readIds.add(announcementId);
      await fulfillData(route, { ...sharedAnnouncement, id: announcementId, readAt: "2026-06-17T08:00:00.000Z" });
      return;
    }
    const data = pathName === "/auth/refresh" ? authResponse(subjectType) : pathName === "/me/tenant" ? tenantResponse() : portalResponse(pathName, mock);
    await fulfillData(route, data);
  });
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  return mock;
}

function withReadState(announcements: AnnouncementRecord[], mock: BellMock) {
  return announcements.map((announcement) =>
    mock.readIds.has(announcement.id) ? { ...announcement, readAt: "2026-06-17T08:00:00.000Z" } : announcement,
  );
}

function portalResponse(pathName: string, mock: BellMock): unknown {
  if (pathName === "/me/student/announcements") return withReadState([sharedAnnouncement, wardAAnnouncement, readAnnouncement], mock);
  if (pathName === "/me/student/profile") return studentProfile("student-a", "Ada");
  if (pathName === "/me/student/overview") return { examSeries: [], schoolGrades: [] };
  if (pathName === "/me/guardian/students") {
    return [
      { firstName: "Ada", id: "student-a", lastName: "Kaya", status: "ACTIVE", tenantId: "tenant-bell" },
      { firstName: "Can", id: "student-b", lastName: "Kaya", status: "ACTIVE", tenantId: "tenant-bell" },
    ];
  }
  if (pathName === "/me/guardian/students/student-a/announcements") return withReadState([sharedAnnouncement, wardAAnnouncement], mock);
  if (pathName === "/me/guardian/students/student-b/announcements") return withReadState([sharedAnnouncement, wardBAnnouncement, readAnnouncement], mock);
  if (pathName === "/me/guardian/students/student-a/profile") return studentProfile("student-a", "Ada");
  if (pathName === "/me/guardian/students/student-a/notification-preferences") {
    return {
      canOpenSupportTickets: false,
      canReceiveAnnouncements: true,
      canReceiveAutoNotifications: true,
      canReceiveSms: false,
      canViewFinance: false,
      guardianId: "guardian-a",
      id: "guardian-link-a",
      studentId: "student-a",
      tenantId: "tenant-bell",
    };
  }
  if (pathName === "/me/teacher") return { branch: "Matematik", firstName: "Zeynep", id: "teacher-math", lastName: "Arslan", tenantId: "tenant-bell" };
  if (pathName === "/me/teacher/lookups") return { attendanceClassIds: [], campuses: [], classes: [], courses: [], gradeLevels: [], terms: [] };
  if (pathName === "/attendance/daily") return { records: [], students: [] };
  if (pathName === "/me/profile") return { activePersona: undefined, availablePersonas: [] };
  return [];
}

function studentProfile(id: string, firstName: string) {
  return { className: "8-A", firstName, gradeLevelName: "8. Sınıf", id, lastName: "Kaya", section: "A", status: "ACTIVE", tenantId: "tenant-bell" };
}

function authResponse(subjectType: SubjectType) {
  const subjectId = subjectType === "STUDENT" ? "student-a" : subjectType === "GUARDIAN" ? "guardian-a" : "teacher-math";
  return {
    accessToken: `portal-bell-${subjectType.toLowerCase()}-token`,
    session: {
      id: `session-${subjectId}`,
      membershipVersion: 1,
      roles: [subjectType],
      status: "ACTIVE",
      subjectId,
      subjectType,
      tenantId: "tenant-bell",
      userId: subjectId,
    },
  };
}

function tenantResponse() {
  return { id: "tenant-bell", institutionType: "Okul", name: "Zil Koleji" };
}

async function fulfillData(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    headers: { ...corsHeaders, "content-type": "application/json" },
    status: 200,
  });
}
