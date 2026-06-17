import { expect, test, type Page, type Route } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": appOrigin,
};

interface CapturedRequests {
  invitations: URLSearchParams[];
  students: URLSearchParams[];
  teachers: URLSearchParams[];
  users: URLSearchParams[];
}

test.describe("Liste URL state", () => {
  test("tek listeli ekran URL state'i okur ve değişiklikleri URL'ye yazar", async ({ page }) => {
    const captured: CapturedRequests = { invitations: [], students: [], teachers: [], users: [] };
    await openWithListMocks(page, captured, "/kurum/ogretmenler?page=2&limit=20&q=mat&sort=-firstName");

    const teachersRegion = page.getByLabel("Öğretmen yönetimi");
    await expect(teachersRegion.getByLabel("Ara")).toHaveValue("mat");
    await expect(teachersRegion.getByLabel("Sırala")).toHaveValue("-firstName");
    await expect(teachersRegion.getByLabel("Göster")).toHaveValue("20");
    await expect.poll(() => captured.teachers.at(-1)?.get("page")).toBe("2");
    await expect.poll(() => captured.teachers.at(-1)?.get("q")).toBe("mat");

    await teachersRegion.getByLabel("Ara").fill("zeynep");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("zeynep");
    await expect.poll(() => new URL(page.url()).searchParams.get("page")).toBe("1");

    await teachersRegion.getByLabel("Sırala").selectOption("lastName");
    await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("lastName");
  });

  test("iki listeli kullanıcı ekranında URL state namespace ile ayrılır", async ({ page }) => {
    const captured: CapturedRequests = { invitations: [], students: [], teachers: [], users: [] };
    await openWithListMocks(
      page,
      captured,
      "/kurum/kullanicilar?usersPage=2&usersLimit=20&usersQ=admin&usersSort=email&invitationsPage=2&invitationsLimit=5&invitationsQ=veli&invitationsSort=-expiresAt",
    );

    const usersRegion = page.getByLabel("Kullanıcı ve rol yönetimi");
    const invitationsRegion = page.getByLabel("Kimlik davetleri");
    await expect(usersRegion.getByLabel("Ara")).toHaveValue("admin");
    await expect(usersRegion.getByLabel("Sırala")).toHaveValue("email");
    await expect(usersRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(invitationsRegion.getByLabel("Ara")).toHaveValue("veli");
    await expect(invitationsRegion.getByLabel("Sırala")).toHaveValue("-expiresAt");
    await expect(invitationsRegion.getByLabel("Göster")).toHaveValue("5");
    await expect.poll(() => captured.users.at(-1)?.get("q")).toBe("admin");
    await expect.poll(() => captured.invitations.at(-1)?.get("q")).toBe("veli");

    await invitationsRegion.getByLabel("Ara").fill("sms");
    await expect.poll(() => new URL(page.url()).searchParams.get("usersQ")).toBe("admin");
    await expect.poll(() => new URL(page.url()).searchParams.get("invitationsQ")).toBe("sms");
    await expect.poll(() => new URL(page.url()).searchParams.get("invitationsPage")).toBe("1");
  });

  test("öğrenci listesi filtre, kolon ve yoğunluk state'ini URL'de korur", async ({ page }) => {
    const captured: CapturedRequests = { invitations: [], students: [], teachers: [], users: [] };
    await openWithListMocks(
      page,
      captured,
      "/kurum/ogrenciler?page=2&limit=20&q=ada&sort=-lastName&classId=class-11a&level=11&responsibleTeacherId=teacher-a&status=ACTIVE&guardianLinked=true&density=compact&columns=name,class,status,actions",
    );

    const studentsRegion = page.getByLabel("Öğrenci yönetimi");
    const filters = page.getByLabel("Öğrenci filtreleri");
    const tableView = page.getByLabel("Öğrenci tablo görünümü");
    await expect(studentsRegion.getByLabel("Ara")).toHaveValue("ada");
    await expect(studentsRegion.getByLabel("Sırala")).toHaveValue("-lastName");
    await expect(studentsRegion.getByLabel("Göster")).toHaveValue("20");
    await expect(filters.getByLabel("Sınıf")).toHaveValue("class-11a");
    await expect(filters.getByLabel("Seviye")).toHaveValue("11");
    await expect(filters.getByLabel("Sorumlu")).toHaveValue("teacher-a");
    await expect(filters.getByLabel("Durum")).toHaveValue("ACTIVE");
    await expect(filters.getByLabel("Veli")).toHaveValue("true");
    await expect(tableView.getByLabel("Görünüm")).toHaveValue("compact");
    await expect(tableView.getByLabel("Sorumlu")).not.toBeChecked();
    await expect(studentsRegion).toHaveClass(/next-students-page--compact/);
    await expect.poll(() => captured.students.at(-1)?.get("classId")).toBe("class-11a");
    await expect.poll(() => captured.students.at(-1)?.get("guardianLinked")).toBe("true");

    await filters.getByLabel("Veli").selectOption("false");
    await expect.poll(() => new URL(page.url()).searchParams.get("guardianLinked")).toBe("false");

    await tableView.getByLabel("Okul No").check();
    await expect.poll(() => new URL(page.url()).searchParams.get("columns")).toContain("studentNo");
  });
});

async function openWithListMocks(page: Page, captured: CapturedRequests, path: string) {
  await installListApiMocks(page, captured);
  await page.addInitScript(() => {
    document.cookie = "csrfToken=csrf-token; path=/; SameSite=Lax";
  });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
  await page.goto(path);
}

async function installListApiMocks(page: Page, captured: CapturedRequests) {
  await page.route("**/api/v1/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeadersFor(route), status: 204 });
      return;
    }

    const url = new URL(route.request().url());
    const pathName = url.pathname.replace(/^\/api\/v1/, "");

    if (pathName === "/auth/refresh") {
      await fulfillData(route, createAuthResponse());
      return;
    }
    if (pathName === "/me/tenant") {
      await fulfillData(route, createTenantResponse());
      return;
    }
    if (pathName === "/me/notification-devices") {
      await fulfillData(route, []);
      return;
    }
    if (pathName === "/tenant-users") {
      captured.users.push(new URLSearchParams(url.search));
      await fulfillList(route, [createTenantUser()], url.searchParams);
      return;
    }
    if (pathName === "/identity-invitations") {
      captured.invitations.push(new URLSearchParams(url.search));
      await fulfillList(route, [createInvitation()], url.searchParams);
      return;
    }
    if (pathName === "/students") {
      if (url.searchParams.has("page")) {
        captured.students.push(new URLSearchParams(url.search));
        await fulfillList(route, [createStudent()], url.searchParams);
        return;
      }
      await fulfillData(route, [createStudent()]);
      return;
    }
    if (pathName === "/teachers") {
      if (!url.searchParams.has("page")) {
        await fulfillData(route, [createTeacher()]);
        return;
      }
      captured.teachers.push(new URLSearchParams(url.search));
      await fulfillList(route, [createTeacher()], url.searchParams);
      return;
    }
    if (pathName === "/classes") {
      await fulfillData(route, [createClass()]);
      return;
    }
    if (pathName === "/courses" || pathName === "/academic-terms" || pathName === "/guardians") {
      await fulfillList(route, [], url.searchParams);
      return;
    }

    await fulfillData(route, []);
  });
}

