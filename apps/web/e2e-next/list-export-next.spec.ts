import { readFile } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Download, type Page, type Route } from "@playwright/test";

// DEC-20261102-08: masked CSV export. The file holds exactly the columns and the displayed cell text of the rows the
// list shows; the audit call (POST /audit/list-exports) runs first and, if it fails, no file is created. Portals have
// no export.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const exportHint = "Yalnız bu sayfada görünen satırlar ve sütunlar, ekrandaki maskeli biçimiyle indirilir.";
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

interface AuditCall {
  body: { filtersSummary: string; list: string; rowCount: number };
  idempotencyKey: string | undefined;
}

interface ExportMock {
  auditCalls: AuditCall[];
  auditStatus: number;
  events: string[];
  teachers: Array<Record<string, unknown>>;
}

const teachers = [
  { branch: "Matematik", firstName: "Ada", id: "teacher-a", lastName: "Kaya", tenantId: "tenant-export" },
  { branch: "=1+1", firstName: "Bora", id: "teacher-b", lastName: "Demir; Yılmaz", tenantId: "tenant-export" },
];

const students = [
  { classId: "class-9a", firstName: "Cem", gradeLevelId: null, id: "student-c", lastName: "Yıldız", responsibleTeacherId: null, status: "ACTIVE", studentNo: "1103", tenantId: "tenant-export" },
  { classId: null, firstName: "Deniz", gradeLevelId: null, id: "student-d", lastName: "Ak", responsibleTeacherId: null, status: "PASSIVE", studentNo: "1104", tenantId: "tenant-export" },
];

