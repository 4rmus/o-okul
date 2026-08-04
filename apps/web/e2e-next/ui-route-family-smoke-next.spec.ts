import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers/horizontal-overflow.js";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const appDirectory = fileURLToPath(new URL("../app", import.meta.url));
const blockedA11yImpacts = new Set(["critical", "serious"]);
const routeViewports = [
  { height: 812, width: 320 },
  { height: 812, width: 375 },
  { height: 896, width: 414 },
  { height: 1024, width: 768 },
] as const;

type Persona = "anonymous" | "assistantAdmin" | "guardian" | "student" | "studentMustChangePassword" | "systemAdmin" | "teacher" | "tenantAdmin";

interface RouteCase {
  feature?: "sms";
  heading: string;
  persona: Persona;
  primaryTask: PrimaryTask;
  query?: string;
  routeTemplate: string;
}

interface PrimaryTask {
  name: string;
  role: "button" | "form" | "link" | "region";
}

const routeCases = [
  route("/", "Her öğrencinin gelişimini sınavdan sınava görün.", "anonymous", { role: "region", name: "Her öğrencinin gelişimini sınavdan sınava görün." }),
  route("/k/[tenantSlug]/giris", "Giriş", "anonymous", { role: "form", name: "Giriş formu" }),
  route("/giris", "Giriş", "anonymous", { role: "form", name: "Giriş formu" }),
  route("/login", "Giriş", "anonymous", { role: "form", name: "Giriş formu" }),
  route("/aktivasyon", "Hesabı etkinleştir", "anonymous", { role: "button", name: "Hesabı etkinleştir" }, { query: "token=activation-token" }),
  route("/parola-sifirla", "Yeni şifre", "anonymous", { role: "button", name: "Şifreyi yenile" }, { query: "token=reset-token" }),
  route("/parolami-unuttum", "Şifremi unuttum", "anonymous", { role: "button", name: "Yenileme bağlantısı gönder" }, { query: "tenant=dna-egitim" }),
  route("/sifre-degistir", "Şifre değiştir", "studentMustChangePassword", { role: "form", name: "Şifre değiştirme formu" }),
  route("/sistem/giris", "Giriş", "anonymous", { role: "form", name: "Giriş formu" }),

  route("/hesap/oturumlar", "Oturumlar", "tenantAdmin", { role: "region", name: "Aktif hesap oturumları kaydırma alanı" }),

  route("/kurum", "Route Smoke Akademi", "assistantAdmin", { role: "region", name: "Kurum başarı görünümü" }),
  route("/kurum/akademik-takvim", "Akademik Takvim", "assistantAdmin", { role: "region", name: "Akademik yıl yönetimi" }),
  route("/kurum/calisanlar", "Çalışanlar ve Yetkiler", "tenantAdmin", { role: "region", name: "Çalışan ve yetki görünümü" }),
  route("/kurum/canli-yayin", "Yayın Hazırlığı", "tenantAdmin", { role: "region", name: "Yayın öncesi kontroller" }),
  route("/kurum/denetim", "Denetim", "tenantAdmin", { role: "region", name: "Denetim kayıtları" }),
  route("/kurum/dersler", "Dersler", "assistantAdmin", { role: "region", name: "Ders yönetimi" }),
  route("/kurum/destek", "Destek", "assistantAdmin", { role: "region", name: "Destek bildirimi yönetimi" }),
  route("/kurum/devamsizlik", "Devamsızlık", "assistantAdmin", { role: "region", name: "Günlük sınıf yoklaması" }),
  route("/kurum/duyurular", "Duyurular", "assistantAdmin", { role: "region", name: "Duyuru yönetimi" }),
  route("/kurum/etutler", "Etütler", "assistantAdmin", { role: "region", name: "Etüt yönetimi" }),
  route("/kurum/finans", "Finans", "tenantAdmin", { role: "region", name: "Finans yönetimi" }),
  route("/kurum/gozlemlenebilirlik", "Sistem İzleme", "tenantAdmin", { role: "region", name: "Anlık sistem durumu" }),
  route("/kurum/guvenlik-denetimi", "Güvenlik Denetimi", "tenantAdmin", { role: "region", name: "Canlıya geçiş güvenlik kontrolleri" }),
  route("/kurum/kampusler", "Kampüsler", "assistantAdmin", { role: "region", name: "Kampüs yönetimi" }),
  route("/kurum/kazanimlar", "Kazanımlar", "assistantAdmin", { role: "region", name: "Kazanım yönetimi" }),
  route("/kurum/kullanicilar", "Kullanıcılar", "tenantAdmin", { role: "region", name: "Kullanıcı ve rol yönetimi" }),
  route("/kurum/lisans-donemleri", "Lisans Dönemleri", "tenantAdmin", { role: "region", name: "Lisans dönemleri" }),
  route("/kurum/kurulum", "Kurulum Sihirbazı", "assistantAdmin", { role: "region", name: "Kurulum formu" }),
  route("/kurum/kvkk", "KVKK", "tenantAdmin", { role: "region", name: "KVKK yönetimi" }),
  route("/kurum/materyaller", "Materyaller", "assistantAdmin", { role: "region", name: "Ödev kontrolü" }),
  route("/kurum/notlar", "Öğretmen Notları", "assistantAdmin", { role: "region", name: "Öğretmen notu yönetimi" }),
  route("/kurum/ogrenci-portal-erisimi", "Öğrenci Portal Erişimi", "tenantAdmin", { role: "region", name: "Öğrenci portal erişimi" }),
  route("/kurum/ogrenciler", "Öğrenciler", "assistantAdmin", { role: "region", name: "Öğrenci yönetimi" }),
  route("/kurum/ogrenciler/[studentId]", "Ada Test", "assistantAdmin", { role: "region", name: "Öğrenci dashboard" }),
  route("/kurum/ogrenciler/[studentId]/sinavlar", "Ada Test", "assistantAdmin", { role: "region", name: "Öğrenci sınav detayları" }),
  route("/kurum/ogretmenler", "Öğretmenler", "assistantAdmin", { role: "region", name: "Öğretmen yönetimi" }),
  route("/kurum/ogretmenler/[teacherId]", "Zeynep Test", "assistantAdmin", { role: "region", name: "Öğretmen detayı" }),
  route("/kurum/optik", "Optik İşlemleri", "assistantAdmin", { role: "region", name: "Optik iş akışı" }),
  route("/kurum/program", "Ders Programı", "assistantAdmin", { role: "region", name: "Ders programı yönetimi" }),
  route("/kurum/raporlar", "Sınav Raporu", "assistantAdmin", { role: "region", name: "Rapor çalışma alanı" }),
  route("/kurum/rol-onizleme", "Rol Önizleme", "tenantAdmin", { role: "region", name: "Rol görünüm önizleme" }),
  route("/kurum/sablonlar", "Şablonlar", "assistantAdmin", { role: "region", name: "Şablon yönetimi" }, { feature: "sms" }),
  route("/kurum/seviyeler", "Seviyeler", "assistantAdmin", { role: "region", name: "Seviye yönetimi" }),
  route("/kurum/sinavlar", "Sınavlar", "assistantAdmin", { role: "region", name: "Sınav yönetimi" }),
  route("/kurum/siniflar", "Sınıflar", "assistantAdmin", { role: "region", name: "Sınıf yönetimi" }),
  route("/kurum/siniflar/[classId]", "8-A", "assistantAdmin", { role: "region", name: "Sınıf detayı" }),
  route("/kurum/sistem-sagligi", "Sistem Sağlığı", "tenantAdmin", { role: "region", name: "Sistem bağlantıları ve kullanım durumu" }),
  route("/kurum/uat-rollback", "Kullanıcı Kabulü ve Geri Dönüş", "tenantAdmin", { role: "region", name: "Yayın öncesi kontroller" }),
  route("/kurum/veliler", "Veliler", "assistantAdmin", { role: "region", name: "Veli yönetimi" }),
  route("/kurum/veliler/[guardianId]", "Veli Test", "assistantAdmin", { role: "region", name: "Veli detayı" }),
  route("/kurum/yedek-restore", "Yedek / Restore", "tenantAdmin", { role: "region", name: "Yedek restore kapıları" }),

  route("/sistem", "Sistem Paneli", "systemAdmin", { role: "region", name: "Sistem özeti" }),
  route("/sistem/denetim", "Denetim", "systemAdmin", { role: "region", name: "Denetim referans kontrol listesi" }),
  route("/sistem/gozlemlenebilirlik", "Sistem İzleme", "systemAdmin", { role: "region", name: "Sistem İzleme referans kontrol listesi" }),
  route("/sistem/kurumlar", "Kurumlar", "systemAdmin", { role: "region", name: "Kurum yönetimi" }),
  route("/sistem/kurumlar/[tenantId]", "Route Smoke Akademi", "systemAdmin", { role: "region", name: "Kurum detayı" }),
  route("/sistem/sistem-sagligi", "Sistem Sağlığı", "systemAdmin", { role: "region", name: "Sistem Sağlığı referans kontrol listesi" }),

  route("/ogrenci", "Öğrenci Portalı", "student", { role: "region", name: "Öğrenci günlük aksiyonları" }),
  route("/ogrenci/destek", "Öğrenci Portalı", "student", { role: "region", name: "Destek talepleri" }),
  route("/ogrenci/devamsizlik", "Öğrenci Portalı", "student", { role: "region", name: "Devamsızlık" }),
  route("/ogrenci/duyurular", "Öğrenci Portalı", "student", { role: "region", name: "Duyurular" }),
  route("/ogrenci/odevler", "Öğrenci Portalı", "student", { role: "region", name: "Ödevler" }),
  route("/ogrenci/profil", "Öğrenci Portalı", "student", { role: "region", name: "Profil" }),
  route("/ogrenci/raporlar", "Öğrenci Portalı", "student", { role: "region", name: "Portal rapor özeti" }, { query: "examId=exam-demo-isem-lgs-1&studentId=student-a" }),

  route("/ogretmen", "Öğretmen Portalı", "teacher", { role: "region", name: "Öğretmen günlük aksiyonları" }),
  route("/ogretmen/ders-akisi", "Öğretmen Portalı", "teacher", { role: "region", name: "Bugünkü dersler" }),
  route("/ogretmen/destek", "Öğretmen Portalı", "teacher", { role: "region", name: "Destek talepleri" }),
  route("/ogretmen/duyurular", "Öğretmen Portalı", "teacher", { role: "region", name: "Duyurular" }),
  route("/ogretmen/odevler", "Öğretmen Portalı", "teacher", { role: "region", name: "Öğretmen ödev kontrolü" }),
  route("/ogretmen/ogrenci-takibi", "Öğretmen Portalı", "teacher", { role: "region", name: "Öğretmen öğrenci kapsamı" }),
  route("/ogretmen/raporlar", "Öğretmen Portalı", "teacher", { role: "region", name: "Portal rapor özeti" }, { query: "examId=exam-demo-isem-lgs-1&studentId=student-a" }),

  route("/veli", "Veli Portalı", "guardian", { role: "region", name: "Veli günlük aksiyonları" }),
  route("/veli/bildirimler", "Veli Portalı", "guardian", { role: "region", name: "Bildirim tercihleri" }),
  route("/veli/destek", "Veli Portalı", "guardian", { role: "region", name: "Destek talepleri" }),
  route("/veli/duyurular", "Veli Portalı", "guardian", { role: "region", name: "Duyurular" }),
  route("/veli/odemeler", "Veli Portalı", "guardian", { role: "region", name: "Ödeme planları" }),
  route("/veli/odevler", "Veli Portalı", "guardian", { role: "region", name: "Ödevler" }),
  route("/veli/ogrenci", "Veli Portalı", "guardian", { role: "region", name: "Seçili öğrenci özeti" }),
  route("/veli/raporlar", "Veli Portalı", "guardian", { role: "region", name: "Portal rapor özeti" }, { query: "examId=exam-demo-isem-lgs-1&studentId=student-a" }),
] satisfies RouteCase[];

