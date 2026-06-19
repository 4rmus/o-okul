import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

type TenantRole = "ASSISTANT_ADMIN" | "TENANT_ADMIN";

interface GuardianLinkBody {
  canOpenSupportTickets?: boolean;
  canReceiveAnnouncements?: boolean;
  canReceiveSms?: boolean;
  canViewFinance?: boolean;
  isPrimary?: boolean;
  relationshipType?: string;
  studentId?: string;
}

test.describe("Veli gizlilik ve izin UX'i", () => {
  test("veli bağlama hassas izinleri varsayılan kapalı gönderir", async ({ page }) => {
    const capturedLinks: GuardianLinkBody[] = [];
    const forbiddenBulkCalls = await openGuardianDetail(page, "TENANT_ADMIN", capturedLinks);
    await expect.poll(() => forbiddenBulkCalls).toEqual([]);

    const summary = page.getByRole("region", { exact: true, name: "Veli detay operasyon özeti" });
    await expect(summary).toContainText("Telefon");
    await expect(summary).toContainText("••• ••• ••22");
    await expect(summary).toContainText("Finans görünürlüğü");
    await expect(summary).toContainText("0/1 açık");
    await expect(page.locator("body")).not.toContainText("5554443322");
    const profile = page.getByLabel("Veli profili");
    await expect(profile).toContainText("••• ••• ••22");
    await profile.getByRole("button", { name: "Telefonu aç" }).click();
    await expect(profile).toContainText("5554443322");
    await profile.getByRole("button", { name: "Telefonu kapat" }).click();
    await expect(profile).not.toContainText("5554443322");
    const relationshipRegion = page.getByRole("table", { name: "Veli öğrenci bağlantıları" });
    await expect(relationshipRegion).toContainText("ham iletişim bilgisi");
    await expect(relationshipRegion).toContainText("Finans kapalı");
    await expect(relationshipRegion).toContainText("SMS kapalı");
    await expect(relationshipRegion).toContainText("Duyuru kapalı");
    await expect(relationshipRegion).toContainText("Destek kapalı");

    const linkRegion = page.getByLabel("Veli öğrenci bağı ekle");
    await expect(linkRegion.getByRole("checkbox", { name: /Finans görünürlüğü/ })).not.toBeChecked();
    await expect(linkRegion.getByRole("checkbox", { name: /SMS alabilir/ })).not.toBeChecked();
    await expect(linkRegion.getByRole("checkbox", { name: /Duyuru görebilir/ })).not.toBeChecked();
    await expect(linkRegion.getByRole("checkbox", { name: /Destek talebi açabilir/ })).not.toBeChecked();

    await linkRegion.getByLabel("Öğrenci", { exact: true }).selectOption("student-b");
    await linkRegion.getByLabel("İlişki", { exact: true }).selectOption("FATHER");
    await linkRegion.getByRole("button", { name: "Bağla" }).click();

    await expect.poll(() => capturedLinks.at(-1)).toMatchObject({
      canOpenSupportTickets: false,
      canReceiveAnnouncements: false,
      canReceiveSms: false,
      canViewFinance: false,
      isPrimary: true,
      relationshipType: "FATHER",
      studentId: "student-b",
    });
    await expect.poll(() => forbiddenBulkCalls).toEqual([]);
  });

  test("yardımcı yönetici user:manage gerektiren veli portal davetini görmez", async ({ page }) => {
    const forbiddenBulkCalls = await openGuardianDetail(page, "ASSISTANT_ADMIN", []);

    await expect(page.getByRole("heading", { level: 1, name: "Zeynep Veli" })).toBeVisible();
    const profile = page.getByLabel("Veli profili");
    await expect(profile).toContainText("••• ••• ••22");
    await expect(profile.getByRole("button", { name: "Telefonu aç" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("5554443322");
    await expect(page.getByRole("link", { name: "Portal daveti gönder" })).toHaveCount(0);
    await expect.poll(() => forbiddenBulkCalls).toEqual([]);
  });

  for (const visibility of ["false", "omitted"] as const) {
    test(`veli portal finans izni ${visibility} iken ödeme verisi istemez`, async ({ page }) => {
      const paymentPlanRequests = await openGuardianPortal(page, visibility);

      await expect(page.getByRole("heading", { level: 1, name: "Veli Portalı" })).toBeVisible();
      await expect(page.getByLabel("Portal özeti")).toContainText("Kapalı");
      await expect(page.getByLabel("Ödeme planları").getByText("Ödeme görünümü kapalı.")).toBeVisible();
      await expect(page.getByText("500,00 TRY")).toHaveCount(0);
      await expect(page.getByText("Gizli ödeme planı")).toHaveCount(0);
      await expect.poll(() => paymentPlanRequests).toEqual([]);
    });
  }
});

async function openGuardianDetail(page: Page, role: TenantRole, capturedLinks: GuardianLinkBody[]) {
  const forbiddenBulkCalls = await installGuardianPrivacyMocks(page, role, capturedLinks);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/kurum/veliler/guardian-a");
  await expect(page.getByRole("heading", { level: 1, name: "Zeynep Veli" })).toBeVisible();
  return forbiddenBulkCalls;
}

async function openGuardianPortal(page: Page, visibility: "false" | "omitted") {
  const paymentPlanRequests = await installGuardianPortalPrivacyMocks(page, visibility);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/veli");
  return paymentPlanRequests;
}

async function installGuardianPrivacyMocks(page: Page, role: TenantRole, capturedLinks: GuardianLinkBody[]) {
  const links = [createGuardianLink("guardian-link-a", "student-a", true)];
  const forbiddenBulkCalls: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");

    if (path === "/auth/refresh") return fulfillData(route, createAuthResponse(role));
    if (path === "/me/tenant") return fulfillData(route, createTenantResponse());
    if (path === "/me/notification-devices") return fulfillData(route, []);
    if (route.request().method() === "GET" && (path === "/classes" || path === "/students")) {
      forbiddenBulkCalls.push(path);
      return fulfillData(route, []);
    }
    if (path === "/guardians/guardian-a" && route.request().method() === "GET") return fulfillData(route, createGuardian());

    if (path === "/guardians/guardian-a/student-details" && route.request().method() === "GET") {
      return fulfillData(route, createGuardianStudentDetails(links));
    }

    if (path === "/guardians/guardian-a/students" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as GuardianLinkBody;
      capturedLinks.push(body);
      links.push(createGuardianLink("guardian-link-created", body.studentId ?? "student-b", Boolean(body.isPrimary), body));
      return fulfillData(route, links.at(-1));
    }

    return fulfillData(route, []);
  });

  return forbiddenBulkCalls;
}

async function installGuardianPortalPrivacyMocks(page: Page, visibility: "false" | "omitted") {
  const paymentPlanRequests: string[] = [];

  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");

    if (path === "/auth/refresh") return fulfillData(route, createGuardianPortalAuthResponse());
    if (path === "/me/tenant") return fulfillData(route, createTenantResponse());
    if (path === "/me/notification-devices") return fulfillData(route, []);
    if (path === "/me/guardian/students") return fulfillData(route, [createStudents()[0]]);
    if (path === "/me/guardian/students/student-a/notification-preferences") {
      return fulfillData(route, createGuardianPortalPreferences(visibility));
    }
    if (path === "/me/guardian/students/student-a/profile") return fulfillData(route, createGuardianPortalProfile());
    if (path === "/courses") return fulfillData(route, [{ id: "course-math", name: "Matematik", tenantId: "tenant-guardian-privacy" }]);
    if (path === "/academic-terms") return fulfillData(route, [{ id: "term-2026-spring", name: "2. Donem", tenantId: "tenant-guardian-privacy" }]);
    if (path === "/me/guardian/students/student-a/attendance/summary") {
      return fulfillData(route, { absent: 0, excused: 0, late: 0, present: 1, studentId: "student-a", total: 1 });
    }
    if (path.includes("/payment-plans")) {
      paymentPlanRequests.push(path);
      return fulfillData(route, createPortalPaymentPlans());
    }
    if (path.includes("/reports/")) return fulfillData(route, null);

    return fulfillData(route, []);
  });

  return paymentPlanRequests;
}