test.describe("Tablo CSV dışa aktarma", () => {
  test("öğretmenler: önce denetim kaydı, sonra ekrandaki sütun ve hücrelerle aynı CSV iner", async ({ page }) => {
    const mock = createMock();
    await openKurum(page, mock, "/kurum/ogretmenler?q=ada&page=1");
    const region = page.getByLabel("Öğretmen yönetimi");
    await expect(region.getByRole("table").getByText("Ada Kaya")).toBeVisible();

    const button = region.getByRole("button", { name: "CSV indir" });
    await expect(button).toBeEnabled();
    await expect(button).toHaveAccessibleDescription(exportHint);

    const visible = await readVisibleTable(page, "Öğretmen yönetimi");
    expect(visible.headers).toEqual(["Ad Soyad", "Branş", "Portal", "Atama"]);
    expect(visible.rows).toHaveLength(2);

    const download = await expectDownload(page, () => button.click());
    expect(download.suggestedFilename()).toMatch(/^ogretmenler-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await readDownload(download);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(parseCsv(csv.slice(1)).map((row) => row.map(stripFormulaGuard))).toEqual([visible.headers, ...visible.rows]);
    // Formül gibi başlayan hücre metin olarak yazılır; ayırıcı içeren hücre tırnaklanır.
    expect(csv).toContain("\"Bora Demir; Yılmaz\";'=1+1;");

    expect(mock.auditCalls).toHaveLength(1);
    expect(mock.auditCalls[0]?.body).toMatchObject({ list: "teachers", rowCount: 2 });
    expect(mock.auditCalls[0]?.body.filtersSummary).toMatch(/^page=1;q(?:;sort=-?[A-Za-z]+)?$/);
    expect(mock.auditCalls[0]?.idempotencyKey).toEqual(expect.any(String));
    expect(JSON.stringify(mock.auditCalls[0]?.body)).not.toContain("ada");
    expect(mock.events).toEqual(["audit", "download"]);
    await expect(region.getByRole("status").filter({ hasText: "2 satır CSV olarak indirildi." })).toBeVisible();
  });

  test("denetim kaydı yazılamazsa dosya oluşmaz ve hata bildirilir", async ({ page }) => {
    const mock = createMock({ auditStatus: 500 });
    await openKurum(page, mock, "/kurum/ogretmenler");
    const region = page.getByLabel("Öğretmen yönetimi");
    await expect(region.getByRole("table").getByText("Ada Kaya")).toBeVisible();

    await region.getByRole("button", { name: "CSV indir" }).click();
    await expect(region.getByRole("alert").filter({ hasText: "Dışa aktarma tamamlanamadı; dosya oluşturulmadı." })).toBeVisible();
    expect(mock.auditCalls).toHaveLength(1);
    expect(mock.events).toEqual(["audit"]);
  });

  test("maskesiz görünen bir değer varsa dışa aktarma denetim çağrısından önce durur", async ({ page }) => {
    const mock = createMock({ teachers: [{ ...teachers[0], branch: "05321234567" }] });
    await openKurum(page, mock, "/kurum/ogretmenler");
    const region = page.getByLabel("Öğretmen yönetimi");
    await expect(region.getByRole("table").getByText("Ada Kaya")).toBeVisible();

    await region.getByRole("button", { name: "CSV indir" }).click();
    await expect(region.getByRole("alert").filter({ hasText: "dosya oluşturulmadı" })).toBeVisible();
    expect(mock.auditCalls).toHaveLength(0);
    expect(mock.events).toEqual([]);
  });

  test("öğrenciler: seçim ve işlem sütunu dosyaya girmez, kolon seçimi dosyaya yansır; klavyeyle çalışır", async ({ page }) => {
    const mock = createMock();
    await openKurum(page, mock, "/kurum/ogrenciler?q=cem");
    const region = page.getByLabel("Öğrenci yönetimi");
    const table = page.getByRole("table", { name: "Öğrenci listesi" });
    await expect(table.getByText("Cem Yıldız")).toBeVisible();
    await expect(table.getByRole("checkbox", { name: "Cem Yıldız seç" })).toBeVisible();

    const visible = await readVisibleTable(page, "Öğrenci yönetimi");
    expect(visible.headers).not.toContain("İşlem");
    expect(visible.headers).toContain("Ad Soyad");

    const button = region.getByRole("button", { name: "CSV indir" });
    await button.focus();
    await expect(button).toBeFocused();
    const download = await expectDownload(page, () => page.keyboard.press("Enter"));
    const csv = await readDownload(download);
    expect(parseCsv(csv.slice(1))).toEqual([visible.headers, ...visible.rows]);
    expect(mock.auditCalls.at(-1)?.body).toMatchObject({ list: "students", rowCount: 2 });
    expect(mock.auditCalls.at(-1)?.body.filtersSummary).not.toContain("cem");
    expect(mock.events).toEqual(["audit", "download"]);
  });

  test("sınıflar ve devamsızlık listeleri kendi liste türüyle dışa aktarır", async ({ page }) => {
    const mock = createMock();
    await openKurum(page, mock, "/kurum/siniflar");
    const classes = page.getByLabel("Sınıf yönetimi");
    await expect(classes.getByRole("table").getByText("9-A")).toBeVisible();
    const classesCsv = await readDownload(await expectDownload(page, () => classes.getByRole("button", { name: "CSV indir" }).click()));
    const classRows = parseCsv(classesCsv.slice(1));
    expect(classRows[0]).toEqual(["Sınıf", "Seviye", "Alan / Şube", "Kampüs"]);
    expect(classRows[1]?.[0]).toBe("9-A");
    expect(mock.auditCalls.at(-1)?.body).toMatchObject({ list: "classes", rowCount: 1 });

    await page.goto("/kurum/devamsizlik");
    const attendance = page.getByLabel("Devamsızlık yönetimi");
    await expect(attendance.getByRole("table").getByText("Cem Yıldız")).toBeVisible();
    const attendanceCsv = await readDownload(await expectDownload(page, () => attendance.getByRole("button", { name: "CSV indir" }).click()));
    const attendanceRows = parseCsv(attendanceCsv.slice(1));
    expect(attendanceRows[0]).toEqual(["Öğrenci", "Sınıf", "Ders", "Dönem", "Tarih", "Durum"]);
    expect(attendanceRows[1]?.[0]).toBe("Cem Yıldız");
    expect(mock.auditCalls.at(-1)?.body).toMatchObject({ list: "attendance", rowCount: 1 });
  });

  test("dışa aktarma alanı erişilebilirlik ihlali taşımaz ve dar ekranda taşmaz", async ({ page }) => {
    const mock = createMock();
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ height: 900, width });
      await openKurum(page, mock, "/kurum/ogretmenler");
      const region = page.getByLabel("Öğretmen yönetimi");
      await expect(region.getByRole("button", { name: "CSV indir" })).toBeVisible();
      const overflow = await page.evaluate(() => Math.max(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.body.scrollWidth - document.body.clientWidth,
      ));
      expect(overflow, `${width}px yatay taşma`).toBeLessThanOrEqual(1);
      if (width < 1024) {
        const box = await region.getByRole("button", { name: "CSV indir" }).boundingBox();
        expect(box?.height ?? 0, `${width}px dokunma hedefi`).toBeGreaterThanOrEqual(44);
      }
    }
    const results = await new AxeBuilder({ page }).include(".uh-crud-page__table-tools").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("portallarda dışa aktarma düğmesi yoktur", async ({ page }) => {
    for (const [subjectType, path, heading] of [
      ["STUDENT", "/ogrenci", "Öğrenci Portalı"],
      ["GUARDIAN", "/veli", "Veli Portalı"],
      ["TEACHER", "/ogretmen/ders-akisi", "Öğretmen Portalı"],
    ] as const) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await installPortalMocks(page, subjectType);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      await expect(page.getByRole("button", { name: "CSV indir" })).toHaveCount(0);
      await expect(page.locator(".uh-crud-page__table-tools")).toHaveCount(0);
    }
  });
});

