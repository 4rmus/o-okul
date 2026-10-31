import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const smsEnabled = process.env.NEXT_PUBLIC_SMS_ENABLED === "true";

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

type TenantRole = "ASSISTANT_ADMIN" | "TENANT_ADMIN";

/** KV-3e: the first `conflicts` link writes answer 409 GUARDIAN_LINK_CONCURRENT_UPDATE; later ones wait for `hold`. */
interface GuardianLinkWrites {
  conflicts: number;
  hold?: Promise<void>;
  requests: Array<{ body: string; idempotencyKey: string }>;
}

interface GuardianLinkBody {
  canOpenSupportTickets?: boolean;
  canReceiveAnnouncements?: boolean;
  canReceiveSms?: boolean;
  canViewFinance?: boolean;
  studentId?: string;
}

/** UAT F-30: `PATCH /guardians/:id/students/:studentId` calls captured with their headers. */
interface GuardianLinkPatch {
  body: GuardianLinkBody;
  idempotencyKey?: string;
  path: string;
}

/** UAT F-29: web push flag and the browser permission state the portal sees. */
interface PushMockOptions {
  enabled: boolean;
  permission: "default" | "denied" | "granted";
}

test.describe("Veli gizlilik ve izin UX'i", () => {
  test("veli bağlama hassas izinleri varsayılan kapalı gönderir", async ({ page }) => {
    const capturedLinks: GuardianLinkBody[] = [];
    const forbiddenBulkCalls = await openGuardianDetail(page, "TENANT_ADMIN", capturedLinks);
    await expect.poll(() => forbiddenBulkCalls).toEqual([]);

    const summary = page.getByRole("region", { exact: true, name: "Veli detay özeti" });
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
    if (smsEnabled) {
      await expect(relationshipRegion).toContainText("SMS kapalı");
    } else {
      await expect(relationshipRegion).not.toContainText("SMS");
    }
    await expect(relationshipRegion).toContainText("Duyuru kapalı");
    await expect(relationshipRegion).toContainText("Destek kapalı");

    await page.getByRole("tab", { name: "Öğrenci bağla", exact: true }).click();
    const linkRegion = page.getByLabel("Veli öğrenci bağı ekle");
    await expect(linkRegion.getByRole("checkbox", { name: /Finans görünürlüğü/ })).not.toBeChecked();
    await expect(linkRegion.getByRole("checkbox", { name: /SMS alabilir/ })).toHaveCount(smsEnabled ? 1 : 0);
    await expect(linkRegion.getByRole("checkbox", { name: /Duyuru görebilir/ })).not.toBeChecked();
    await expect(linkRegion.getByRole("checkbox", { name: /Destek talebi açabilir/ })).not.toBeChecked();

    await linkRegion.getByLabel("Öğrenci", { exact: true }).selectOption("student-b");
    await linkRegion.getByRole("button", { name: "Bağla" }).click();

    await expect.poll(() => capturedLinks.at(-1)).toMatchObject({
      canOpenSupportTickets: false,
      canReceiveAnnouncements: false,
      canReceiveSms: false,
      canViewFinance: false,
      studentId: "student-b",
    });
    await expect.poll(() => forbiddenBulkCalls).toEqual([]);
  });

  for (const viewport of [{ name: "masaüstü", width: 1280, height: 900 }, { name: "mobil", width: 390, height: 844 }]) {
    test(`eşzamanlı güncelleme 409'unda "Tekrar dene" bağlama isteğini aynı Idempotency-Key ile yeniden gönderir (KV-3e, ${viewport.name})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      let releaseRetry = () => {};
      const writes: GuardianLinkWrites = { conflicts: 1, hold: new Promise<void>((resolve) => { releaseRetry = resolve; }), requests: [] };
      const capturedLinks: GuardianLinkBody[] = [];
      await openGuardianDetail(page, "TENANT_ADMIN", capturedLinks, writes);

      await page.getByRole("tab", { name: "Öğrenci bağla", exact: true }).click();
      const linkRegion = page.getByLabel("Veli öğrenci bağı ekle");
      await linkRegion.getByLabel("Öğrenci", { exact: true }).selectOption("student-b");
      await linkRegion.getByRole("checkbox", { name: /Duyuru görebilir/ }).check();
      await linkRegion.getByRole("button", { name: "Bağla" }).click();

      const retry = linkRegion.getByRole("alert").getByRole("button", { name: "Tekrar dene" });
      await expect(retry).toBeVisible();
      await expect(linkRegion.getByRole("alert")).toContainText("eşzamanlı bir işlem");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      const box = await retry.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);

      await retry.click();
      await expect(retry).toBeDisabled();
      releaseRetry();

      await expect(retry).toHaveCount(0);
      // The list is refreshed: the new link shows up in the links tab.
      await page.getByRole("tab", { name: "Öğrenci bağlantıları", exact: true }).click();
      await expect(page.getByRole("table", { name: "Veli öğrenci bağlantıları" })).toContainText("Bora Yılmaz");
      expect(writes.requests).toHaveLength(2);
      expect(writes.requests[1]).toEqual(writes.requests[0]);
      expect(writes.requests[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(capturedLinks).toEqual([expect.objectContaining({ canReceiveAnnouncements: true, studentId: "student-b" })]);
    });
  }

  test("UAT F-03: bekleyen veli hesap daveti görünür ve iptal edilir", async ({ page }) => {
    const invitations = { pending: true, revoked: [] as string[], queries: [] as string[] };
    await openGuardianDetail(page, "TENANT_ADMIN", [], undefined, invitations);
    const region = page.getByRole("region", { name: "Veli hesap daveti" });
    await expect(region).toContainText("Hesap daveti bekliyor (z***@example.test).");
    await expect(page.getByRole("region", { name: "Veli detay özeti" })).toContainText("Davet bekliyor");
    await expect(page.locator("body")).not.toContainText("zeynep.veli@example.test");
    await region.getByRole("button", { name: "Daveti iptal et" }).click();
    await expect.poll(() => invitations.revoked).toEqual(["guardian-invitation-a"]);
    await expect(page.getByRole("region", { name: "Veli hesap daveti" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Veli detay özeti" })).toContainText("Hesap yok");
    // Only this guardian's invitations are requested, never the tenant-wide list.
    expect(new Set(invitations.queries)).toEqual(new Set(["guardian-a"]));
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

  test("UAT F-30: bağlı öğrencinin izinleri satırdan düzenlenir ve PATCH ile kaydedilir", async ({ page }) => {
    const patches: GuardianLinkPatch[] = [];
    await openGuardianDetail(page, "TENANT_ADMIN", [], undefined, undefined, patches);

    const table = page.getByRole("table", { name: "Veli öğrenci bağlantıları" });
    await expect(table).toContainText("Finans kapalı");
    await table.getByRole("button", { name: "Ada Kaya izinlerini düzenle" }).click();

    const dialog = page.getByRole("dialog", { name: "İzinleri düzenle" });
    await expect(dialog).toContainText("Ada Kaya için veli portalına açılan izinler");
    await expect(dialog.getByRole("checkbox", { name: /Finans görünürlüğü/ })).not.toBeChecked();
    await dialog.getByRole("checkbox", { name: /Finans görünürlüğü/ }).check();
    await dialog.getByRole("checkbox", { name: /Duyuru görebilir/ }).check();
    await dialog.getByRole("button", { name: "İzinleri kaydet" }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Ada Kaya izinleri güncellendi." })).toBeVisible();
    await expect(table).toContainText("Finans açık");
    await expect(table).toContainText("Duyuru açık");
    await expect(table).toContainText("Destek kapalı");

    expect(patches).toHaveLength(1);
    expect(patches[0]?.path).toBe("/guardians/guardian-a/students/student-a");
    expect(patches[0]?.body).toEqual({ canOpenSupportTickets: false, canReceiveAnnouncements: true, canReceiveSms: false, canViewFinance: true });
    // The PATCH sets values (idempotency inventory class C); the client sends no Idempotency-Key for it.
    expect(patches[0]?.idempotencyKey).toBeUndefined();

    // The link form explains that an existing link is edited from its row, not re-linked.
    await page.getByRole("tab", { name: "Öğrenci bağla", exact: true }).click();
    await expect(page.getByLabel("Veli öğrenci bağı ekle")).toContainText("Bağlı bir öğrencinin izinleri 'Öğrenci bağlantıları' sekmesindeki satırdan düzenlenir.");
  });

  test("UAT F-30: izin güncellemesi başarısız olursa diyalog açık kalır ve hata okunur", async ({ page }) => {
    const patches: GuardianLinkPatch[] = [];
    await openGuardianDetail(page, "TENANT_ADMIN", [], undefined, undefined, patches, { failPatch: 404 });

    await page.getByRole("table", { name: "Veli öğrenci bağlantıları" }).getByRole("button", { name: "Ada Kaya izinlerini düzenle" }).click();
    const dialog = page.getByRole("dialog", { name: "İzinleri düzenle" });
    await dialog.getByRole("checkbox", { name: /Destek talebi açabilir/ }).check();
    await dialog.getByRole("button", { name: "İzinleri kaydet" }).click();

    await expect(dialog.getByRole("alert")).toContainText("İzinler güncellenemedi; bağlantı silinmiş olabilir.");
    await expect(dialog).toBeVisible();
    expect(patches).toHaveLength(1);
    await expect(page.getByRole("table", { name: "Veli öğrenci bağlantıları" })).toContainText("Destek kapalı");
  });

  test("UAT F-29: push açık ve izin verilmemişken veli portalı push hatırlatması gösterir", async ({ page }) => {
    const { notificationDeviceRegistrations } = await openGuardianPortal(page, "false", { enabled: true, permission: "default" });

    const prompt = page.getByRole("status", { name: "Push bildirim hatırlatması" });
    await expect(prompt).toContainText("Push bildirimleri bu cihazda kapalı");
    await expect(prompt).toContainText("Bildirim cihazı");
    const enable = prompt.getByRole("button", { name: "Push iznini aç" });
    const box = await enable.boundingBox();
    expect(box && box.height >= 44).toBe(true);

    await enable.click();
    await expect(prompt).toContainText("Push açıldı; bu cihaz bildirim alacak.");
    await expect(prompt.getByRole("button", { name: "Push iznini aç" })).toHaveCount(0);
    expect(notificationDeviceRegistrations).toEqual([{ platform: "web", provider: "web-push" }]);
  });

  test("UAT F-29: izin zaten verilmişse push hatırlatması görünmez", async ({ page }) => {
    await openGuardianPortal(page, "false", { enabled: true, permission: "granted" });
    await expect(page.getByLabel("Bildirim tercihleri")).toBeVisible();
    await expect(page.getByLabel("Push bildirim hatırlatması")).toHaveCount(0);
    // The sidebar panel still exists for the device list; only the in-portal reminder is suppressed.
    await expect(page.getByLabel("Bildirim cihazı")).toBeVisible();
  });

  test("UAT F-29: web push bayrağı kapalıyken push hatırlatması görünmez", async ({ page }) => {
    await openGuardianPortal(page, "false", { enabled: false, permission: "default" });
    await expect(page.getByLabel("Bildirim tercihleri")).toBeVisible();
    await expect(page.getByLabel("Push bildirim hatırlatması")).toHaveCount(0);
  });

  for (const visibility of ["false", "omitted"] as const) {
    test(`veli portal finans izni ${visibility} iken ödeme verisi istemez`, async ({ page }) => {
      const { paymentPlanRequests } = await openGuardianPortal(page, visibility);

      await expect(page.getByRole("heading", { level: 1, name: "Veli Portalı" })).toBeVisible();
      await expect(page.getByLabel("Portal özeti")).toContainText("Kapalı");
      await expect(page.getByLabel("Ödeme planları").getByText("Ödeme görünümü kapalı.")).toBeVisible();
      await expect(page.getByText("500,00 TRY")).toHaveCount(0);
      await expect(page.getByText("Gizli ödeme planı")).toHaveCount(0);
      await expect.poll(() => paymentPlanRequests).toEqual([]);
    });
  }
});

async function openGuardianDetail(
  page: Page,
  role: TenantRole,
  capturedLinks: GuardianLinkBody[],
  writes?: GuardianLinkWrites,
  invitations?: GuardianInvitationMock,
  patches?: GuardianLinkPatch[],
  options: { failPatch?: number } = {},
) {
  const forbiddenBulkCalls = await installGuardianPrivacyMocks(page, role, capturedLinks, writes, invitations, patches, options);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/kurum/veliler/guardian-a");
  await expect(page.getByRole("heading", { level: 1, name: "Zeynep Veli" })).toBeVisible();
  return forbiddenBulkCalls;
}

async function openGuardianPortal(page: Page, visibility: "false" | "omitted", push?: PushMockOptions) {
  const mocks = await installGuardianPortalPrivacyMocks(page, visibility);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  if (push) {
    // The build under test has no NEXT_PUBLIC_WEB_PUSH_* values; the window overrides stand in for them,
    // and the browser APIs are doubled so no real permission prompt or service worker is involved.
    await page.addInitScript((options: PushMockOptions) => {
      Object.defineProperty(window, "__O_OKUL_WEB_PUSH_ENABLED__", { configurable: true, value: options.enabled ? "true" : "false" });
      Object.defineProperty(window, "__O_OKUL_WEB_PUSH_PUBLIC_KEY__", {
        configurable: true,
        value: "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      });
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: { permission: options.permission, requestPermission: async () => "granted" },
      });
      Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          register: async () => ({
            pushManager: {
              getSubscription: async () => null,
              subscribe: async () => ({ toJSON: () => ({ endpoint: "https://push.example/subscription", keys: { auth: "auth-key", p256dh: "p256dh-key" } }) }),
            },
          }),
        },
      });
    }, push);
  }
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto("/veli");
  await expect(page.getByRole("heading", { level: 1, name: "Veli Portalı" })).toBeVisible();
  return mocks;
}

interface GuardianInvitationMock {
  pending: boolean;
  revoked: string[];
  queries?: string[];
}

async function installGuardianPrivacyMocks(
  page: Page,
  role: TenantRole,
  capturedLinks: GuardianLinkBody[],
  writes?: GuardianLinkWrites,
  invitations?: GuardianInvitationMock,
  patches?: GuardianLinkPatch[],
  options: { failPatch?: number } = {},
) {
  let links = [createGuardianLink("guardian-link-a", "student-a")];
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
    if (path === "/identity-invitations" && route.request().method() === "GET") {
      invitations?.queries?.push(url.searchParams.get("subjectId") ?? "");
      return fulfillData(route, invitations?.pending ? [{
        id: "guardian-invitation-a", tenantId: "tenant-guardian-privacy", subjectType: "GUARDIAN", subjectId: "guardian-a",
        email: "zeynep.veli@example.test", name: "Zeynep Veli", role: "GUARDIAN", kind: "EMAIL_LINK", status: "PENDING",
        expiresAt: "2099-01-01T00:00:00.000Z", createdAt: "2026-10-15T10:00:00.000Z", updatedAt: "2026-10-15T10:00:00.000Z",
      }] : []);
    }
    if (path === "/identity-invitations/guardian-invitation-a/revoke" && route.request().method() === "POST" && invitations) {
      invitations.revoked.push("guardian-invitation-a");
      invitations.pending = false;
      return fulfillData(route, { id: "guardian-invitation-a", status: "REVOKED" });
    }

    if (path === "/guardians/guardian-a/student-details" && route.request().method() === "GET") {
      return fulfillData(route, createGuardianStudentDetails(links));
    }

    const patchMatch = route.request().method() === "PATCH" ? /^\/guardians\/guardian-a\/students\/([^/]+)$/.exec(path) : null;
    if (patchMatch) {
      const body = route.request().postDataJSON() as GuardianLinkBody;
      patches?.push({ body, idempotencyKey: route.request().headers()["idempotency-key"], path });
      if (options.failPatch) {
        return route.fulfill({
          body: JSON.stringify({ error: { code: "GUARDIAN_STUDENT_NOT_FOUND" } }),
          headers: { ...corsHeadersFor(route), "content-type": "application/json" },
          status: options.failPatch,
        });
      }
      const studentId = patchMatch[1] ?? "";
      links = links.map((link) => (link.studentId === studentId ? { ...link, ...body } : link));
      return fulfillData(route, links.find((link) => link.studentId === studentId));
    }

    if (path === "/guardians/guardian-a/students" && route.request().method() === "POST") {
      if (writes) {
        writes.requests.push({ body: route.request().postData() ?? "", idempotencyKey: route.request().headers()["idempotency-key"] ?? "" });
        if (writes.conflicts > 0) {
          writes.conflicts -= 1;
          return route.fulfill({
            body: JSON.stringify({ error: { code: "GUARDIAN_LINK_CONCURRENT_UPDATE", message: "Aynı kayıt üzerinde eşzamanlı bir işlem var, lütfen tekrar deneyin." } }),
            headers: { ...corsHeadersFor(route), "content-type": "application/json" },
            status: 409,
          });
        }
        await writes.hold;
      }
      const body = route.request().postDataJSON() as GuardianLinkBody;
      capturedLinks.push(body);
      links.push(createGuardianLink("guardian-link-created", body.studentId ?? "student-b", body));
      return fulfillData(route, links.at(-1));
    }

    return fulfillData(route, []);
  });

  return forbiddenBulkCalls;
}

async function installGuardianPortalPrivacyMocks(page: Page, visibility: "false" | "omitted") {
  const paymentPlanRequests: string[] = [];
  const notificationDeviceRegistrations: Array<{ platform?: string; provider?: string }> = [];

  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");

    if (path === "/auth/refresh") return fulfillData(route, createGuardianPortalAuthResponse());
    if (path === "/me/tenant") return fulfillData(route, createTenantResponse());
    if (path === "/me/notification-devices" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { platform?: string; provider?: string; token?: string };
      notificationDeviceRegistrations.push({ platform: body.platform, provider: body.provider });
      return fulfillData(route, { createdAt: "2026-10-31T09:00:00.000Z", id: "device-a", platform: "web", provider: "web-push", tenantId: "tenant-guardian-privacy", userId: "guardian-a" });
    }
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

  return { notificationDeviceRegistrations, paymentPlanRequests };
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
  const preferences = createGuardianLink("guardian-link-a", "student-a", {
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

function createGuardianLink(id: string, studentId: string, overrides: GuardianLinkBody = {}) {
  return {
    canOpenSupportTickets: overrides.canOpenSupportTickets ?? false,
    canReceiveAnnouncements: overrides.canReceiveAnnouncements ?? false,
    canReceiveSms: overrides.canReceiveSms ?? false,
    canViewFinance: overrides.canViewFinance ?? false,
    guardianId: "guardian-a",
    id,
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