assertRouteManifestParity(routeCases);

test.describe("UI route family smoke", () => {
  test.describe.configure({ mode: "parallel" });

  for (const routeCase of routeCases) {
    test(`${routeCase.routeTemplate} dört zorunlu viewport'ta görev ve UX sözleşmesini korur`, async ({ page }) => {
      test.setTimeout(120_000);
      const unknownApiRequests: string[] = [];
      await installRouteApiMocks(page, routeCase.persona, unknownApiRequests);
      await page.addInitScript(() => {
        document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
      });
      await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);

      const resolvedPath = resolveRouteTemplate(routeCase.routeTemplate);
      for (const viewport of routeViewports) {
        await page.setViewportSize(viewport);
        const targetPath = routeCase.query ? `${resolvedPath}?${routeCase.query}` : resolvedPath;
        await page.goto(targetPath, { waitUntil: "domcontentloaded" });

        const featureRedirected = routeCase.feature === "sms" && process.env.NEXT_PUBLIC_SMS_ENABLED !== "true";
        await expect(page).toHaveURL((url) =>
          url.pathname === (featureRedirected ? "/kurum" : resolvedPath)
          && (featureRedirected || !routeCase.query || url.searchParams.toString() === routeCase.query),
        );
        await expect(page, contractLabel(routeCase, viewport, "document title")).toHaveTitle(/\S/);
        const expectedHeading = featureRedirected ? "Route Smoke Akademi" : routeCase.heading;
        const expectedTask = featureRedirected
          ? { role: "region" as const, name: "Kurum başarı görünümü" }
          : routeCase.primaryTask;
        const main = page.locator("main:visible");

        await expect(main, contractLabel(routeCase, viewport, "visible main")).toHaveCount(1);
        await expect(main.locator("h1:visible"), contractLabel(routeCase, viewport, "visible h1")).toHaveCount(1);
        await expect(main.getByRole("heading", { level: 1, name: expectedHeading, exact: true })).toBeVisible();
        await expect(
          main.getByRole(expectedTask.role, { name: expectedTask.name, exact: true }),
          contractLabel(routeCase, viewport, "primary task"),
        ).toBeVisible();
        await expectBusyStateToFinish(page, routeCase, viewport);
        await expectNoHorizontalOverflow(page, `${routeCase.routeTemplate}-${viewport.width}`);
        await expectNoClippedVisibleText(page, routeCase, viewport);
        await expectNoUnlabeledControls(page, routeCase, viewport);
        await expectClickableTextOnOneLine(page, routeCase, viewport);
        await expectNoHighImpactA11yViolations(page, routeCase, viewport);
        expect(unknownApiRequests, contractLabel(routeCase, viewport, "unhandled /api/v1 request")).toEqual([]);
      }
    });
  }
});