function createMock(overrides: Partial<ExportMock> = {}): ExportMock {
  return { auditCalls: [], auditStatus: 201, events: [], teachers, ...overrides };
}

async function openKurum(page: Page, mock: ExportMock, path: string) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  page.removeAllListeners("download");
  page.on("download", () => mock.events.push("download"));
  await installKurumMocks(page, mock);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
}

async function installKurumMocks(page: Page, mock: ExportMock) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }
    const url = new URL(request.url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");

    if (pathName === "/auth/refresh") {
      await fulfillData(route, {
        accessToken: "list-export-access-token",
        session: { activePersona: "STAFF", id: "session-list-export", membershipVersion: 1, roles: ["TENANT_ADMIN"], status: "ACTIVE", tenantId: "tenant-export", userId: "user-list-export" },
      });
      return;
    }
    if (pathName === "/me/tenant") {
      await fulfillData(route, { contactEmail: "bilgi@aktarim-akademi.example", id: "tenant-export", institutionType: "Okul", name: "Aktarım Akademi" });
      return;
    }
    if (pathName === "/audit/list-exports" && request.method() === "POST") {
      mock.events.push("audit");
      mock.auditCalls.push({ body: request.postDataJSON() as AuditCall["body"], idempotencyKey: request.headers()["idempotency-key"] });
      if (mock.auditStatus >= 400) {
        await route.fulfill({ body: JSON.stringify({ error: { code: "INTERNAL_ERROR" } }), headers: { ...corsHeadersFor(route), "content-type": "application/json" }, status: mock.auditStatus });
        return;
      }
      const body = request.postDataJSON() as AuditCall["body"];
      await fulfillData(route, { auditId: "audit-export-a", list: body.list, recordedAt: "2026-11-02T09:00:00.000Z", rowCount: body.rowCount }, undefined, 201);
      return;
    }
    if (pathName === "/teachers") {
      await fulfillPagedOrPlain(route, url, mock.teachers);
      return;
    }
    if (pathName === "/students") {
      if (url.searchParams.has("limit")) {
        await fulfillData(route, students, { limit: Number(url.searchParams.get("limit") ?? "50"), total: students.length });
        return;
      }
      await fulfillData(route, students);
      return;
    }
    if (pathName === "/classes") {
      await fulfillPagedOrPlain(route, url, [{ campusId: null, gradeLevelId: null, id: "class-9a", name: "9-A", section: "A", tenantId: "tenant-export" }]);
      return;
    }
    if (pathName === "/attendance") {
      await fulfillPagedOrPlain(route, url, [{ classId: "class-9a", date: "2026-10-30", id: "attendance-a", status: "ABSENT", studentId: "student-c", tenantId: "tenant-export" }]);
      return;
    }
    await fulfillData(route, []);
  });
}

