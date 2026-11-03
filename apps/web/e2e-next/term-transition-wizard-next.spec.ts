import { expect, test, type Page, type Route } from "@playwright/test";

// DEC-20261102-08: dönem geçişi sihirbazı; seçimler adreste, ilerleme sunucudan okunur, uygulama sırası
// yenileme → mezun/ayrılan → aktivasyon ve yarıda kalan uygulama aynı anahtarlarla sürer.
const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,idempotency-key,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

interface MockStudent {
  id: string;
  firstName: string;
  lastName: string;
  studentNo: string;
  classId: string;
  status: "ACTIVE" | "GRADUATED" | "TRANSFERRED";
  termId: string;
}

interface CapturedRequest {
  path: string;
  idempotencyKey?: string;
  body: Record<string, unknown>;
}

function createDb() {
  return {
    renewFailuresLeft: 1,
    years: [
      { id: "year-old", tenantId: "tenant-term", name: "2025-2026", startsAt: daysFromToday(-400), endsAt: daysFromToday(-30), isActive: true },
      { id: "year-new", tenantId: "tenant-term", name: "2026-2027", startsAt: daysFromToday(-60), endsAt: daysFromToday(300), isActive: false },
    ],
    terms: [
      { id: "term-old", tenantId: "tenant-term", academicYearId: "year-old", name: "2. Dönem", startsAt: daysFromToday(-150), endsAt: daysFromToday(-30), isActive: true },
      { id: "term-new", tenantId: "tenant-term", academicYearId: "year-new", name: "1. Dönem", startsAt: daysFromToday(-10), endsAt: daysFromToday(80), isActive: false },
    ],
    classes: [
      { id: "class-8a", tenantId: "tenant-term", name: "8-A", gradeLevelId: "grade-8" },
      { id: "class-9a", tenantId: "tenant-term", name: "9-A", gradeLevelId: "grade-9" },
      { id: "class-12a", tenantId: "tenant-term", name: "12-A", gradeLevelId: "grade-12" },
    ],
    students: [
      { id: "student-ada", firstName: "Ada", lastName: "Kaya", studentNo: "801", classId: "class-8a", status: "ACTIVE", termId: "term-old" },
      { id: "student-bora", firstName: "Bora", lastName: "Demir", studentNo: "802", classId: "class-8a", status: "ACTIVE", termId: "term-old" },
      { id: "student-cem", firstName: "Cem", lastName: "Yıldız", studentNo: "1201", classId: "class-12a", status: "ACTIVE", termId: "term-old" },
    ] as MockStudent[],
    captured: [] as CapturedRequest[],
  };
}

type MockDb = ReturnType<typeof createDb>;