function createAuthResponse() {
  return {
    accessToken: "list-url-access-token",
    session: {
      id: "session-list-url",
      membershipVersion: 1,
      roles: ["TENANT_ADMIN"],
      status: "ACTIVE",
      tenantId: "tenant-list-url",
      userId: "user-list-url-admin",
    },
  };
}

function createTenantResponse() {
  return {
    contactEmail: "bilgi@liste-akademi.example",
    id: "tenant-list-url",
    institutionType: "Dershane",
    name: "Liste Akademi",
  };
}

function createTenantUser() {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    email: "admin@liste-akademi.example",
    id: "tenant-user-a",
    name: "Admin Kullanıcı",
    roles: ["TEACHER"],
    tenantId: "tenant-list-url",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createInvitation() {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    email: "veli@liste-akademi.example",
    expiresAt: "2026-02-01T00:00:00.000Z",
    id: "invitation-a",
    name: "Veli Daveti",
    role: "GUARDIAN",
    status: "PENDING",
    subjectId: "guardian-a",
    subjectType: "GUARDIAN",
    tenantId: "tenant-list-url",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createTeacher() {
  return {
    branch: "Matematik",
    firstName: "Zeynep",
    id: "teacher-a",
    lastName: "Arslan",
    tenantId: "tenant-list-url",
  };
}

function createClass() {
  return {
    campusId: "campus-a",
    gradeLevelId: "grade-11",
    id: "class-11a",
    level: "11",
    name: "11-A",
    section: "A",
    tenantId: "tenant-list-url",
  };
}

function createStudent() {
  return {
    classId: "class-11a",
    firstName: "Ada",
    id: "student-a",
    lastName: "Kaya",
    responsibleTeacherId: "teacher-a",
    status: "ACTIVE",
    studentNo: "1101",
    tenantId: "tenant-list-url",
  };
}

async function fulfillList(route: Route, data: unknown[], searchParams: URLSearchParams) {
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? "10");
  await fulfillData(route, data, {
    limit,
    page,
    total: 30,
    totalPages: Math.ceil(30 / limit),
  });
}

async function fulfillData(route: Route, data: unknown, meta?: { limit: number; page: number; total: number; totalPages: number }) {
  await route.fulfill({
    body: JSON.stringify(meta ? { data, meta } : { data }),
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