async function installPortalMocks(page: Page, subjectType: "GUARDIAN" | "STUDENT" | "TEACHER") {
  const subjectId = subjectType === "STUDENT" ? "student-c" : subjectType === "GUARDIAN" ? "guardian-a" : "teacher-a";
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }
    const pathName = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
    if (pathName === "/auth/refresh") {
      await fulfillData(route, {
        accessToken: `list-export-${subjectType.toLowerCase()}-token`,
        session: { id: `session-${subjectId}`, membershipVersion: 1, roles: [subjectType], status: "ACTIVE", subjectId, subjectType, tenantId: "tenant-export", userId: subjectId },
      });
      return;
    }
    if (pathName === "/me/tenant") {
      await fulfillData(route, { id: "tenant-export", institutionType: "Okul", name: "Aktarım Akademi" });
      return;
    }
    if (pathName === "/me/student/profile") {
      await fulfillData(route, { firstName: "Cem", id: "student-c", lastName: "Yıldız", status: "ACTIVE", tenantId: "tenant-export" });
      return;
    }
    if (pathName === "/me/guardian/students") {
      await fulfillData(route, [{ firstName: "Cem", id: "student-c", lastName: "Yıldız", status: "ACTIVE", tenantId: "tenant-export" }]);
      return;
    }
    await fulfillData(route, []);
  });
}

async function fulfillPagedOrPlain(route: Route, url: URL, rows: unknown[]) {
  if (url.searchParams.has("page")) {
    const limit = Number(url.searchParams.get("limit") ?? "10");
    await fulfillData(route, rows, { limit, page: Number(url.searchParams.get("page") ?? "1"), total: rows.length, totalPages: 1 });
    return;
  }
  await fulfillData(route, rows);
}

/** Reads the header and body cell text the table shows, the way a person reads the screen. */
async function readVisibleTable(page: Page, regionLabel: string) {
  return page.getByLabel(regionLabel).locator("table.uh-data-table").evaluate((table) => {
    const excluded = new Set(["__select", "actions"]);
    const text = (cell: Element) => {
      const clone = cell.cloneNode(true) as Element;
      clone.querySelectorAll("button, svg, input, [aria-hidden='true'], [hidden]").forEach((node) => node.remove());
      return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    };
    const headerCells = Array.from(table.querySelectorAll("thead th[data-column-key]")).filter((cell) => !excluded.has(cell.getAttribute("data-column-key") ?? ""));
    const keys = headerCells.map((cell) => cell.getAttribute("data-column-key"));
    const rows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => !row.hasAttribute("data-mobile-detail") && !row.hasAttribute("data-state"));
    return {
      headers: headerCells.map(text),
      rows: rows.map((row) => keys.map((key) => {
        const cell = row.querySelector(`td[data-column-key="${key}"]`);
        return cell ? text(cell) : "";
      })),
    };
  });
}

async function expectDownload(page: Page, trigger: () => Promise<unknown>): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
  return download;
}

async function readDownload(download: Download): Promise<string> {
  const path = await download.path();
  return readFile(path, "utf8");
}

/** Minimal CSV reader for ";"-separated, double-quote-escaped content with CRLF rows. */
function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === "\"" && content[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ";") {
      row.push(field);
      field = "";
    } else if (char === "\r" && content[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
    } else {
      field += char;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The formula guard prefixes "'" to a formula-like cell; the rest of the cell is the screen text. */
function stripFormulaGuard(value: string) {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

async function fulfillData(route: Route, data: unknown, meta?: Record<string, unknown>, status = 200) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
    headers: { ...corsHeadersFor(route), "content-type": "application/json" },
    status,
  });
}

function corsHeadersFor(route: Route) {
  return {
    ...corsHeaders,
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}