test.describe("Dönem geçişi sihirbazı", () => {
  test("adımlar adreste kalır, uygulama sırası korunur ve yarıda kalan uygulama yeniden denemeyle tamamlanır", async ({ page }) => {
    const db = createDb();
    await page.setViewportSize({ height: 900, width: 1280 });
    await open(page, db, "/kurum/donem-gecisi");

    const calendar = page.getByRole("form", { name: "Yeni yıl ve dönem" });
    await calendar.getByRole("combobox", { name: "Akademik yıl", exact: true }).selectOption("year-new");
    await calendar.getByRole("combobox", { name: "Dönem", exact: true }).selectOption("term-new");
    await expect(page).toHaveURL(/yil=year-new/);
    await expect(page).toHaveURL(/donem=term-new/);
    await expect(calendar).toContainText("Seçilen dönem: 2026-2027 1. Dönem");

    await page.getByRole("button", { name: "Devam edin" }).click();
    const mapping = page.getByRole("region", { name: "Sınıf eşleştirme", exact: true });
    await mapping.getByLabel("8-A sınıfının yeni dönemdeki yeri").selectOption("class-9a");
    await mapping.getByLabel("12-A sınıfının yeni dönemdeki yeri").selectOption("mezun");
    await expect(page).toHaveURL(/e=class-8a%3Aclass-9a/);

    await page.getByRole("button", { name: "Devam edin" }).click();
    const exits = page.getByRole("region", { name: "Mezun ve ayrılanlar", exact: true });
    await expect(exits.getByRole("table", { name: "Mezun ve ayrılan öğrenciler" })).toContainText("Cem Yıldız");
    await exits.getByLabel("Ayrılacak öğrenci").selectOption("student-bora");
    await exits.getByRole("button", { name: "Ayrılan olarak ekleyin" }).click();
    await expect(exits.getByLabel("Bora Demir için işlem")).toHaveValue("leave");
    const confirmation = exits.getByRole("checkbox", { name: /1 öğrencinin mezun, 1 öğrencinin ayrılan/ });
    await confirmation.check();
    await expect(page).toHaveURL(/onay=1/);

    await page.getByRole("button", { name: "Devam edin" }).click();
    const assignments = page.getByRole("region", { name: "Öğretmen atamaları", exact: true });
    await expect(assignments.getByRole("link", { name: "Zeynep Ak atamalarını açın" })).toHaveAttribute("href", "/kurum/ogretmenler/teacher-zeynep");

    await page.getByRole("button", { name: "Devam edin" }).click();
    const preview = page.getByRole("region", { name: "Ön izleme", exact: true });
    await expect(preview.getByRole("table", { name: "Kaydı yenilenecek öğrenciler" })).toContainText("Ada Kaya");
    await expect(preview.getByRole("table", { name: "Kaydı yenilenecek öğrenciler" })).toContainText("9-A");
    expect(db.captured.filter((request) => !request.path.endsWith("/dry-run"))).toEqual([]);

    await page.getByRole("button", { name: "Devam edin" }).click();
    const apply = page.getByRole("region", { name: "Geçişi uygulama", exact: true });
    await apply.getByRole("button", { name: "Geçişi uygulayın" }).click();
    await expect(apply.getByRole("alert")).toBeVisible();
    await expect(apply.getByRole("button", { name: "Yeniden deneyin" })).toBeEnabled();
    expect(writes(db).map((request) => request.path)).toEqual(["/students/enrollments/bulk-renew"]);
    await expect(page).toHaveURL(/kosu=/);

    await apply.getByRole("button", { name: "Yeniden deneyin" }).click();
    await expect(apply.getByText("Dönem geçişi tamamlandı.")).toBeVisible();
    const writeRequests = writes(db);
    expect(writeRequests.map((request) => request.path)).toEqual([
      "/students/enrollments/bulk-renew",
      "/students/enrollments/bulk-renew",
      "/students/bulk-status",
      "/students/bulk-status",
      "/academic-calendar/activate",
    ]);
    for (const request of writeRequests) expect(request.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
    expect(writeRequests[0]?.idempotencyKey).toBe(writeRequests[1]?.idempotencyKey);
    expect(writeRequests[1]?.body).toMatchObject({
      studentIds: ["student-ada"],
      classIdBySourceClassId: { "class-8a": "class-9a" },
      academicYearId: "year-new",
      termId: "term-new",
    });
    expect(writeRequests[2]?.body).toEqual({ studentIds: ["student-cem"], status: "GRADUATED", confirmIrreversible: true });
    expect(writeRequests[3]?.body).toEqual({ studentIds: ["student-bora"], status: "TRANSFERRED", confirmIrreversible: true });
    expect(writeRequests[4]?.body).toEqual({ academicYearId: "year-new", termId: "term-new" });

    // A reload rebuilds the plan from the address and the server: nothing is left to apply.
    await page.reload();
    await expect(page.getByRole("region", { name: "Geçişi uygulama", exact: true }).getByText("Dönem geçişi tamamlandı.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Geçişi uygulama", exact: true }).getByRole("button", { name: "Geçişi uygulayın" })).toBeDisabled();
  });

  test("geri alınamaz onay verilmeden ve dönem başlamadan uygulama düğmesi kapalı kalır", async ({ page }) => {
    const db = createDb();
    db.terms[1]!.startsAt = daysFromToday(20);
    await page.setViewportSize({ height: 900, width: 1280 });
    await open(page, db, "/kurum/donem-gecisi?adim=6&yil=year-new&donem=term-new&e=class-12a%3Amezun");

    const apply = page.getByRole("region", { name: "Geçişi uygulama", exact: true });
    await expect(apply).toContainText("Başlangıç tarihi gelmemiş dönem için geçiş uygulanamaz.");
    await expect(apply).toContainText("geri alınamaz onayı verilmedi");
    await expect(apply.getByRole("button", { name: "Geçişi uygulayın" })).toBeDisabled();
    expect(writes(db)).toEqual([]);
  });
});

function writes(db: MockDb) {
  return db.captured.filter((request) => !request.path.endsWith("/dry-run"));
}

async function open(page: Page, db: MockDb, path: string) {
  await installMocks(page, db);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Dönem Geçişi" })).toBeVisible();
}