test("öğrenci portal erişimi eylemi expectedVersion gönderir ve sonucu yeniler", async ({ page }) => {
  const unknownApiRequests: string[] = [];
  const portalAccess = createPortalAccessMock();
  await installRouteApiMocks(page, "tenantAdmin", unknownApiRequests, { portalAccess });
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  page.on("dialog", (dialog) => void dialog.accept());

  await page.goto("/kurum/ogrenci-portal-erisimi", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Ada A: Portal erişimini askıya al" }).click();

  await expect.poll(() => portalAccess.lastRequest).toEqual({ expectedVersion: 1, status: "SUSPENDED" });
  await expect(page.getByText("Askıda", { exact: true })).toBeVisible();
  expect(unknownApiRequests).toEqual([]);
});

test("öğrenci portal aktivasyon kodunu yalnız sonuç penceresinde gösterir", async ({ page }) => {
  const unknownApiRequests: string[] = [];
  const portalAccess = createPortalAccessMock();
  portalAccess.record.accessState = "NOT_INVITED";
  portalAccess.record.userId = undefined;
  portalAccess.record.accountStatus = undefined;
  portalAccess.record.membership = undefined;
  portalAccess.record.activeSessionCount = 0;
  await installRouteApiMocks(page, "tenantAdmin", unknownApiRequests, { portalAccess });
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);

  await page.goto("/kurum/ogrenci-portal-erisimi", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Ada A: Aktivasyon kodu üret" }).click();

  await expect(page.getByRole("dialog", { name: "Öğrenci aktivasyon kodu" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "12 karakterlik kod" })).toHaveValue("ABCDEFGHJKL2");
  expect(portalAccess.invitationIssued).toBe(true);
  await page.getByRole("button", { name: "Tamam" }).click();
  await expect(page.getByText("ABCDEFGHJKL2")).toHaveCount(0);
  expect(unknownApiRequests).toEqual([]);
});

function route(
  routeTemplate: string,
  heading: string,
  persona: Persona,
  primaryTask: PrimaryTask,
  options: Pick<RouteCase, "feature" | "query"> = {},
): RouteCase {
  return { ...options, heading, persona, primaryTask, routeTemplate };
}

function resolveRouteTemplate(routeTemplate: string) {
  const resolved = routeTemplate
    .replace("[tenantSlug]", "dna-egitim")
    .replace("[tenantId]", "tenant-faz9")
    .replace("[studentId]", "student-a")
    .replace("[teacherId]", "teacher-math")
    .replace("[guardianId]", "guardian-mother")
    .replace("[classId]", "class-8a")
    .replace("[examId]", "exam-demo-isem-lgs-1");
  if (resolved.includes("[")) throw new Error(`Unresolved route parameter: ${routeTemplate}`);
  return resolved;
}

function assertRouteManifestParity(manifest: readonly RouteCase[]) {
  const fileSystemRoutes = collectPageRoutes(appDirectory).sort();
  const manifestRoutes = manifest.map((entry) => entry.routeTemplate).sort();
  const duplicates = manifestRoutes.filter((routeTemplate, index) => manifestRoutes.indexOf(routeTemplate) !== index);
  if (manifest.length !== 79) throw new Error(`Route manifest must contain exactly 79 entries; found ${manifest.length}.`);
  if (duplicates.length > 0) throw new Error(`Route manifest contains duplicates: ${[...new Set(duplicates)].join(", ")}`);
  if (JSON.stringify(manifestRoutes) !== JSON.stringify(fileSystemRoutes)) {
    throw new Error(`Route manifest does not match page.tsx inventory.\nmanifest=${manifestRoutes.join(",")}\nfilesystem=${fileSystemRoutes.join(",")}`);
  }
  for (const entry of manifest) resolveRouteTemplate(entry.routeTemplate);
}

function collectPageRoutes(directory: string, segments: string[] = []): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nextSegments = entry.name.startsWith("(") && entry.name.endsWith(")") ? segments : [...segments, entry.name];
      routes.push(...collectPageRoutes(`${directory}/${entry.name}`, nextSegments));
    } else if (entry.name === "page.tsx") {
      routes.push(segments.length === 0 ? "/" : `/${segments.join("/")}`);
    }
  }
  return routes;
}

