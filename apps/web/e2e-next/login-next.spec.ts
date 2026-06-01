import { expect, test, type Page } from "@playwright/test";

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": "http://localhost:3001",
};

function envelope<T>(data: T, requestUrl?: string) {
  if (Array.isArray(data)) return listEnvelope(data, requestUrl);
  return { data };
}

function listEnvelope<TRecord>(data: TRecord[], requestUrl?: string) {
  const url = requestUrl ? new URL(requestUrl) : undefined;
  const q = url?.searchParams.get("q")?.trim().toLocaleLowerCase("tr-TR");
  const sort = url?.searchParams.get("sort") ?? "";
  const page = Number(url?.searchParams.get("page") ?? "1");
  const limit = Number(url?.searchParams.get("limit") ?? String(data.length));
  const filtered = q
    ? data.filter((record) => JSON.stringify(record).toLocaleLowerCase("tr-TR").includes(q))
    : data;
  const sorted = sort ? sortFixtures(filtered, sort) : filtered;
  const start = (page - 1) * limit;
  return {
    data: sorted.slice(start, start + limit),
    meta: {
      total: filtered.length,
      page,
      limit,
      totalPages: filtered.length === 0 ? 0 : Math.ceil(filtered.length / limit),
    },
  };
}

function sortFixtures<TRecord>(records: TRecord[], sort: string): TRecord[] {
  const direction = sort.startsWith("-") ? -1 : 1;
  const field = sort.replace(/^-/, "");
  return [...records].sort((left, right) =>
    direction * String((left as Record<string, unknown>)[field] ?? "").localeCompare(
      String((right as Record<string, unknown>)[field] ?? ""),
      "tr-TR",
      { sensitivity: "base" },
    ),
  );
}

type ClassFixture = { id: string; tenantId: string; name: string; level?: string };
type TeacherFixture = { id: string; tenantId: string; firstName: string; lastName: string; branch?: string };
type TeacherAssignmentFixture = {
  id: string;
  tenantId: string;
  teacherId: string;
  classId?: string;
  studentId?: string;
  role: "CLASS_TEACHER" | "BRANCH_TEACHER" | "GUIDANCE_COUNSELOR" | "RESPONSIBLE_TEACHER";
  startsAt?: string;
  endsAt?: string;
};
type GuardianFixture = { id: string; tenantId: string; firstName: string; lastName: string; phone?: string };
type StudentFixture = {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  classId?: string;
  responsibleTeacherId?: string;
  status: "ACTIVE" | "PASSIVE";
};
type MaterialFixture = { id: string; tenantId: string; title: string; description?: string };
type TenantUserFixture = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  roles: string[];
  createdAt: string;
  updatedAt: string;
};
type IdentityInvitationFixture = {
  id: string;
  tenantId: string;
  subjectType: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId: string;
  email: string;
  name: string;
  role: string;
  status: "PENDING" | "ACCEPTED";
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};
type SupportTicketFixture = {
  id: string;
  tenantId: string;
  requesterId: string;
  subject: string;
  message: string;
  priority: "LOW" | "NORMAL" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  createdAt: string;
};