async function installMocks(page: Page, db: MockDb) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }
    const url = new URL(request.url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method();

    if (pathName === "/auth/refresh") {
      await fulfillData(route, {
        accessToken: "term-transition-access-token",
        session: { id: "session-term", membershipVersion: 1, roles: ["TENANT_ADMIN"], status: "ACTIVE", tenantId: "tenant-term", userId: "user-term" },
      });
      return;
    }
    if (pathName === "/me/tenant") {
      await fulfillData(route, { id: "tenant-term", institutionType: "Okul", name: "Geçiş Koleji" });
      return;
    }
    if (pathName === "/academic-years" && method === "GET") return fulfillData(route, db.years);
    if (pathName === "/academic-terms" && method === "GET") return fulfillData(route, db.terms);
    if (pathName === "/classes" && method === "GET") return fulfillData(route, db.classes);
    if (pathName === "/students" && method === "GET") {
      const rows = db.students.filter((student) => !url.searchParams.get("status") || student.status === url.searchParams.get("status"));
      return fulfillData(route, rows.map(toStudentRecord), { limit: Number(url.searchParams.get("limit") ?? "50"), total: rows.length });
    }
    if (pathName === "/teachers" && method === "GET") {
      return fulfillData(route, [{ id: "teacher-zeynep", tenantId: "tenant-term", firstName: "Zeynep", lastName: "Ak" }]);
    }
    if (pathName === "/teachers/teacher-zeynep/assignments" && method === "GET") {
      return fulfillData(route, [{ id: "assignment-8a", tenantId: "tenant-term", teacherId: "teacher-zeynep", classId: "class-8a", role: "CLASS_TEACHER" }]);
    }
    if (method === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      db.captured.push({ path: pathName, idempotencyKey: request.headers()["idempotency-key"], body });
      if (pathName === "/students/enrollments/bulk-renew/dry-run") return fulfillData(route, dryRun(db, body));
      if (pathName === "/students/enrollments/bulk-renew") {
        if (db.renewFailuresLeft > 0) {
          db.renewFailuresLeft -= 1;
          return fulfillJson(route, { error: { code: "SERVICE_UNAVAILABLE", message: "unavailable" } }, 503);
        }
        const mapping = (body.classIdBySourceClassId ?? {}) as Record<string, string>;
        const ids = body.studentIds as string[];
        for (const student of db.students.filter((candidate) => ids.includes(candidate.id))) {
          student.classId = mapping[student.classId] ?? student.classId;
          student.termId = String(body.termId);
        }
        return fulfillData(route, { updatedCount: ids.length, enrollments: [] });
      }
      if (pathName === "/students/bulk-status") {
        const ids = body.studentIds as string[];
        for (const student of db.students.filter((candidate) => ids.includes(candidate.id))) student.status = body.status as MockStudent["status"];
        return fulfillData(route, {
          updatedCount: ids.length,
          unchangedCount: 0,
          results: ids.map((studentId) => ({ studentId, outcome: "UPDATED", previousStatus: "ACTIVE", status: body.status, portalAccessSuspended: false })),
        });
      }
      if (pathName === "/academic-calendar/activate") {
        for (const year of db.years) year.isActive = year.id === body.academicYearId;
        for (const term of db.terms) term.isActive = term.id === body.termId;
        return fulfillData(route, {
          academicYear: db.years.find((year) => year.id === body.academicYearId),
          term: db.terms.find((term) => term.id === body.termId),
          deactivatedAcademicYearIds: ["year-old"],
          deactivatedTermIds: ["term-old"],
        });
      }
    }
    await fulfillData(route, []);
  });
}

function dryRun(db: MockDb, body: Record<string, unknown>) {
  const ids = body.studentIds as string[];
  const mapping = (body.classIdBySourceClassId ?? {}) as Record<string, string>;
  const items = db.students.filter((student) => ids.includes(student.id)).map((student) => ({
    studentId: student.id,
    status: student.status,
    sourceClassId: student.classId,
    currentTermId: student.termId,
    targetClassId: mapping[student.classId] ?? student.classId,
    addsToQuota: false,
  }));
  return {
    dryRun: true,
    academicYearId: body.academicYearId,
    termId: body.termId,
    termStartsAt: db.terms[1]!.startsAt,
    termStarted: true,
    items,
    conflictStudentIds: [],
    quota: { limit: 100, current: 3, incoming: 0, wouldExceed: false },
  };
}

function toStudentRecord(student: MockStudent) {
  return {
    id: student.id,
    tenantId: "tenant-term",
    firstName: student.firstName,
    lastName: student.lastName,
    studentNo: student.studentNo,
    classId: student.classId,
    status: student.status,
  };
}

function daysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function fulfillData(route: Route, data: unknown, meta?: Record<string, unknown>) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
    headers: { ...corsHeadersFor(route), "content-type": "application/json" },
    status: 200,
  });
}

async function fulfillJson(route: Route, body: unknown, status: number) {
  await route.fulfill({ body: JSON.stringify(body), headers: { ...corsHeadersFor(route), "content-type": "application/json" }, status });
}

function corsHeadersFor(route: Route) {
  return {
    ...corsHeaders,
    "access-control-allow-origin": route.request().headers().origin ?? corsHeaders["access-control-allow-origin"],
  };
}