async function installRouteApiMocks(
  page: Page,
  persona: Persona,
  unknownApiRequests: string[],
  options: { portalAccess?: ReturnType<typeof createPortalAccessMock> } = {},
) {
  await page.route("**/health/ready", async (route) => {
    await fulfillJson(route, { dependencies: { postgres: "ok", redis: "ok" }, status: "ready" });
  });
  await page.route("**/health", async (route) => {
    await fulfillJson(route, { status: "ok" });
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(request.url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    if (pathName === "/auth/refresh") {
      if (persona === "anonymous") {
        await fulfillJson(route, { code: "UNAUTHENTICATED", message: "Authentication required" }, 401);
      } else {
        await fulfillData(route, createAuthResponse(persona));
      }
      return;
    }
    if (pathName === "/me/profile" && request.method() === "GET" && persona !== "anonymous") {
      const session = createAuthResponse(persona).session;
      await fulfillData(route, {
        userId: session.userId,
        tenantId: session.tenantId ?? null,
        roles: session.roles,
        mustChangePassword: "mustChangePassword" in session ? session.mustChangePassword : false,
        subjectType: "subjectType" in session ? session.subjectType : undefined,
        subjectId: "subjectId" in session ? session.subjectId : undefined,
        capabilities: [],
      });
      return;
    }

    if (options.portalAccess && pathName === "/students/portal-access" && request.method() === "GET") {
      await fulfillData(route, [options.portalAccess.record], { limit: 20 });
      return;
    }
    if (options.portalAccess && pathName === "/students/student-a/portal-access" && request.method() === "PATCH") {
      const body = request.postDataJSON() as { expectedVersion: number; status: "ACTIVE" | "SUSPENDED" };
      const membership = options.portalAccess.record.membership;
      if (!membership) throw new Error("PORTAL_ACCESS_MEMBERSHIP_FIXTURE_MISSING");
      options.portalAccess.lastRequest = body;
      membership.status = body.status;
      membership.version += 1;
      options.portalAccess.record.accountStatus = body.status === "ACTIVE" ? "ACTIVE" : "DISABLED";
      options.portalAccess.record.accessState = body.status;
      await fulfillData(route, {
        studentId: options.portalAccess.record.studentId,
        tenantId: options.portalAccess.record.tenantId,
        userId: options.portalAccess.record.userId,
        accountStatus: options.portalAccess.record.accountStatus,
        membership,
        sessionsRevoked: 1,
      });
      return;
    }
    if (options.portalAccess && pathName === "/students/student-a/portal-invitations" && request.method() === "POST") {
      options.portalAccess.invitationIssued = true;
      options.portalAccess.record.accessState = "INVITED";
      options.portalAccess.record.invitation = {
        id: "student-code-invitation",
        kind: "STUDENT_CODE",
        status: "PENDING",
        expiresAt: "2026-08-02T12:00:00.000Z",
      };
      await fulfillData(route, {
        invitationId: "student-code-invitation",
        studentId: "student-a",
        tenantSlug: "dna-egitim",
        studentNo: "100",
        activationCode: "ABCDEFGHJKL2",
        activationUrl: "http://localhost:3000/aktivasyon#tenant=dna-egitim&student=100&code=ABCDEFGHJKL2",
        expiresAt: "2026-08-02T12:00:00.000Z",
      });
      return;
    }

    if (request.method() !== "GET") {
      unknownApiRequests.push(`${request.method()} ${pathName}${url.search}`);
      await fulfillJson(route, { code: "UNHANDLED_ROUTE_SMOKE_API", path: pathName }, 501);
      return;
    }

    const response = responseForApi(pathName, url.searchParams);
    if (response) {
      await fulfillData(route, response.data, response.meta);
      return;
    }

    unknownApiRequests.push(`${request.method()} ${pathName}${url.search}`);
    await fulfillJson(route, { code: "UNHANDLED_ROUTE_SMOKE_API", path: pathName }, 501);
  });
}

function createPortalAccessMock() {
  return {
    invitationIssued: false,
    lastRequest: undefined as { expectedVersion: number; status: "ACTIVE" | "SUSPENDED" } | undefined,
    record: {
      studentId: "student-a",
      tenantId: "tenant-a",
      studentNo: "100",
      firstName: "Ada",
      lastName: "A",
      studentStatus: "ACTIVE" as const,
      accessState: "ACTIVE" as "ACTIVE" | "SUSPENDED" | "INVITED" | "NOT_INVITED",
      userId: "student-tenant-a" as string | undefined,
      accountStatus: "ACTIVE" as string | undefined,
      membership: { id: "membership-student-a", status: "ACTIVE" as "ACTIVE" | "SUSPENDED", version: 1 } as { id: string; status: "ACTIVE" | "SUSPENDED"; version: number } | undefined,
      invitation: undefined as { id: string; kind: "STUDENT_CODE"; status: "PENDING"; expiresAt: string } | undefined,
      activeSessionCount: 1,
    },
  };
}

function responseForApi(pathName: string, searchParams: URLSearchParams): ApiFixtureResponse | undefined {
  if (pathName === "/me/sessions") {
    return {
      data: [{
        id: "session-tenantAdmin",
        activePersona: "STAFF",
        deviceLabel: "Chrome · macOS",
        clientIpPrefix: "203.0.113.0/24",
        roles: ["TENANT_ADMIN"],
        status: "ACTIVE",
        current: true,
        expiresAt: "2026-08-31T12:00:00.000Z",
        lastSeenAt: "2026-08-01T12:00:00.000Z",
        createdAt: "2026-08-01T09:00:00.000Z",
        updatedAt: "2026-08-01T12:00:00.000Z",
      }],
    };
  }
  if (pathName === "/me/tenant") return { data: tenantFixture };
  if (pathName === "/me/institution-dashboard") {
    return {
      data: {
        generatedAt: "2026-07-30T09:00:00.000Z",
        institution: { name: tenantFixture.name, institutionType: tenantFixture.institutionType },
        activeStudentCount: 1,
        attention: {
          attendanceAlertCount: 0,
          openImportQuarantineCount: 0,
          openSupportTicketCount: 0,
        },
      },
    };
  }
  if (pathName === "/me/notification-devices") return { data: [] };
  if (pathName === "/import-quarantines/summary") return { data: { openCount: 0 } };
  if (pathName === "/attendance/summary" || pathName === "/me/student/attendance/summary" || pathName === "/me/guardian/students/student-a/attendance/summary") {
    return { data: { absent: 0, excused: 0, late: 0, present: 0, studentId: "student-a", total: 0 } };
  }
  if (pathName === "/attendance/daily") {
    return {
      data: {
        classId: searchParams.get("classId") ?? "class-8a",
        date: searchParams.get("date") ?? "2026-07-30",
        records: [],
        students: [studentFixture],
        summary: { absent: 0, excused: 0, late: 0, present: 0, total: 0, unmarked: 1 },
      },
    };
  }

  if (pathName === "/classes/class-8a") return { data: classFixture };
  if (pathName === "/teachers/teacher-math") return { data: teacherFixture };
  if (pathName === "/teachers/teacher-math/assignments") return { data: [] };
  if (pathName === "/guardians/guardian-mother") return { data: guardianFixture };
  if (pathName === "/guardians/guardian-mother/student-details") {
    return { data: { availableStudents: [], linkedStudents: [studentFixture], links: [guardianLinkFixture] } };
  }
  if (pathName === "/students/student-a/profile" || pathName === "/me/student/profile" || pathName === "/me/guardian/students/student-a/profile") {
    return { data: studentProfileFixture };
  }
  if (pathName === "/students/student-a/guardians" || pathName === "/me/student/guardians") return { data: [guardianFixture] };
  if (pathName === "/students/student-a/guardian-links" || pathName === "/me/student/guardian-links") return { data: [guardianLinkFixture] };
  if (pathName === "/students/student-a/enrollments" || pathName === "/me/student/enrollments" || pathName === "/me/teacher/students/student-a/enrollments" || pathName === "/me/guardian/students/student-a/enrollments") {
    return { data: [] };
  }
  if (pathName === "/students/student-a/teacher-assignments") return { data: [] };
  if (pathName === "/students/student-a/class-history" || pathName === "/me/student/class-history" || pathName === "/me/guardian/students/student-a/class-history") {
    return { data: [] };
  }
  if (pathName === "/audit-logs/student-summary") return { data: [] };

  if (pathName === "/me/teacher") return { data: teacherFixture };
  if (pathName === "/me/teacher/lookups") {
    return {
      data: {
        attendanceClassIds: ["class-8a"],
        campuses: [campusFixture],
        classes: [classFixture],
        courses: [courseFixture],
        gradeLevels: [gradeLevelFixture],
        terms: [termFixture],
      },
    };
  }
  if (pathName === "/me/guardian/students") return { data: [studentFixture] };
  if (pathName === "/me/guardian/students/student-a/notification-preferences") return { data: guardianLinkFixture };
  if (pathName === "/students/portal-access") return { data: [createPortalAccessMock().record], meta: { limit: 20 } };

  const portalArrayPaths = new Set([
    "/me/student/announcements",
    "/me/student/attendance",
    "/me/student/development-assessments",
    "/me/student/homework/material-assignments",
    "/me/student/reports",
    "/me/student/support-tickets",
    "/me/student/teacher-notes",
    "/me/teacher/announcements",
    "/me/teacher/attendance",
    "/me/teacher/homework",
    "/me/teacher/homework/material-assignments",
    "/me/teacher/homework/materials",
    "/me/teacher/reports",
    "/me/teacher/schedule",
    "/me/teacher/students",
    "/me/teacher/support-tickets",
    "/me/teacher/teacher-notes",
    "/me/guardian/homework/material-assignments",
    "/me/guardian/students/student-a/announcements",
    "/me/guardian/students/student-a/attendance",
    "/me/guardian/students/student-a/development-assessments",
    "/me/guardian/students/student-a/homework/material-assignments",
    "/me/guardian/students/student-a/payment-plans",
    "/me/guardian/students/student-a/reports",
    "/me/guardian/students/student-a/support-tickets",
    "/me/guardian/students/student-a/teacher-notes",
  ]);
  if (portalArrayPaths.has(pathName)) return { data: [] };

  const directArrays: Record<string, unknown[]> = {
    "/academic-terms": [termFixture],
    "/academic-years": [],
    "/alanlar": [],
    "/announcements": [],
    "/attendance": [],
    "/audit-logs": [],
    "/audit-logs/safe-list": [],
    "/backup-restore-jobs": [],
    "/campuses": [campusFixture],
    "/classes": [classFixture],
    "/courses": [courseFixture],
    "/employees": [],
    "/exams": [],
    "/grade-level-course-templates": [],
    "/grade-levels": [gradeLevelFixture],
    "/guardians": [guardianFixture],
    "/homework": [],
    "/homework/material-assignments": [],
    "/homework/materials": [],
    "/learning-outcomes": [],
    "/message-templates": [],
    "/optical-form-templates": [],
    "/payment-plans": [],
    "/privacy/inventory": [],
    "/schedule-lessons": [],
    "/students": [studentFixture],
    "/study-sessions": [],
    "/support-tickets": [],
    "/teacher-notes": [],
    "/teachers": [teacherFixture],
    "/tenant-users": [],
    "/tenants/current/license-terms": [],
    "/tenants": [tenantFixture],
  };
  if (pathName in directArrays) {
    const data = directArrays[pathName] ?? [];
    return { data, meta: listMeta(searchParams, data.length) };
  }
  if (pathName === "/tenants/tenant-faz9") return { data: tenantFixture };

  if (/^\/exams\/[^/]+\/participants$/.test(pathName)) return { data: [] };
  if (/^\/grade-levels\/[^/]+\/courses$/.test(pathName)) return { data: [] };
  if (/^\/exams\/[^/]+\/reports\/(?:students\/[^/]+\/)?snapshots$/.test(pathName)) return { data: [] };
  if (/^\/exams\/[^/]+\/reports\/students\/[^/]+\/progress$/.test(pathName)) return { data: emptyProgressFixture };
  if (/^\/me\/(?:student|teacher)\/reports\/[^/]+\/snapshots$/.test(pathName)) return { data: [] };
  if (/^\/me\/student\/reports\/[^/]+\/progress$/.test(pathName)) return { data: emptyProgressFixture };
  if (/^\/me\/guardian\/students\/student-a\/reports\/[^/]+\/progress$/.test(pathName)) return { data: emptyProgressFixture };

  return undefined;
}

function createAuthResponse(persona: Exclude<Persona, "anonymous">) {
  const profiles = {
    assistantAdmin: { roles: ["ASSISTANT_ADMIN"], userId: "user-assistant" },
    guardian: { roles: ["GUARDIAN"], subjectId: "guardian-mother", subjectType: "GUARDIAN", userId: "user-guardian" },
    student: { roles: ["STUDENT"], subjectId: "student-a", subjectType: "STUDENT", userId: "user-student" },
    studentMustChangePassword: { mustChangePassword: true, roles: ["STUDENT"], subjectId: "student-a", subjectType: "STUDENT", userId: "user-student" },
    systemAdmin: { roles: ["SYSTEM_ADMIN"], userId: "user-system" },
    teacher: { roles: ["TEACHER"], subjectId: "teacher-math", subjectType: "TEACHER", userId: "user-teacher" },
    tenantAdmin: { roles: ["TENANT_ADMIN"], userId: "user-tenant-admin" },
  } as const;
  const profile = profiles[persona];
  return {
    accessToken: "route-smoke-access-token",
    session: {
      id: `session-${persona}`,
      membershipVersion: 1,
      status: "ACTIVE",
      ...(persona === "systemAdmin" ? {} : { tenantId: "tenant-faz9" }),
      ...profile,
    },
  };
}

const tenantFixture = {
  activeSeatCount: 1,
  id: "tenant-faz9",
  institutionType: "Dershane",
  name: "Route Smoke Akademi",
  plan: "ENTERPRISE",
  seatLimit: 10,
  slug: "dna-egitim",
  status: "ACTIVE",
};
const campusFixture = { id: "campus-main", name: "Ana Kampüs", tenantId: "tenant-faz9" };
const gradeLevelFixture = { code: "8", id: "grade-8", name: "8. Sınıf", tenantId: "tenant-faz9" };
const courseFixture = { code: "MAT", id: "course-math", name: "Matematik", tenantId: "tenant-faz9" };
const termFixture = {
  academicYearId: "year-2026",
  endsAt: "2027-01-15T00:00:00.000Z",
  id: "term-2026",
  isActive: true,
  name: "2026 Güz",
  startsAt: "2026-09-01T00:00:00.000Z",
  tenantId: "tenant-faz9",
};
const classFixture = {
  campusId: "campus-main",
  gradeLevelId: "grade-8",
  id: "class-8a",
  name: "8-A",
  section: "A",
  tenantId: "tenant-faz9",
};
const studentFixture = {
  classId: "class-8a",
  firstName: "Ada",
  id: "student-a",
  lastName: "Test",
  status: "ACTIVE",
  studentNo: "TEST-001",
  tenantId: "tenant-faz9",
};
const studentProfileFixture = {
  ...studentFixture,
  email: "masked@example.test",
  phone: "MASKED_PHONE",
};
const teacherFixture = {
  branch: "Matematik",
  firstName: "Zeynep",
  id: "teacher-math",
  lastName: "Test",
  tenantId: "tenant-faz9",
  userId: "user-teacher",
};
const guardianFixture = {
  firstName: "Veli",
  id: "guardian-mother",
  lastName: "Test",
  phone: "MASKED_PHONE",
  tenantId: "tenant-faz9",
  userId: "user-guardian",
};
const guardianLinkFixture = {
  canOpenSupportTickets: true,
  canReceiveAnnouncements: true,
  canReceiveSms: false,
  canViewFinance: true,
  guardianId: "guardian-mother",
  id: "guardian-link",
  studentId: "student-a",
  tenantId: "tenant-faz9",
};
const emptyProgressFixture = {
  examId: "exam-demo-isem-lgs-1",
  netDelta: 0,
  points: [],
  standardScoreDelta: 0,
  studentId: "student-a",
  successRateDelta: 0,
  tenantId: "tenant-faz9",
};

interface ApiFixtureResponse {
  data: unknown;
  meta?: { limit: number; nextCursor?: string; previousCursor?: string } | { limit: number; page: number; total: number; totalPages: number };
}

function listMeta(searchParams: URLSearchParams, total: number) {
  const limit = Number(searchParams.get("limit") ?? Math.max(total, 1));
  const page = Number(searchParams.get("page") ?? 1);
  return { limit, page, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) };
}