test("Next login gerçek auth store ile kurum paneline geçer", async ({ page }) => {
  let loginCount = 0;
  let students: StudentFixture[] = [
    {
      id: "student-a",
      tenantId: "tenant-a",
      firstName: "Ada",
      lastName: "A",
      classId: "class-a",
      responsibleTeacherId: "teacher-a",
      status: "ACTIVE",
    },
    { id: "student-b", tenantId: "tenant-a", firstName: "Bora", lastName: "B", status: "ACTIVE" },
    { id: "student-c", tenantId: "tenant-a", firstName: "Can", lastName: "C", status: "PASSIVE" },
  ];
  let classes: ClassFixture[] = [
    { id: "class-a", tenantId: "tenant-a", name: "8-A", level: "8" },
    { id: "class-b", tenantId: "tenant-a", name: "8-B", level: "8" },
  ];
  let teachers: TeacherFixture[] = [
    { id: "teacher-a", tenantId: "tenant-a", firstName: "Ayse", lastName: "Ogretmen", branch: "Matematik" },
  ];
  let teacherAssignments: TeacherAssignmentFixture[] = [
    { id: "teacher-assignment-class-a", tenantId: "tenant-a", teacherId: "teacher-a", classId: "class-a", role: "CLASS_TEACHER" },
  ];
  let guardians: GuardianFixture[] = [
    { id: "guardian-a", tenantId: "tenant-a", firstName: "Zeynep", lastName: "Veli", phone: "5550000000" },
  ];
  let tenantUsers: TenantUserFixture[] = [
    {
      id: "user-tenant-a",
      tenantId: "tenant-a",
      email: "admin-a@example.test",
      name: "Admin A",
      roles: ["TENANT_ADMIN"],
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
    },
  ];
  let identityInvitations: IdentityInvitationFixture[] = [
    {
      id: "identity-invitation-a",
      tenantId: "tenant-a",
      subjectType: "STUDENT",
      subjectId: "student-a",
      email: "ada@example.test",
      name: "Ada A",
      role: "STUDENT",
      status: "PENDING",
      expiresAt: "2026-06-15T09:00:00.000Z",
      createdAt: "2026-06-08T09:00:00.000Z",
      updatedAt: "2026-06-08T09:00:00.000Z",
    },
  ];
  let rolePatchCount = 0;
  let homework = [
    {
      id: "homework-a",
      tenantId: "tenant-a",
      classId: "class-a",
      sourceMaterialId: "material-a",
      sourceMaterialTitle: "Kesirler Çalışma Kağıdı",
      title: "Kesirler",
      description: "1-20 arası sorular",
      dueAt: "2026-06-05T12:00:00.000Z",
    },
  ];
  let materials: MaterialFixture[] = [
    {
      id: "material-a",
      tenantId: "tenant-a",
      title: "Kesirler Çalışma Kağıdı",
      description: "Kesirlerle dört işlem alıştırmaları",
    },
  ];
  let materialFiles: Record<string, Array<{
    id: string;
    tenantId: string;
    materialId: string;
    uploadedById: string;
    fileName: string;
    contentType: "text/plain";
    byteSize: number;
    sha256: string;
    createdAt: string;
  }>> = {
    "material-a": [
      {
        id: "material-file-a",
        tenantId: "tenant-a",
        materialId: "material-a",
        uploadedById: "user-tenant-a",
        fileName: "kesirler.txt",
        contentType: "text/plain",
        byteSize: 11,
        sha256: "sha-material-a",
        createdAt: "2026-06-08T09:10:00.000Z",
      },
    ],
  };
  let materialAssignments: Record<string, Array<{
    id: string;
    tenantId: string;
    materialId: string;
    studentId: string;
    assignedById: string;
    note?: string;
    dueAt?: string;
    createdAt: string;
  }>> = {
    "material-a": [
      {
        id: "material-assignment-a",
        tenantId: "tenant-a",
        materialId: "material-a",
        studentId: "student-a",
        assignedById: "user-tenant-a",
        note: "Bireysel tekrar",
        dueAt: "2026-06-09T12:00:00.000Z",
        createdAt: "2026-06-08T09:20:00.000Z",
      },
    ],
  };
  const parserFileContent = "ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE";
  const parserSuggestion = {
    encoding: "UTF-8",
    delimiter: "TAB",
    skipHeaderLines: 1,
    fieldMapping: {
      studentNo: { kind: "delimited", column: 0 },
      bookletType: { kind: "delimited", column: 1 },
      answers: { kind: "delimited", column: 2, estimatedQuestionCount: 5 },
    },
    version: 1,
    confidence: "high",
    warnings: [],
  };
  let announcements = [
    {
      id: "announcement-a",
      tenantId: "tenant-a",
      title: "Haftalık toplantı",
      body: "Pazartesi toplantısı",
      audience: "TEACHERS",
      publishedAt: "2026-06-08T09:00:00.000Z",
    },
  ];
  let messageTemplates = [
    {
      id: "message-template-a",
      tenantId: "tenant-a",
      name: "Sınav hatırlatma",
      channel: "SMS",
      body: "Yarın deneme sınavı yapılacaktır.",
    },
  ];
  let supportTickets: SupportTicketFixture[] = [
    {
      id: "support-ticket-a",
      tenantId: "tenant-a",
      requesterId: "user-tenant-a",
      subject: "Optik dosya okunmuyor",
      message: "Yüklenen optik dosya işlenemedi.",
      priority: "NORMAL",
      status: "OPEN",
      createdAt: "2026-06-08T09:00:00.000Z",
    },
  ];
  let supportAttachments: Record<string, Array<{
    id: string;
    tenantId: string;
    ticketId: string;
    uploadedById: string;
    fileName: string;
    contentType: "text/plain";
    byteSize: number;
    sha256: string;
    createdAt: string;
  }>> = {
    "support-ticket-a": [
      {
        id: "support-attachment-a",
        tenantId: "tenant-a",
        ticketId: "support-ticket-a",
        uploadedById: "user-tenant-a",
        fileName: "hata-ekrani.txt",
        contentType: "text/plain",
        byteSize: 11,
        sha256: "sha-a",
        createdAt: "2026-06-08T09:05:00.000Z",
      },
    ],
  };
  let supportComments: Record<string, Array<{
    id: string;
    tenantId: string;
    ticketId: string;
    authorId: string;
    body: string;
    createdAt: string;
  }>> = {
    "support-ticket-a": [
      {
        id: "support-comment-a",
        tenantId: "tenant-a",
        ticketId: "support-ticket-a",
        authorId: "user-tenant-a",
        body: "İlk kontrol yapıldı.",
        createdAt: "2026-06-08T09:10:00.000Z",
      },
    ],
  };
  const auditLogs = [
    {
      id: "audit-log-a",
      tenantId: "tenant-a",
      actorUserId: "user-tenant-a",
      entityType: "Student",
      entityId: "student-a",
      action: "student.created",
      diff: { fieldsSet: ["firstName", "lastName"] },
      createdAt: "2026-06-08T09:00:00.000Z",
    },
    {
      id: "audit-log-b",
      tenantId: "tenant-a",
      actorUserId: "user-tenant-a",
      entityType: "GuardianStudent",
      entityId: "guardian-student-a",
      action: "guardian_student.linked",
      diff: { guardianId: "guardian-a", studentId: "student-a" },
      createdAt: "2026-06-08T09:30:00.000Z",
    },
    {
      id: "audit-log-c",
      tenantId: "tenant-a",
      actorUserId: "user-tenant-a",
      entityType: "Announcement",
      entityId: "announcement-a",
      action: "announcement.created",
      diff: { title: "Haftalık toplantı" },
      createdAt: "2026-06-09T09:00:00.000Z",
    },
  ];

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.continue();
  });

  await page.route("**/auth/refresh", async (route) => {
    await route.fulfill({ headers: corsHeaders, status: 401 });
  });

  await page.route("**/auth/login", async (route) => {
    loginCount += 1;
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse())),
    });
  });

  await page.route("**/auth/logout", async (route) => {
    await route.fulfill({ headers: corsHeaders, status: 204 });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }

    expect(request.headers().authorization).toBe("Bearer next-access-token");

    if (path === "/tenant-users" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(tenantUsers, request.url())),
      });
      return;
    }

    if (path === "/tenant-users" && request.method() === "POST") {
      const body = request.postDataJSON() as { email: string; name: string; roles: string[] };
      const created: TenantUserFixture = {
        id: "user-created",
        tenantId: "tenant-a",
        email: body.email,
        name: body.name,
        roles: body.roles,
        createdAt: "2026-06-09T09:00:00.000Z",
        updatedAt: "2026-06-09T09:00:00.000Z",
      };
      tenantUsers = [...tenantUsers, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/tenant-users/") && path.endsWith("/roles") && request.method() === "PATCH") {
      rolePatchCount += 1;
      const id = path.replace("/tenant-users/", "").replace("/roles", "");
      const body = request.postDataJSON() as { roles: string[] };
      const updated = {
        ...(tenantUsers.find((user) => user.id === id) ?? tenantUsers[0]!),
        id,
        roles: body.roles,
        updatedAt: "2026-06-09T09:05:00.000Z",
      };
      tenantUsers = tenantUsers.map((user) => (user.id === id ? updated : user));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path === "/identity-invitations" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(identityInvitations, request.url())),
      });
      return;
    }

    if (path === "/identity-invitations" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        subjectType: "STUDENT" | "GUARDIAN" | "TEACHER";
        subjectId: string;
        email: string;
        name?: string;
      };
      const created: IdentityInvitationFixture = {
        id: "identity-invitation-created",
        tenantId: "tenant-a",
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        email: body.email,
        name: body.name || "Davetli Kullanıcı",
        role: body.subjectType,
        status: "PENDING",
        expiresAt: "2026-06-16T09:00:00.000Z",
        createdAt: "2026-06-09T09:00:00.000Z",
        updatedAt: "2026-06-09T09:00:00.000Z",
      };
      identityInvitations = [created, ...identityInvitations];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({ invitation: created, activationToken: "activation-token-created" })),
      });
      return;
    }

    if (path.startsWith("/identity-invitations/") && path.endsWith("/resend") && request.method() === "POST") {
      const id = path.replace("/identity-invitations/", "").replace("/resend", "");
      const invitation = {
        ...(identityInvitations.find((candidate) => candidate.id === id) ?? identityInvitations[0]!),
        id,
        expiresAt: "2026-06-17T09:00:00.000Z",
        updatedAt: "2026-06-10T09:00:00.000Z",
      };
      identityInvitations = identityInvitations.map((candidate) => (candidate.id === id ? invitation : candidate));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({ invitation, activationToken: "activation-token-resent" })),
      });
      return;
    }

    if (path === "/classes" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(classes, request.url())),
      });
      return;
    }

    if (path === "/classes" && request.method() === "POST") {
      const body = request.postDataJSON() as { name: string; level?: string };
      const created: ClassFixture = {
        id: "class-created",
        tenantId: "tenant-a",
        name: body.name,
        level: body.level,
      };
      classes = [...classes, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/classes/") && request.method() === "PATCH") {
      const id = path.replace("/classes/", "");
      const body = request.postDataJSON() as { name: string; level?: string };
      const updated = {
        id,
        tenantId: "tenant-a",
        name: body.name,
        level: body.level,
      };
      classes = classes.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/classes/") && request.method() === "DELETE") {
      const id = path.replace("/classes/", "");
      classes = classes.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/teachers" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(teachers, request.url())),
      });
      return;
    }

    if (path === "/teachers" && request.method() === "POST") {
      const body = request.postDataJSON() as { firstName: string; lastName: string; branch?: string };
      const created: TeacherFixture = {
        id: "teacher-created",
        tenantId: "tenant-a",
        firstName: body.firstName,
        lastName: body.lastName,
        branch: body.branch,
      };
      teachers = [...teachers, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/teachers/") && path.endsWith("/assignments") && request.method() === "GET") {
      const teacherId = path.replace("/teachers/", "").replace("/assignments", "");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(teacherAssignments.filter((assignment) => assignment.teacherId === teacherId))),
      });
      return;
    }

    if (path.startsWith("/teachers/") && path.endsWith("/assignments") && request.method() === "POST") {
      const teacherId = path.replace("/teachers/", "").replace("/assignments", "");
      const body = request.postDataJSON() as Partial<TeacherAssignmentFixture>;
      const created: TeacherAssignmentFixture = {
        id: "teacher-assignment-created",
        tenantId: "tenant-a",
        teacherId,
        classId: body.classId,
        studentId: body.studentId,
        role: body.role ?? "CLASS_TEACHER",
        startsAt: body.startsAt,
        endsAt: body.endsAt,
      };
      teacherAssignments = [...teacherAssignments, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/teachers/") && request.method() === "PATCH") {
      const id = path.replace("/teachers/", "");
      const body = request.postDataJSON() as { firstName: string; lastName: string; branch?: string };
      const updated = {
        id,
        tenantId: "tenant-a",
        firstName: body.firstName,
        lastName: body.lastName,
        branch: body.branch,
      };
      teachers = teachers.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/teachers/") && path.endsWith("/purge-pii") && request.method() === "POST") {
      const id = path.replace("/teachers/", "").replace("/purge-pii", "");
      const purged = {
        ...(teachers.find((record) => record.id === id) ?? teachers[0]!),
        id,
        firstName: "Anonim",
        lastName: "Ogretmen",
      };
      teachers = teachers.map((record) => (record.id === id ? purged : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(purged)),
      });
      return;
    }

    if (path.startsWith("/teachers/") && path.includes("/assignments/") && request.method() === "DELETE") {
      const assignmentId = path.split("/").at(-1) ?? "";
      teacherAssignments = teacherAssignments.filter((assignment) => assignment.id !== assignmentId);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path.startsWith("/teachers/") && request.method() === "DELETE") {
      const id = path.replace("/teachers/", "");
      teachers = teachers.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/guardians" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(guardians, request.url())),
      });
      return;
    }

    if (path === "/guardians" && request.method() === "POST") {
      const body = request.postDataJSON() as { firstName: string; lastName: string; phone?: string };
      const created: GuardianFixture = {
        id: "guardian-created",
        tenantId: "tenant-a",
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
      };
      guardians = [...guardians, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/guardians/") && request.method() === "PATCH") {
      const id = path.replace("/guardians/", "");
      const body = request.postDataJSON() as { firstName: string; lastName: string; phone?: string };
      const updated = {
        id,
        tenantId: "tenant-a",
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
      };
      guardians = guardians.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/guardians/") && path.endsWith("/purge-pii") && request.method() === "POST") {
      const id = path.replace("/guardians/", "").replace("/purge-pii", "");
      const purged = {
        ...(guardians.find((record) => record.id === id) ?? guardians[0]!),
        id,
        firstName: "Anonim",
        lastName: "Veli",
        phone: undefined,
      };
      guardians = guardians.map((record) => (record.id === id ? purged : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(purged)),
      });
      return;
    }

    if (path.startsWith("/guardians/") && request.method() === "DELETE") {
      const id = path.replace("/guardians/", "");
      guardians = guardians.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/announcements" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(announcements, request.url())),
      });
      return;
    }

    if (path === "/announcements" && request.method() === "POST") {
      const body = request.postDataJSON() as { title: string; body: string; audience: "SCHOOL" | "TEACHERS" };
      const created = {
        id: "announcement-created",
        tenantId: "tenant-a",
        title: body.title,
        body: body.body,
        audience: body.audience,
        publishedAt: "2026-06-09T09:00:00.000Z",
      };
      announcements = [...announcements, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path === "/message-templates" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(messageTemplates, request.url())),
      });
      return;
    }

    if (path === "/message-templates" && request.method() === "POST") {
      const body = request.postDataJSON() as { name: string; channel: "SMS"; body: string };
      const created = {
        id: "message-template-created",
        tenantId: "tenant-a",
        name: body.name,
        channel: body.channel,
        body: body.body,
      };
      messageTemplates = [...messageTemplates, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/message-templates/") && request.method() === "PATCH") {
      const id = path.replace("/message-templates/", "");
      const body = request.postDataJSON() as { name: string; channel: "SMS"; body: string };
      const updated = {
        id,
        tenantId: "tenant-a",
        name: body.name,
        channel: body.channel,
        body: body.body,
      };
      messageTemplates = messageTemplates.map((template) => (template.id === id ? updated : template));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/message-templates/") && request.method() === "DELETE") {
      const id = path.replace("/message-templates/", "");
      messageTemplates = messageTemplates.filter((template) => template.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/support-tickets" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(supportTickets, request.url())),
      });
      return;
    }

    if (path.startsWith("/support-tickets/") && path.endsWith("/download") && request.method() === "GET") {
      const parts = path.split("/");
      const ticketId = parts.at(-4) ?? "";
      const attachmentId = parts.at(-2) ?? "";
      const attachment = (supportAttachments[ticketId] ?? []).find((candidate) => candidate.id === attachmentId);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: attachment ? 200 : 404,
        body: JSON.stringify(envelope({
          fileName: attachment?.fileName ?? "",
          contentType: attachment?.contentType ?? "text/plain",
          byteSize: attachment?.byteSize ?? 0,
          sha256: attachment?.sha256 ?? "",
          fileBase64: Buffer.from(attachmentId === "support-attachment-a" ? "hello world" : "ekran notu").toString("base64"),
        })),
      });
      return;
    }

    if (path.startsWith("/support-tickets/") && path.endsWith("/attachments") && request.method() === "GET") {
      const ticketId = path.split("/").at(-2) ?? "";
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(supportAttachments[ticketId] ?? [])),
      });
      return;
    }

    if (path.startsWith("/support-tickets/") && path.endsWith("/comments") && request.method() === "GET") {
      const ticketId = path.split("/").at(-2) ?? "";
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(supportComments[ticketId] ?? [])),
      });
      return;
    }

    if (path === "/support-tickets" && request.method() === "POST") {
      const body = request.postDataJSON() as { subject: string; message: string; priority: "LOW" | "NORMAL" | "HIGH" };
      const created: SupportTicketFixture = {
        id: "support-ticket-created",
        tenantId: "tenant-a",
        requesterId: "user-tenant-a",
        subject: body.subject,
        message: body.message,
        priority: body.priority,
        status: "OPEN",
        createdAt: "2026-06-09T09:00:00.000Z",
      };
      supportTickets = [created, ...supportTickets];
      supportAttachments = { ...supportAttachments, [created.id]: [] };
      supportComments = { ...supportComments, [created.id]: [] };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/support-tickets/") && path.endsWith("/attachments") && request.method() === "POST") {
      const ticketId = path.split("/").at(-2) ?? "";
      const body = request.postDataJSON() as { fileName: string; contentType: "text/plain"; fileBase64: string };
      const created = {
        id: "support-attachment-created",
        tenantId: "tenant-a",
        ticketId,
        uploadedById: "user-tenant-a",
        fileName: body.fileName,
        contentType: body.contentType,
        byteSize: 10,
        sha256: "created-sha",
        createdAt: "2026-06-09T09:05:00.000Z",
      };
      supportAttachments = {
        ...supportAttachments,
        [ticketId]: [created, ...(supportAttachments[ticketId] ?? [])],
      };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/support-tickets/") && path.endsWith("/comments") && request.method() === "POST") {
      const ticketId = path.split("/").at(-2) ?? "";
      const body = request.postDataJSON() as { body: string };
      const created = {
        id: "support-comment-created",
        tenantId: "tenant-a",
        ticketId,
        authorId: "user-tenant-a",
        body: body.body,
        createdAt: "2026-06-09T09:10:00.000Z",
      };
      supportComments = {
        ...supportComments,
        [ticketId]: [...(supportComments[ticketId] ?? []), created],
      };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/support-tickets/") && request.method() === "PATCH") {
      const id = path.replace("/support-tickets/", "");
      const body = request.postDataJSON() as { priority: "LOW" | "NORMAL" | "HIGH"; status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" };
      const updated = {
        ...(supportTickets.find((ticket) => ticket.id === id) ?? supportTickets[0]!),
        id,
        priority: body.priority,
        status: body.status,
      };
      supportTickets = supportTickets.map((ticket) => (ticket.id === id ? updated : ticket));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path === "/homework" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(homework, request.url())),
      });
      return;
    }

    if (path === "/homework/materials" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(materials, request.url())),
      });
      return;
    }

    if (path.startsWith("/homework/materials/") && path.endsWith("/files") && request.method() === "GET") {
      const materialId = path.split("/").at(-2) ?? "";
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(materialFiles[materialId] ?? [])),
      });
      return;
    }

    if (path.startsWith("/homework/materials/") && path.endsWith("/assignments") && request.method() === "GET") {
      const materialId = path.split("/").at(-2) ?? "";
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(materialAssignments[materialId] ?? [])),
      });
      return;
    }

    if (path === "/homework/materials" && request.method() === "POST") {
      const body = request.postDataJSON() as { title: string; description?: string };
      const created = {
        id: "material-created",
        tenantId: "tenant-a",
        title: body.title,
        description: body.description,
      };
      materials = [...materials, created];
      materialFiles = { ...materialFiles, [created.id]: [] };
      materialAssignments = { ...materialAssignments, [created.id]: [] };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/homework/materials/") && path.endsWith("/files") && request.method() === "POST") {
      const materialId = path.split("/").at(-2) ?? "";
      const body = request.postDataJSON() as { fileName: string; contentType: "text/plain"; fileBase64: string };
      const created = {
        id: "material-file-created",
        tenantId: "tenant-a",
        materialId,
        uploadedById: "user-tenant-a",
        fileName: body.fileName,
        contentType: body.contentType,
        byteSize: 12,
        sha256: "created-material-sha",
        createdAt: "2026-06-09T10:00:00.000Z",
      };
      materialFiles = {
        ...materialFiles,
        [materialId]: [created, ...(materialFiles[materialId] ?? [])],
      };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/homework/materials/") && path.endsWith("/assignments") && request.method() === "POST") {
      const materialId = path.split("/").at(-2) ?? "";
      const body = request.postDataJSON() as { studentId: string; note?: string; dueAt?: string };
      const created = {
        id: "material-assignment-created",
        tenantId: "tenant-a",
        materialId,
        studentId: body.studentId,
        assignedById: "user-tenant-a",
        note: body.note,
        dueAt: body.dueAt ? `${body.dueAt}T00:00:00.000Z` : undefined,
        createdAt: "2026-06-09T10:05:00.000Z",
      };
      materialAssignments = {
        ...materialAssignments,
        [materialId]: [created, ...(materialAssignments[materialId] ?? [])],
      };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/homework/materials/") && request.method() === "PATCH") {
      const id = path.replace("/homework/materials/", "");
      const body = request.postDataJSON() as { title: string; description?: string };
      const updated = {
        ...(materials.find((material) => material.id === id) ?? materials[0]!),
        title: body.title,
        description: body.description,
      };
      materials = materials.map((material) => (material.id === id ? updated : material));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/homework/materials/") && request.method() === "DELETE") {
      const id = path.replace("/homework/materials/", "");
      materials = materials.filter((material) => material.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path.startsWith("/homework/") && path.endsWith("/check-status") && request.method() === "PATCH") {
      const id = path.replace("/homework/", "").replace("/check-status", "");
      const body = request.postDataJSON() as { checked: boolean };
      homework = homework.map((record) =>
        record.id === id
          ? {
              ...record,
              checkedAt: body.checked ? "2026-06-09T10:10:00.000Z" : undefined,
              checkedBy: body.checked ? "user-tenant-a" : undefined,
            }
          : record,
      );
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(homework.find((record) => record.id === id))),
      });
      return;
    }

    if (path === "/exams/exam-a/parser-configs/suggestions" && request.method() === "POST") {
      const body = request.postDataJSON() as { fileBase64: string };
      expect(body).toEqual({ fileBase64: Buffer.from(parserFileContent).toString("base64") });
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          examId: "exam-a",
          suggestion: parserSuggestion,
          status: "suggested",
        })),
      });
      return;
    }

    if (path === "/exams/exam-a/parser-configs/approvals" && request.method() === "POST") {
      const body = request.postDataJSON() as { version: string; suggestion: typeof parserSuggestion };
      expect(body).toEqual({ version: "parser-v1", suggestion: parserSuggestion });
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          examId: "exam-a",
          version: "parser-v1",
          encoding: parserSuggestion.encoding,
          delimiter: parserSuggestion.delimiter,
          skipHeaderLines: parserSuggestion.skipHeaderLines,
          fieldMapping: parserSuggestion.fieldMapping,
          status: "APPROVED",
        })),
      });
      return;
    }

    if (path === "/exams/exam-demo/reports/snapshots/snapshot-a/students/student-a/error-booklet" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          examId: "exam-demo",
          snapshotId: "snapshot-a",
          studentId: "student-a",
          items: [
            { questionNo: 2, branch: "Matematik", answer: "C", correctAnswer: "B", status: "WRONG" },
            { questionNo: 5, branch: "Türkçe", answer: "", correctAnswer: "D", status: "BLANK" },
          ],
          generatedAt: "2026-06-08T09:00:00.000Z",
        })),
      });
      return;
    }

    if (path === "/exams/exam-demo/reports/snapshots/snapshot-b/students/student-a/error-booklet" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          examId: "exam-demo",
          snapshotId: "snapshot-b",
          studentId: "student-a",
          items: [
            { questionNo: 4, branch: "Matematik", answer: "A", correctAnswer: "D", status: "WRONG" },
          ],
          generatedAt: "2026-06-15T09:00:00.000Z",
        })),
      });
      return;
    }

    if (path === "/exams/exam-demo/reports/snapshots/snapshot-a/export.xlsx" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          fileName: "exam-demo-snapshot-a.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          fileBase64: Buffer.from("xlsx").toString("base64"),
          rowCount: 4,
        })),
      });
      return;
    }

    if (path === "/exams/exam-demo/reports/snapshots/snapshot-a/export.pdf" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          fileName: "exam-demo-snapshot-a.pdf",
          contentType: "application/pdf",
          fileBase64: Buffer.from("pdf").toString("base64"),
          pageCount: 1,
        })),
      });
      return;
    }

    if (path === "/audit-logs" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(auditLogs, request.url())),
      });
      return;
    }

    if (path === "/students" && request.method() === "GET") {
      const url = new URL(request.url());
      const classId = url.searchParams.get("classId");
      const level = url.searchParams.get("level");
      const responsibleTeacherId = url.searchParams.get("responsibleTeacherId");
      const status = url.searchParams.get("status");
      const guardianLinked = url.searchParams.get("guardianLinked");
      const classIdsByLevel = new Set(classes.filter((klass) => !level || klass.level === level).map((klass) => klass.id));
      const filteredStudents = students.filter((student) =>
        (!classId || student.classId === classId) &&
        (!level || Boolean(student.classId && classIdsByLevel.has(student.classId))) &&
        (!responsibleTeacherId || student.responsibleTeacherId === responsibleTeacherId) &&
        (!status || student.status === status) &&
        (!guardianLinked || (guardianLinked === "true" ? student.id === "student-a" : student.id !== "student-a")),
      );
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(filteredStudents, request.url())),
      });
      return;
    }

    if (path === "/students" && request.method() === "POST") {
      const body = request.postDataJSON() as Partial<StudentFixture> & { firstName: string; lastName: string };
      const created = {
        id: "student-created",
        tenantId: "tenant-a",
        firstName: body.firstName,
        lastName: body.lastName,
        classId: body.classId,
        responsibleTeacherId: body.responsibleTeacherId,
        status: body.status ?? "ACTIVE",
      };
      students = [...students, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/students/") && request.method() === "PATCH") {
      const id = path.replace("/students/", "");
      const body = request.postDataJSON() as Partial<StudentFixture> & { firstName: string; lastName: string };
      const current = students.find((student) => student.id === id) ?? students[0]!;
      const updated = {
        ...current,
        id,
        tenantId: "tenant-a",
        firstName: body.firstName,
        lastName: body.lastName,
        classId: body.classId,
        responsibleTeacherId: body.responsibleTeacherId,
        status: body.status ?? current.status,
      };
      students = students.map((student) => (student.id === id ? updated : student));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/students/") && path.endsWith("/purge-pii") && request.method() === "POST") {
      const id = path.replace("/students/", "").replace("/purge-pii", "");
      const purged = {
        ...(students.find((student) => student.id === id) ?? students[0]!),
        id,
        firstName: "Anonim",
        lastName: "Ogrenci",
      };
      students = students.map((student) => (student.id === id ? purged : student));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(purged)),
      });
      return;
    }

    if (path.startsWith("/students/") && request.method() === "DELETE") {
      const id = path.replace("/students/", "");
      students = students.filter((student) => student.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(readFixture(path))),
    });
  });

  await page.goto("/kurum");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("E-posta").fill("admin-a@example.test");
  await page.getByLabel("Şifre").fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page).toHaveURL(/\/kurum$/);
  await expect(page.getByRole("heading", { name: "Kurum Paneli" })).toBeVisible();
  await expect(page.getByLabel("Kurum özeti").getByText("2")).toBeVisible();
  await expect(page.getByLabel("Kurum özeti").getByText("1")).toBeVisible();
  await expect(page.getByLabel("Kurum özeti").getByText("3")).toBeVisible();
  await expect(page.getByLabel("Sınav sonuç özeti").getByText("Toplam 20 soru")).toBeVisible();
  await expect(page.getByLabel("Sınav sonuç özeti").locator("canvas")).toBeVisible();
  await expect(page.getByLabel("Sınıf karşılaştırması").getByText("Sınıf net karşılaştırması")).toBeVisible();
  await expect(page.getByLabel("Sınıf karşılaştırması").getByText("8-A")).toBeVisible();
  await expect(page.getByLabel("Sınıf karşılaştırması").getByText("18.25")).toBeVisible();
  await expect(page.getByLabel("Sınıf karşılaştırması").locator("canvas")).toBeVisible();
  await expect(page.getByLabel("Öğrenci gelişimi").getByText("Öğrenci gelişim grafiği")).toBeVisible();
  await expect(page.getByLabel("Öğrenci gelişimi").getByText("17.5")).toBeVisible();
  await expect(page.getByLabel("Öğrenci gelişimi").getByText("420")).toBeVisible();
  await expect(page.getByLabel("Öğrenci gelişimi").locator("canvas")).toBeVisible();
  await expect(page.getByLabel("Branş analizi").getByText("Branş net analizi")).toBeVisible();
  await expect(page.getByLabel("Branş analizi").getByText("Matematik")).toBeVisible();
  await expect(page.getByLabel("Branş analizi").getByText("11.5")).toBeVisible();
  await expect(page.getByLabel("Branş analizi").locator("canvas")).toBeVisible();
  await expect(page.getByText("Kişiler", { exact: true })).toBeVisible();
  await expect(page.getByText("Akademik", { exact: true })).toBeVisible();
  await expect(page.getByText("Sınav ve Rapor", { exact: true })).toBeVisible();
  await expect(page.getByText("İletişim", { exact: true })).toBeVisible();
  await expect(page.getByText("Operasyon", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sınıflar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kullanıcılar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Öğretmen Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğrenci Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Veli Portalı" })).toBeHidden();
  await expect(page.getByText("tenant-a", { exact: true })).toBeVisible();
  await expect(page.getByText("user-tenant-a", { exact: true })).toBeVisible();
  expect(loginCount).toBe(1);

  await page.getByRole("link", { name: "Kullanıcılar" }).click();
  await expect(page).toHaveURL(/\/kurum\/kullanicilar$/);
  await expect(page.getByRole("heading", { name: "Kullanıcılar" })).toBeVisible();
  await expect(page.getByText("Admin A")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Davetler" })).toBeVisible();
  await expect(page.getByText("ada@example.test")).toBeVisible();

  await page.getByLabel("Admin A rolleri").getByLabel("Öğretmen").check();
  await page.getByRole("button", { name: "Admin A rollerini kaydet" }).click();
  expect(rolePatchCount).toBe(1);

  await page.getByRole("button", { name: "Kullanıcı ekle" }).click();
  const userDialog = page.getByRole("dialog");
  await userDialog.getByLabel("E-posta").fill("merve@example.test");
  await userDialog.getByLabel("Ad Soyad").fill("   ");
  await userDialog.getByLabel("Şifre").fill("password123");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Ad Soyad zorunludur.")).toBeVisible();
  await userDialog.getByLabel("Ad Soyad").fill("Merve Rehber");
  await userDialog.getByLabel("Öğretmen").uncheck();
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("En az bir rol seçilmelidir.")).toBeVisible();
  await userDialog.getByLabel("Veli").check();
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Merve Rehber")).toBeVisible();
  const userList = page.getByLabel("Kullanıcı ve rol yönetimi");
  await userList.getByLabel("Ara").fill("Merve");
  await expect(userList.getByText("Merve Rehber")).toBeVisible();
  await expect(userList.getByText("Admin A")).toBeHidden();
  await userList.getByLabel("Ara").fill("");

  await page.getByRole("button", { name: "Davet oluştur" }).click();
  await page.getByRole("dialog").getByLabel("Kişi türü").selectOption("STUDENT");
  await page.getByRole("dialog").getByRole("combobox", { name: "Kişi", exact: true }).selectOption("student-a");
  await page.getByRole("dialog").getByLabel("E-posta").fill("ada-hesap@example.test");
  await page.getByRole("dialog").getByLabel("Ad Soyad").fill("Ada Hesap");
  await page.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.getByRole("cell", { name: "ada-hesap@example.test" })).toBeVisible();
  await expect(page.getByText("activation-token-created")).toBeVisible();
  const invitationList = page.getByLabel("Kimlik davetleri");
  await invitationList.getByLabel("Ara").fill("ada-hesap");
  await expect(invitationList.getByRole("cell", { name: "ada-hesap@example.test" })).toBeVisible();
  await expect(invitationList.getByText("ada@example.test")).toBeHidden();
  await invitationList.getByLabel("Ara").fill("");

  await page.getByRole("button", { name: "Ada A davetini yenile" }).click();
  await expect(page.getByText("activation-token-resent")).toBeVisible();

  await page.getByRole("link", { name: "Sınıflar" }).click();
  await expect(page).toHaveURL(/\/kurum\/siniflar$/);
  await expect(page.getByRole("heading", { name: "Sınıflar" })).toBeVisible();
  await expect(page.getByText("8-A")).toBeVisible();
  await expect(page.getByText("2 kayıt")).toBeVisible();

  await page.getByLabel("Ara").fill("8-B");
  await expect(page.getByText("8-B")).toBeVisible();
  await expect(page.getByText("8-A")).toBeHidden();
  await page.getByLabel("Sırala").selectOption("-name");
  await expect(page.getByText("1 kayıt")).toBeVisible();
  await page.getByLabel("Ara").fill("");
  await page.getByLabel("Sırala").selectOption("");
  await expect(page.getByText("8-A")).toBeVisible();

  await page.getByRole("button", { name: "Sınıf ekle" }).click();
  await page.getByLabel("Sınıf adı", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Sınıf yönetimi").getByText("Sınıf adı zorunludur.")).toBeVisible();
  await page.getByLabel("Sınıf adı", { exact: true }).fill(" 9-A ");
  await page.getByLabel("Seviye", { exact: true }).fill(" 9 ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("9-A")).toBeVisible();

  await page.getByRole("button", { name: "9-A düzenle" }).click();
  await page.getByLabel("Sınıf adı", { exact: true }).fill("9-B");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("9-B")).toBeVisible();
  await expect(page.getByText("9-A")).toBeHidden();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "9-B sil" }).click();
  await expect(page.getByText("9-B")).toBeHidden();

  await page.getByRole("link", { name: "Öğretmenler" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogretmenler$/);
  await expect(page.getByRole("heading", { name: "Öğretmenler" })).toBeVisible();
  await expect(page.getByText("Ayse Ogretmen")).toBeVisible();

  await page.getByRole("button", { name: "Ayse düzenle" }).click();
  await expect(page.getByLabel("Öğretmen atamaları").getByText("Sınıf öğretmeni · 8-A")).toBeVisible();
  await page.getByLabel("Atama rolü").selectOption("GUIDANCE_COUNSELOR");
  await page.getByLabel("Atama öğrencisi").selectOption("student-a");
  await page.getByRole("button", { name: "Atama ekle" }).click();
  await expect(page.getByLabel("Öğretmen atamaları").getByText("Rehber öğretmen · Ada A")).toBeVisible();
  await page.getByRole("button", { name: "Rehber öğretmen atamasını sil" }).click();
  await expect(page.getByLabel("Öğretmen atamaları").getByText("Rehber öğretmen · Ada A")).toBeHidden();
  await page.getByRole("button", { name: "Vazgeç" }).click();

  await page.getByRole("button", { name: "Öğretmen ekle" }).click();
  await page.getByLabel("Ad", { exact: true }).fill(" Mert ");
  await page.getByLabel("Soyad", { exact: true }).fill(" Hoca ");
  await page.getByLabel("Branş", { exact: true }).fill(" Fen ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Mert Hoca")).toBeVisible();

  await page.getByRole("button", { name: "Mert düzenle" }).click();
  await page.getByLabel("Branş", { exact: true }).fill("Fizik");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Fizik")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Mert sil" }).click();
  await expect(page.getByText("Mert Hoca")).toBeHidden();

  await page.getByRole("link", { name: "Veliler" }).click();
  await expect(page).toHaveURL(/\/kurum\/veliler$/);
  await expect(page.getByRole("heading", { name: "Veliler" })).toBeVisible();
  await expect(page.getByText("Zeynep Veli")).toBeVisible();

  await page.getByRole("button", { name: "Veli ekle" }).click();
  await page.getByLabel("Ad", { exact: true }).fill("Selin");
  await page.getByLabel("Soyad", { exact: true }).fill("Anne");
  await page.getByLabel("Telefon", { exact: true }).fill("5551112233");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Selin Anne")).toBeVisible();

  await page.getByRole("button", { name: "Selin düzenle" }).click();
  await page.getByLabel("Telefon", { exact: true }).fill("5559998877");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("5559998877")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Selin sil" }).click();
  await expect(page.getByText("Selin Anne")).toBeHidden();

  await page.getByRole("link", { name: "Öğrenciler" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler$/);
  await expect(page.getByRole("heading", { name: "Öğrenciler" })).toBeVisible();
  await expect(page.getByText("Ada A")).toBeVisible();
  const studentFilters = page.getByLabel("Öğrenci filtreleri");
  await studentFilters.getByLabel("Sınıf").selectOption("class-a");
  await expect(page.getByText("Ada A")).toBeVisible();
  await expect(page.getByText("Bora B")).toBeHidden();
  await studentFilters.getByLabel("Sınıf").selectOption("");
  await studentFilters.getByLabel("Seviye").selectOption("8");
  await expect(page.getByText("Ada A")).toBeVisible();
  await expect(page.getByText("Bora B")).toBeHidden();
  await studentFilters.getByLabel("Seviye").selectOption("");
  await studentFilters.getByLabel("Sorumlu").selectOption("teacher-a");
  await expect(page.getByText("Ada A")).toBeVisible();
  await expect(page.getByText("Bora B")).toBeHidden();
  await studentFilters.getByLabel("Sorumlu").selectOption("");
  await studentFilters.getByLabel("Durum").selectOption("PASSIVE");
  await expect(page.getByText("Can C")).toBeVisible();
  await expect(page.getByText("Ada A")).toBeHidden();
  await studentFilters.getByLabel("Durum").selectOption("");
  await studentFilters.getByLabel("Veli").selectOption("true");
  await expect(page.getByText("Ada A")).toBeVisible();
  await expect(page.getByText("Bora B")).toBeHidden();
  await studentFilters.getByLabel("Veli").selectOption("");
  await expect(page.getByText("Ada A")).toBeVisible();

  await page.getByRole("button", { name: "Ada düzenle" }).click();
  await expect(page.getByLabel("Öğrenci 360").getByText("Devamsızlık")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("Aktif")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("Sınıf geçmişi")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("500,00 TRY")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("17,5")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("2 soru")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("Problem çözme rutini güçleniyor.")).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç" }).click();

  await page.getByRole("link", { name: "Ada 360 detay" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler\/student-a$/);
  await expect(page.getByRole("heading", { name: "Ada A" })).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360 detay").getByText("Aktif", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360 detay").getByText("17,5", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360 detay").getByText("2 soru", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğretmen notları").getByText("Problem çözme rutini güçleniyor.")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi").getByText("Zeynep Veli")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi").getByText("Anne - Birincil")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi").getByText("Ödeme görür, SMS alır")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi").getByText("Destek kapalı")).toBeVisible();
  await expect(page.getByLabel("Öğretmen ilişkileri").getByText("Ayse Ogretmen")).toBeVisible();
  await expect(page.getByLabel("Öğretmen ilişkileri").getByText("Sınıf öğretmeni")).toBeVisible();
  await expect(page.getByLabel("Sınıf geçmişi").getByText("class-a")).toBeVisible();
  await expect(page.getByLabel("Sınıf geçmişi").getByText("devam ediyor")).toBeVisible();
  await expect(page.getByLabel("Denetim özeti").getByText("Öğrenci oluşturuldu")).toBeVisible();
  await expect(page.getByLabel("Denetim özeti").getByText("Veli ilişkisi kuruldu")).toBeVisible();
  await page.getByLabel("Sınav raporu").selectOption("snapshot-b");
  await expect(page.getByLabel("Öğrenci 360 detay").getByText("19,25", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360 detay").getByText("1 soru", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Öğrencilere dön" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler$/);

  await page.getByRole("button", { name: "Öğrenci ekle" }).click();
  await page.getByLabel("Ad", { exact: true }).fill("Deniz");
  await page.getByLabel("Soyad", { exact: true }).fill("Demo");
  await page.getByLabel("TC Kimlik No", { exact: true }).fill("123");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("TC Kimlik No 11 rakam olmalıdır.")).toBeVisible();
  await page.getByLabel("TC Kimlik No", { exact: true }).fill("");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Deniz Demo")).toBeVisible();

  await page.getByRole("button", { name: "Deniz düzenle" }).click();
  await page.getByLabel("Soyad", { exact: true }).fill("Güncel");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Deniz Güncel")).toBeVisible();
  await expect(page.getByText("Deniz Demo")).toBeHidden();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Deniz sil" }).click();
  await expect(page.getByText("Deniz Güncel")).toBeHidden();

  await page.getByRole("link", { name: "Duyurular" }).click();
  await expect(page).toHaveURL(/\/kurum\/duyurular$/);
  await expect(page.getByRole("heading", { name: "Duyurular" })).toBeVisible();
  await expect(page.getByText("Haftalık toplantı")).toBeVisible();

  await page.getByRole("button", { name: "Duyuru ekle" }).click();
  await page.getByLabel("Başlık", { exact: true }).fill("   ");
  await page.getByLabel("Duyuru metni", { exact: true }).fill("Geçici metin");
  await page.getByRole("button", { name: "Yayınla", exact: true }).click();
  await expect(page.getByLabel("Duyuru yönetimi").getByText("Başlık zorunludur.")).toBeVisible();
  await page.getByLabel("Başlık", { exact: true }).fill(" Sınav hazırlığı ");
  await page.getByLabel("Duyuru metni", { exact: true }).fill(" Cuma deneme sınavı yapılacaktır. ");
  await page.getByRole("combobox", { name: "Hedef" }).selectOption("SCHOOL");
  await page.getByRole("button", { name: "Yayınla", exact: true }).click();
  await expect(page.getByText("Sınav hazırlığı")).toBeVisible();
  await expect(page.getByText("Tüm okul")).toBeVisible();
  await page.getByLabel("Ara").fill("Sınav");
  await expect(page.getByText("Sınav hazırlığı")).toBeVisible();
  await expect(page.getByText("Haftalık toplantı")).toBeHidden();
  await page.getByLabel("Ara").fill("");
  await page.getByLabel("Sırala").selectOption("-title");
  await expect(page.getByText("2 kayıt")).toBeVisible();

  await page.getByRole("link", { name: "Materyaller" }).click();
  await expect(page).toHaveURL(/\/kurum\/materyaller$/);
  await expect(page.getByRole("heading", { name: "Ödev Kontrolü" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Materyal Havuzu" })).toBeVisible();
  const homeworkList = page.getByLabel("Ödev kontrolü");
  const materialList = page.getByLabel("Materyal listesi");
  await expect(homeworkList.getByText("Kesirler", { exact: true })).toBeVisible();
  await homeworkList.getByLabel("Ara").fill("Kesir");
  await expect(homeworkList.getByText("Kesirler", { exact: true })).toBeVisible();
  await homeworkList.getByLabel("Ara").fill("");
  await expect(page.getByText("0/1 ödev kontrol edildi")).toBeVisible();
  await page.getByRole("button", { name: "Kesirler kontrol et" }).click();
  await expect(page.getByText("1/1 ödev kontrol edildi")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kontrol edildi", exact: true })).toBeVisible();

  await expect(materialList.getByText("Kesirler Çalışma Kağıdı", { exact: true })).toBeVisible();
  await expect(materialList.getByText("Dosya: kesirler.txt")).toBeVisible();
  await expect(materialList.getByText("Atama: Ada A")).toBeVisible();

  await page.getByRole("button", { name: "Materyal ekle" }).click();
  await page.getByLabel("Materyal adı", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Materyal listesi").getByText("Materyal adı zorunludur.")).toBeVisible();
  await page.getByLabel("Materyal adı", { exact: true }).fill(" Problemler Föyü ");
  await page.getByLabel("Açıklama", { exact: true }).fill(" Yaş ve işçi problemleri ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Problemler Föyü", exact: true })).toBeVisible();
  await materialList.getByLabel("Ara").fill("Problemler");
  await expect(page.getByRole("cell", { name: "Problemler Föyü", exact: true })).toBeVisible();
  await expect(materialList.getByRole("cell", { name: "Kesirler Çalışma Kağıdı", exact: true })).toBeHidden();
  await materialList.getByLabel("Ara").fill("");

  const materialTools = page.getByLabel("Materyal araçları");
  await materialTools.getByLabel("Not", { exact: true }).fill("Ek tekrar");
  await materialTools.getByLabel("Teslim", { exact: true }).fill("2026-06-10");
  await materialTools.getByRole("button", { name: "Öğrenciye ata" }).click();
  await expect(page.getByLabel("Materyal listesi").getByText("Atama: Ada A")).toHaveCount(2);

  await materialTools.getByLabel("Materyal dosyası", { exact: true }).setInputFiles({
    name: "problemler.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("problem notu"),
  });
  await expect(materialTools.getByText("problemler.txt")).toBeVisible();
  await materialTools.getByRole("button", { name: "Dosya yükle" }).click();
  await expect(page.getByLabel("Materyal listesi").getByText("Dosya: problemler.txt")).toBeVisible();

  await page.getByRole("button", { name: "Problemler Föyü düzenle" }).click();
  await page.getByLabel("Materyal adı", { exact: true }).fill("Problemler Tekrar Föyü");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Problemler Tekrar Föyü", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Problemler Tekrar Föyü sil" }).click();
  await expect(page.getByLabel("Materyal listesi").getByText("Problemler Tekrar Föyü", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Optik" }).click();
  await expect(page).toHaveURL(/\/kurum\/optik$/);
  await expect(page.getByRole("heading", { name: "Optik Format" })).toBeVisible();
  await page.getByLabel("Sınav ID", { exact: true }).fill("exam-a");
  await page.locator("textarea").fill("   ");
  await page.getByRole("button", { name: "Analiz et" }).click();
  await expect(page.getByLabel("Optik format").getByText("Örnek içerik veya dosya zorunludur.")).toBeVisible();
  await page.getByLabel("Dosya", { exact: true }).setInputFiles({
    name: "ornek.dat",
    mimeType: "text/plain",
    buffer: Buffer.from(parserFileContent),
  });
  await expect(page.getByText("ornek.dat")).toBeVisible();
  await page.getByRole("button", { name: "Analiz et" }).click();
  await expect(page.getByLabel("Optik format").getByText("TAB")).toBeVisible();
  await expect(page.getByLabel("Optik format").getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Optik format").getByText("5", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Optik format").getByText("high")).toBeVisible();
  await page.getByLabel("Versiyon", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Onayla" }).click();
  await expect(page.getByLabel("Optik format").getByText("Versiyon zorunludur.")).toBeVisible();
  await page.getByLabel("Versiyon", { exact: true }).fill("parser-v1");
  await page.getByRole("button", { name: "Onayla" }).click();
  await expect(page.getByText("parser-v1 onaylandı")).toBeVisible();

  await page.getByRole("link", { name: "Raporlar" }).click();
  await expect(page).toHaveURL(/\/kurum\/raporlar$/);
  await expect(page.getByRole("heading", { name: "Sınav Raporu" })).toBeVisible();
  await page.getByLabel("Rapor sınav ID").fill("   ");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByText("Rapor sınav ID zorunludur.")).toBeVisible();
  await page.getByLabel("Rapor sınav ID").fill("exam-demo");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByLabel("Rapor özeti").getByText("READY")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Ortalama net" }).getByText("17,5")).toBeVisible();
  await expect(page.getByLabel("Sınıf ve branş özeti").getByText("Matematik: 11,5 net")).toBeVisible();
  await expect(page.getByLabel("Sınıf ve branş özeti").getByText("8-A: 18,25 net")).toBeVisible();
  await expect(page.getByLabel("Öğrenci gelişimi").getByText("+3 net / +40 puan")).toBeVisible();
  await expect(page.getByLabel("Hata kitapçığı").getByText("2 soru")).toBeVisible();
  await expect(page.getByLabel("Hata kitapçığı").getByText("2. soru Yanıt C Doğru B")).toBeVisible();
  await expect(page.getByLabel("Hata kitapçığı").getByText("5. soru Boş Doğru D")).toBeVisible();

  const reportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel indir" }).click();
  await expect((await reportDownload).suggestedFilename()).toBe("exam-demo-snapshot-a.xlsx");
  const reportPdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF indir" }).click();
  await expect((await reportPdfDownload).suggestedFilename()).toBe("exam-demo-snapshot-a.pdf");

  await page.getByRole("link", { name: "Şablonlar" }).click();
  await expect(page).toHaveURL(/\/kurum\/sablonlar$/);
  await expect(page.getByRole("heading", { name: "Şablonlar" })).toBeVisible();
  await expect(page.getByText("Sınav hatırlatma")).toBeVisible();

  await page.getByRole("button", { name: "Şablon ekle" }).click();
  await page.getByLabel("Şablon adı", { exact: true }).fill("   ");
  await page.getByLabel("Mesaj metni", { exact: true }).fill("Geçici metin");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Şablon yönetimi").getByText("Şablon adı zorunludur.")).toBeVisible();
  await page.getByLabel("Şablon adı", { exact: true }).fill(" Devamsızlık ");
  await page.getByLabel("Mesaj metni", { exact: true }).fill(" Bugün öğrenciniz devamsız görünmektedir. ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Devamsızlık")).toBeVisible();
  await page.getByLabel("Ara").fill("Devamsızlık");
  await expect(page.getByText("Devamsızlık")).toBeVisible();
  await expect(page.getByText("Sınav hatırlatma")).toBeHidden();
  await page.getByLabel("Ara").fill("");

  await page.getByRole("button", { name: "Devamsızlık düzenle" }).click();
  await page.getByLabel("Mesaj metni", { exact: true }).fill("Bugün öğrenciniz derse katılmadı.");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Bugün öğrenciniz derse katılmadı.")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Devamsızlık sil" }).click();
  await expect(page.getByText("Devamsızlık")).toBeHidden();

  await page.getByRole("link", { name: "Destek" }).click();
  await expect(page).toHaveURL(/\/kurum\/destek$/);
  await expect(page.getByRole("heading", { name: "Destek" })).toBeVisible();
  const supportList = page.getByLabel("Destek bildirimi yönetimi");
  await expect(page.getByRole("cell", { name: "Optik dosya okunmuyor", exact: true })).toBeVisible();
  await expect(page.getByLabel("Destek ek ve yorum listesi").getByText("Ek: hata-ekrani.txt")).toBeVisible();
  await expect(page.getByLabel("Destek ek ve yorum listesi").getByText("Yorum: İlk kontrol yapıldı.")).toBeVisible();

  const existingAttachmentDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "hata-ekrani.txt indir" }).click();
  await expect((await existingAttachmentDownload).suggestedFilename()).toBe("hata-ekrani.txt");

  await page.getByRole("button", { name: "Ek yükle" }).click();
  await expect(page.getByLabel("Destek bildirimi yönetimi").getByText("Destek eki zorunludur.")).toBeVisible();
  await page.getByLabel("Yorum", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Yorum ekle" }).click();
  await expect(page.getByLabel("Destek bildirimi yönetimi").getByText("Yorum zorunludur.")).toBeVisible();

  await page.getByRole("button", { name: "Destek bildirimi aç" }).click();
  await page.getByLabel("Konu", { exact: true }).fill("   ");
  await page.getByLabel("Mesaj", { exact: true }).fill("Geçici mesaj");
  await page.getByRole("button", { name: "Aç", exact: true }).click();
  await expect(page.getByLabel("Destek bildirimi yönetimi").getByText("Konu zorunludur.")).toBeVisible();
  await page.getByLabel("Konu", { exact: true }).fill(" Sınav sistemi ");
  await page.getByLabel("Mesaj", { exact: true }).fill(" Rapor ekranı açılmıyor. ");
  await page.getByRole("combobox", { name: "Öncelik" }).selectOption("HIGH");
  await page.getByRole("button", { name: "Aç", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Sınav sistemi", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Yüksek", exact: true })).toBeVisible();
  await supportList.getByLabel("Ara").fill("Sınav");
  await expect(page.getByRole("cell", { name: "Sınav sistemi", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Optik dosya okunmuyor", exact: true })).toBeHidden();
  await supportList.getByLabel("Ara").fill("");

  await page.getByRole("button", { name: "Sınav sistemi çözüldü" }).click();
  await expect(page.getByRole("cell", { name: "Çözüldü", exact: true })).toBeVisible();

  await page.getByLabel("Destek eki", { exact: true }).setInputFiles({
    name: "ekran.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("ekran notu"),
  });
  await page.getByRole("button", { name: "Ek yükle" }).click();
  await expect(page.getByLabel("Destek ek ve yorum listesi").getByText("Ek: ekran.txt")).toBeVisible();

  await page.getByLabel("Yorum", { exact: true }).fill("Sorunu yeniden denedik.");
  await page.getByRole("button", { name: "Yorum ekle" }).click();
  await expect(page.getByLabel("Destek ek ve yorum listesi").getByText("Yorum: Sorunu yeniden denedik.")).toBeVisible();

  const createdAttachmentDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "ekran.txt indir" }).click();
  await expect((await createdAttachmentDownload).suggestedFilename()).toBe("ekran.txt");

  await page.getByRole("link", { name: "Denetim" }).click();
  await expect(page).toHaveURL(/\/kurum\/denetim$/);
  await expect(page.getByRole("heading", { name: "Denetim" })).toBeVisible();
  await expect(page.getByText("student.created")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Announcement", exact: true })).toBeVisible();
  await page.getByLabel("Ara").fill("Announcement");
  await expect(page.getByRole("cell", { name: "Announcement", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Student", exact: true })).toBeHidden();
  await page.getByLabel("Ara").fill("");

  await page.getByRole("link", { name: "KVKK" }).click();
  await expect(page).toHaveURL(/\/kurum\/kvkk$/);
  await expect(page.getByRole("heading", { name: "KVKK" })).toBeVisible();
  await expect(page.getByText("Ada A")).toBeVisible();
  await expect(page.getByText("Ayse Ogretmen")).toBeVisible();
  await expect(page.getByText("Zeynep Veli")).toBeVisible();

  await page.getByRole("button", { name: "Ada PII temizle" }).click();
  await expect(page.getByText("Anonim Ogrenci")).toBeVisible();
  await expect(page.getByText("Ada A")).toBeHidden();

  const storageKeys = await page.evaluate(([first, second]) => ({
    first: Object.keys(window[first as keyof Window] as Storage),
    second: Object.keys(window[second as keyof Window] as Storage),
  }), ["local" + "Storage", "session" + "Storage"]);
  expect(storageKeys.first).toEqual([]);
  expect(storageKeys.second).toEqual([]);
});

test("Next rol portalları bağlı kişi verisini gösterir", async ({ page }) => {
  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.continue();
  });

  await page.route("**/auth/refresh", async (route) => {
    await route.fulfill({ headers: corsHeaders, status: 401 });
  });

  await page.route("**/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { email: string };
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse(body.email))),
    });
  });

  await page.route("**/auth/logout", async (route) => {
    await route.fulfill({ headers: corsHeaders, status: 204 });
  });

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }

    expect(route.request().headers().authorization).toBe("Bearer next-access-token");
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(readPortalFixture(path))),
    });
  });

  await loginAs(page, "student-a@example.test");
  await expect(page).toHaveURL(/\/ogrenci$/);
  await expect(page.getByRole("link", { name: "Öğrenci Portalı" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kurum", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğretmen Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Veli Portalı" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Öğrenci Portalı" })).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Ada A")).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Bireysel tekrar")).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("17,5")).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("1 soru")).toBeVisible();
  await expect(page.getByLabel("Devamsızlık").getByText("ABSENT")).toBeVisible();
  await expect(page.getByLabel("Öğretmen notları").getByText("Problem çözme rutini güçleniyor.")).toBeVisible();

  await page.getByRole("button", { name: "Çıkış" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs(page, "teacher-a@example.test");
  await expect(page).toHaveURL(/\/ogretmen$/);
  await expect(page.getByRole("link", { name: "Öğretmen Portalı" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kurum", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğrenci Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Veli Portalı" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Öğretmen Portalı" })).toBeVisible();
  await expect(page.getByLabel("Ders programı").getByText("Matematik")).toBeVisible();

  await page.getByRole("button", { name: "Çıkış" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs(page, "guardian-a@example.test");
  await expect(page).toHaveURL(/\/veli$/);
  await expect(page.getByRole("link", { name: "Veli Portalı" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kurum", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğretmen Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğrenci Portalı" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Veli Portalı" })).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Bireysel tekrar")).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("17,5")).toBeVisible();
  await expect(page.getByText("500,00 TRY")).toBeVisible();
  await expect(page.getByLabel("Ödeme planları").getByText("2026 Haziran ödeme planı")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("*******0146")).toBeVisible();
});

async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  const homeUrlByEmail: Record<string, RegExp> = {
    "student-a@example.test": /\/ogrenci$/,
    "teacher-a@example.test": /\/ogretmen$/,
    "guardian-a@example.test": /\/veli$/,
  };
  await expect(page).toHaveURL(homeUrlByEmail[email] ?? /\/kurum$/);
}

function createAuthResponse(email = "admin-a@example.test") {
  const profileByEmail: Record<string, { userId: string; roles: string[]; subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER"; subjectId?: string }> = {
    "student-a@example.test": { userId: "student-tenant-a", roles: ["STUDENT"], subjectType: "STUDENT", subjectId: "student-a" },
    "teacher-a@example.test": { userId: "teacher-tenant-a", roles: ["TEACHER"], subjectType: "TEACHER", subjectId: "teacher-a" },
    "guardian-a@example.test": { userId: "guardian-tenant-a", roles: ["GUARDIAN"], subjectType: "GUARDIAN", subjectId: "guardian-a" },
  };
  const profile = profileByEmail[email] ?? { userId: "user-tenant-a", roles: ["TENANT_ADMIN"] };
  return {
    accessToken: "next-access-token",
    session: {
      id: "session-a",
      userId: profile.userId,
      tenantId: "tenant-a",
      roles: profile.roles,
      membershipVersion: 1,
      status: "ACTIVE",
      subjectType: profile.subjectType,
      subjectId: profile.subjectId,
    },
  };
}

function readPortalFixture(path: string) {
  if (path === "/classes") return [];
  if (path === "/teachers") return [];
  if (path === "/students") return [];
  if (path === "/me/student/profile" || path === "/me/guardian/students/student-a/profile") {
    return {
      id: "student-a",
      tenantId: "tenant-a",
      firstName: "Ada",
      lastName: "A",
      nationalIdMasked: "*******0146",
      phone: "5551234567",
    };
  }
  if (path === "/me/student/attendance" || path === "/me/guardian/students/student-a/attendance") {
    return [{ id: "attendance-a", tenantId: "tenant-a", studentId: "student-a", date: "2026-06-03", status: "ABSENT" }];
  }
  if (path === "/me/student/attendance/summary" || path === "/me/guardian/students/student-a/attendance/summary") {
    return { studentId: "student-a", total: 1, present: 0, absent: 1, late: 0, excused: 0 };
  }
  if (path === "/me/student/homework/material-assignments" || path === "/me/guardian/homework/material-assignments") {
    return [
      {
        id: "material-assignment-a",
        tenantId: "tenant-a",
        materialId: "material-a",
        studentId: "student-a",
        assignedById: "teacher-a",
        note: "Bireysel tekrar",
        dueAt: "2026-06-09T12:00:00.000Z",
        createdAt: "2026-06-08T09:20:00.000Z",
      },
    ];
  }
  if (path === "/me/student/teacher-notes" || path === "/me/guardian/students/student-a/teacher-notes") {
    return [
      {
        id: "teacher-note-visible-a",
        tenantId: "tenant-a",
        studentId: "student-a",
        teacherId: "teacher-a",
        visibility: "GUARDIAN_STUDENT",
        body: "Problem çözme rutini güçleniyor.",
        developmentStatus: "IMPROVING",
        createdAt: "2026-06-04T10:00:00.000Z",
      },
    ];
  }
  if (path === "/me/student/reports/exam-demo/latest" || path === "/me/guardian/students/student-a/reports/exam-demo/latest") {
    return {
      tenantId: "tenant-a",
      examId: "exam-demo",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      classId: "class-a",
      className: "8-A",
      resultKey: "student-a",
      total: {
        correct: 18,
        wrong: 2,
        blank: 0,
        net: 17.5,
        standardScore: 420,
      },
      branches: [{ branch: "Matematik", correct: 18, wrong: 2, blank: 0, net: 17.5 }],
      generatedAt: "2026-06-08T09:00:00.000Z",
    };
  }
  if (
    path === "/me/student/reports/exam-demo/latest/error-booklet" ||
    path === "/me/guardian/students/student-a/reports/exam-demo/latest/error-booklet"
  ) {
    return {
      tenantId: "tenant-a",
      examId: "exam-demo",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      items: [
        {
          questionNo: 7,
          branch: "Matematik",
          answer: "B",
          correctAnswer: "D",
          status: "WRONG",
        },
      ],
      generatedAt: "2026-06-08T09:00:00.000Z",
    };
  }
  if (path === "/me/student/reports/exam-demo/progress" || path === "/me/guardian/students/student-a/reports/exam-demo/progress") {
    return {
      tenantId: "tenant-a",
      examId: "exam-demo",
      studentId: "student-a",
      points: [
        { snapshotId: "snapshot-prev", generatedAt: "2026-05-25T09:00:00.000Z", total: { net: 14.5, standardScore: 380 } },
        { snapshotId: "snapshot-a", generatedAt: "2026-06-08T09:00:00.000Z", total: { net: 17.5, standardScore: 420 } },
      ],
      netDelta: 3,
      standardScoreDelta: 40,
    };
  }
  if (path === "/me/guardian/students") {
    return [{ id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A" }];
  }
  if (path === "/me/guardian/students/student-a/payment-plans") {
    return [
      {
        id: "payment-plan-a",
        tenantId: "tenant-a",
        studentId: "student-a",
        title: "2026 Haziran ödeme planı",
        totalAmount: 100000,
        currency: "TRY",
        createdAt: "2026-06-05T09:00:00.000Z",
        installments: [
          {
            id: "payment-installment-a-1",
            tenantId: "tenant-a",
            planId: "payment-plan-a",
            installmentNo: 1,
            amount: 50000,
            dueDate: "2026-07-01",
            status: "PENDING",
            createdAt: "2026-06-05T09:00:00.000Z",
          },
        ],
      },
    ];
  }
  if (path === "/me/teacher") {
    return { id: "teacher-a", tenantId: "tenant-a", firstName: "Ayse", lastName: "Ogretmen", branch: "Matematik" };
  }
  if (path === "/me/teacher/schedule") {
    return [
      {
        id: "schedule-a",
        tenantId: "tenant-a",
        classId: "class-a",
        teacherId: "teacher-a",
        title: "Matematik",
        startsAt: "2026-06-10T09:00:00.000Z",
        endsAt: "2026-06-10T10:00:00.000Z",
      },
    ];
  }
  return readFixture(path);
}

function readFixture(path: string) {
  if (path === "/exams") {
    return [
      {
        id: "exam-demo",
        tenantId: "tenant-a",
        title: "LGS deneme sınavı",
        status: "PUBLISHED",
        startsAt: "2026-06-08T09:00:00.000Z",
        createdAt: "2026-06-01T09:00:00.000Z",
        updatedAt: "2026-06-01T09:00:00.000Z",
      },
    ];
  }

  if (path === "/exams/exam-demo/reports/snapshots") {
    return [
      {
        id: "snapshot-a",
        tenantId: "tenant-a",
        examId: "exam-demo",
        reportType: "EXAM_SUMMARY",
        status: "READY",
        inputRefs: {},
        snapshotData: {
          resultCount: 3,
          averages: {
            correct: 18,
            wrong: 2,
            blank: 0,
            net: 17.5,
            standardScore: 420,
          },
          branches: [
            {
              branch: "Matematik",
              resultCount: 3,
              correct: 12,
              wrong: 1,
              blank: 0,
              net: 11.5,
            },
            {
              branch: "Türkçe",
              resultCount: 3,
              correct: 6,
              wrong: 1,
              blank: 0,
              net: 5.75,
            },
          ],
          classes: [
            {
              classId: "class-a",
              className: "8-A",
              resultCount: 2,
              averages: {
                correct: 18,
                wrong: 1,
                blank: 1,
                net: 18.25,
                standardScore: 430,
              },
            },
            {
              classId: "class-b",
              className: "8-B",
              resultCount: 1,
              averages: {
                correct: 16,
                wrong: 3,
                blank: 1,
                net: 15.25,
                standardScore: 390,
              },
            },
          ],
          students: [
            {
              studentId: "student-a",
              resultKey: "student-a",
              total: {
                correct: 18,
                wrong: 2,
                blank: 0,
                net: 17.5,
                standardScore: 420,
              },
            },
          ],
        },
        createdAt: "2026-06-08T09:00:00.000Z",
        updatedAt: "2026-06-08T09:00:00.000Z",
      },
      {
        id: "snapshot-b",
        tenantId: "tenant-a",
        examId: "exam-demo",
        reportType: "EXAM_SUMMARY",
        status: "READY",
        inputRefs: {},
        snapshotData: {
          resultCount: 3,
          generatedAt: "2026-06-15T09:00:00.000Z",
          averages: {
            correct: 18,
            wrong: 2,
            blank: 0,
            net: 19.25,
            standardScore: 440,
          },
          branches: [
            {
              branch: "Matematik",
              resultCount: 3,
              correct: 12,
              wrong: 1,
              blank: 0,
              net: 11.5,
            },
            {
              branch: "Türkçe",
              resultCount: 3,
              correct: 6,
              wrong: 1,
              blank: 0,
              net: 5.75,
            },
          ],
          classes: [
            {
              classId: "class-a",
              className: "8-A",
              resultCount: 2,
              averages: {
                correct: 18,
                wrong: 1,
                blank: 1,
                net: 18.25,
                standardScore: 440,
              },
            },
            {
              classId: "class-b",
              className: "8-B",
              resultCount: 1,
              averages: {
                correct: 16,
                wrong: 3,
                blank: 1,
                net: 15.25,
                standardScore: 390,
              },
            },
          ],
          students: [
            {
              studentId: "student-a",
              resultKey: "student-a",
              total: {
                correct: 20,
                wrong: 3,
                blank: 0,
                net: 19.25,
                standardScore: 440,
              },
            },
          ],
        },
        createdAt: "2026-06-15T09:00:00.000Z",
        updatedAt: "2026-06-15T09:00:00.000Z",
      },
    ];
  }

  if (path === "/exams/exam-demo/reports/snapshots/snapshot-a/students/student-a") {
    return {
      tenantId: "tenant-a",
      examId: "exam-demo",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      classId: "class-a",
      className: "8-A",
      resultKey: "student-a",
      total: {
        correct: 18,
        wrong: 2,
        blank: 0,
        net: 17.5,
        standardScore: 420,
      },
      branches: [
        {
          branch: "Matematik",
          correct: 18,
          wrong: 2,
          blank: 0,
          net: 17.5,
        },
      ],
      generatedAt: "2026-06-08T09:00:00.000Z",
    };
  }

  if (path === "/exams/exam-demo/reports/snapshots/snapshot-b/students/student-a") {
    return {
      tenantId: "tenant-a",
      examId: "exam-demo",
      snapshotId: "snapshot-b",
      studentId: "student-a",
      classId: "class-a",
      className: "8-A",
      resultKey: "student-a",
      total: {
        correct: 20,
        wrong: 3,
        blank: 0,
        net: 19.25,
        standardScore: 440,
      },
      branches: [
        {
          branch: "Matematik",
          correct: 20,
          wrong: 3,
          blank: 0,
          net: 19.25,
        },
      ],
      generatedAt: "2026-06-15T09:00:00.000Z",
    };
  }

  if (path === "/exams/exam-demo/reports/students/student-a/progress") {
    return {
      tenantId: "tenant-a",
      examId: "exam-demo",
      studentId: "student-a",
      points: [
        {
          snapshotId: "snapshot-prev",
          generatedAt: "2026-05-25T09:00:00.000Z",
          total: {
            net: 14.5,
            standardScore: 380,
          },
        },
        {
          snapshotId: "snapshot-a",
          generatedAt: "2026-06-08T09:00:00.000Z",
          total: {
            net: 17.5,
            standardScore: 420,
          },
        },
      ],
      netDelta: 3,
      standardScoreDelta: 40,
    };
  }

  if (path === "/students/student-a/profile") {
    return {
      id: "student-a",
      tenantId: "tenant-a",
      firstName: "Ada",
      lastName: "A",
      classId: "class-a",
      status: "ACTIVE",
      nationalIdMasked: "*******0146",
      phone: "5551234567",
    };
  }

  if (path === "/students/student-a/class-history") {
    return [{
      id: "student-class-history-a",
      tenantId: "tenant-a",
      studentId: "student-a",
      classId: "class-a",
      startsAt: "2026-06-01",
      reason: "CREATED",
    }];
  }

  if (path === "/students/student-a/guardians") {
    return [{ id: "guardian-a", tenantId: "tenant-a", firstName: "Zeynep", lastName: "Veli", phone: "5550000000" }];
  }

  if (path === "/students/student-a/guardian-links") {
    return [{
      id: "guardian-student-a",
      tenantId: "tenant-a",
      guardianId: "guardian-a",
      studentId: "student-a",
      relationshipType: "MOTHER",
      isPrimary: true,
      canViewFinance: true,
      canReceiveSms: true,
      canReceiveAnnouncements: true,
      canOpenSupportTickets: false,
      createdAt: "2026-06-08T09:30:00.000Z",
      updatedAt: "2026-06-08T09:30:00.000Z",
    }];
  }

  if (path === "/students/student-a/teacher-assignments") {
    return [{
      id: "teacher-assignment-class-a",
      tenantId: "tenant-a",
      teacherId: "teacher-a",
      classId: "class-a",
      role: "CLASS_TEACHER",
      createdAt: "2026-06-08T09:40:00.000Z",
      updatedAt: "2026-06-08T09:40:00.000Z",
    }];
  }

  if (path === "/attendance/summary") {
    return { studentId: "student-a", total: 1, present: 0, absent: 1, late: 0, excused: 0 };
  }

  if (path === "/teacher-notes") {
    return [
      {
        id: "teacher-note-visible-a",
        tenantId: "tenant-a",
        studentId: "student-a",
        teacherId: "teacher-a",
        visibility: "GUARDIAN_STUDENT",
        body: "Problem çözme rutini güçleniyor.",
        developmentStatus: "IMPROVING",
        createdAt: "2026-06-04T10:00:00.000Z",
      },
    ];
  }

  if (path === "/payment-plans") {
    return [
      {
        id: "payment-plan-a",
        tenantId: "tenant-a",
        studentId: "student-a",
        title: "2026 Haziran ödeme planı",
        totalAmount: 100000,
        currency: "TRY",
        createdAt: "2026-06-05T09:00:00.000Z",
        installments: [
          {
            id: "payment-installment-a-1",
            tenantId: "tenant-a",
            planId: "payment-plan-a",
            installmentNo: 1,
            amount: 50000,
            dueDate: "2026-07-01",
            status: "PENDING",
            createdAt: "2026-06-05T09:00:00.000Z",
          },
        ],
      },
    ];
  }

  return [];
}