function createAuthResponse(role: TenantRole) {
  return {
    accessToken: "guardian-privacy-access-token",
    session: {
      id: "session-guardian-privacy",
      membershipVersion: 1,
      roles: [role],
      status: "ACTIVE",
      tenantId: "tenant-guardian-privacy",
      userId: "user-guardian-privacy",
    },
  };
}

function createGuardianPortalAuthResponse() {
  return {
    accessToken: "guardian-portal-privacy-access-token",
    session: {
      id: "session-guardian-portal-privacy",
      membershipVersion: 1,
      roles: ["GUARDIAN"],
      status: "ACTIVE",
      subjectId: "guardian-a",
      subjectType: "GUARDIAN",
      tenantId: "tenant-guardian-privacy",
      userId: "guardian-a",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@veli-gizlilik.example",
    id: "tenant-guardian-privacy",
    institutionType: "Dershane",
    name: "Veli Gizlilik Akademi",
  };
}

function createGuardian() {
  return {
    firstName: "Zeynep",
    id: "guardian-a",
    lastName: "Veli",
    phone: "5554443322",
    tenantId: "tenant-guardian-privacy",
  };
}

function createStudents() {
  return [
    { classId: "class-8a", firstName: "Ada", id: "student-a", lastName: "Kaya", status: "ACTIVE", studentNo: "8001", tenantId: "tenant-guardian-privacy" },
    { classId: "class-8a", firstName: "Bora", id: "student-b", lastName: "Yılmaz", status: "ACTIVE", studentNo: "8002", tenantId: "tenant-guardian-privacy" },
  ];
}

function createClass() {
  return {
    campusId: "campus-main",
    gradeLevelId: "grade-8",
    id: "class-8a",
    level: "8",
    name: "8-A",
    section: "A",
    tenantId: "tenant-guardian-privacy",
  };
}

function createGuardianStudentDetails(links: ReturnType<typeof createGuardianLink>[]) {
  const linkedStudentIds = new Set(links.map((link) => link.studentId));
  const students = createStudents();
  return {
    availableStudents: students.filter((student) => !linkedStudentIds.has(student.id)).map(createStudentDetail),
    linkedStudents: students.filter((student) => linkedStudentIds.has(student.id)).map(createStudentDetail),
    links,
  };
}

function createStudentDetail(student: ReturnType<typeof createStudents>[number]) {
  return {
    classId: student.classId,
    className: createClass().name,
    firstName: student.firstName,
    hasPortalUser: false,
    id: student.id,
    lastName: student.lastName,
    status: student.status,
    studentNo: student.studentNo,
  };
}

function createGuardianPortalProfile() {
  return {
    campusName: "Merkez Kampüs",
    classId: "class-8a",
    className: "8-A",
    firstName: "Ada",
    gradeLevelName: "8. Sınıf",
    id: "student-a",
    lastName: "Kaya",
    section: "A",
    status: "ACTIVE",
    tenantId: "tenant-guardian-privacy",
  };
}

function createGuardianPortalPreferences(visibility: "false" | "omitted") {
  const preferences = createGuardianLink("guardian-link-a", "student-a", true, {
    canOpenSupportTickets: true,
    canReceiveAnnouncements: true,
    canReceiveSms: true,
  });
  if (visibility === "false") return { ...preferences, canViewFinance: false };
  return {
    canOpenSupportTickets: preferences.canOpenSupportTickets,
    canReceiveAnnouncements: preferences.canReceiveAnnouncements,
    canReceiveSms: preferences.canReceiveSms,
    guardianId: preferences.guardianId,
    id: preferences.id,
    isPrimary: preferences.isPrimary,
    relationshipType: preferences.relationshipType,
    studentId: preferences.studentId,
    tenantId: preferences.tenantId,
  };
}

function createPortalPaymentPlans() {
  return [
    {
      currency: "TRY",
      id: "payment-plan-a",
      installments: [{ amount: 50000, currency: "TRY", dueDate: "2026-07-01", id: "installment-a", installmentNo: 1, status: "PENDING" }],
      studentId: "student-a",
      tenantId: "tenant-guardian-privacy",
      title: "Gizli ödeme planı",
      totalAmount: 50000,
    },
  ];
}

function createGuardianLink(id: string, studentId: string, isPrimary: boolean, overrides: GuardianLinkBody = {}) {
  return {
    canOpenSupportTickets: overrides.canOpenSupportTickets ?? false,
    canReceiveAnnouncements: overrides.canReceiveAnnouncements ?? false,
    canReceiveSms: overrides.canReceiveSms ?? false,
    canViewFinance: overrides.canViewFinance ?? false,
    guardianId: "guardian-a",
    id,
    isPrimary,
    relationshipType: overrides.relationshipType ?? "MOTHER",
    studentId,
    tenantId: "tenant-guardian-privacy",
  };
}

async function fulfillData(route: Route, data: unknown) {
  await route.fulfill({
    body: JSON.stringify({ data }),
    headers: {
      ...corsHeadersFor(route),
      "content-type": "application/json",
    },
    status: 200,
  });
}

function corsHeadersFor(route: Route) {
  return {
    ...corsHeaders,
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}