async function fulfillData(route: Route, data: unknown, meta?: ApiFixtureResponse["meta"]) {
  await fulfillJson(route, meta ? { data, meta } : { data });
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify(body),
    headers: { ...corsHeadersFor(route), "content-type": "application/json" },
    status,
  });
}

function corsHeadersFor(route: Route) {
  return {
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "authorization,content-type,x-csrf-token,x-role-preview-token",
    "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
    "access-control-allow-origin": route.request().headers().origin ?? appOrigin,
  };
}

async function expectBusyStateToFinish(
  page: Page,
  routeCase: RouteCase,
  viewport: (typeof routeViewports)[number],
) {
  await expect(page.locator('[aria-busy="true"]:visible, .uh-chart-loading:visible, .uh-loading-state:visible'), contractLabel(routeCase, viewport, "busy state")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(/^(Yükleniyor|Hazırlanıyor)(?:…|\.\.\.)?$/).filter({ visible: true }), contractLabel(routeCase, viewport, "loading text")).toHaveCount(0, { timeout: 15_000 });
}

async function expectNoUnlabeledControls(
  page: Page,
  routeCase: RouteCase,
  viewport: (typeof routeViewports)[number],
) {
  const unlabeledControls = await page.evaluate(() => {
    const isVisible = (element: Element) => {
      const htmlElement = element as HTMLElement;
      const rect = htmlElement.getBoundingClientRect();
      const style = getComputedStyle(htmlElement);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const hasName = (element: Element) => {
      const htmlElement = element as HTMLElement;
      const input = element as HTMLInputElement;
      return Boolean(
        htmlElement.closest("label")
        || element.getAttribute("aria-label")?.trim()
        || element.getAttribute("aria-labelledby")?.trim()
        || element.getAttribute("title")?.trim()
        || input.labels?.length
        || input.placeholder?.trim()
        || htmlElement.textContent?.trim(),
      );
    };
    return Array.from(document.querySelectorAll("button, input, select, textarea"))
      .filter((element) => isVisible(element) && !(element as HTMLInputElement).disabled && !hasName(element))
      .map((element) => element.outerHTML.slice(0, 180));
  });
  expect(unlabeledControls, contractLabel(routeCase, viewport, "unlabeled controls")).toEqual([]);
}

async function expectNoClippedVisibleText(
  page: Page,
  routeCase: RouteCase,
  viewport: (typeof routeViewports)[number],
) {
  const clippedText = await page.evaluate(() => {
    const selectors = "a, button, div, span, label, h1, h2, h3, p, li, dt, dd, th, td, [role='status'], [role='alert']";
    return Array.from(document.querySelectorAll(selectors))
      .filter((element) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        const style = getComputedStyle(htmlElement);
        if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") return false;
        if (!htmlElement.textContent?.trim()) return false;
        const leafOnlyTag = ["DIV", "SPAN", "LI", "DT", "DD"].includes(element.tagName);
        if (leafOnlyTag && element.children.length > 0) return false;
        const isNamedKeyboardScrollRegion = (
          (style.overflowX === "auto" || style.overflowX === "scroll" || style.overflowY === "auto" || style.overflowY === "scroll")
          && htmlElement.tabIndex >= 0
          && Boolean(element.getAttribute("aria-label")?.trim() || element.getAttribute("aria-labelledby")?.trim())
        );
        if (isNamedKeyboardScrollRegion) return false;
        if (style.overflow === "visible" && style.overflowX === "visible" && style.overflowY === "visible") return false;
        return htmlElement.scrollWidth - htmlElement.clientWidth > 1 || htmlElement.scrollHeight - htmlElement.clientHeight > 1;
      })
      .map((element) => element.textContent?.trim().replace(/\s+/g, " ").slice(0, 140));
  });
  expect(clippedText, contractLabel(routeCase, viewport, "clipped visible text")).toEqual([]);
}

async function expectClickableTextOnOneLine(
  page: Page,
  routeCase: RouteCase,
  viewport: (typeof routeViewports)[number],
) {
  const wrappedTextNodes = await page.evaluate(() => {
    const failures: string[] = [];
    for (const clickable of document.querySelectorAll("a, button, [role='button'], [role='link']")) {
      const element = clickable as HTMLElement;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (bounds.width <= 0 || bounds.height <= 0 || style.display === "none" || style.visibility === "hidden") continue;
      const walker = document.createTreeWalker(clickable, NodeFilter.SHOW_TEXT);
      let textNode = walker.nextNode();
      while (textNode) {
        const text = textNode.textContent?.trim();
        if (text) {
          const range = document.createRange();
          range.selectNodeContents(textNode);
          const lineTops = new Set(
            Array.from(range.getClientRects())
              .filter((rect) => rect.width > 0 && rect.height > 0)
              .map((rect) => Math.round(rect.top)),
          );
          if (lineTops.size > 1) failures.push(text.replace(/\s+/g, " ").slice(0, 100));
        }
        textNode = walker.nextNode();
      }
    }
    return failures;
  });
  expect(wrappedTextNodes, contractLabel(routeCase, viewport, "clickable text-node wraps")).toEqual([]);
}

async function expectNoHighImpactA11yViolations(
  page: Page,
  routeCase: RouteCase,
  viewport: (typeof routeViewports)[number],
) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocked = results.violations
    .filter((violation) => blockedA11yImpacts.has(violation.impact ?? ""))
    .map((violation) => ({
      help: violation.help,
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    }));
  expect(blocked, contractLabel(routeCase, viewport, "axe serious/critical")).toEqual([]);
}

function contractLabel(
  routeCase: RouteCase,
  viewport: (typeof routeViewports)[number],
  contract: string,
) {
  return `${routeCase.routeTemplate} ${viewport.width}x${viewport.height}: ${contract}`;
}
