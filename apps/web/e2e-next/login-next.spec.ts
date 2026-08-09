import { createHash } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const appOrigin = `http://localhost:${process.env.NEXT_E2E_PORT ?? "3001"}`;
const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,PUT,OPTIONS",
  "access-control-allow-origin": appOrigin,
};
const smsEnabled = process.env.NEXT_PUBLIC_SMS_ENABLED === "true";

function heading(page: Page, options: Parameters<Page["getByRole"]>[1]) {
  return page.getByRole("heading", options).first();
}

async function expandSidebarGroup(page: Page, name: string) {
  const groupButton = page.getByRole("navigation", { name: "Ana menü" }).getByRole("button", { name, exact: true });
  if ((await groupButton.getAttribute("aria-expanded")) !== "true") {
    await groupButton.click();
  }
}

async function clickSidebarLink(page: Page, name: string, url: RegExp) {
  const link = page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name, exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(url, { timeout: 15_000 });
}

async function fillReportExamReference(page: Page, examId: string) {
  await page.getByLabel("Rapor kontrol alanı").getByRole("combobox", { name: "Sınav" }).selectOption(examId.trim());
}

async function confirmDeleteDialog(page: Page, name: string, message: string) {
  const confirmDialog = page.getByRole("dialog", { name });
  await expect(confirmDialog.getByText(message)).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Sil" }).click();
}

async function openCommandPalette(page: Page) {
  await page.getByRole("button", { name: "Komut paleti" }).click();
  const dialog = page.getByRole("dialog", { name: "Komut paleti" });
  await expect(dialog).toBeVisible();
  return dialog;
}

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

async function capturePortalKarneVisualEvidence(page: Page, testInfo: TestInfo, label: string) {
  await captureVisualEvidence(page, testInfo, "Sınav raporu", label);
}

async function captureVisualEvidence(page: Page, testInfo: TestInfo, ariaLabel: string, label: string) {
  if (process.env.KARNE_VISUAL_EVIDENCE !== "1") return;

  const path = testInfo.outputPath(`${label}.png`);
  const buffer = await page.getByLabel(ariaLabel).screenshot({ path });
  const metadata = readPngMetadata(buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  console.log(`karne-visual-evidence ${label} ${metadata.width}x${metadata.height} sha256=${sha256} path=${path}`);
}

function readPngMetadata(buffer: Buffer) {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
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

function buildIsemProgress(examId: string) {
  return {
    tenantId: "tenant-a",
    examId,
    studentId: "student-a",
    points: [
      {
        snapshotId: "snapshot-progress-palme",
        examTitle: "PALME - TİS ENERJİ LGS - 8",
        generatedAt: "2026-05-26T09:00:00.000Z",
        total: { net: 82.01, questionCount: 90, standardScore: 430 },
        branches: [
          { branch: "TÜRKÇE", net: 18.67 },
          { branch: "İNKILAP TARİHİ", net: 8.67 },
          { branch: "DİN KÜLTÜRÜ", net: 7.33 },
          { branch: "İNGİLİZCE", net: 10 },
          { branch: "MATEMATİK", net: 18.67 },
          { branch: "FEN BİLİMLERİ", net: 18.67 },
        ],
      },
      {
        snapshotId: "snapshot-progress-ozdebir",
        examTitle: "ÖZDEBİR - TG LGS - 5",
        generatedAt: "2026-05-26T09:00:00.000Z",
        total: { net: 84.66, questionCount: 90, standardScore: 440 },
        branches: [
          { branch: "TÜRKÇE", net: 17.33 },
          { branch: "İNKILAP TARİHİ", net: 10 },
          { branch: "DİN KÜLTÜRÜ", net: 10 },
          { branch: "İNGİLİZCE", net: 10 },
          { branch: "MATEMATİK", net: 20 },
          { branch: "FEN BİLİMLERİ", net: 17.33 },
        ],
      },
      {
        snapshotId: "snapshot-progress-sempatik",
        examTitle: "SEMPATİK - LGS - 6",
        generatedAt: "2026-05-23T09:00:00.000Z",
        total: { net: 79.33, questionCount: 90, standardScore: 410 },
        branches: [
          { branch: "TÜRKÇE", net: 18.67 },
          { branch: "İNKILAP TARİHİ", net: 10 },
          { branch: "DİN KÜLTÜRÜ", net: 8.67 },
          { branch: "İNGİLİZCE", net: 7.33 },
          { branch: "MATEMATİK", net: 17.33 },
          { branch: "FEN BİLİMLERİ", net: 17.33 },
        ],
      },
      {
        snapshotId: "snapshot-progress-hiz",
        examTitle: "HIZ - TG LGS - 7",
        generatedAt: "2026-05-23T09:00:00.000Z",
        total: { net: 80.67, questionCount: 90, standardScore: 420 },
        branches: [
          { branch: "TÜRKÇE", net: 17.33 },
          { branch: "İNKILAP TARİHİ", net: 10 },
          { branch: "DİN KÜLTÜRÜ", net: 10 },
          { branch: "İNGİLİZCE", net: 10 },
          { branch: "MATEMATİK", net: 18.67 },
          { branch: "FEN BİLİMLERİ", net: 14.67 },
        ],
      },
      {
        snapshotId: "snapshot-progress-ankara",
        examTitle: "ANKARA - LGS - 3 KALA",
        generatedAt: "2026-05-20T09:00:00.000Z",
        total: { net: 83.34, questionCount: 90, standardScore: 435 },
        branches: [
          { branch: "TÜRKÇE", net: 17.33 },
          { branch: "İNKILAP TARİHİ", net: 10 },
          { branch: "DİN KÜLTÜRÜ", net: 10 },
          { branch: "İNGİLİZCE", net: 8.67 },
          { branch: "MATEMATİK", net: 18.67 },
          { branch: "FEN BİLİMLERİ", net: 18.67 },
        ],
      },
    ],
    netDelta: 3,
    standardScoreDelta: 40,
    successRateDelta: 3.3,
  };
}

function closeActiveEnrollments(
  records: StudentEnrollmentFixture[],
  studentId: string,
  endsAt: string,
  status?: StudentEnrollmentFixture["status"],
): StudentEnrollmentFixture[] {
  return records.map((record) =>
    record.studentId === studentId && !record.endsAt
      ? { ...record, endsAt, status: status ?? record.status }
      : record,
  );
}

type CampusFixture = { id: string; tenantId: string; name: string; code?: string };
type GradeLevelFixture = { id: string; tenantId: string; name: string; code?: string };
type ClassFixture = {
  id: string;
  tenantId: string;
  name: string;
  level?: string;
  campusId?: string;
  gradeLevelId?: string;
  section?: string;
};
type CourseFixture = { id: string; tenantId: string; name: string; code?: string };
type LearningOutcomeFixture = {
  id: string;
  tenantId: string;
  code: string;
  branch: string;
  title: string;
  level?: string;
};
type ExamFixture = {
  id: string;
  tenantId: string;
  title: string;
  status: "DRAFT" | "PUBLISHED";
  answerKeySummary?: {
    status: "MISSING" | "DRAFT" | "PUBLISHED";
    version?: string;
    questionCount?: number;
    branchCount?: number;
    updatedAt?: string;
  };
  startsAt?: string;
  createdAt: string;
  updatedAt: string;
};
type ExamParticipantFixture = {
  id: string;
  tenantId: string;
  examId: string;
  studentId: string;
  participantNo?: string;
  bookletType?: string;
  status: "REGISTERED" | "ATTENDED" | "ABSENT";
  createdAt: string;
  updatedAt: string;
};
type ImportQuarantineFixture = {
  id: string;
  tenantId: string;
  examId: string;
  rawImportId: string;
  rowNumber: number;
  rawRow: Record<string, unknown>;
  reason: string;
  status: "OPEN" | "RESOLVED";
  resolvedStudentId?: string;
  createdAt: string;
  updatedAt: string;
  evaluationJob?: {
    queueName: "exam-evaluation";
    jobId: string;
    status: "queued";
  };
};

function automaticTargetClassId(
  sourceClassId: string | undefined,
  classes: ClassFixture[],
  gradeLevels: GradeLevelFixture[],
): string | undefined {
  const sourceClass = classes.find((klass) => klass.id === sourceClassId);
  if (!sourceClass) return undefined;

  const gradeLevelById = new Map(gradeLevels.map((gradeLevel) => [gradeLevel.id, gradeLevel]));
  const sourceCode = sourceClass.gradeLevelId ? gradeLevelById.get(sourceClass.gradeLevelId)?.code : undefined;
  if (!sourceCode || !/^\d+$/.test(sourceCode)) return undefined;
  const targetCode = String(Number.parseInt(sourceCode, 10) + 1);
  return classes.find((klass) =>
    klass.id !== sourceClass.id &&
    (klass.gradeLevelId ? gradeLevelById.get(klass.gradeLevelId)?.code : undefined) === targetCode &&
    (!sourceClass.campusId || klass.campusId === sourceClass.campusId) &&
    (!sourceClass.section || klass.section === sourceClass.section),
  )?.id;
}

function filterByStudentClass<TRecord extends { studentId: string }>(
  records: TRecord[],
  students: StudentFixture[],
  classId: string | null,
): TRecord[] {
  if (!classId) return records;
  const studentIds = new Set(students.filter((student) => student.classId === classId).map((student) => student.id));
  return records.filter((record) => studentIds.has(record.studentId));
}

type AcademicYearFixture = {
  id: string;
  tenantId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};
type AcademicTermFixture = AcademicYearFixture & {
  academicYearId: string;
};
type ScheduleLessonFixture = {
  id: string;
  tenantId: string;
  classId: string;
  teacherId: string;
  courseId?: string;
  termId?: string;
  title: string;
  startsAt: string;
  endsAt: string;
};
type StudySessionFixture = ScheduleLessonFixture & {
  studentIds: string[];
  capacity: number;
};
type TeacherFixture = { id: string; tenantId: string; firstName: string; lastName: string; branch?: string };
type AttendanceFixture = {
  id: string;
  tenantId: string;
  studentId: string;
  courseId?: string;
  termId?: string;
  date: string;
  status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
};
type TeacherAssignmentFixture = {
  id: string;
  tenantId: string;
  teacherId: string;
  classId?: string;
  studentId?: string;
  courseId?: string;
  termId?: string;
  role: "CLASS_TEACHER" | "BRANCH_TEACHER" | "GUIDANCE_COUNSELOR" | "RESPONSIBLE_TEACHER";
  startsAt?: string;
  endsAt?: string;
};
type TeacherNoteFixture = {
  id: string;
  tenantId: string;
  studentId: string;
  teacherId: string;
  courseId?: string;
  termId?: string;
  visibility: "INTERNAL" | "GUARDIAN_STUDENT";
  body: string;
  developmentStatus?: string;
  createdAt: string;
};
type GuardianFixture = { id: string; tenantId: string; firstName: string; lastName: string; phone?: string };
type GuardianStudentFixture = {
  id: string;
  tenantId: string;
  guardianId: string;
  studentId: string;
  canViewFinance: boolean;
  canReceiveSms: boolean;
  canReceiveAnnouncements: boolean;
  canOpenSupportTickets: boolean;
  createdAt: string;
  updatedAt: string;
};
type StudentFixture = {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  studentNo?: string;
  classId?: string;
  responsibleTeacherId?: string;
  status: "ACTIVE" | "PASSIVE" | "GRADUATED" | "TRANSFERRED";
};
type StudentEnrollmentFixture = {
  id: string;
  tenantId: string;
  studentId: string;
  academicYearId?: string;
  termId?: string;
  classId?: string;
  status: StudentFixture["status"];
  startsAt: string;
  endsAt?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
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
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};
type SupportTicketFixture = {
  id: string;
  tenantId: string;
  requesterId: string;
  studentId?: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  subject: string;
  message: string;
  priority: "LOW" | "NORMAL" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  createdAt: string;
};
type AnnouncementFixture = {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  audience: "SCHOOL" | "TEACHERS" | "STUDENTS" | "GUARDIANS";
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  publishedAt: string;
  readAt?: string;
};
type NotificationDeviceFixture = {
  id: string;
  tenantId: string;
  userId: string;
  provider: string;
  token: string;
  platform?: string;
  lastSeenAt: string;
  disabledAt?: string;
};
type ReportSnapshotFixture = {
  id: string;
  tenantId: string;
  examId: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  reportType: string;
  status: string;
  inputRefs: Record<string, unknown>;
  snapshotData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
type ReportGenerationRequestFixture = {
  reportType?: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
};
type PaymentInstallmentFixture = {
  id: string;
  tenantId: string;
  planId: string;
  installmentNo: number;
  amount: number;
  dueDate: string;
  status: "PENDING" | "PAID" | "OVERDUE" | "CANCELED";
  paidAt?: string;
  createdAt: string;
};
type PaymentPlanFixture = {
  id: string;
  tenantId: string;
  studentId: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  title: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  installments: PaymentInstallmentFixture[];
};

test("Next login gerçek auth store ile kurum paneline geçer", async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(5_000);

  let loginCount = 0;
  let students: StudentFixture[] = [
    {
      id: "student-a",
      tenantId: "tenant-a",
      firstName: "Ada",
      lastName: "A",
      studentNo: "176",
      classId: "class-a",
      responsibleTeacherId: "teacher-a",
      status: "ACTIVE",
    },
    { id: "student-b", tenantId: "tenant-a", firstName: "Bora", lastName: "B", studentNo: "201", status: "ACTIVE" },
    { id: "student-c", tenantId: "tenant-a", firstName: "Can", lastName: "C", studentNo: "305", status: "PASSIVE" },
  ];
  let studentEnrollments: StudentEnrollmentFixture[] = [
    {
      id: "student-enrollment-a",
      tenantId: "tenant-a",
      studentId: "student-a",
      academicYearId: "academic-year-2026",
      termId: "term-2026-spring",
      classId: "class-a",
      status: "ACTIVE",
      startsAt: "2026-06-01",
      reason: "CREATED",
      createdAt: "2026-06-08T09:45:00.000Z",
      updatedAt: "2026-06-08T09:45:00.000Z",
    },
  ];
  let classes: ClassFixture[] = [
    { id: "class-a", tenantId: "tenant-a", name: "8-A", campusId: "campus-main", gradeLevelId: "grade-8", section: "A" },
    { id: "class-b", tenantId: "tenant-a", name: "8-B", campusId: "campus-main", gradeLevelId: "grade-8", section: "B" },
  ];
  let campuses: CampusFixture[] = [
    { id: "campus-main", tenantId: "tenant-a", name: "Merkez Kampüs", code: "MRK" },
  ];
  let gradeLevels: GradeLevelFixture[] = [
    { id: "grade-8", tenantId: "tenant-a", name: "8. Sınıf", code: "8" },
  ];
  const reportGenerationRequests: ReportGenerationRequestFixture[] = [];
  let evaluationStatusRequests = 0;
  let courses: CourseFixture[] = [
    { id: "course-math", tenantId: "tenant-a", name: "Matematik", code: "MAT" },
    { id: "course-turkish", tenantId: "tenant-a", name: "Turkce", code: "TUR" },
  ];
  let learningOutcomes: LearningOutcomeFixture[] = [
    {
      id: "learning-outcome-a",
      tenantId: "tenant-a",
      code: "MAT.8.1.1",
      branch: "Matematik",
      title: "Çarpanlar ve katlar",
      level: "8",
    },
  ];
  let academicYears: AcademicYearFixture[] = [
    {
      id: "academic-year-2026",
      tenantId: "tenant-a",
      name: "2025-2026",
      startsAt: "2025-09-01",
      endsAt: "2026-06-30",
      isActive: true,
    },
  ];
  let academicTerms: AcademicTermFixture[] = [
    {
      id: "term-2026-spring",
      tenantId: "tenant-a",
      academicYearId: "academic-year-2026",
      name: "2. Donem",
      startsAt: "2026-02-01",
      endsAt: "2026-06-30",
      isActive: true,
    },
  ];
  let scheduleLessons: ScheduleLessonFixture[] = [
    {
      id: "lesson-a",
      tenantId: "tenant-a",
      classId: "class-a",
      teacherId: "teacher-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      title: "Matematik",
      startsAt: "2026-06-01T09:00:00.000Z",
      endsAt: "2026-06-01T10:00:00.000Z",
    },
  ];
  let studySessions: StudySessionFixture[] = [
    {
      id: "study-a",
      tenantId: "tenant-a",
      classId: "class-a",
      teacherId: "teacher-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      studentIds: ["student-a"],
      title: "Matematik Etut",
      capacity: 4,
      startsAt: "2026-06-02T13:00:00.000Z",
      endsAt: "2026-06-02T14:00:00.000Z",
    },
  ];
  let teachers: TeacherFixture[] = [
    { id: "teacher-a", tenantId: "tenant-a", firstName: "Ayse", lastName: "Ogretmen", branch: "Matematik" },
  ];
  let exams: ExamFixture[] = [
    {
      id: "exam-demo",
      tenantId: "tenant-a",
      title: "LGS deneme sınavı",
      status: "PUBLISHED",
      answerKeySummary: {
        status: "PUBLISHED",
        version: "lgs-deneme-v1",
        questionCount: 90,
        branchCount: 6,
        updatedAt: "2026-06-01T09:00:00.000Z",
      },
      startsAt: "2026-06-08T09:00:00.000Z",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
    },
    {
      id: "exam-demo-isem-lgs-1",
      tenantId: "tenant-a",
      title: "İSEM LGS-1",
      status: "PUBLISHED",
      startsAt: "2026-06-15T09:00:00.000Z",
      createdAt: "2026-06-02T09:00:00.000Z",
      updatedAt: "2026-06-02T09:00:00.000Z",
    },
  ];
  let examParticipants: ExamParticipantFixture[] = [
    {
      id: "exam-participant-a",
      tenantId: "tenant-a",
      examId: "exam-demo",
      studentId: "student-a",
      participantNo: "176",
      bookletType: "A",
      status: "REGISTERED",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
    },
    {
      id: "exam-participant-b",
      tenantId: "tenant-a",
      examId: "exam-demo",
      studentId: "student-b",
      participantNo: "201",
      bookletType: "B",
      status: "REGISTERED",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
    },
    {
      id: "exam-participant-c",
      tenantId: "tenant-a",
      examId: "exam-demo",
      studentId: "student-c",
      participantNo: "305",
      bookletType: "A",
      status: "ABSENT",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
    },
  ];
  let importQuarantines: ImportQuarantineFixture[] = [
    {
      id: "quarantine-a",
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      rowNumber: 7,
      rawRow: { participantNo: "999", bookletType: "A" },
      reason: "STUDENT_NOT_MATCHED",
      status: "OPEN",
      createdAt: "2026-06-09T09:20:00.000Z",
      updatedAt: "2026-06-09T09:20:00.000Z",
    },
  ];
  let attendanceRecords: AttendanceFixture[] = [
    {
      id: "attendance-a",
      tenantId: "tenant-a",
      studentId: "student-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      date: "2026-06-03",
      status: "ABSENT",
    },
  ];
  let teacherAssignments: TeacherAssignmentFixture[] = [
    {
      id: "teacher-assignment-class-a",
      tenantId: "tenant-a",
      teacherId: "teacher-a",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      role: "CLASS_TEACHER",
    },
  ];
  let teacherNotes: TeacherNoteFixture[] = [
    {
      id: "teacher-note-internal-a",
      tenantId: "tenant-a",
      studentId: "student-a",
      teacherId: "teacher-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      visibility: "INTERNAL",
      body: "Dikkat takibi iç notu",
      developmentStatus: "WATCH",
      createdAt: "2026-06-04T09:00:00.000Z",
    },
    {
      id: "teacher-note-visible-a",
      tenantId: "tenant-a",
      studentId: "student-a",
      teacherId: "teacher-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      visibility: "GUARDIAN_STUDENT",
      body: "Problem çözme rutini güçleniyor.",
      developmentStatus: "IMPROVING",
      createdAt: "2026-06-04T10:00:00.000Z",
    },
  ];
  let guardians: GuardianFixture[] = [
    { id: "guardian-a", tenantId: "tenant-a", firstName: "Zeynep", lastName: "Veli", phone: "5550000000" },
  ];
  let guardianStudentLinks: GuardianStudentFixture[] = [
    {
      id: "guardian-student-a",
      tenantId: "tenant-a",
      guardianId: "guardian-a",
      studentId: "student-a",
      canViewFinance: true,
      canReceiveSms: true,
      canReceiveAnnouncements: true,
      canOpenSupportTickets: false,
      createdAt: "2026-06-08T09:30:00.000Z",
      updatedAt: "2026-06-08T09:30:00.000Z",
    },
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
  let identityInvitationCreateCount = 0;
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
    courseId?: string;
    termId?: string;
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
        courseId: "course-math",
        termId: "term-2026-spring",
        assignedById: "user-tenant-a",
        note: "Bireysel tekrar",
        dueAt: "2026-06-09T12:00:00.000Z",
        createdAt: "2026-06-08T09:20:00.000Z",
      },
    ],
  };
  const parserFileContent = "ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE";
  const parserConfigVersion = "optik-form-7108-v1";
  let observedAnswerKeyVersion = "";
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
  let announcements: AnnouncementFixture[] = [
    {
      id: "announcement-a",
      tenantId: "tenant-a",
      title: "Haftalık toplantı",
      body: "Pazartesi toplantısı",
      audience: "TEACHERS",
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      publishedAt: "2026-06-08T09:00:00.000Z",
    },
  ];
  const announcementCreateIdempotencyKeys: string[] = [];
  const smsBatchIdempotencyKeys: string[] = [];
  const smsBatchCreateBodies: Array<Record<string, unknown>> = [];
  let messageTemplates = [
    {
      id: "message-template-a",
      tenantId: "tenant-a",
      name: "Sınav hatırlatma",
      channel: "SMS",
      body: "Yarın deneme sınavı yapılacaktır.",
    },
  ];
  const smsBatchReports = new Map<string, {
    id: string;
    tenantId: string;
    jobId: string;
    templateId: string;
    recipientCount: number;
    sentCount: number;
    failedCount: number;
    billableSegments: number;
    status: "queued" | "completed" | "failed";
  }>();
  let supportTickets: SupportTicketFixture[] = [
    {
      id: "support-ticket-a",
      tenantId: "tenant-a",
      requesterId: "user-tenant-a",
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
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
  let paymentPlans: PaymentPlanFixture[] = [
    {
      id: "payment-plan-a",
      tenantId: "tenant-a",
      studentId: "student-a",
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
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
          dueDate: "2026-06-01",
          status: "OVERDUE",
          createdAt: "2026-06-05T09:00:00.000Z",
        },
        {
          id: "payment-installment-a-2",
          tenantId: "tenant-a",
          planId: "payment-plan-a",
          installmentNo: 2,
          amount: 50000,
          dueDate: "2026-07-01",
          status: "PENDING",
          createdAt: "2026-06-05T09:00:00.000Z",
        },
      ],
    },
  ];
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
    {
      id: "audit-log-d",
      tenantId: "tenant-a",
      actorUserId: "user-tenant-a",
      entityType: "Auth",
      entityId: "user-tenant-a",
      action: "auth.login",
      createdAt: "2026-06-10T09:00:00.000Z",
    },
  ];
  let backupRestoreJobs: Array<{
    id: string;
    tenantId: string;
    requestedByUserId: string;
    operationType: "BACKUP" | "RESTORE_DRILL";
    targetReference: string;
    reason?: string;
    queueName: "backup-restore";
    jobId: string;
    status: "queued";
    checkedTables: string[];
    result?: "PASS";
    errorCode?: string;
    createdAt: string;
    updatedAt: string;
  }> = [];
  let backupRestorePostCount = 0;

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/v1/auth/refresh", async (route) => {
    if (loginCount === 0) {
      await route.fulfill({ headers: corsHeaders, status: 401 });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse())),
    });
  });

  await page.route("**/api/v1/auth/login", async (route) => {
    loginCount += 1;
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse())),
    });
  });

  await page.route("**/api/v1/auth/logout", async (route) => {
    await route.fulfill({ headers: corsHeaders, status: 204 });
  });

  await page.route("**/health", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify({ status: "ok" }),
    });
  });

  await page.route("**/health/ready", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify({
        status: "ready",
        dependencies: {
          postgres: "ok",
          redis: "ok",
        },
      }),
    });
  });

  await page.route("**/metrics", async (route) => {
    await route.fulfill({
      contentType: "text/plain; version=0.0.4; charset=utf-8",
      headers: corsHeaders,
      status: 200,
      body: [
        "# TYPE o_okul_process_uptime_seconds gauge",
        "o_okul_process_uptime_seconds 123.4",
        "# TYPE o_okul_http_requests_total counter",
        "o_okul_http_requests_total{method=\"GET\",path=\"/health\",status=\"200\"} 3",
        "o_okul_http_requests_total{method=\"GET\",path=\"/api/v1/students\",status=\"200\"} 4",
        "",
      ].join("\n"),
    });
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

    if (path === "/search" && request.method() === "GET") {
      const query = (url.searchParams.get("q") ?? "").toLocaleLowerCase("tr-TR");
      const results = [
        { id: "teacher-a", type: "teachers", title: "Ayse Ogretmen", subtitle: "Matematik", href: "/kurum/ogretmenler/teacher-a" },
        { id: "student-a", type: "students", title: "Ada A", subtitle: "8-A", href: "/kurum/ogrenciler/student-a" },
        { id: "guardian-a", type: "guardians", title: "Zeynep Veli", subtitle: "Veli", href: "/kurum/veliler/guardian-a" },
        { id: "class-a", type: "classes", title: "8-A", href: "/kurum/siniflar/class-a" },
      ].filter((result) => `${result.title} ${result.subtitle ?? ""}`.toLocaleLowerCase("tr-TR").includes(query));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(results, request.url())),
      });
      return;
    }

    if (path === "/me/notification-devices" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([])),
      });
      return;
    }

    if (path === "/backup-restore-jobs" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(backupRestoreJobs, request.url())),
      });
      return;
    }

    if (path === "/backup-restore-jobs" && request.method() === "POST") {
      backupRestorePostCount += 1;
      const body = request.postDataJSON() as {
        confirmationText: string;
        operationType: "BACKUP" | "RESTORE_DRILL";
        reason?: string;
        targetReference: string;
      };
      expect(body.confirmationText).toBe(body.operationType === "BACKUP" ? "YEDEK AL" : "RESTORE DRILL");
      const suffix = body.operationType === "BACKUP" ? "backup" : "restore-drill";
      const created = {
        id: `backup-restore-job-created-${suffix}`,
        tenantId: "tenant-a",
        requestedByUserId: "user-tenant-a",
        operationType: body.operationType,
        targetReference: body.targetReference,
        reason: body.reason,
        queueName: "backup-restore" as const,
        jobId: `backup-restore-job-created_${suffix}`,
        status: "queued" as const,
        checkedTables: [],
        createdAt: "2026-06-10T09:00:00.000Z",
        updatedAt: "2026-06-10T09:00:00.000Z",
      };
      backupRestoreJobs = [created, ...backupRestoreJobs];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path === "/role-previews" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        targetRole: "TEACHER" | "STUDENT" | "GUARDIAN";
        targetSubjectId: string;
      };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          id: "role-preview-created",
          tenantId: "tenant-a",
          actorUserId: "user-tenant-a",
          targetRole: body.targetRole,
          targetSubjectType: body.targetRole,
          targetSubjectId: body.targetSubjectId,
          mode: "READ_ONLY",
          createdAt: "2026-06-10T09:00:00.000Z",
          expiresAt: "2026-06-10T09:15:00.000Z",
          previewToken: `preview-token-${body.targetRole.toLowerCase()}`,
        })),
      });
      return;
    }

    if (path === "/me/profile" && request.method() === "GET" && request.headers()["x-role-preview-token"]) {
      const token = request.headers()["x-role-preview-token"] ?? "";
      const targetRole = token.includes("student") ? "STUDENT" : token.includes("guardian") ? "GUARDIAN" : "TEACHER";
      const subjectId = targetRole === "STUDENT" ? "student-a" : targetRole === "GUARDIAN" ? "guardian-a" : "teacher-a";
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          userId: "user-tenant-a",
          tenantId: "tenant-a",
          roles: [targetRole],
          subjectType: targetRole,
          subjectId,
        })),
      });
      return;
    }

    if (path === "/me/teacher" && request.method() === "GET" && request.headers()["x-role-preview-token"]) {
      expect(request.headers()["x-role-preview-token"]).toBe("preview-token-teacher");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          id: "teacher-a",
          tenantId: "tenant-a",
          firstName: "Ayse",
          lastName: "Ogretmen",
        })),
      });
      return;
    }

    if (path === "/me/teacher/schedule" && request.method() === "GET" && request.headers()["x-role-preview-token"]) {
      expect(request.headers()["x-role-preview-token"]).toBe("preview-token-teacher");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([
          {
            id: "schedule-a",
            tenantId: "tenant-a",
            classId: "class-a",
            teacherId: "teacher-a",
            courseId: "course-math",
            termId: "term-2026-spring",
            title: "Matematik",
            startsAt: "2026-06-10T09:00:00.000Z",
            endsAt: "2026-06-10T10:00:00.000Z",
          },
        ])),
      });
      return;
    }

    if (path === "/me/teacher/announcements" && request.method() === "GET" && request.headers()["x-role-preview-token"]) {
      expect(request.headers()["x-role-preview-token"]).toBe("preview-token-teacher");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([
          {
            id: "announcement-teacher-a",
            tenantId: "tenant-a",
            title: "Öğretmen duyurusu",
            body: "Zümre toplantısı salı günü yapılacaktır.",
            audience: "TEACHERS",
            publishedAt: "2026-06-09T11:00:00.000Z",
          },
        ])),
      });
      return;
    }

    if (path === "/me/teacher/support-tickets" && request.method() === "GET" && request.headers()["x-role-preview-token"]) {
      expect(request.headers()["x-role-preview-token"]).toBe("preview-token-teacher");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([
          {
            id: "support-ticket-teacher-a",
            tenantId: "tenant-a",
            requesterId: "teacher-tenant-a",
            subject: "Sınıf raporu",
            message: "Sınıf raporu hakkında destek.",
            priority: "NORMAL",
            status: "OPEN",
            createdAt: "2026-06-09T11:20:00.000Z",
          },
        ])),
      });
      return;
    }

    if (path === "/me/student/profile" && request.method() === "GET" && request.headers()["x-role-preview-token"]) {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          id: "student-a",
          tenantId: "tenant-a",
          firstName: "Ada",
          lastName: "A",
        })),
      });
      return;
    }

    if (path === "/me/guardian/students" && request.method() === "GET" && request.headers()["x-role-preview-token"]) {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([{ id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A" }])),
      });
      return;
    }

    if (request.method() === "GET" && request.headers()["x-role-preview-token"]) {
      const token = request.headers()["x-role-preview-token"] ?? "";
      expect(token).toMatch(/^preview-token-(teacher|student|guardian)$/);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(readPortalFixture(path), request.url())),
      });
      return;
    }

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
      const body = request.postDataJSON() as { email: string; name: string; nationalId: string; roles: string[] };
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
      identityInvitationCreateCount += 1;
      const created: IdentityInvitationFixture = {
        id: `identity-invitation-created-${identityInvitationCreateCount}`,
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

    if (path === "/campuses" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(campuses, request.url())),
      });
      return;
    }

    if (path === "/campuses" && request.method() === "POST") {
      const body = request.postDataJSON() as { name: string; code?: string };
      const created: CampusFixture = {
        id: "campus-created",
        tenantId: "tenant-a",
        name: body.name,
        code: body.code,
      };
      campuses = [...campuses, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/campuses/") && request.method() === "PATCH") {
      const id = path.replace("/campuses/", "");
      const body = request.postDataJSON() as { name: string; code?: string };
      const current = campuses.find((record) => record.id === id) ?? campuses[0]!;
      const updated = {
        ...current,
        name: body.name,
        code: body.code,
      };
      campuses = campuses.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/campuses/") && request.method() === "DELETE") {
      const id = path.replace("/campuses/", "");
      campuses = campuses.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/grade-levels" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(gradeLevels, request.url())),
      });
      return;
    }

    if (path === "/grade-levels" && request.method() === "POST") {
      const body = request.postDataJSON() as { name: string; code?: string };
      const created: GradeLevelFixture = {
        id: "grade-level-created",
        tenantId: "tenant-a",
        name: body.name,
        code: body.code,
      };
      gradeLevels = [...gradeLevels, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/grade-levels/") && request.method() === "PATCH") {
      const id = path.replace("/grade-levels/", "");
      const body = request.postDataJSON() as { name: string; code?: string };
      const current = gradeLevels.find((record) => record.id === id) ?? gradeLevels[0]!;
      const updated = {
        ...current,
        name: body.name,
        code: body.code,
      };
      gradeLevels = gradeLevels.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/grade-levels/") && request.method() === "DELETE") {
      const id = path.replace("/grade-levels/", "");
      gradeLevels = gradeLevels.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
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

    if (path.startsWith("/classes/") && request.method() === "GET") {
      const id = path.replace("/classes/", "");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(classes.find((record) => record.id === id) ?? null)),
      });
      return;
    }

    if (path === "/classes" && request.method() === "POST") {
      const body = request.postDataJSON() as { name: string; level?: string; campusId?: string; gradeLevelId?: string; section?: string };
      const created: ClassFixture = {
        id: "class-created",
        tenantId: "tenant-a",
        name: body.name,
        level: body.level,
        campusId: body.campusId,
        gradeLevelId: body.gradeLevelId,
        section: body.section,
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
      const body = request.postDataJSON() as { name: string; level?: string; campusId?: string; gradeLevelId?: string; section?: string };
      const current = classes.find((record) => record.id === id) ?? classes[0]!;
      const updated = {
        ...current,
        id,
        tenantId: "tenant-a",
        name: body.name,
        level: body.level,
        campusId: body.campusId,
        gradeLevelId: body.gradeLevelId,
        section: body.section,
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

    if (path === "/courses" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(courses, request.url())),
      });
      return;
    }

    if (path === "/courses" && request.method() === "POST") {
      const body = request.postDataJSON() as { name: string; code?: string };
      const created: CourseFixture = {
        id: "course-created",
        tenantId: "tenant-a",
        name: body.name,
        code: body.code,
      };
      courses = [...courses, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/courses/") && request.method() === "PATCH") {
      const id = path.replace("/courses/", "");
      const current = courses.find((record) => record.id === id) ?? courses[0]!;
      const body = request.postDataJSON() as { name: string; code?: string };
      const updated = {
        ...current,
        name: body.name,
        code: body.code,
      };
      courses = courses.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/courses/") && request.method() === "DELETE") {
      const id = path.replace("/courses/", "");
      courses = courses.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/learning-outcomes" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(learningOutcomes, request.url())),
      });
      return;
    }

    if (path === "/learning-outcomes" && request.method() === "POST") {
      const body = request.postDataJSON() as Omit<LearningOutcomeFixture, "id" | "tenantId">;
      const created: LearningOutcomeFixture = {
        id: "learning-outcome-created",
        tenantId: "tenant-a",
        ...body,
      };
      learningOutcomes = [...learningOutcomes, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/learning-outcomes/") && request.method() === "PATCH") {
      const id = path.replace("/learning-outcomes/", "");
      const current = learningOutcomes.find((record) => record.id === id) ?? learningOutcomes[0]!;
      const body = request.postDataJSON() as Partial<LearningOutcomeFixture>;
      const updated = { ...current, ...body };
      learningOutcomes = learningOutcomes.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/learning-outcomes/") && request.method() === "DELETE") {
      const id = path.replace("/learning-outcomes/", "");
      learningOutcomes = learningOutcomes.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/academic-years" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(academicYears, request.url())),
      });
      return;
    }

    if (path === "/academic-years" && request.method() === "POST") {
      const body = request.postDataJSON() as Omit<AcademicYearFixture, "id" | "tenantId">;
      const created: AcademicYearFixture = {
        id: "academic-year-created",
        tenantId: "tenant-a",
        ...body,
      };
      academicYears = [...academicYears, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/academic-years/") && request.method() === "PATCH") {
      const id = path.replace("/academic-years/", "");
      const current = academicYears.find((record) => record.id === id) ?? academicYears[0]!;
      const body = request.postDataJSON() as Partial<AcademicYearFixture>;
      const updated = { ...current, ...body };
      academicYears = academicYears.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/academic-years/") && request.method() === "DELETE") {
      const id = path.replace("/academic-years/", "");
      academicYears = academicYears.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/academic-terms" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(academicTerms, request.url())),
      });
      return;
    }

    if (path === "/academic-terms" && request.method() === "POST") {
      const body = request.postDataJSON() as Omit<AcademicTermFixture, "id" | "tenantId">;
      const created: AcademicTermFixture = {
        id: "academic-term-created",
        tenantId: "tenant-a",
        ...body,
      };
      academicTerms = [...academicTerms, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/academic-terms/") && request.method() === "PATCH") {
      const id = path.replace("/academic-terms/", "");
      const current = academicTerms.find((record) => record.id === id) ?? academicTerms[0]!;
      const body = request.postDataJSON() as Partial<AcademicTermFixture>;
      const updated = { ...current, ...body };
      academicTerms = academicTerms.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/academic-terms/") && request.method() === "DELETE") {
      const id = path.replace("/academic-terms/", "");
      academicTerms = academicTerms.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/schedule-lessons" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(scheduleLessons, request.url())),
      });
      return;
    }

    if (path === "/schedule-lessons" && request.method() === "POST") {
      const body = request.postDataJSON() as Omit<ScheduleLessonFixture, "id" | "tenantId">;
      const created: ScheduleLessonFixture = {
        id: "lesson-created",
        tenantId: "tenant-a",
        ...body,
      };
      scheduleLessons = [...scheduleLessons, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/schedule-lessons/") && request.method() === "PATCH") {
      const id = path.replace("/schedule-lessons/", "");
      const current = scheduleLessons.find((record) => record.id === id) ?? scheduleLessons[0]!;
      const body = request.postDataJSON() as Partial<ScheduleLessonFixture>;
      const updated = { ...current, ...body };
      scheduleLessons = scheduleLessons.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/schedule-lessons/") && request.method() === "DELETE") {
      const id = path.replace("/schedule-lessons/", "");
      scheduleLessons = scheduleLessons.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/attendance" && request.method() === "GET") {
      const classId = new URL(request.url()).searchParams.get("classId");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(filterByStudentClass(attendanceRecords, students, classId), request.url())),
      });
      return;
    }

    if (path === "/attendance/daily" && request.method() === "GET") {
      const url = new URL(request.url());
      const classId = url.searchParams.get("classId") ?? "";
      const date = url.searchParams.get("date") ?? "";
      const roster = students.filter((student) => student.classId === classId);
      const records = attendanceRecords.filter((record) => record.date === date && roster.some((student) => student.id === record.studentId));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          classId,
          date,
          students: roster,
          records,
          summary: { absent: records.filter((record) => record.status === "ABSENT").length, excused: 0, late: records.filter((record) => record.status === "LATE").length, present: records.filter((record) => record.status === "PRESENT").length, total: records.length, unmarked: roster.length - records.length },
        })),
      });
      return;
    }

    if (path === "/import-quarantines/summary" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          openCount: importQuarantines.filter((record) => record.status === "OPEN").length,
        })),
      });
      return;
    }

    if (path === "/attendance" && request.method() === "POST") {
      const body = request.postDataJSON() as Omit<AttendanceFixture, "id" | "tenantId">;
      const created: AttendanceFixture = {
        id: "attendance-created",
        tenantId: "tenant-a",
        ...body,
      };
      attendanceRecords = [...attendanceRecords, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/attendance/") && request.method() === "PATCH") {
      const id = path.replace("/attendance/", "");
      const current = attendanceRecords.find((record) => record.id === id) ?? attendanceRecords[0]!;
      const body = request.postDataJSON() as Partial<AttendanceFixture>;
      if ("studentId" in body || "date" in body) {
        await route.fulfill({
          contentType: "application/json",
          headers: corsHeaders,
          status: 422,
          body: JSON.stringify({ code: "VALIDATION_ERROR", message: "Unexpected attendance update field" }),
        });
        return;
      }
      const updated = { ...current, ...body };
      attendanceRecords = attendanceRecords.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/attendance/") && request.method() === "DELETE") {
      const id = path.replace("/attendance/", "");
      attendanceRecords = attendanceRecords.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/teacher-notes" && request.method() === "GET") {
      const classId = new URL(request.url()).searchParams.get("classId");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(filterByStudentClass(teacherNotes, students, classId), request.url())),
      });
      return;
    }

    if (path === "/teacher-notes" && request.method() === "POST") {
      const body = request.postDataJSON() as Omit<TeacherNoteFixture, "id" | "tenantId" | "createdAt">;
      const created: TeacherNoteFixture = {
        id: "teacher-note-created",
        tenantId: "tenant-a",
        createdAt: "2026-06-10T12:00:00.000Z",
        ...body,
      };
      teacherNotes = [...teacherNotes, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/teacher-notes/") && request.method() === "PATCH") {
      const id = path.replace("/teacher-notes/", "");
      const current = teacherNotes.find((record) => record.id === id) ?? teacherNotes[0]!;
      const body = request.postDataJSON() as Partial<TeacherNoteFixture>;
      const updated = { ...current, ...body };
      teacherNotes = teacherNotes.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/teacher-notes/") && request.method() === "DELETE") {
      const id = path.replace("/teacher-notes/", "");
      teacherNotes = teacherNotes.filter((record) => record.id !== id);
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    if (path === "/study-sessions" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(studySessions, request.url())),
      });
      return;
    }

    if (path === "/study-sessions" && request.method() === "POST") {
      const body = request.postDataJSON() as Omit<StudySessionFixture, "id" | "tenantId">;
      const created: StudySessionFixture = {
        id: "study-created",
        tenantId: "tenant-a",
        ...body,
      };
      studySessions = [...studySessions, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/study-sessions/") && request.method() === "PATCH") {
      const id = path.replace("/study-sessions/", "");
      const current = studySessions.find((record) => record.id === id) ?? studySessions[0]!;
      const body = request.postDataJSON() as Partial<StudySessionFixture>;
      const updated = { ...current, ...body };
      studySessions = studySessions.map((record) => (record.id === id ? updated : record));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    if (path.startsWith("/study-sessions/") && request.method() === "DELETE") {
      const id = path.replace("/study-sessions/", "");
      studySessions = studySessions.filter((record) => record.id !== id);
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

    if (path.startsWith("/teachers/") && request.method() === "GET") {
      const id = path.replace("/teachers/", "");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(teachers.find((record) => record.id === id) ?? null)),
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
        courseId: body.courseId,
        termId: body.termId,
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

    if (path.startsWith("/guardians/") && path.endsWith("/student-details") && request.method() === "GET") {
      const guardianId = path.replace("/guardians/", "").replace("/student-details", "");
      const links = guardianStudentLinks.filter((link) => link.guardianId === guardianId);
      const linkedStudentIds = new Set(links.map((link) => link.studentId));
      const toStudentDetail = (student: StudentFixture) => {
        const classRecord = student.classId ? classes.find((record) => record.id === student.classId) : undefined;
        return {
          id: student.id,
          studentNo: student.studentNo,
          firstName: student.firstName,
          lastName: student.lastName,
          classId: student.classId,
          className: classRecord?.name,
          status: student.status,
          hasPortalUser: false,
        };
      };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          links,
          linkedStudents: students.filter((student) => linkedStudentIds.has(student.id)).map(toStudentDetail),
          availableStudents: students.filter((student) => !linkedStudentIds.has(student.id)).map(toStudentDetail),
        })),
      });
      return;
    }

    if (path.startsWith("/guardians/") && path.endsWith("/students") && request.method() === "GET") {
      const guardianId = path.replace("/guardians/", "").replace("/students", "");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(guardianStudentLinks.filter((link) => link.guardianId === guardianId))),
      });
      return;
    }

    if (path.startsWith("/guardians/") && path.endsWith("/students") && request.method() === "POST") {
      const guardianId = path.replace("/guardians/", "").replace("/students", "");
      const body = request.postDataJSON() as Partial<GuardianStudentFixture>;
      const created: GuardianStudentFixture = {
        id: `guardian-student-created-${guardianStudentLinks.length}`,
        tenantId: "tenant-a",
        guardianId,
        studentId: body.studentId ?? "student-a",
        canViewFinance: body.canViewFinance ?? false,
        canReceiveSms: body.canReceiveSms ?? false,
        canReceiveAnnouncements: body.canReceiveAnnouncements ?? false,
        canOpenSupportTickets: body.canOpenSupportTickets ?? false,
        createdAt: "2026-06-09T09:30:00.000Z",
        updatedAt: "2026-06-09T09:30:00.000Z",
      };
      guardianStudentLinks = [...guardianStudentLinks, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/guardians/") && request.method() === "GET") {
      const id = path.replace("/guardians/", "");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(guardians.find((record) => record.id === id) ?? null)),
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

    if (path.startsWith("/announcements/") && path.endsWith("/recipients") && request.method() === "GET") {
      const announcementId = path.split("/")[2] ?? "";
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(announcementRecipientReport(announcementId))),
      });
      return;
    }

    if (path === "/announcements/recipients/preview" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        audience?: AnnouncementFixture["audience"];
        campusId?: string;
        classId?: string;
        courseId?: string;
        gradeLevelId?: string;
        termId?: string;
      };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          audience: body.audience ?? "SCHOOL",
          channel: "IN_APP",
          counts: { guardians: 1, students: 1, teachers: 1 },
          expiresAt: "2026-06-09T09:05:00.000Z",
          previewToken: "announcement-preview-token",
          recipientCount: 3,
          scope: {
            ...(body.campusId ? { campusId: body.campusId } : {}),
            ...(body.classId ? { classId: body.classId } : {}),
            ...(body.courseId ? { courseId: body.courseId } : {}),
            ...(body.gradeLevelId ? { gradeLevelId: body.gradeLevelId } : {}),
            ...(body.termId ? { termId: body.termId } : {}),
          },
        })),
      });
      return;
    }

    if (path === "/announcements" && request.method() === "POST") {
      announcementCreateIdempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      const body = request.postDataJSON() as Omit<AnnouncementFixture, "id" | "tenantId" | "publishedAt">;
      const created: AnnouncementFixture = {
        id: "announcement-created",
        tenantId: "tenant-a",
        title: body.title,
        body: body.body,
        audience: body.audience,
        campusId: body.campusId,
        gradeLevelId: body.gradeLevelId,
        classId: body.classId,
        courseId: body.courseId,
        termId: body.termId,
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

    if (path === "/sms-batches/recipients/preview" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        announcementId?: string;
        classId?: string;
        courseId?: string;
        studentStatus?: "ACTIVE" | "PASSIVE" | "GRADUATED" | "TRANSFERRED";
        termId?: string;
      };
      const announcement = announcements.find((record) => record.id === body.announcementId);
      const recipients = announcement &&
        body.studentStatus === "ACTIVE" &&
        (!body.classId || body.classId === announcement.classId) &&
        (!body.courseId || body.courseId === announcement.courseId) &&
        (!body.termId || body.termId === announcement.termId)
        ? [{
            to: "905000000001",
            guardianId: "guardian-a",
            guardianName: "Ali Veli",
            studentIds: ["student-a"],
            studentNames: ["Ada A"],
          }]
        : [];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          recipientCount: recipients.length,
          recipients,
        })),
      });
      return;
    }

    if (path === "/sms-batches" && request.method() === "POST") {
      smsBatchIdempotencyKeys.push(request.headers()["idempotency-key"] ?? "");
      smsBatchCreateBodies.push(request.postDataJSON() as Record<string, unknown>);
      const body = request.postDataJSON() as { templateId: string; recipients: Array<{ to: string }> };
      const jobId = `${body.templateId}_sms-ui-hash`;
      smsBatchReports.set(jobId, {
        id: "sms-report-a",
        tenantId: "tenant-a",
        jobId,
        templateId: body.templateId,
        recipientCount: body.recipients.length,
        sentCount: body.recipients.length,
        failedCount: 0,
        billableSegments: body.recipients.length,
        status: "completed",
      });
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          templateId: body.templateId,
          recipientCount: body.recipients.length,
          queueName: "sms-batch",
          jobId,
          status: "queued",
        })),
      });
      return;
    }

    if (path.startsWith("/sms-batches/") && request.method() === "GET") {
      const jobId = decodeURIComponent(path.replace("/sms-batches/", ""));
      const report = smsBatchReports.get(jobId);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: report ? 200 : 404,
        body: JSON.stringify(envelope(report ?? { code: "SMS_BATCH_DELIVERY_REPORT_NOT_FOUND" })),
      });
      return;
    }

    if (path === "/support-tickets" && request.method() === "GET") {
      const url = new URL(request.url());
      const filteredTickets = supportTickets.filter((ticket) =>
        (!url.searchParams.get("campusId") || ticket.campusId === url.searchParams.get("campusId")) &&
        (!url.searchParams.get("gradeLevelId") || ticket.gradeLevelId === url.searchParams.get("gradeLevelId")) &&
        (!url.searchParams.get("classId") || ticket.classId === url.searchParams.get("classId")) &&
        (!url.searchParams.get("courseId") || ticket.courseId === url.searchParams.get("courseId")) &&
        (!url.searchParams.get("termId") || ticket.termId === url.searchParams.get("termId")),
      );
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(filteredTickets, request.url())),
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
      const body = request.postDataJSON() as Partial<SupportTicketFixture> & { subject: string; message: string; priority: "LOW" | "NORMAL" | "HIGH" };
      const created: SupportTicketFixture = {
        id: "support-ticket-created",
        tenantId: "tenant-a",
        requesterId: "user-tenant-a",
        campusId: body.campusId,
        gradeLevelId: body.gradeLevelId,
        classId: body.classId,
        courseId: body.courseId,
        termId: body.termId,
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

    if (path === "/payment-plans" && request.method() === "GET") {
      const url = new URL(request.url());
      const filteredPlans = paymentPlans.filter((plan) =>
        (!url.searchParams.get("studentId") || plan.studentId === url.searchParams.get("studentId")) &&
        (!url.searchParams.get("campusId") || plan.campusId === url.searchParams.get("campusId")) &&
        (!url.searchParams.get("gradeLevelId") || plan.gradeLevelId === url.searchParams.get("gradeLevelId")) &&
        (!url.searchParams.get("classId") || plan.classId === url.searchParams.get("classId")) &&
        (!url.searchParams.get("courseId") || plan.courseId === url.searchParams.get("courseId")) &&
        (!url.searchParams.get("termId") || plan.termId === url.searchParams.get("termId")),
      );
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(filteredPlans, request.url())),
      });
      return;
    }

    if (path.startsWith("/payment-plans/") && path.includes("/installments/") && request.method() === "PATCH") {
      const parts = path.split("/");
      const planId = parts[2] ?? "";
      const installmentId = parts[4] ?? "";
      const body = request.postDataJSON() as Partial<Pick<PaymentInstallmentFixture, "amount" | "dueDate" | "status">>;
      const currentPlan = paymentPlans.find((plan) => plan.id === planId) ?? paymentPlans[0]!;
      const updatedPlan = {
        ...currentPlan,
        installments: currentPlan.installments.map((installment) =>
          installment.id === installmentId
            ? {
                ...installment,
                amount: body.amount ?? installment.amount,
                dueDate: body.dueDate ?? installment.dueDate,
                paidAt: body.status === "PAID" ? "2026-06-10T09:00:00.000Z" : body.status ? undefined : installment.paidAt,
                status: body.status ?? installment.status,
              }
            : installment,
        ),
      };
      paymentPlans = paymentPlans.map((plan) => (plan.id === planId ? updatedPlan : plan));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updatedPlan)),
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

    if (path === "/homework/material-assignments" && request.method() === "GET") {
      const studentId = new URL(request.url()).searchParams.get("studentId");
      const assignments = Object.values(materialAssignments).flat().filter((assignment) => !studentId || assignment.studentId === studentId);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(assignments)),
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
      const body = request.postDataJSON() as { fileBase64?: string; preset?: string };
      expect(body).toEqual({ preset: "OPTIK_7108_LGS" });
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
      expect(body).toEqual({ version: parserConfigVersion, suggestion: parserSuggestion });
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          examId: "exam-a",
          version: parserConfigVersion,
          encoding: parserSuggestion.encoding,
          delimiter: parserSuggestion.delimiter,
          skipHeaderLines: parserSuggestion.skipHeaderLines,
          fieldMapping: parserSuggestion.fieldMapping,
          status: "APPROVED",
        })),
      });
      return;
    }

    if (path === "/exams/exam-a/answer-keys/imports/dry-run" && request.method() === "POST") {
      const body = request.postDataJSON() as { version: string; fileBase64: string };
      expect(body.version).toMatch(/^haziran-genel-deneme-\d{4}-\d{2}-\d{2}$/);
      expect(body.fileBase64).toBe(Buffer.from("answer-key").toString("base64"));
      observedAnswerKeyVersion = body.version;
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          dryRun: true,
          tenantId: "tenant-a",
          examId: "exam-a",
          version: body.version,
          questionCount: 90,
          branches: [{ branch: "LGS TÜRKÇE", questionCount: 20 }],
          scoringConfig: { wrongPenalty: 1 / 3 },
          bookletVariants: [{ code: "B", questionCount: 90 }],
          wouldImport: true,
        })),
      });
      return;
    }

    if (path === "/exams/exam-a/answer-keys" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        version: string;
        questions: Array<{ questionNo: number; correctAnswer: string; branch: string }>;
        bookletVariants?: Array<{ code: string; permutation: number[] }>;
        dryRun?: boolean;
      };
      expect(body.version).toBe("manual-key-v1");
      expect(body.questions).toHaveLength(90);
      expect(body.questions[0]).toMatchObject({ questionNo: 1, correctAnswer: "A", branch: "LGS TÜRKÇE" });
      expect(body.bookletVariants).toEqual([{ code: "B", permutation: Array.from({ length: 90 }, (_unused, index) => 90 - index) }]);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
        body: JSON.stringify(envelope(body.dryRun
          ? {
              tenantId: "tenant-a",
              examId: "exam-a",
              version: "manual-key-v1",
              questionCount: 90,
              branches: [{ branch: "LGS TÜRKÇE", questionCount: 20 }],
              scoringConfig: { wrongPenalty: 1 / 3 },
              bookletVariants: [{ code: "B", questionCount: 90 }],
              status: "DRY_RUN",
            }
          : {
              id: "answer-key-manual",
              tenantId: "tenant-a",
              examId: "exam-a",
              version: "manual-key-v1",
              questionCount: 90,
              branches: [{ branch: "LGS TÜRKÇE", questionCount: 20 }],
              scoringConfig: { wrongPenalty: 1 / 3 },
              status: "DRAFT",
              createdAt: "2026-06-09T09:18:00.000Z",
              updatedAt: "2026-06-09T09:18:00.000Z",
            })),
      });
      return;
    }

    if (path.startsWith("/exams/") && path.endsWith("/answer-keys/imports") && request.method() === "POST") {
      const examId = path.replace("/exams/", "").replace("/answer-keys/imports", "");
      const body = request.postDataJSON() as { version: string; fileBase64: string };
      if (examId === "exam-a") {
        expect(body.version).toBe(observedAnswerKeyVersion);
      } else {
        expect(body.version).toMatch(/^haziran-genel-deneme-\d{4}-\d{2}-\d{2}$/);
        expect(body.fileBase64).toBe(Buffer.from("answer-key").toString("base64"));
      }
      const importedAnswerKey = {
        id: examId === "exam-a" ? "answer-key-a" : `answer-key-${examId}`,
        tenantId: "tenant-a",
        examId,
        version: body.version,
        questionCount: 90,
        branches: [{ branch: "LGS TÜRKÇE", questionCount: 20 }],
        scoringConfig: { wrongPenalty: 1 / 3 },
        status: "DRAFT",
        createdAt: "2026-06-09T09:15:00.000Z",
        updatedAt: "2026-06-09T09:15:00.000Z",
      };
      exams = exams.map((exam) => exam.id === examId
        ? {
            ...exam,
            answerKeySummary: {
              status: "DRAFT",
              version: body.version,
              questionCount: 90,
              branchCount: 1,
              updatedAt: "2026-06-09T09:15:00.000Z",
            },
          }
        : exam);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
        body: JSON.stringify(envelope({
          imported: true,
          answerKey: importedAnswerKey,
          bookletVariants: [{ code: "B", questionCount: 90 }],
        })),
      });
      return;
    }

    if (path === "/exams/exam-a/raw-imports" && request.method() === "POST") {
      const body = request.postDataJSON() as { sourceType: string; fileName: string; fileBase64: string; parserConfigVersion: string };
      expect(body).toMatchObject({
        sourceType: "OPTICAL_ANSWER_TXT",
        fileName: "optik-a.txt",
        fileBase64: Buffer.from(parserFileContent).toString("base64"),
        parserConfigVersion,
      });
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
        body: JSON.stringify(envelope({
          rawImport: {
            id: "raw-import-a",
            tenantId: "tenant-a",
            examId: "exam-a",
            sourceType: "OPTICAL_ANSWER_TXT",
            fileName: "optik-a.txt",
            s3Key: `raw-imports/tenant-a/exam-a/${parserConfigVersion}/hash/source`,
            sha256: "abcdef1234567890",
            parserConfigVersion,
          },
          parseJob: { queueName: "optical-parse", jobId: "parse-job-a", status: "queued" },
          status: "uploaded",
        })),
      });
      return;
    }

    if (path === "/exams/exam-a/raw-imports/raw-import-a/summary" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          examId: "exam-a",
          rawImportId: "raw-import-a",
          matchedCount: 2,
          quarantinedCount: 1,
          totalRows: 3,
          quarantineReasons: [{ reason: "STUDENT_NOT_MATCHED", count: 1 }],
        }, request.url())),
      });
      return;
    }

    if (path === "/exams/exam-a/raw-imports/raw-import-a/evaluation-jobs" && request.method() === "POST") {
      const body = request.postDataJSON() as { answerKeyId?: string };
      expect(body.answerKeyId).toBeUndefined();
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          examId: "exam-a",
          rawImportId: "raw-import-a",
          answerKeyId: "answer-key-a",
          rawImportSha256: "abcdef1234567890",
          matchedCount: 2,
          queuedCount: 2,
          queueName: "exam-evaluation",
          jobs: [
            { participantId: "participant-a", jobId: "evaluation-job-a", status: "queued" },
            { participantId: "participant-b", jobId: "evaluation-job-b", status: "queued" },
          ],
        })),
      });
      return;
    }

    if (path === "/exams/exam-a/raw-imports/raw-import-a/evaluation-status" && request.method() === "GET") {
      evaluationStatusRequests += 1;
      expect(new URL(request.url()).searchParams.get("answerKeyId")).toBe("answer-key-a");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          examId: "exam-a",
          rawImportId: "raw-import-a",
          answerKeyId: "answer-key-a",
          matchedCount: 2,
          evaluatedCount: 2,
          pendingCount: 0,
          status: "COMPLETED",
        }, request.url())),
      });
      return;
    }

    if (path === "/exams/exam-a/raw-imports/raw-import-a/quarantines" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(importQuarantines, request.url())),
      });
      return;
    }

    if (path === "/exams/exam-a/raw-imports/raw-import-a/quarantines/quarantine-a/resolve" && request.method() === "POST") {
      const body = request.postDataJSON() as { resolvedStudentId: string };
      expect(body.resolvedStudentId).toBe("student-a");
      const resolved: ImportQuarantineFixture = {
        ...importQuarantines[0]!,
        status: "RESOLVED",
        resolvedStudentId: "student-a",
        updatedAt: "2026-06-09T09:25:00.000Z",
        evaluationJob: { queueName: "exam-evaluation", jobId: "evaluation-job-a", status: "queued" },
      };
      importQuarantines = [resolved];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(resolved)),
      });
      return;
    }

    if (path === "/exams/exam-a/reports/generation-jobs" && request.method() === "POST") {
      const body = request.postDataJSON() as ReportGenerationRequestFixture;
      expect(body).toEqual({
        reportType: "EXAM_RESULT_SUMMARY",
      });
      reportGenerationRequests.push(body);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          examId: "exam-a",
          reportType: "EXAM_RESULT_SUMMARY",
          queueName: "report-generation",
          jobId: "report-job-a",
          status: "queued",
        })),
      });
      return;
    }

    if (path === "/exams/exam-a/reports/generation-jobs/report-job-a" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({ jobId: "report-job-a", snapshotId: "snapshot-a", status: "COMPLETED", updatedAt: "2026-06-17T10:00:00.000Z" })),
      });
      return;
    }

    if (path === "/exams" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(exams, request.url())),
      });
      return;
    }

    if (path === "/exams" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        title: string;
        startsAt?: string;
        classIds?: string[];
        answerKey: { version: string; fileBase64: string };
      };
      expect(body.answerKey.version).toMatch(/^haziran-genel-deneme-\d{4}-\d{2}-\d{2}$/);
      expect(body.answerKey.fileBase64).toBe(Buffer.from("answer-key").toString("base64"));
      const created: ExamFixture = {
        id: exams.some((exam) => exam.id === "exam-a") ? `exam-created-${exams.length + 1}` : "exam-a",
        tenantId: "tenant-a",
        title: body.title.trim(),
        status: "DRAFT",
        answerKeySummary: {
          status: "DRAFT",
          version: body.answerKey.version,
          questionCount: 90,
          branchCount: 1,
          updatedAt: "2026-06-09T09:15:00.000Z",
        },
        ...(body.startsAt ? { startsAt: body.startsAt } : {}),
        createdAt: "2026-06-09T09:00:00.000Z",
        updatedAt: "2026-06-09T09:00:00.000Z",
      };
      exams = [created, ...exams];
      const selectedClassIds = new Set(body.classIds ?? []);
      const createdParticipants = students
        .filter((student) => Boolean(student.classId && selectedClassIds.has(student.classId)))
        .map((student, index): ExamParticipantFixture => ({
          id: `exam-participant-${created.id}-${student.id}`,
          tenantId: "tenant-a",
          examId: created.id,
          studentId: student.id,
          participantNo: student.studentNo ?? String(index + 1),
          bookletType: index % 2 === 0 ? "A" : "B",
          status: "REGISTERED",
          createdAt: "2026-06-09T09:00:00.000Z",
          updatedAt: "2026-06-09T09:00:00.000Z",
        }));
      examParticipants = [...createdParticipants, ...examParticipants];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/exams/") && path.endsWith("/publish") && request.method() === "POST") {
      const id = path.replace("/exams/", "").replace("/publish", "");
      const published = {
        ...(exams.find((exam) => exam.id === id) ?? exams[0]!),
        status: "PUBLISHED" as const,
        updatedAt: "2026-06-09T09:05:00.000Z",
      };
      exams = exams.map((exam) => (exam.id === id ? published : exam));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
        body: JSON.stringify(envelope(published)),
      });
      return;
    }

    if (path.startsWith("/exams/") && path.endsWith("/participants") && request.method() === "GET") {
      const id = path.replace("/exams/", "").replace("/participants", "");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(examParticipants.filter((participant) => participant.examId === id), request.url())),
      });
      return;
    }

    if (path.startsWith("/exams/") && path.endsWith("/participants") && request.method() === "POST") {
      const id = path.replace("/exams/", "").replace("/participants", "");
      const body = request.postDataJSON() as { studentId: string; participantNo?: string; bookletType?: string };
      const exists = examParticipants.some((participant) => participant.examId === id && participant.studentId === body.studentId);
      if (exists) {
        await route.fulfill({
          contentType: "application/json",
          headers: corsHeaders,
          status: 409,
          body: JSON.stringify(envelope({ code: "EXAM_PARTICIPANT_EXISTS" })),
        });
        return;
      }
      const created: ExamParticipantFixture = {
        id: `exam-participant-${examParticipants.length + 1}`,
        tenantId: "tenant-a",
        examId: id,
        studentId: body.studentId,
        ...(body.participantNo ? { participantNo: body.participantNo } : {}),
        ...(body.bookletType ? { bookletType: body.bookletType } : {}),
        status: "REGISTERED",
        createdAt: "2026-06-09T09:10:00.000Z",
        updatedAt: "2026-06-09T09:10:00.000Z",
      };
      examParticipants = [created, ...examParticipants];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (
      (
        path === "/exams/exam-demo/reports/snapshots/snapshot-a/students/student-a/error-booklet" ||
        path === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-a/students/student-a/error-booklet"
      ) &&
      request.method() === "GET"
    ) {
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

    if (/^\/exams\/exam-demo(?:-isem-lgs-1)?\/reports\/generation-jobs\//.test(path) && request.method() === "GET") {
      const jobId = path.split("/").at(-1) ?? "report-job";
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({ jobId, snapshotId: "snapshot-demo", status: "COMPLETED", updatedAt: "2026-06-17T10:00:00.000Z" })),
      });
      return;
    }

    if (
      (
        path === "/exams/exam-demo/reports/snapshots/snapshot-b/students/student-a/error-booklet" ||
        path === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-b/students/student-a/error-booklet"
      ) &&
      request.method() === "GET"
    ) {
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

    if (
      (
        path === "/exams/exam-demo/reports/snapshots/snapshot-a/export.xlsx" ||
        path === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-a/export.xlsx"
      ) &&
      request.method() === "GET"
    ) {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          fileName: `${path.includes("exam-demo-isem-lgs-1") ? "exam-demo-isem-lgs-1" : "exam-demo"}-snapshot-a.xlsx`,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          fileBase64: Buffer.from("xlsx").toString("base64"),
          rowCount: 4,
        })),
      });
      return;
    }

    if (
      (
        path === "/exams/exam-demo/reports/snapshots/snapshot-a/export.pdf" ||
        path === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-a/export.pdf"
      ) &&
      request.method() === "GET"
    ) {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          fileName: `${path.includes("exam-demo-isem-lgs-1") ? "exam-demo-isem-lgs-1" : "exam-demo"}-snapshot-a.pdf`,
          contentType: "application/pdf",
          fileBase64: Buffer.from("pdf").toString("base64"),
          pageCount: 1,
        })),
      });
      return;
    }

    if (
      (
        path === "/exams/exam-demo/reports/snapshots" ||
        path === "/exams/exam-demo-isem-lgs-1/reports/snapshots" ||
        path === "/exams/exam-a/reports/snapshots" ||
        path === "/exams/exam-demo/reports/students/student-a/snapshots" ||
        path === "/exams/exam-demo-isem-lgs-1/reports/students/student-a/snapshots"
      ) &&
      request.method() === "GET"
    ) {
      const url = new URL(request.url());
      const fixturePath = path.replace("/reports/students/student-a/snapshots", "/reports/snapshots");
      const snapshots = (readFixture(fixturePath) as ReportSnapshotFixture[]).filter((snapshot) =>
        (!url.searchParams.get("campusId") || snapshot.campusId === url.searchParams.get("campusId")) &&
        (!url.searchParams.get("gradeLevelId") || snapshot.gradeLevelId === url.searchParams.get("gradeLevelId")) &&
        (!url.searchParams.get("classId") || snapshot.classId === url.searchParams.get("classId")) &&
        (!url.searchParams.get("courseId") || snapshot.courseId === url.searchParams.get("courseId")) &&
        (!url.searchParams.get("termId") || snapshot.termId === url.searchParams.get("termId")),
      );
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(snapshots, request.url())),
      });
      return;
    }

    if (
      (
        path === "/exams/exam-demo/reports/generation-jobs" ||
        path === "/exams/exam-demo-isem-lgs-1/reports/generation-jobs"
      ) &&
      request.method() === "POST"
    ) {
      const body = request.postDataJSON() as ReportGenerationRequestFixture;
      reportGenerationRequests.push(body);
      const examId = path.includes("exam-demo-isem-lgs-1") ? "exam-demo-isem-lgs-1" : "exam-demo";
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          examId,
          reportType: body.reportType ?? "EXAM_RESULT_SUMMARY",
          queueName: "report-generation",
          jobId: `${examId}_server-derived-hash`,
          status: "queued",
        })),
      });
      return;
    }

    if (path === "/exams/exam-demo/reports/snapshots/snapshot-a/students/student-b/error-booklet" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          tenantId: "tenant-a",
          examId: "exam-demo",
          snapshotId: "snapshot-a",
          studentId: "student-b",
          items: [
            { questionNo: 3, branch: "Matematik", answer: "A", correctAnswer: "C", status: "WRONG" },
          ],
          generatedAt: "2026-06-08T09:00:00.000Z",
        })),
      });
      return;
    }

    if (path === "/audit-logs/student-summary" && request.method() === "GET") {
      const url = new URL(request.url());
      const studentId = url.searchParams.get("studentId");
      const summaries = auditLogs
        .filter((record) =>
          (record.entityType === "Student" && record.entityId === studentId) ||
          (record.entityType === "GuardianStudent" && record.diff?.studentId === studentId),
        )
        .slice(0, 5)
        .map((record) => ({
          actionLabel: auditActionLabel(record.action),
          createdAt: record.createdAt,
          id: record.id,
        }));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(summaries, request.url())),
      });
      return;
    }

    if (path === "/audit-logs/safe-list" && request.method() === "GET") {
      const safeLogs = auditLogs.map((record) => ({
        actionLabel: auditActionLabel(record.action),
        actorLabel: record.actorUserId ? "Kullanıcı kaydı" : "Sistem",
        category: auditCategory(record.action, record.entityType),
        createdAt: record.createdAt,
        entityLabel: auditEntityLabel(record.entityType, record.action),
        id: record.id,
      }));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(safeLogs, request.url())),
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
      const classIdsByLevel = new Set(classes.filter((klass) => !level || klass.gradeLevelId === level).map((klass) => klass.id));
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

    if (path === "/students/enrollments/bulk-renew" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        studentIds?: string[];
        classId?: string;
        classIdBySourceClassId?: Record<string, string>;
        useAutomaticClassMapping?: boolean;
        startsAt?: string;
        academicYearId?: string;
        termId?: string;
      };
      const studentIds = body.studentIds ?? [];
      const startsAt = body.startsAt ?? "2026-06-08";
      const created = studentIds.map((studentId, index): StudentEnrollmentFixture => {
        const sourceClassId = students.find((student) => student.id === studentId)?.classId;
        const targetClassId =
          (sourceClassId ? body.classIdBySourceClassId?.[sourceClassId] : undefined) ||
          (body.useAutomaticClassMapping ? automaticTargetClassId(sourceClassId, classes, gradeLevels) : undefined) ||
          body.classId ||
          undefined;
        return {
          id: `student-enrollment-bulk-${index}`,
          tenantId: "tenant-a",
          studentId,
          academicYearId: body.academicYearId ?? "academic-year-2026",
          termId: body.termId ?? "term-2026-spring",
          classId: targetClassId,
          status: "ACTIVE",
          startsAt,
          reason: "RENEWED",
        };
      });
      for (const studentId of studentIds) {
        studentEnrollments = closeActiveEnrollments(studentEnrollments, studentId, startsAt);
      }
      studentEnrollments = [...studentEnrollments, ...created];
      students = students.map((student) =>
        studentIds.includes(student.id)
          ? { ...student, classId: created.find((record) => record.studentId === student.id)?.classId, status: "ACTIVE" }
          : student,
      );
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({ updatedCount: created.length, enrollments: created })),
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

    if (path.startsWith("/students/") && path.endsWith("/enrollments") && request.method() === "GET") {
      const studentId = path.replace("/students/", "").replace("/enrollments", "");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(studentEnrollments.filter((record) => record.studentId === studentId))),
      });
      return;
    }

    if (path.startsWith("/students/") && path.endsWith("/enrollments/renew") && request.method() === "POST") {
      const studentId = path.replace("/students/", "").replace("/enrollments/renew", "");
      const body = request.postDataJSON() as Partial<StudentEnrollmentFixture>;
      const startsAt = body.startsAt ?? "2026-06-05";
      studentEnrollments = closeActiveEnrollments(studentEnrollments, studentId, startsAt);
      const created: StudentEnrollmentFixture = {
        id: "student-enrollment-renewed",
        tenantId: "tenant-a",
        studentId,
        academicYearId: body.academicYearId ?? "academic-year-2026",
        termId: body.termId ?? "term-2026-spring",
        classId: body.classId || undefined,
        status: "ACTIVE",
        startsAt,
        reason: "RENEWED",
      };
      studentEnrollments = [...studentEnrollments, created];
      students = students.map((student) =>
        student.id === studentId ? { ...student, classId: created.classId, status: "ACTIVE" } : student,
      );
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path.startsWith("/students/") && path.endsWith("/enrollments/transfer") && request.method() === "POST") {
      const studentId = path.replace("/students/", "").replace("/enrollments/transfer", "");
      const body = request.postDataJSON() as Partial<StudentEnrollmentFixture>;
      const startsAt = body.startsAt ?? "2026-06-06";
      studentEnrollments = closeActiveEnrollments(studentEnrollments, studentId, startsAt, body.classId ? undefined : "TRANSFERRED");
      students = students.map((student) =>
        student.id === studentId ? { ...student, classId: body.classId || undefined, status: body.classId ? "ACTIVE" : "TRANSFERRED" } : student,
      );
      if (!body.classId) {
        await route.fulfill({
          contentType: "application/json",
          headers: corsHeaders,
          status: 200,
          body: JSON.stringify(envelope(null)),
        });
        return;
      }
      const created: StudentEnrollmentFixture = {
        id: "student-enrollment-transferred",
        tenantId: "tenant-a",
        studentId,
        academicYearId: body.academicYearId ?? "academic-year-2026",
        termId: body.termId ?? "term-2026-spring",
        classId: body.classId,
        status: "ACTIVE",
        startsAt,
        reason: "TRANSFERRED",
      };
      studentEnrollments = [...studentEnrollments, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
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

  await loginAs(page, "admin-a@example.test");

  await expect(page).toHaveURL(/\/kurum$/);
  await expect(heading(page, { name: "DNA EĞİTİM KURUMU" })).toBeVisible();
  const workContext = page.getByLabel("Çalışma bilgileri");
  await expect(workContext).toContainText("Tüm kampüsler");
  await expect(workContext).toContainText("Tüm dönemler");
  await expect(workContext).not.toContainText("Aktif dönem");
  await expect(workContext).not.toContainText("Son hazır sürüm");
  const institutionSummary = page.getByRole("region", { name: "Kurum başarı görünümü" });
  await expect(institutionSummary).toContainText("Aktif öğrenci");
  await expect(institutionSummary).toContainText("3");
  await expect(institutionSummary).toContainText("Son sınav katılımı");
  await expect(institutionSummary).toContainText("1/1");
  const attention = page.getByRole("region", { name: "Bugün ilgilenmeniz gerekenler" });
  await expect(attention.getByRole("link", { name: /Öğrenci destek talepleri 1/ })).toBeVisible();
  await expect(attention.getByRole("link", { name: /Devamsızlık takibi 1/ })).toBeVisible();
  await expect(attention.getByRole("link", { name: /Sonuç kontrolü 1/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Son sınav ve rapor durumu" })).toContainText("Rapor hazır");
  await expect(page.getByLabel("Sınıf karşılaştırması").getByText("Sınıf başarı karşılaştırması")).toBeVisible();
  await expect(page.getByLabel("Sınıf karşılaştırması").getByText("8-A")).toBeVisible();
  await expect(page.getByLabel("Sınıf karşılaştırması").getByText("%91,5")).toBeVisible();
  await expect(page.getByLabel("Sınıf karşılaştırması").locator("canvas")).toBeVisible();
  await expect(page.getByRole("region", { name: "Kurum duyuruları" })).toContainText("Haftalık toplantı");
  await expect(page.getByRole("region", { name: "Kurum duyuruları" }).getByRole("link", { name: "Tüm duyuruları aç" })).toHaveAttribute("href", "/kurum/duyurular");
  await expect(page.getByText("Öğrenci ve eğitim", { exact: true })).toBeVisible();
  await expect(page.getByText("Sınav ve rapor", { exact: true })).toBeVisible();
  await expect(page.getByText("İletişim", { exact: true })).toBeVisible();
  await expect(page.getByText("Yönetim", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Denetim", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "KVKK" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Güvenlik Denetimi" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sistem İzleme" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Kabul ve Geri Dönüş" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Yayın Hazırlığı" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sistem Sağlığı" })).toHaveCount(0);
  await expandSidebarGroup(page, "Öğrenci ve eğitim");
  await expandSidebarGroup(page, "Yönetim");
  await expect(page.getByRole("link", { name: "Operasyon ve kanıt" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kullanıcılar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rol Önizleme" })).toBeVisible();
  await expandSidebarGroup(page, "Öğrenci ve eğitim");
  await expect(page.getByRole("link", { name: "Kampüsler" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Takvim" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Seviyeler" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sınıflar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dersler" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Program" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Etütler" })).toBeVisible();
  await expandSidebarGroup(page, "Sınav ve rapor");
  await expandSidebarGroup(page, "İletişim");
  await expandSidebarGroup(page, "Yönetim");
  await expect(page.getByRole("link", { name: "Öğretmen Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğrenci Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Veli Portalı" })).toBeHidden();
  await expect(page.getByLabel("Oturum özeti")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("tenant-a");
  await expect(page.locator("body")).not.toContainText("user-tenant-a");
  expect(loginCount).toBe(1);
  const commandDialog = await openCommandPalette(page);
  await commandDialog.getByLabel("Komut ara").fill("finans");
  await commandDialog.getByRole("link", { name: /Ödeme planları/ }).click();
  await expect(page).toHaveURL(/\/kurum\/finans$/);
  await expect(heading(page, { name: "Finans" })).toBeVisible();
  await expect(page.getByLabel("Son kullanılanlar")).toHaveCount(0);
  await expandSidebarGroup(page, "Bugün");
  await clickSidebarLink(page, "Özet", /\/kurum$/);
  await expect(heading(page, { name: "DNA EĞİTİM KURUMU" })).toBeVisible();
  const workflowDialog = await openCommandPalette(page);
  await workflowDialog.getByLabel("Komut ara").fill("dönem");
  await workflowDialog.getByRole("link", { name: /Yeni dönem açılışı/ }).click();
  await expect(page).toHaveURL(/\/kurum\/kurulum$/);
  await expect(heading(page, { name: "Kurulum Sihirbazı" })).toBeVisible();
  const examCloseDialog = await openCommandPalette(page);
  await examCloseDialog.getByLabel("Komut ara").fill("sınav sonrası");
  await examCloseDialog.getByRole("link", { name: /Sınav sonrası kapanış/ }).click();
  await expect(page).toHaveURL(/\/kurum\/raporlar$/);
  await expect(heading(page, { name: "Sınav Raporu" })).toBeVisible();
  const emptyReportContext = page.getByLabel("Sayfa bilgileri");
  await expect(emptyReportContext).toContainText("SınavLGS deneme sınavı");
  await expect(emptyReportContext).toContainText("Rapor sürümüHenüz oluşturulmadı");
  const governanceDialog = await openCommandPalette(page);
  await governanceDialog.getByLabel("Komut ara").fill("kvkk");
  await expect(governanceDialog.getByRole("link", { name: /KVKK/ })).toBeVisible();
  await governanceDialog.getByLabel("Komut ara").fill("denetim");
  await expect(governanceDialog.getByRole("link", { name: /^Denetim / })).toBeVisible();
  await governanceDialog.getByRole("button", { name: "Kapat" }).click();
  const entityDialog = await openCommandPalette(page);
  await entityDialog.getByLabel("Komut ara").fill("Ayse");
  const teacherResult = entityDialog.getByLabel("Varlık araması").getByRole("link", { name: /Ayse Ogretmen/ });
  await expect(teacherResult).toBeVisible();
  await Promise.all([page.waitForURL(/\/kurum\/ogretmenler\/teacher-a$/), teacherResult.click()]);
  await expect(heading(page, { name: "Ayse Ogretmen" })).toBeVisible();
  const studentEntityDialog = await openCommandPalette(page);
  await studentEntityDialog.getByLabel("Komut ara").fill("Ada");
  const studentResult = studentEntityDialog.getByLabel("Varlık araması").getByRole("link", { name: /Ada A/ });
  await expect(studentResult).toBeVisible();
  await Promise.all([page.waitForURL(/\/kurum\/ogrenciler\/student-a$/), studentResult.click()]);
  await expect(heading(page, { name: "Ada A" })).toBeVisible();
  const guardianEntityDialog = await openCommandPalette(page);
  await guardianEntityDialog.getByLabel("Komut ara").fill("Zeynep");
  const guardianResult = guardianEntityDialog.getByLabel("Varlık araması").getByRole("link", { name: /Zeynep Veli/ });
  await expect(guardianResult).toBeVisible();
  await Promise.all([page.waitForURL(/\/kurum\/veliler\/guardian-a$/), guardianResult.click()]);
  await expect(heading(page, { name: "Zeynep Veli" })).toBeVisible();
  const classEntityDialog = await openCommandPalette(page);
  await classEntityDialog.getByLabel("Komut ara").fill("8-A");
  const classResult = classEntityDialog.getByLabel("Varlık araması").locator('a[href="/kurum/siniflar/class-a"]');
  await expect(classResult).toBeVisible();
  await Promise.all([page.waitForURL(/\/kurum\/siniflar\/class-a$/), classResult.click()]);
  await expect(heading(page, { name: "8-A" })).toBeVisible();

  await expandSidebarGroup(page, "Yönetim");
  const usersLink = page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Kullanıcılar" });
  await expect(usersLink).toBeVisible();
  await Promise.all([page.waitForURL(/\/kurum\/kullanicilar$/), usersLink.click()]);
  await expect(heading(page, { name: "Kullanıcılar" })).toBeVisible();
  await expect(page.getByText("Admin A")).toBeVisible();
  const userList = page.getByLabel("Kullanıcı ve rol yönetimi");
  await expect(userList.getByText("ad••@•••.test")).toBeVisible();
  await expect(userList.getByText("admin-a@example.test")).toHaveCount(0);
  await expect(heading(page, { name: "Davetler" })).toHaveCount(0);

  await expect(page.getByLabel("Admin A rolleri").getByRole("checkbox")).toHaveCount(0);
  await expect(userList.getByText("Mevcut hesaplar", { exact: true })).toBeVisible();
  await expect(userList.getByText("Yazma kapalı")).toBeVisible();
  await expect(userList.getByRole("link", { name: "Çalışan erişimlerini yönet" })).toHaveAttribute("href", "/kurum/calisanlar");
  expect(rolePatchCount).toBe(0);

  await expandSidebarGroup(page, "Öğrenci ve eğitim");
  await clickSidebarLink(page, "Kampüsler", /\/kurum\/kampusler$/);
  await expect(heading(page, { name: "Kampüsler" })).toBeVisible();
  await expect(page.getByText("Merkez Kampüs")).toBeVisible();
  await expect(page.getByText("1 kayıt").first()).toBeVisible();

  await page.getByRole("button", { name: "Kampüs ekle" }).click();
  const campusDialog = page.getByRole("dialog", { name: "Kampüs ekle" });
  await campusDialog.getByLabel("Kampüs adı", { exact: true }).fill("   ");
  await campusDialog.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Kampüs yönetimi").getByText("Kampüs adı zorunludur.")).toBeVisible();
  await campusDialog.getByLabel("Kampüs adı", { exact: true }).fill(" Kuzey Kampüs ");
  await campusDialog.getByRole("textbox", { name: /^Kod / }).fill(" KZY ");
  await campusDialog.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Kuzey Kampüs")).toBeVisible();

  await page.getByRole("button", { name: "Kuzey Kampüs düzenle" }).click();
  await page.getByLabel("Kampüs adı", { exact: true }).fill("Kuzey Şube");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Kuzey Şube")).toBeVisible();
  await expect(page.getByText("Kuzey Kampüs")).toBeHidden();

  await page.getByRole("button", { name: "Kuzey Şube sil" }).click();
  const deleteCampusDialog = page.getByRole("dialog", { name: "Kampüsü sil" });
  await expect(deleteCampusDialog.getByText("Kuzey Şube kampüsü silinsin mi?")).toBeVisible();
  await deleteCampusDialog.getByRole("button", { name: "Sil" }).click();
  await expect(page.getByRole("cell", { name: "Kuzey Şube", exact: true })).toHaveCount(0);

  await clickSidebarLink(page, "Takvim", /\/kurum\/akademik-takvim$/);
  await expect(heading(page, { name: "Akademik Takvim" })).toBeVisible();
  await expect(heading(page, { name: "Dönemler" })).toBeVisible();
  await expect(page.getByLabel("Akademik yıl yönetimi").getByText("2025-2026")).toBeVisible();
  await expect(page.getByLabel("Akademik dönem yönetimi").getByText("2. Donem")).toBeVisible();

  await page.getByRole("button", { name: "Akademik yıl ekle" }).click();
  let calendarDialog = page.getByRole("dialog", { name: "Akademik yıl ekle" });
  await calendarDialog.getByLabel("Akademik yıl adı").fill("   ");
  await calendarDialog.getByLabel("Başlangıç").fill("2026-09-01");
  await calendarDialog.getByLabel("Bitiş").fill("2027-06-30");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Akademik yıl yönetimi").getByText("Akademik yıl adı zorunludur.")).toBeVisible();
  await calendarDialog.getByLabel("Akademik yıl adı").fill("2026-2027");
  await calendarDialog.getByLabel("Aktif").check();
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Akademik yıl yönetimi").getByText("2026-2027")).toBeVisible();

  await page.getByRole("button", { name: "2026-2027 yılını düzenle" }).click();
  calendarDialog = page.getByRole("dialog", { name: "Akademik yıl düzenle" });
  await calendarDialog.getByLabel("Akademik yıl adı").fill("2026-27");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByLabel("Akademik yıl yönetimi").getByText("2026-27")).toBeVisible();

  await page.getByRole("button", { name: "Dönem ekle" }).click();
  calendarDialog = page.getByRole("dialog", { name: "Dönem ekle" });
  await calendarDialog.getByLabel("Akademik yıl").selectOption("academic-year-created");
  await calendarDialog.getByLabel("Dönem adı").fill("1. Dönem");
  await calendarDialog.getByLabel("Başlangıç").fill("2026-09-01");
  await calendarDialog.getByLabel("Bitiş").fill("2027-01-31");
  await calendarDialog.getByLabel("Aktif").check();
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Akademik dönem yönetimi").getByText("1. Dönem")).toBeVisible();

  await page.getByRole("button", { name: "1. Dönem dönemini düzenle" }).click();
  calendarDialog = page.getByRole("dialog", { name: "Dönem düzenle" });
  await calendarDialog.getByLabel("Dönem adı").fill("Güz Dönemi");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByLabel("Akademik dönem yönetimi").getByText("Güz Dönemi")).toBeVisible();

  await page.getByRole("button", { name: "Güz Dönemi dönemini sil" }).click();
  const deleteTermDialog = page.getByRole("dialog", { name: "Dönemi sil" });
  await expect(deleteTermDialog.getByText("Güz Dönemi dönemi silinsin mi?")).toBeVisible();
  await deleteTermDialog.getByRole("button", { name: "Sil" }).click();
  await expect(page.getByLabel("Akademik dönem yönetimi").getByRole("cell", { name: "Güz Dönemi", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "2026-27 yılını sil" }).click();
  const deleteAcademicYearDialog = page.getByRole("dialog", { name: "Akademik yılı sil" });
  await expect(deleteAcademicYearDialog.getByText("2026-27 akademik yılı silinsin mi?")).toBeVisible();
  await deleteAcademicYearDialog.getByRole("button", { name: "Sil" }).click();
  await expect(page.getByLabel("Akademik yıl yönetimi").getByRole("cell", { name: "2026-27", exact: true })).toHaveCount(0);

  await clickSidebarLink(page, "Seviyeler", /\/kurum\/seviyeler$/);
  await expect(heading(page, { name: "Seviyeler" })).toBeVisible();
  await expect(page.getByText("8. Sınıf")).toBeVisible();
  await expect(page.getByText("1 kayıt").first()).toBeVisible();

  await page.getByRole("button", { name: "Seviye ekle" }).click();
  let gradeDialog = page.getByRole("dialog", { name: "Seviye ekle" });
  await gradeDialog.getByLabel("Seviye adı").fill("   ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Seviye yönetimi").getByText("Seviye adı zorunludur.")).toBeVisible();
  await gradeDialog.getByLabel("Seviye adı").fill("9. Sınıf");
  await gradeDialog.getByLabel("Kod").fill("9");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("9. Sınıf")).toBeVisible();

  await page.getByRole("button", { name: "9. Sınıf düzenle" }).click();
  gradeDialog = page.getByRole("dialog", { name: "Seviye düzenle" });
  await gradeDialog.getByLabel("Seviye adı").fill("Hazırlık");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Hazırlık")).toBeVisible();
  await expect(page.getByText("9. Sınıf")).toBeHidden();

  await page.getByRole("button", { name: "Hazırlık sil" }).click();
  await confirmDeleteDialog(page, "Seviyeyi sil", "Hazırlık seviyesi silinsin mi?");
  await expect(page.getByRole("cell", { name: "Hazırlık", exact: true })).toHaveCount(0);

  await clickSidebarLink(page, "Sınıflar", /\/kurum\/siniflar$/);
  await expect(heading(page, { name: "Sınıflar" })).toBeVisible();
  await expect(page.getByText("8-A")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Merkez Kampüs" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "8. Sınıf" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "A", exact: true })).toBeVisible();
  await expect(page.getByText("2 kayıt").first()).toBeVisible();

  await page.getByRole("main").getByLabel("Ara", { exact: true }).fill("8-B");
  await expect(page.getByText("8-B")).toBeVisible();
  await expect(page.getByText("8-A")).toBeHidden();
  await page.getByLabel("Sırala").selectOption("-name");
  await expect(page.getByText("1 kayıt").first()).toBeVisible();
  await page.getByRole("main").getByLabel("Ara", { exact: true }).fill("");
  await page.getByLabel("Sırala").selectOption("");
  await expect(page.getByText("8-A")).toBeVisible();

  await page.getByRole("button", { name: "Sınıf ekle" }).click();
  const classDialog = page.getByRole("dialog", { name: "Sınıf ekle" });
  await classDialog.getByLabel("Sınıf adı", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Sınıf yönetimi").getByText("Sınıf adı zorunludur.")).toBeVisible();
  await classDialog.getByLabel("Sınıf adı", { exact: true }).fill(" 9-A ");
  await classDialog.getByRole("combobox", { name: /^Seviye / }).selectOption("grade-8");
  await classDialog.getByLabel("Şube", { exact: true }).fill(" A ");
  await classDialog.getByRole("combobox", { name: /^Kampüs / }).selectOption("campus-main");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("9-A")).toBeVisible();

  await page.getByRole("button", { name: "9-A düzenle" }).click();
  await page.getByLabel("Sınıf adı", { exact: true }).fill("9-B");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("9-B")).toBeVisible();
  await expect(page.getByText("9-A")).toBeHidden();

  await page.getByRole("button", { name: "9-B sil" }).click();
  await confirmDeleteDialog(page, "Sınıfı sil", "9-B sınıfı silinsin mi?");
  await expect(page.getByRole("cell", { name: "9-B", exact: true })).toHaveCount(0);

  await clickSidebarLink(page, "Dersler", /\/kurum\/dersler$/);
  await expect(heading(page, { name: "Dersler" })).toBeVisible();
  await expect(page.getByText("Matematik")).toBeVisible();
  await expect(page.getByText("2 kayıt").first()).toBeVisible();

  await page.getByRole("main").getByLabel("Ara", { exact: true }).fill("Turkce");
  await expect(page.getByText("Turkce")).toBeVisible();
  await expect(page.getByText("Matematik")).toBeHidden();
  await page.getByRole("main").getByLabel("Ara", { exact: true }).fill("");

  await page.getByRole("button", { name: "Ders ekle" }).click();
  const courseDialog = page.getByRole("dialog", { name: "Ders ekle" });
  await courseDialog.getByLabel("Ders adı", { exact: true }).fill("   ");
  await courseDialog.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Ders yönetimi").getByText("Ders adı zorunludur.")).toBeVisible();
  await courseDialog.getByLabel("Ders adı", { exact: true }).fill(" Fen Bilimleri ");
  await courseDialog.getByRole("textbox", { name: /^Kod / }).fill(" FEN ");
  await courseDialog.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Fen Bilimleri")).toBeVisible();

  await page.getByRole("button", { name: "Fen Bilimleri düzenle" }).click();
  await page.getByLabel("Ders adı", { exact: true }).fill("Fen");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Fen", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Fen Bilimleri", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Fen sil" }).click();
  await confirmDeleteDialog(page, "Dersi sil", "Fen dersi silinsin mi?");
  await expect(page.getByRole("cell", { name: "Fen", exact: true })).toHaveCount(0);

  await expandSidebarGroup(page, "Sınav ve rapor");
  await clickSidebarLink(page, "Kazanımlar", /\/kurum\/kazanimlar$/);
  await expect(heading(page, { name: "Kazanımlar" })).toBeVisible();
  await expect(page.getByText("Çarpanlar ve katlar")).toBeVisible();
  await page.getByRole("button", { name: "Kazanım ekle" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Kazanım kodu").fill("TUR.8.1.1");
  await dialog.getByLabel("Branş").fill("Türkçe");
  await dialog.getByLabel("Kazanım adı").fill("Sözcükte anlam");
  await dialog.getByLabel("Seviye").fill("8");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Sözcükte anlam")).toBeVisible();

  await page.getByRole("button", { name: "TUR.8.1.1 düzenle" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Kazanım adı").fill("Cümlede anlam");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Cümlede anlam", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sözcükte anlam", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "TUR.8.1.1 sil" }).click();
  await confirmDeleteDialog(page, "Kazanımı sil", "TUR.8.1.1 kazanımı silinsin mi?");
  await expect(page.getByRole("cell", { name: "Cümlede anlam", exact: true })).toHaveCount(0);

  await expandSidebarGroup(page, "Öğrenci ve eğitim");
  await clickSidebarLink(page, "Program", /\/kurum\/program$/);
  await expect(heading(page, { name: "Ders Programı" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Matematik", exact: true }).first()).toBeVisible();
  await expect(page.getByText("1 kayıt").first()).toBeVisible();

  await page.getByRole("main").getByLabel("Ara", { exact: true }).fill("Matematik");
  await expect(page.getByRole("cell", { name: "Matematik", exact: true }).first()).toBeVisible();
  await page.getByRole("main").getByLabel("Ara", { exact: true }).fill("");

  await page.getByRole("button", { name: "Ders ekle" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Sınıf").selectOption("class-a");
  await dialog.getByLabel("Öğretmen").selectOption("teacher-a");
  await dialog.getByLabel("Branş").selectOption("course-math");
  await dialog.getByLabel("Dönem").selectOption("term-2026-spring");
  await dialog.getByLabel("Ders başlığı").fill("Geometri");
  await dialog.getByLabel("Başlangıç").fill("2026-06-01T10:00");
  await dialog.getByLabel("Bitiş").fill("2026-06-01T11:00");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Geometri", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Geometri düzenle" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Ders başlığı").fill("Analitik Geometri");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Analitik Geometri", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Geometri", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Analitik Geometri sil" }).click();
  await confirmDeleteDialog(page, "Ders programını sil", "Analitik Geometri ders programı kaydı silinsin mi?");
  await expect(page.getByRole("cell", { name: "Analitik Geometri", exact: true })).toHaveCount(0);

  await clickSidebarLink(page, "Etütler", /\/kurum\/etutler$/);
  await expect(heading(page, { name: "Etütler" })).toBeVisible();
  await expect(page.getByText("Matematik Etut")).toBeVisible();
  await expect(page.getByText("1 kayıt").first()).toBeVisible();

  await page.getByRole("button", { name: "Etüt ekle" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Sınıf").selectOption("class-a");
  await dialog.getByLabel("Öğretmen").selectOption("teacher-a");
  await dialog.getByLabel("Branş").selectOption("course-math");
  await dialog.getByLabel("Dönem").selectOption("term-2026-spring");
  await dialog.getByLabel("Öğrenciler").selectOption(["student-a"]);
  await dialog.getByLabel("Etüt başlığı").fill("Problem Çözümü");
  await dialog.getByLabel("Kapasite").fill("2");
  await dialog.getByLabel("Başlangıç").fill("2026-06-02T14:00");
  await dialog.getByLabel("Bitiş").fill("2026-06-02T15:00");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Problem Çözümü", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Problem Çözümü düzenle" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Etüt başlığı").fill("Problem Tekrarı");
  await dialog.getByLabel("Kapasite").fill("3");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Problem Tekrarı", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Problem Çözümü", exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Problem Tekrarı sil" }).click();
  await confirmDeleteDialog(page, "Etüdü sil", "Problem Tekrarı etüdü silinsin mi?");
  await expect(page.getByRole("cell", { name: "Problem Tekrarı", exact: true })).toHaveCount(0);

  await clickSidebarLink(page, "Devamsızlık", /\/kurum\/devamsizlik$/);
  await expect(heading(page, { name: "Devamsızlık" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Ada A", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Matematik", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "2. Donem", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Yok", exact: true })).toBeVisible();
  await page.getByLabel("Yoklama sınıfı").selectOption("class-b");
  await expect(page.getByRole("cell", { name: "Ada A", exact: true })).toBeHidden();
  await page.getByLabel("Yoklama sınıfı").selectOption("");
  await expect(page.getByRole("cell", { name: "Ada A", exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: /devamsızlık ekle|eski kayıt ekle/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /devamsızlığını düzenle|devamsızlığını sil/i })).toHaveCount(0);

  await expandSidebarGroup(page, "Öğrenci ve eğitim");
  await clickSidebarLink(page, "Notlar", /\/kurum\/notlar$/);
  await expect(heading(page, { name: "Öğretmen Notları" })).toBeVisible();
  const teacherNoteCell = page.getByRole("cell", { name: "Dikkat takibi iç notu", exact: true });
  await expect(teacherNoteCell).toBeVisible();
  await expect(page.getByRole("cell", { name: "Matematik", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "2. Donem", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "İç not", exact: true })).toBeVisible();
  await page.getByLabel("Sınıf").selectOption("class-b");
  await expect(teacherNoteCell).toBeHidden();
  await page.getByLabel("Sınıf").selectOption("");
  await expect(teacherNoteCell).toBeVisible();

  await page.getByRole("button", { name: "Not ekle" }).click();
  dialog = page.getByRole("dialog", { name: "Not ekle" });
  await dialog.locator("select").nth(0).selectOption("student-b");
  await dialog.locator("select").nth(1).selectOption("teacher-a");
  await dialog.locator("select").nth(2).selectOption("course-math");
  await dialog.locator("select").nth(3).selectOption("term-2026-spring");
  await dialog.locator("select").nth(4).selectOption("GUARDIAN_STUDENT");
  await dialog.getByLabel("Gelişim durumu").fill("FOCUS");
  await dialog.getByRole("textbox", { name: "Not", exact: true }).fill("Problem çözümü güçleniyor.");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Problem çözümü güçleniyor.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Veli/öğrenci görür", exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Bora B notunu düzenle" }).click();
  dialog = page.getByRole("dialog", { name: "Not düzenle" });
  await dialog.getByRole("textbox", { name: "Not", exact: true }).fill("Problem çözümü düzenli.");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Problem çözümü düzenli.")).toBeVisible();

  await page.getByRole("button", { name: "Bora B notunu sil" }).click();
  await confirmDeleteDialog(page, "Notu sil", "Bora B notu silinsin mi?");
  await expect(page.getByText("Problem çözümü düzenli.")).toHaveCount(0);

  await expandSidebarGroup(page, "Öğrenci ve eğitim");
  await clickSidebarLink(page, "Öğretmenler", /\/kurum\/ogretmenler$/);
  await expect(heading(page, { name: "Öğretmenler" })).toBeVisible();
  await expect(page.getByText("Ayse Ogretmen")).toBeVisible();

  await page.getByRole("button", { name: "Ayse düzenle" }).click();
  const teacherAssignmentsRegion = page.getByLabel("Öğretmen atamaları");
  const teacherAssignmentsTable = teacherAssignmentsRegion.getByRole("table", { name: "Öğretmen atamaları" });
  const classTeacherAssignment = teacherAssignmentsTable.getByRole("row", { name: /Sınıf öğretmeni/ });
  await expect(classTeacherAssignment).toContainText("8-A · Matematik");
  await expect(classTeacherAssignment).toContainText("2. Donem · Tarih sınırı yok");
  await page.getByLabel("Atama rolü").selectOption("GUIDANCE_COUNSELOR");
  await page.getByLabel("Atama öğrencisi").selectOption("student-a");
  await page.getByLabel("Atama branşı").selectOption("course-math");
  await page.getByLabel("Atama dönemi").selectOption("term-2026-spring");
  await page.getByRole("button", { name: "Atama ekle" }).click();
  const guidanceAssignment = teacherAssignmentsTable.getByRole("row", { name: /Rehber öğretmen/ });
  await expect(guidanceAssignment).toContainText("Ada A · Matematik");
  await expect(guidanceAssignment).toContainText("2. Donem · Tarih sınırı yok");
  expect(teacherAssignments.find((assignment) => assignment.id === "teacher-assignment-created")?.courseId).toBe("course-math");
  expect(teacherAssignments.find((assignment) => assignment.id === "teacher-assignment-created")?.termId).toBe("term-2026-spring");
  await page.getByRole("button", { name: "Rehber öğretmen atamasını sil" }).click();
  await expect(guidanceAssignment).toHaveCount(0);
  await page.getByRole("button", { name: "Vazgeç" }).click();

  await page.getByRole("button", { name: "Öğretmen ekle" }).click();
  await page.getByLabel("Ad", { exact: true }).fill(" Mert ");
  await page.getByLabel("Soyad", { exact: true }).fill(" Hoca ");
  await page.getByRole("textbox", { name: /^Branş / }).fill(" Fen ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Mert Hoca")).toBeVisible();

  await page.getByRole("button", { name: "Mert düzenle" }).click();
  await page.getByRole("textbox", { name: /^Branş / }).fill("Fizik");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Fizik")).toBeVisible();

  await page.getByRole("button", { name: "Mert sil" }).click();
  await confirmDeleteDialog(page, "Öğretmeni sil", "Mert Hoca öğretmeni silinsin mi?");
  await expect(page.getByText("Mert Hoca")).toHaveCount(0);

  await expandSidebarGroup(page, "Öğrenci ve eğitim");
  await clickSidebarLink(page, "Veli kayıtları", /\/kurum\/veliler$/);
  await expect(heading(page, { name: "Veliler" })).toBeVisible();
  await expect(page.getByText("Zeynep Veli")).toBeVisible();

  const guardianSearchRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === "GET" && url.pathname.endsWith("/guardians") && url.searchParams.get("q") === "Ali Veli";
  });
  const guardianSearch = page.getByRole("main").getByLabel("Ara", { exact: true });
  await guardianSearch.fill("  Ali Veli  ");
  const serializedGuardianSearch = new URL((await guardianSearchRequest).url());
  await expect(guardianSearch).toHaveValue("  Ali Veli  ");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("Ali Veli");
  expect(serializedGuardianSearch.searchParams.get("q")).toBe("Ali Veli");
  await guardianSearch.fill("");
  await expect(page.getByText("Zeynep Veli")).toBeVisible();

  await page.getByRole("link", { name: "Zeynep detay" }).click();
  await expect(page).toHaveURL(/\/kurum\/veliler\/guardian-a$/);
  await expect(heading(page, { name: "Zeynep Veli" })).toBeVisible();
  await expect(page.getByLabel("Veli öğrenci bağlantıları").getByRole("row", { name: /Ada A/ })).toBeVisible();
  await page.getByRole("tab", { name: "Öğrenci bağla", exact: true }).click();
  await page.getByLabel("Veli öğrenci bağı ekle").getByLabel("Öğrenci", { exact: true }).selectOption("student-b");
  await page.getByRole("button", { name: "Bağla" }).click();
  await page.getByRole("tab", { name: "Öğrenci bağlantıları" }).click();
  await expect(page.getByLabel("Veli öğrenci bağlantıları").getByRole("row", { name: /Bora B/ })).toBeVisible();
  expect(guardianStudentLinks.find((link) => link.studentId === "student-b" && link.guardianId === "guardian-a")).toMatchObject({
    canOpenSupportTickets: false,
    canReceiveAnnouncements: false,
    canReceiveSms: false,
    canViewFinance: false,
  });

  await expandSidebarGroup(page, "Öğrenci ve eğitim");
  await clickSidebarLink(page, "Veli kayıtları", /\/kurum\/veliler$/);

  await page.getByRole("button", { name: "Veli ekle" }).click();
  await page.getByLabel("Ad", { exact: true }).fill("Selin");
  await page.getByLabel("Soyad", { exact: true }).fill("Anne");
  await page.getByRole("textbox", { name: /^Telefon / }).fill("5551112233");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Selin Anne")).toBeVisible();

  await page.getByRole("button", { name: "Selin düzenle" }).click();
  await page.getByRole("textbox", { name: /^Telefon / }).fill("5559998877");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("5559998877")).toHaveCount(0);
  await expect(page.getByText("••• ••• ••77")).toBeVisible();

  await page.getByRole("button", { name: "Selin sil" }).click();
  await confirmDeleteDialog(page, "Veliyi sil", "Selin Anne velisi silinsin mi?");
  await expect(page.getByText("Selin Anne")).toHaveCount(0);

  gradeLevels = [...gradeLevels, { id: "grade-9", tenantId: "tenant-a", name: "9. Sınıf", code: "9" }];
  classes = [...classes, { id: "class-c", tenantId: "tenant-a", name: "9-A", campusId: "campus-main", gradeLevelId: "grade-9", section: "A" }];

  await expandSidebarGroup(page, "Öğrenci ve eğitim");
  await clickSidebarLink(page, "Öğrenciler", /\/kurum\/ogrenciler$/);
  await expect(heading(page, { name: "Öğrenciler" })).toBeVisible();
  await expect(page.getByText("Ada A", { exact: true })).toBeVisible();
  await page.getByText("Filtreler ve görünüm", { exact: true }).click();
  const studentTableView = page.getByLabel("Öğrenci tablo görünümü");
  await studentTableView.getByLabel("Sorumlu").uncheck();
  await expect(page.getByRole("columnheader", { name: "Sorumlu öğretmen" })).toBeHidden();
  await studentTableView.getByLabel("Görünüm").selectOption("compact");
  await expect(page).toHaveURL(/density=compact/);
  await studentTableView.getByLabel("Sorumlu").check();
  await expect(page.getByRole("columnheader", { name: "Sorumlu öğretmen" })).toBeVisible();
  const studentFilters = page.getByLabel("Öğrenci filtreleri");
  await studentFilters.getByRole("combobox", { name: /^Sınıf/ }).selectOption("class-a");
  await expect(page.getByText("Ada A", { exact: true })).toBeVisible();
  await expect(page.getByText("Bora B", { exact: true })).toBeHidden();
  await studentFilters.getByRole("combobox", { name: /^Sınıf/ }).selectOption("");
  await studentFilters.getByRole("combobox", { name: /^Seviye/ }).selectOption({ label: "8. Sınıf" });
  await expect(page.getByText("Ada A", { exact: true })).toBeVisible();
  await expect(page.getByText("Bora B", { exact: true })).toBeHidden();
  await studentFilters.getByRole("combobox", { name: /^Seviye/ }).selectOption("");
  await studentFilters.getByRole("combobox", { name: /^Sorumlu/ }).selectOption("teacher-a");
  await expect(page.getByText("Ada A", { exact: true })).toBeVisible();
  await expect(page.getByText("Bora B", { exact: true })).toBeHidden();
  await studentFilters.getByRole("combobox", { name: /^Sorumlu/ }).selectOption("");
  await studentFilters.getByRole("combobox", { name: /^Durum/ }).selectOption("PASSIVE");
  await expect(page.getByText("Can C", { exact: true })).toBeVisible();
  await expect(page.getByText("Ada A", { exact: true })).toBeHidden();
  await studentFilters.getByRole("combobox", { name: /^Durum/ }).selectOption("");
  await studentFilters.getByRole("combobox", { name: /^Veli/ }).selectOption("true");
  await expect(page.getByText("Ada A", { exact: true })).toBeVisible();
  await expect(page.getByText("Bora B", { exact: true })).toBeHidden();
  await studentFilters.getByRole("combobox", { name: /^Veli/ }).selectOption("");
  await expect(page.getByText("Ada A", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ada düzenle" }).click();
  await expect(page.getByLabel("Öğrenci 360").getByText("Devamsızlık")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("Aktif", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("Kayıt geçmişi")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("İlk kayıt")).toBeVisible();
  await page.getByLabel("İşlem tarihi").fill("2026-06-05");
  await page.getByLabel("Yeni sınıf").selectOption("class-a");
  await page.getByRole("button", { name: "Kayıt yenile" }).click();
  await expect(page.getByLabel("Öğrenci 360").getByText("Kayıt yenileme")).toBeVisible();
  await page.getByLabel("İşlem tarihi").fill("2026-06-06");
  await page.getByLabel("Yeni sınıf").selectOption("class-b");
  await page.getByRole("button", { name: "Nakil işle" }).click();
  await expect(page.getByLabel("Öğrenci 360").getByText("Nakil")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("8-B")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("1.000,00 TRY")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("Dikkat takibi iç notu")).toBeVisible();
  await page.getByLabel("Kayıt durumu").selectOption("GRADUATED");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Mezun" })).toBeVisible();
  await page.getByRole("button", { name: "Ada düzenle" }).click();
  await page.getByLabel("Kayıt durumu").selectOption("ACTIVE");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();

  await page.getByRole("link", { name: "Ada öğrenci özeti" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler\/student-a$/);
  await expect(heading(page, { name: "Ada A" })).toBeVisible();
  const studentDashboard = page.getByLabel("Öğrenci özeti", { exact: true });
  const studentSummaryMetrics = page.getByLabel("Öğrenci detay özeti metrikleri");
  await expect(studentSummaryMetrics.getByText("Aktif", { exact: true })).toBeVisible();
  await expect(studentSummaryMetrics.getByText("Başarı %", { exact: true })).toBeVisible();
  await expect(studentSummaryMetrics.getByText("%87,5", { exact: true })).toBeVisible();
  await expect(studentSummaryMetrics.getByText("Net 17,50 / Soru 20", { exact: true })).toBeVisible();
  await expect(studentSummaryMetrics.getByText("2 sınav sonucu", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğretmen notları").getByText("Veli/öğrenci görünür")).toBeVisible();
  await expect(page.getByLabel("Öğretmen notları").getByText("Gelişim olumlu")).toBeVisible();
  await expect(page.getByLabel("Öğretmen notları")).not.toContainText("Problem çözme rutini güçleniyor.");
  await expect(page.getByLabel("İlişki geçmişi").getByText("Zeynep Veli")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi").getByText("Veli bağlantısı")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi").getByText("Finans görünürlüğü: açık")).toBeVisible();
  if (smsEnabled) {
    await expect(page.getByLabel("İlişki geçmişi").getByText("SMS: açık")).toBeVisible();
  } else {
    await expect(page.getByLabel("İlişki geçmişi")).not.toContainText("SMS");
  }
  await expect(page.getByLabel("İlişki geçmişi").getByText("Destek: kapalı")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi")).not.toContainText("Ödeme görür");
  await expect(page.getByLabel("Öğretmen ilişkileri").getByText("Ayse Ogretmen")).toBeVisible();
  await expect(page.getByLabel("Öğretmen ilişkileri").getByText("Sınıf öğretmeni")).toBeVisible();
  await expect(page.getByLabel("Öğretmen ilişkileri").getByText("8-A · Matematik · 2. Donem")).toBeVisible();
  await expect(page.getByLabel("Öğrenci ilişki haritası").getByText("8-A", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğrenci ilişki haritası")).not.toContainText("class-a");
  const enrollmentHistory = page.getByLabel("Kayıt geçmişi", { exact: true });
  await expect(enrollmentHistory.getByText("İlk kayıt")).toBeVisible();
  await expect(enrollmentHistory.getByText("Kayıt yenileme")).toBeVisible();
  await expect(enrollmentHistory.getByText("Nakil")).toBeVisible();
  await expect(enrollmentHistory.getByText("8-B")).toBeVisible();
  await expect(enrollmentHistory.getByText("2. Donem").first()).toBeVisible();
  await expect(enrollmentHistory).not.toContainText("academic-year-2026");
  await expect(page.getByLabel("Denetim özeti").getByText("Öğrenci oluşturuldu")).toBeVisible();
  await expect(page.getByLabel("Denetim özeti").getByText("Veli ilişkisi kuruldu")).toBeVisible();
  await studentDashboard.getByRole("link", { name: "Sınav detayları" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler\/student-a\/sinavlar$/);
  const studentExamDetails = page.getByLabel("Öğrenci sınav detayları", { exact: true });
  await studentExamDetails.getByLabel("Sınav raporu", { exact: true }).selectOption("snapshot-b");
  const studentReportContext = page.getByLabel("Öğrenci rapor bağlam özeti");
  await expect(studentReportContext.getByText("%83,7", { exact: true })).toBeVisible();
  await expect(studentReportContext.getByText("19,25", { exact: true })).toBeVisible();
  await expect(studentReportContext.getByText("23", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Öğrencilere dön" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler$/);
  await page.getByText("Toplu işlemler", { exact: true }).click();
  await page.getByLabel("Toplu dönem geçişi").getByLabel("Geçiş tarihi").fill("2026-06-08");
  await page.getByLabel("Toplu dönem geçişi").getByLabel("8-B hedefi").selectOption("class-a");
  await page.getByRole("button", { name: "Listelenenleri geçir" }).click();
  await page.getByRole("dialog", { name: "Toplu dönem geçişini onayla" }).getByRole("button", { name: "Geçir" }).click();
  await expect(page.getByRole("cell", { name: "8-A", exact: true }).first()).toBeVisible();
  expect(studentEnrollments.some((record) => record.studentId === "student-a" && record.reason === "RENEWED" && record.startsAt === "2026-06-08")).toBe(true);
  await page.getByLabel("Toplu dönem geçişi").getByLabel("Geçiş tarihi").fill("2026-06-09");
  await page.getByLabel("Otomatik seviye yükselt").check();
  await page.getByRole("button", { name: "Listelenenleri geçir" }).click();
  await page.getByRole("dialog", { name: "Toplu dönem geçişini onayla" }).getByRole("button", { name: "Geçir" }).click();
  await expect(page.getByRole("cell", { name: "9-A", exact: true }).first()).toBeVisible();
  expect(studentEnrollments.some((record) =>
    record.studentId === "student-a" &&
    record.reason === "RENEWED" &&
    record.classId === "class-c" &&
    record.startsAt === "2026-06-09",
  )).toBe(true);

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

  await page.getByRole("button", { name: "Deniz sil" }).click();
  await confirmDeleteDialog(page, "Öğrenciyi sil", "Deniz Güncel öğrencisi silinsin mi?");
  await expect(page.getByText("Deniz Güncel")).toHaveCount(0);

  await expandSidebarGroup(page, "İletişim");
  await clickSidebarLink(page, "Duyurular", /\/kurum\/duyurular$/);
  await expect(heading(page, { name: "Duyurular" })).toBeVisible();
  await expect(page.getByText("Haftalık toplantı")).toBeVisible();
  await page.getByRole("row", { name: /Haftalık toplantı/ }).getByRole("button", { name: "Alıcılar" }).click();
  const recipientSummary = page.getByLabel("Alıcı raporu özeti");
  await expect(recipientSummary.getByText("Toplam", { exact: true })).toBeVisible();
  await expect(recipientSummary.getByText("3", { exact: true })).toBeVisible();
  await expect(recipientSummary.getByText("Bekleyen", { exact: true })).toBeVisible();
  await expect(recipientSummary.getByText("2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Duyuru alıcı raporu").getByText("Zeynep Veli")).toBeVisible();

  await page.getByRole("button", { name: "Duyuru ekle" }).click();
  await page.getByLabel("Başlık", { exact: true }).fill("   ");
  await page.getByLabel(/^Duyuru metni/).fill("Geçici metin");
  await page.getByRole("button", { name: "Alıcıları önizle", exact: true }).click();
  await expect(page.getByLabel("Duyuru yönetimi").getByText("Başlık zorunludur.")).toBeVisible();
  await page.getByLabel("Başlık", { exact: true }).fill(" Sınav hazırlığı ");
  await page.getByLabel(/^Duyuru metni/).fill(" Cuma deneme sınavı yapılacaktır. ");
  await page.getByRole("button", { name: "Alıcıları önizle", exact: true }).click();
  await expect(page.getByLabel("Duyuru önizleme")).toContainText("3 alıcı");
  await page.getByRole("button", { name: "Yayınla", exact: true }).click();
  const announcementConfirmDialog = page.getByRole("dialog", { name: "Duyuruyu yayınla" });
  await expect(announcementConfirmDialog).toContainText("3 kişi");
  await announcementConfirmDialog.getByRole("button", { name: "Yayınla" }).click();
  await expect.poll(() => announcementCreateIdempotencyKeys).toHaveLength(1);
  expect(announcementCreateIdempotencyKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByText("Sınav hazırlığı")).toBeVisible();
  await expect(page.getByRole("row", { name: /Sınav hazırlığı/ }).getByRole("cell", { name: "Tüm okul", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Sınav hazırlığı/ }).getByText("Tüm kapsam", { exact: true })).toBeVisible();
  await page.getByRole("row", { name: /Sınav hazırlığı/ }).getByRole("button", { name: "Alıcılar" }).click();
  if (smsEnabled) {
    await expect(page.getByLabel("Duyuru SMS gönderimi").getByText("SMS gönderimi")).toBeVisible();
    await page.getByLabel("Duyuru SMS gönderimi").getByRole("combobox", { name: "SMS şablonu" }).selectOption("message-template-a");
    await page.getByLabel("Duyuru SMS gönderimi").getByRole("button", { name: "Alıcıları önizle" }).click();
    await page.getByLabel("Duyuru SMS gönderimi").getByRole("button", { name: "SMS gönder" }).click();
    await page.getByRole("dialog", { name: "SMS gönderimini onayla" }).getByRole("button", { name: "SMS gönder" }).click();
    await expect.poll(() => smsBatchIdempotencyKeys).toHaveLength(1);
    expect(smsBatchIdempotencyKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(smsBatchCreateBodies[0]).toMatchObject({
      recipientScope: { announcementId: "announcement-created", studentStatus: "ACTIVE" },
    });
    await expect(page.getByLabel("Duyuru SMS gönderimi").getByText("1 alıcı için gönderim başlatıldı.")).toBeVisible();
    await expect(page.getByLabel("Duyuru SMS gönderimi").getByLabel("SMS teslim raporu").getByText("Tamamlandı")).toBeVisible();
  } else {
    await expect(page.getByLabel("Duyuru SMS gönderimi")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Kapat" }).click();
  await page.getByRole("main").getByLabel("Ara", { exact: true }).fill("Sınav");
  await expect(page.getByText("Sınav hazırlığı")).toBeVisible();
  await expect(page.getByText("Haftalık toplantı")).toBeHidden();
  await page.getByRole("main").getByLabel("Ara", { exact: true }).fill("");
  await page.getByLabel("Sırala").selectOption("-title");
  await expect(page.getByText("2 kayıt").first()).toBeVisible();

  await expandSidebarGroup(page, "Öğrenci ve eğitim");
  await clickSidebarLink(page, "Materyaller", /\/kurum\/materyaller$/);
  await expect(heading(page, { name: "Ödev Kontrolü" })).toBeVisible();
  await expect(heading(page, { name: "Materyal Havuzu" })).toBeVisible();
  const homeworkList = page.getByLabel("Ödev kontrolü");
  const materialList = page.getByLabel("Materyal listesi");
  const materialTools = page.getByLabel("Materyal araçları");
  await expect(homeworkList.getByText("Kesirler", { exact: true })).toBeVisible();
  await homeworkList.getByLabel("Ara").fill("Kesir");
  await expect(homeworkList.getByText("Kesirler", { exact: true })).toBeVisible();
  await homeworkList.getByLabel("Ara").fill("");
  await expect(page.getByText("0/1 ödev kontrol edildi")).toBeVisible();
  await page.getByRole("button", { name: "Kesirler kontrol et" }).click();
  await expect(page.getByText("1/1 ödev kontrol edildi")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kontrol edildi", exact: true })).toBeVisible();

  await expect(materialList.getByText("Kesirler Çalışma Kağıdı", { exact: true })).toBeVisible();
  await expect(materialTools.getByText("Dosya: kesirler.txt")).toBeVisible();
  await expect(materialTools.getByText("Atama: Ada A")).toBeVisible();

  await page.getByRole("button", { name: "Materyal ekle" }).click();
  await page.getByLabel("Materyal adı", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Materyal listesi").getByText("Materyal adı zorunludur.")).toBeVisible();
  await page.getByLabel("Materyal adı", { exact: true }).fill(" Problemler Föyü ");
  await page.getByLabel(/^Açıklama/).fill(" Yaş ve işçi problemleri ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Problemler Föyü", exact: true })).toBeVisible();
  await materialList.getByLabel("Ara").fill("Problemler");
  await expect(page.getByRole("cell", { name: "Problemler Föyü", exact: true })).toBeVisible();
  await expect(materialList.getByRole("cell", { name: "Kesirler Çalışma Kağıdı", exact: true })).toBeHidden();
  await materialList.getByLabel("Ara").fill("");

  await materialTools.getByLabel(/^Not/).fill("Ek tekrar");
  await materialTools.getByLabel("Teslim", { exact: true }).fill("2026-06-10");
  await materialTools.getByRole("button", { name: "Öğrenciye ata" }).click();
  await expect(materialTools.getByText("Atama: Ada A")).toBeVisible();

  await materialTools.getByLabel("Materyal dosyası", { exact: true }).setInputFiles({
    name: "problemler.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("problem notu"),
  });
  await expect(materialTools.getByText("problemler.txt")).toBeVisible();
  await materialTools.getByRole("button", { name: "Dosya yükle" }).click();
  await expect(materialTools.getByText("Dosya: problemler.txt")).toBeVisible();

  await page.getByRole("button", { name: "Problemler Föyü düzenle" }).click();
  await page.getByLabel("Materyal adı", { exact: true }).fill("Problemler Tekrar Föyü");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Problemler Tekrar Föyü", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Problemler Tekrar Föyü sil" }).click();
  await confirmDeleteDialog(page, "Materyali sil", "Problemler Tekrar Föyü materyali, dosya ve atama bağlantılarıyla silinsin mi?");
  await expect(page.getByLabel("Materyal listesi").getByText("Problemler Tekrar Föyü", { exact: true })).toHaveCount(0);

  await expandSidebarGroup(page, "Sınav ve rapor");
  await clickSidebarLink(page, "Sınavlar", /\/kurum\/sinavlar$/);
  await expect(heading(page, { name: "Sınavlar" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "LGS deneme sınavı", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sınav ekle" }).click();
  await page.getByLabel(/^Sınav adı/).fill("Haziran Genel Deneme");
  await page.getByLabel(/^Başlangıç/).fill("2026-06-12T09:30");
  await page.getByRole("checkbox", { name: /^9-A/ }).check();
  await page.getByLabel("Cevap anahtarı dosyası").setInputFiles({
    name: "haziran-genel-deneme.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("answer-key"),
  });
  await expect(page.getByText("haziran-genel-deneme.xlsx", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Sınav ekle" }).locator('input[type="file"]')).not.toHaveAttribute("required");
  const invalidExamFields = await page.getByRole("dialog", { name: "Sınav ekle" })
    .locator("input:invalid, select:invalid, textarea:invalid")
    .evaluateAll((elements) => elements.map((element) => ({
      name: element.getAttribute("aria-label") ?? element.getAttribute("name") ?? element.id,
      validationMessage: (element as HTMLInputElement).validationMessage,
    })));
  expect(invalidExamFields).toEqual([]);
  const [examCreateResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/exams")),
    page.getByRole("button", { name: "Ekle", exact: true }).click(),
  ]);
  expect(examCreateResponse.status()).toBe(201);
  await expect(page.getByRole("cell", { name: "Haziran Genel Deneme", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Haziran Genel Deneme/ }).getByText("Taslak")).toBeVisible();
  await page.getByRole("button", { name: "Haziran Genel Deneme yayınla" }).click();
  await expect(page.getByRole("row", { name: /Haziran Genel Deneme/ }).getByRole("cell", { name: "Yayında" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Haziran Genel Deneme katılımcıları" }).click();
  const participantPanel = page.getByLabel("Sınav katılımcıları");
  await expect(participantPanel.getByRole("heading", { name: "Haziran Genel Deneme katılımcıları" })).toBeVisible();
  await expect(participantPanel.getByRole("row", { name: /Ada A/ }).locator('[data-column-key="participantNo"]')).toHaveText("176");
  await expect(participantPanel.getByRole("row", { name: /Ada A/ }).getByText("Kayıtlı")).toBeVisible();

  await expandSidebarGroup(page, "Sınav ve rapor");
  await clickSidebarLink(page, "Optik Okuma", /\/kurum\/optik$/);
  await expect(heading(page, { name: "Optik düzeni seç" })).toBeVisible();
  const opticalExamSelector = page.getByLabel("Sınav seçimi");
  await expect(opticalExamSelector.getByLabel("Yeni sınav adı")).toHaveCount(0);
  await expect(opticalExamSelector.getByRole("button", { name: "Sınav oluştur" })).toHaveCount(0);
  await opticalExamSelector.getByRole("combobox", { name: "Sınav seç" }).selectOption("exam-a");
  await expect(opticalExamSelector.getByLabel("Yeni sınav adı")).toHaveCount(0);
  await expect(opticalExamSelector.getByRole("button", { name: "Sınav oluştur" })).toHaveCount(0);
  await expect(page.getByLabel("Seçili form özeti")).toContainText("7108 LGS optik düzeni");
  await expect(page.getByLabel("Seçili düzenin teknik ayrıntıları")).toBeHidden();
  await page.getByRole("button", { name: "Seç ve ilerle" }).click();
  await expect(page.getByRole("tab", { name: /Optik yükleme/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /Cevap anahtarı/ })).toHaveCount(0);
  await page.getByLabel("Optik cevap dosyası").setInputFiles({
    name: "optik-a.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(parserFileContent),
  });
  await page.getByRole("button", { name: "Yükle ve kontrol et" }).click();
  await expect(page.getByLabel("Optik yükleme sonucu").getByText("Kontrol tamamlandı")).toBeVisible();
  await expect(page.getByLabel("Optik yükleme sonucu").getByText("Eşleşmeyen")).toBeVisible();
  await page.getByRole("button", { name: "Analizi başlat" }).click();
  await expect(page.getByLabel("Eşleşmeyen satırlar").getByRole("heading", { name: "Eşleşmeyen satırları çöz" })).toBeVisible();
  expect(evaluationStatusRequests).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Eşleşmeyen satırları getir" }).click();
  const quarantineRow = page.getByRole("row", { name: /Öğrenciyle eşleşmedi/ });
  await expect(quarantineRow.getByText("Bekliyor")).toBeVisible();
  await page.getByLabel("Öğrenci adı/no ara").fill("Ada");
  await page.getByRole("button", { name: "Öğrencileri ara" }).click();
  await quarantineRow.getByRole("combobox").selectOption("student-a");
  await quarantineRow.getByRole("button", { name: "7. satırı çöz" }).click();
  await expect(quarantineRow.getByText("Bekliyor")).not.toBeVisible();
  await expect(quarantineRow.getByText("Çözüldü", { exact: true })).toBeVisible();
  const opticalReportPanel = page.getByLabel("Raporlara geçiş");
  await expect(opticalReportPanel.getByText("2 öğrenci için rapor hazır.", { exact: true })).toBeVisible();
  await expect(opticalReportPanel.getByLabel("Rapor hazırlama durumu").getByText("Tamamlandı")).toBeVisible();
  await expect(opticalReportPanel.getByRole("link", { name: "Rapor çalışma alanına geç" })).toHaveAttribute("href", "/kurum/raporlar?examId=exam-a");

  await expandSidebarGroup(page, "Sınav ve rapor");
  await clickSidebarLink(page, "Sınav Raporları", /\/kurum\/raporlar$/);
  await expect(heading(page, { name: "Sınav Raporu" })).toBeVisible();
  await fillReportExamReference(page, "exam-a");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  const reportPageContext = page.getByLabel("Sayfa bilgileri");
  await expect(reportPageContext).toContainText("Haziran Genel Deneme");
  await expect(reportPageContext).toContainText("Rapor sürümüRapor hazır");
  await expect(reportPageContext).not.toContainText("Son hazır sürüm");
  await expect(page.getByLabel("Rapor özeti").getByText("Başarı %", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Rapor özeti").getByText("%81,3", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Rapor özeti").getByText("16,25 net / 20 soru", { exact: true })).toBeVisible();
  await fillReportExamReference(page, "exam-demo");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByLabel("Rapor özeti").getByText("%87,5", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Rapor özeti").getByText("17,50 net / 20 soru", { exact: true })).toBeVisible();
  await fillReportExamReference(page, "exam-demo-isem-lgs-1");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByLabel("Rapor iş akışı").getByText("İSEM LGS-1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Rapor özeti").getByText("%87,5", { exact: true })).toBeVisible();
  await fillReportExamReference(page, "exam-demo");
  await page.getByText("Kapsam filtreleri", { exact: true }).click();
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Ders" }).selectOption("course-turkish");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByLabel("Rapor özeti").getByText("19,25 net / 20 soru", { exact: true })).toBeVisible();
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Ders" }).selectOption("course-math");
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Kampüs" }).selectOption("campus-main");
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Seviye" }).selectOption("grade-8");
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Sınıf" }).selectOption("class-a");
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Dönem" }).selectOption("term-2026-spring");
  await page.getByRole("button", { name: /^(Raporu hazırla|Yeniden hazırla)$/ }).click();
  await expect(page.getByText("Rapor hazırlandı.")).toBeVisible();
  expect(reportGenerationRequests.at(-1)).toEqual({
    reportType: "EXAM_RESULT_SUMMARY",
    campusId: "campus-main",
    gradeLevelId: "grade-8",
    classId: "class-a",
    courseId: "course-math",
    termId: "term-2026-spring",
  });
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByLabel("Rapor özeti").getByText("17,50 net / 20 soru", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Çıktılar" }).click();
  const reportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel indir" }).click();
  await expect((await reportDownload).suggestedFilename()).toBe("exam-demo-snapshot-a.xlsx");
  const reportPdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF indir" }).click();
  await expect((await reportPdfDownload).suggestedFilename()).toBe("exam-demo-snapshot-a.pdf");

  await expandSidebarGroup(page, "Yönetim");
  await clickSidebarLink(page, "Ödeme planları", /\/kurum\/finans$/);
  await expect(heading(page, { name: "Finans" })).toBeVisible();
  const financeMetrics = page.getByLabel("Ödeme planları özeti metrikleri");
  await expect(financeMetrics.getByText("₺1.000,00")).toBeVisible();
  await expect(financeMetrics.getByText("₺500,00")).toBeVisible();
  const firstPaymentRow = page.getByRole("row", { name: /1\. taksit/ });
  await expect(firstPaymentRow.getByRole("cell", { name: "2026 Haziran ödeme planı", exact: true })).toBeVisible();
  await expect(firstPaymentRow.getByRole("cell", { name: "Merkez Kampüs / 8. Sınıf / 8-A / Matematik / 2. Donem", exact: true })).toBeVisible();
  await expect(firstPaymentRow.getByRole("cell", { name: "Gecikmiş", exact: true })).toBeVisible();
  await page.getByLabel("Finans filtreleri").getByRole("combobox", { name: "Ders" }).selectOption("course-math");
  await expect(firstPaymentRow.getByRole("cell", { name: "2026 Haziran ödeme planı", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "2026 Haziran ödeme planı 1. taksit ödendi işaretle" }).click();
  await expect(firstPaymentRow.getByText("Ödendi")).toBeVisible();
  await expect(financeMetrics.getByText("₺0,00")).toBeVisible();

  if (smsEnabled) {
    await expandSidebarGroup(page, "İletişim");
    await clickSidebarLink(page, "Mesaj Şablonları", /\/kurum\/sablonlar$/);
    await expect(heading(page, { name: "Şablonlar" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Sınav hatırlatma", exact: true })).toBeVisible();
    await expect(page.getByLabel("SMS önizleme").getByText("Yarın deneme sınavı yapılacaktır.")).toBeVisible();
    await page.getByRole("combobox", { name: "Duyuru hedefi" }).selectOption("announcement-a");
    await expect(page.getByRole("combobox", { name: "Sınıf" })).toHaveValue("class-a");
    await expect(page.getByRole("combobox", { name: "Ders" })).toHaveValue("course-math");
    await expect(page.getByRole("combobox", { name: "Dönem" })).toHaveValue("term-2026-spring");
    await page.getByRole("button", { name: "Alıcıları getir" }).click();
    const smsRecipientPreview = page.getByRole("region", { exact: true, name: "SMS alıcı önizleme" });
    await expect(smsRecipientPreview.getByText("1 izinli veli")).toBeVisible();
    await expect(smsRecipientPreview.getByText("İzinli veli", { exact: true })).toBeVisible();
    await expect(smsRecipientPreview.getByText("1 bağlı öğrenci").first()).toBeVisible();
    await expect(smsRecipientPreview).not.toContainText("Ali Veli");
    await expect(page.getByLabel("SMS alıcıları")).toHaveValue("");
    await expect(page.getByLabel("SMS önizleme").getByText("1 alıcı")).toBeVisible();
    await page.getByRole("button", { name: "SMS gönder" }).click();
    await page.getByRole("dialog", { name: "SMS gönderimini onayla" }).getByRole("button", { name: "SMS gönder" }).click();
    await expect(page.getByRole("region", { exact: true, name: "SMS gönderim" }).getByText("1 alıcı için gönderim başlatıldı.")).toBeVisible();
    await expect(page.getByLabel("SMS teslim raporu").getByText("Tamamlandı")).toBeVisible();
    await expect(page.getByLabel("SMS teslim raporu").getByText("1", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Şablon ekle" }).click();
    await page.getByLabel("Şablon adı", { exact: true }).fill("   ");
    await page.getByLabel(/^Mesaj metni/).fill("Geçici metin");
    await page.getByRole("button", { name: "Ekle", exact: true }).click();

    await expect(page.getByLabel("Şablon yönetimi").getByText("Şablon adı zorunludur.")).toBeVisible();
    await page.getByLabel("Şablon adı", { exact: true }).fill(" Devamsızlık ");
    await page.getByLabel(/^Mesaj metni/).fill(" Bugün öğrenciniz devamsız görünmektedir. ");
    await page.getByRole("button", { name: "Ekle", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Devamsızlık", exact: true })).toBeVisible();
    await page.getByRole("main").getByLabel("Ara", { exact: true }).fill("Devamsızlık");
    await expect(page.getByRole("cell", { name: "Devamsızlık", exact: true })).toBeVisible();
    await expect(page.getByText("Sınav hatırlatma")).toBeHidden();
    await page.getByRole("main").getByLabel("Ara", { exact: true }).fill("");

    await page.getByRole("button", { name: "Devamsızlık düzenle" }).click();
    await page.getByLabel(/^Mesaj metni/).fill("Bugün öğrenciniz derse katılmadı.");
    await page.getByRole("button", { name: "Kaydet", exact: true }).click();
    await expect(page.getByText("Bugün öğrenciniz derse katılmadı.")).toBeVisible();

    await page.getByRole("button", { name: "Devamsızlık sil" }).click();
    await confirmDeleteDialog(page, "Şablonu sil", "Devamsızlık şablonu silinsin mi?");
    await expect(page.getByRole("cell", { name: "Devamsızlık", exact: true })).toHaveCount(0);
  } else {
    await expandSidebarGroup(page, "İletişim");
    await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Mesaj Şablonları", exact: true })).toHaveCount(0);
  }

  await expandSidebarGroup(page, "İletişim");
  await clickSidebarLink(page, "Kurum içi destek", /\/kurum\/destek$/);
  await expect(heading(page, { name: "Kurum içi destek" })).toBeVisible();
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
  const supportDialog = page.getByRole("dialog", { name: "Destek bildirimi aç" });
  await page.getByLabel("Konu", { exact: true }).fill("   ");
  await supportDialog.getByRole("textbox", { name: "Mesaj" }).fill("Geçici mesaj");
  await page.getByRole("button", { name: "Aç", exact: true }).click();
  await expect(page.getByLabel("Destek bildirimi yönetimi").getByText("Konu zorunludur.")).toBeVisible();
  await page.getByLabel("Konu", { exact: true }).fill(" Sınav sistemi ");
  await supportDialog.getByRole("textbox", { name: "Mesaj" }).fill(" Rapor ekranı açılmıyor. ");
  await page.getByRole("combobox", { name: "Öncelik" }).selectOption("HIGH");
  await supportDialog.getByRole("combobox", { name: "Ders" }).selectOption("course-turkish");
  await supportDialog.getByRole("combobox", { name: "Dönem" }).selectOption("term-2026-spring");
  await page.getByRole("button", { name: "Aç", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Sınav sistemi", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Yüksek", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Turkce / 2. Donem", exact: true })).toBeVisible();
  await page.getByLabel("Destek filtreleri").getByRole("combobox", { name: "Ders" }).selectOption("course-turkish");
  await expect(page.getByRole("cell", { name: "Sınav sistemi", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Optik dosya okunmuyor", exact: true })).toBeHidden();
  await page.getByLabel("Destek filtreleri").getByRole("combobox", { name: "Ders" }).selectOption("");
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

  await page.goto("/kurum/denetim");
  await expect(page).toHaveURL(/\/kurum\/denetim$/);
  await expect(page.getByRole("region", { exact: true, name: "Denetim operasyon özeti" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Denetim kayıtları" })).toContainText("Oturum açıldı");

  await expandSidebarGroup(page, "Yönetim");
  await clickSidebarLink(page, "Rol Önizleme", /\/kurum\/rol-onizleme$/);
  await expect(heading(page, { name: "Rol Önizleme" })).toBeVisible();
  await expect(page.getByLabel("Rol önizleme özeti").getByText("Kişiye göre")).toBeVisible();
  const roleViewPreview = page.getByLabel("Rol görünüm önizleme");
  await expect(roleViewPreview.getByText("Ödeme planları")).toBeVisible();
  await expect(roleViewPreview.getByText("Kullanıcılar")).toBeVisible();
  await roleViewPreview.getByRole("combobox", { name: /^Rol/ }).selectOption("ASSISTANT_ADMIN");
  await expect(roleViewPreview.getByText("Öğrenciler")).toBeVisible();
  await expect(roleViewPreview.getByText("Ödeme planları")).toHaveCount(0);
  await expect(roleViewPreview.getByText("Kullanıcılar")).toHaveCount(0);
  await roleViewPreview.getByRole("combobox", { name: /^Rol/ }).selectOption("TEACHER");
  await expect(roleViewPreview.getByText("Öğretmen ekranı")).toBeVisible();
  await expect(roleViewPreview.getByText("/ogretmen")).toBeVisible();
  await expect(roleViewPreview.getByText("Kurum sol menüsü görünmez")).toBeVisible();
  await expect(page.getByLabel("Kişisel ekran kartları").getByText("Öğretmen hesabı")).toBeVisible();
  await expect(page.getByLabel("Kişisel ekran kartları").getByText("Kişisel giriş bilgileri önizlemede gösterilmez.")).toHaveCount(3);
  await expect(page.getByLabel("Kişisel ekran kartları").getByText("student-a@example.test")).toHaveCount(0);
  await expect(page.getByLabel("Kişisel ekran kartları").getByText("/veli")).toBeVisible();
  await page.getByLabel("Kişisel ekran kartları").getByRole("button", { name: "Öğretmen ekranı önizle" }).click();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Seçili rol: Öğretmen")).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Kişi kaydı: Öğretmen kaydı doğrulandı", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Erişim: Yalnızca görüntüleme")).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByRole("paragraph").filter({ hasText: "Kişi erişimi doğrulandı" })).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Öğretmen ekranı: Erişim doğrulandı")).toBeVisible();
  await page.getByLabel("Aktif rol önizleme kaydı").getByRole("link", { name: "Öğretmen ekranına geç" }).click();
  await expect(page).toHaveURL(/\/ogretmen\?rolePreview=1$/);
  expect(page.url()).not.toContain("preview-token");
  await expect(heading(page, { name: "Öğretmen Portalı" })).toBeVisible();
  await expect(page.getByLabel("Rol önizleme bilgisi").getByText("Yalnızca Görüntüleme")).toBeVisible();
  await expect(page.getByLabel("Öğretmen öğrenci kapsamı").getByText("Ada A")).toBeVisible();
  await expect(page.getByLabel("Öğretmen günlük işlemleri")).toHaveCount(0);
  await expect(page.getByLabel("Destek talepleri").getByText("Yalnızca görüntüleme sırasında destek talebi açılamaz.")).toBeVisible();
  await expect(page.getByLabel("Öğretmen ödev kontrolü").getByText("Yalnızca görüntüleme")).toBeVisible();
  await expandSidebarGroup(page, "Yönetim");
  await clickSidebarLink(page, "Rol Önizleme", /\/kurum\/rol-onizleme$/);
  await expect(heading(page, { name: "Rol Önizleme" })).toBeVisible();
  await page.getByLabel("Kişisel ekran kartları").getByRole("button", { name: "Öğrenci ekranı önizle" }).click();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Seçili rol: Öğrenci")).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Kişi kaydı: Öğrenci kaydı doğrulandı", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Öğrenci ekranı: Kendi bilgilerine erişim doğrulandı")).toBeVisible();
  await page.getByLabel("Aktif rol önizleme kaydı").getByRole("link", { name: "Öğrenci ekranına geç" }).click();
  await expect(page).toHaveURL(/\/ogrenci\?rolePreview=1$/);
  expect(page.url()).not.toContain("preview-token");
  await expect(heading(page, { name: "Öğrenci Portalı" })).toBeVisible();
  await expect(page.getByLabel("Rol önizleme bilgisi").getByText("Yalnızca Görüntüleme")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Ada A")).toBeVisible();
  await expect(page.getByLabel("Destek talepleri").getByText("Yalnızca görüntüleme sırasında destek talebi açılamaz.")).toBeVisible();
  await expandSidebarGroup(page, "Yönetim");
  await clickSidebarLink(page, "Rol Önizleme", /\/kurum\/rol-onizleme$/);
  await page.getByLabel("Kişisel ekran kartları").getByRole("button", { name: "Mevcut veli ekranı önizle" }).click();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Seçili rol: Veli")).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Kişi kaydı: Veli kaydı doğrulandı", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Mevcut veli ekranı: 1 bağlı öğrenci")).toBeVisible();
  await page.getByLabel("Aktif rol önizleme kaydı").getByRole("link", { name: "Mevcut veli ekranına geç" }).click();
  await expect(page).toHaveURL(/\/veli\?rolePreview=1$/);
  expect(page.url()).not.toContain("preview-token");
  await expect(heading(page, { name: "Veli Portalı" })).toBeVisible();
  await expect(page.getByLabel("Rol önizleme bilgisi").getByText("Yalnızca Görüntüleme")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Ada A")).toBeVisible();
  await expect(page.getByLabel("Bildirim tercihleri").getByText("Yalnızca görüntüleme sırasında bildirim tercihleri değiştirilemez.")).toBeVisible();
  await expect(page.getByLabel("Destek talepleri").getByText("Yalnızca görüntüleme sırasında destek talebi açılamaz.")).toBeVisible();
  await expandSidebarGroup(page, "Yönetim");
  await clickSidebarLink(page, "Rol Önizleme", /\/kurum\/rol-onizleme$/);
  await expect(page.getByText("Rehber / Referans")).toBeVisible();
  await expect(page.getByLabel("Kişisel ekran kartları").getByRole("button", { name: "Öğrenci ekranı önizle" })).toBeVisible();
  await expect(page.getByLabel("Kişisel ekran kartları").getByRole("button", { name: "Mevcut veli ekranı önizle" })).toBeVisible();
  await expect(page.getByLabel("Rol erişim kuralları").getByText("Kurum yöneticileri kişisel ekranları normal menüde görmez.")).toBeVisible();
  await expect(page.getByLabel("Rol erişim kuralları").getByText("Öğretmen yalnız sorumlu olduğu öğrencileri ve ders programını görür.")).toBeVisible();
  await expect(page.getByLabel("Rol önizleme kanıt komutları").getByText("me-access-matrix.e2e.test.ts")).toBeVisible();
  await expect(page.getByLabel("Operasyon kararı").getByRole("heading", { name: "Rol önizlemesi yalnızca görüntüleme için açılır." })).toBeVisible();

  for (const operationPath of [
    "/kurum/guvenlik-denetimi",
    "/kurum/gozlemlenebilirlik",
    "/kurum/uat-rollback",
    "/kurum/canli-yayin",
    "/kurum/sistem-sagligi",
  ]) {
    await page.goto(operationPath);
    await expect(page).toHaveURL(new RegExp(`${operationPath}$`));
  }

  await expandSidebarGroup(page, "Yönetim");
  await expect(page.getByRole("navigation", { name: "Ana menü" }).getByRole("link", { name: "Yedekleme" })).toHaveCount(0);
  await page.goto("/kurum/yedek-restore");
  await expect(page).toHaveURL(/\/kurum\/yedek-restore$/);
  await expect(heading(page, { name: "Yedekleme ve Geri Yükleme" })).toBeVisible();
  await expect(page.getByText("Rehber / Referans")).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme operasyon özeti").getByText("İndirilebilir")).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme güven durumu").getByText("Yedekleme Güvence Durumu")).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme güven durumu").getByText("Maskeli")).toBeVisible();
  await expect(page.getByLabel("Panel geri yükleme tatbikatı işi").getByText("Korumalı İş Başlatma")).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByText("Henüz panelden başlatılmış iş yok.")).toBeVisible();
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("İş tipi").selectOption("BACKUP");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Yedek hedefi").fill("offsite-backup");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Onay metni").fill("YEDEK AL");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByRole("button", { name: "Yedek al" }).click();
  await expect(page.getByText("Yedek hedefi s3://bucket/prefix veya kalıcı file:// dizin olmalı.")).toBeVisible();
  expect(backupRestorePostCount).toBe(0);
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Yedek hedefi").fill("file:///mnt/backups/tenant-a");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Onay metni").fill("YEDEK AL");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByRole("button", { name: "Yedek al" }).click();
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByRole("heading", { name: "Yedekleme" })).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByText("file://<redacted>")).toBeVisible();
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByText("file:///mnt/backups/tenant-a")).toHaveCount(0);
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByText("backup-restore-job-created_backup")).toHaveCount(0);
  await expect(page.getByLabel("Yedekleme ve geri yükleme işleri").getByText("İş referansı maskeli")).toBeVisible();
  expect(backupRestorePostCount).toBe(1);
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("İş tipi").selectOption("RESTORE_DRILL");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Geri yükleme kanıt dosyası").fill("s3://o-okul-prod-backups/restore-drill.json");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Onay metni").fill("GERİ YÜKLEME TATBİKATI");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByRole("button", { name: "Geri yüklemeyi dene" }).click();
  await expect(page.getByText("Geri yükleme kanıt dosyası kalıcı file:// yolunda olmalı.")).toBeVisible();
  expect(backupRestorePostCount).toBe(1);
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Geri yükleme kanıt dosyası").fill("file:///mnt/restore-drills/restore-drill.json");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByLabel("Onay metni").fill("GERİ YÜKLEME TATBİKATI");
  await page.getByLabel("Panel geri yükleme tatbikatı işi").getByRole("button", { name: "Geri yüklemeyi dene" }).click();
  const restoreDrillJob = page
    .getByLabel("Yedekleme ve geri yükleme işleri")
    .getByRole("row")
    .filter({ has: page.getByRole("heading", { name: "Geri yükleme tatbikatı", exact: true }) });
  await expect(restoreDrillJob.getByRole("heading", { name: "Geri yükleme tatbikatı" })).toBeVisible();
  await expect(restoreDrillJob.getByText("Hazırlanıyor")).toBeVisible();
  await expect(restoreDrillJob.getByText("file:///mnt/restore-drills/restore-drill.json")).toHaveCount(0);
  expect(backupRestorePostCount).toBe(2);
  const backupValidation = page.getByLabel("Yedekleme ve geri yükleme doğrulamaları");
  const localRestoreRow = backupValidation.getByRole("row").filter({ hasText: "Yerel geri yükleme kontrolü" });
  await localRestoreRow.getByText("İleri ayrıntılar").click();
  await expect(localRestoreRow.getByText("pnpm backup:restore:smoke")).toBeVisible();
  const offsiteBackupRow = backupValidation.getByRole("row").filter({ hasText: "Sunucu dışı yedekleme kontrolü" });
  await offsiteBackupRow.getByText("İleri ayrıntılar").click();
  await expect(offsiteBackupRow.getByText("pnpm backup:offsite:smoke")).toBeVisible();
  const historyArchiveRow = backupValidation.getByRole("row").filter({ hasText: "Veritabanı işlem geçmişi arşivi" });
  await historyArchiveRow.getByText("İleri ayrıntılar").click();
  await expect(historyArchiveRow.getByText("pnpm wal:archive:smoke")).toBeVisible();
  const restoreReport = page.getByLabel("Geri yükleme tatbikatı raporu");
  const restoreResultRow = restoreReport.getByRole("row").filter({ hasText: "Sonuç: Başarılı" });
  await restoreResultRow.getByText("İleri ayrıntılar").click();
  await expect(restoreResultRow.getByText("result = PASS", { exact: true })).toBeVisible();
  const criticalRestoreTables = page.getByLabel("Kritik geri yükleme tabloları");
  const migrationRow = criticalRestoreTables.getByRole("row").filter({ hasText: "Veritabanı güncelleme kayıtları" });
  await migrationRow.getByText("İleri ayrıntılar").click();
  await expect(migrationRow.getByText("_prisma_migrations", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Operasyon kararı").getByText("Karar: kurum kullanıcısı kendi eklediği veriyi bilgisayarına JSON yedek olarak indirir.")).toBeVisible();

  await page.goto("/kurum/kvkk");
  await expect(page).toHaveURL(/\/kurum\/kvkk$/);

  const storageKeys = await page.evaluate(([first, second]) => ({
    first: Object.keys(window[first as keyof Window] as Storage),
    second: Object.keys(window[second as keyof Window] as Storage),
  }), ["local" + "Storage", "session" + "Storage"]);
  expect(storageKeys.first.filter((key) => key !== "des.sidebar.expandedGroups.v2")).toEqual([]);
  expect(storageKeys.second.sort()).toEqual(["o-okul.role-preview-token", "uh_onboarding_tenant-a_draft"].sort());
});

test("ilk girişte zorunlu şifre değişimi ekranına yönlendirir", async ({ page }) => {
  let auth = createAuthResponse("student-a@example.test");
  auth = {
    ...auth,
    session: {
      ...auth.session,
      mustChangePassword: true,
    },
    mustChangePassword: true,
  };
  let passwordChanged = false;

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/v1/auth/refresh", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(auth)),
    });
  });

  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(auth)),
    });
  });

  await page.route("**/api/v1/me/password", async (route) => {
    const body = route.request().postDataJSON() as { currentPassword?: string; newPassword?: string };
    expect(body).toMatchObject({ currentPassword: "5551234567", newPassword: "YeniAb12" });
    passwordChanged = true;
    auth = {
      ...auth,
      session: {
        ...auth.session,
        mustChangePassword: false,
      },
      mustChangePassword: false,
    };
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope({ changedAt: "2026-06-27T12:00:00.000Z" })),
    });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/") || path === "/me/password") {
      await route.fallback();
      return;
    }
    if (path === "/me/tenant") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({ id: "tenant-a", name: "DNA Eğitim", slug: "dna-egitim", plan: "TRIAL", status: "ACTIVE" })),
      });
      return;
    }
    if (path === "/me/notification-devices") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([])),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope([])),
    });
  });

  await page.goto("/login");
  await page.getByLabel("Kurum Kodu").fill("dna-egitim");
  await page.getByLabel("Kullanıcı adı veya e-posta").fill("student-a@example.test");
  await page.locator('input[name="password"]').fill("5551234567");
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page).toHaveURL(/\/sifre-degistir$/, { timeout: 15_000 });
  await expect(heading(page, { level: 1, name: "Şifre değiştir" })).toBeVisible();
  await page.getByLabel("Mevcut şifre").fill("5551234567");
  await page.getByLabel("Yeni şifre", { exact: true }).fill("YeniAb12");
  await page.getByLabel("Yeni şifre tekrar").fill("YeniAb12");
  await page.getByRole("button", { name: "Kaydet" }).click();

  await expect(page).toHaveURL(/\/ogrenci$/, { timeout: 15_000 });
  expect(passwordChanged).toBe(true);
});

test("Next sıfır-veri kurulum adımlarını ve yeni kayıt derin linkini gösterir", async ({ page }) => {
  let activeEmail = "";
  let campuses: Array<{ id: string; tenantId: string; name: string; code?: string }> = [];
  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/v1/auth/refresh", async (route) => {
    if (!activeEmail) {
      await route.fulfill({ headers: corsHeaders, status: 401 });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse(activeEmail))),
    });
  });

  await page.route("**/api/v1/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { email?: string; nationalId?: string };
    activeEmail = loginEmailFromRequest(body);
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse(activeEmail))),
    });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }

    expect(request.headers().authorization).toBe("Bearer next-access-token");
    if (path === "/me/institution-dashboard" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          generatedAt: "2026-06-17T08:00:00.000Z",
          institution: { name: "DNA EĞİTİM KURUMU", institutionType: "study-center" },
          activeStudentCount: 0,
          attention: {
            attendanceAlertCount: 0,
            openImportQuarantineCount: 0,
            openSupportTicketCount: 0,
          },
        })),
      });
      return;
    }

    if (path === "/me/tenant" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          id: "tenant-a",
          name: "DNA EĞİTİM KURUMU",
          institutionType: "study-center",
          contactEmail: "admin-a@example.test",
        })),
      });
      return;
    }

    if (path === "/campuses" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(campuses, request.url())),
      });
      return;
    }

    if (path === "/campuses" && request.method() === "POST") {
      const body = request.postDataJSON() as { name: string; code?: string };
      const created = {
        id: "campus-zero-created",
        tenantId: "tenant-a",
        name: body.name,
        code: body.code,
      };
      campuses = [...campuses, created];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }

    if (path === "/import-quarantines/summary" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({ openCount: 0 })),
      });
      return;
    }

    const emptyListPaths = new Set([
      "/grade-levels",
      "/classes",
      "/courses",
      "/academic-years",
      "/academic-terms",
      "/schedule-lessons",
      "/study-sessions",
      "/attendance",
      "/teacher-notes",
      "/teachers",
      "/students",
      "/guardians",
      "/learning-outcomes",
      "/announcements",
      "/message-templates",
      "/support-tickets",
      "/tenant-users",
      "/identity-invitations",
      "/exams",
      "/payment-plans",
      "/audit-logs/safe-list",
      "/audit-logs",
      "/homework",
      "/homework/materials",
      "/me/notification-devices",
    ]);

    if (emptyListPaths.has(path) && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([], request.url())),
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope([])),
    });
  });

  await loginAs(page, "admin-a@example.test");

  await expect(page).toHaveURL(/\/kurum$/);
  const mainNav = page.getByRole("navigation", { name: "Ana menü" });
  const setupStart = page.getByLabel("Kurum kurulum başlangıcı");
  await expect(setupStart.getByText("Kurumunuzu kurmaya başlayın")).toBeVisible();
  await setupStart.getByRole("button", { name: "Daha sonra" }).click();
  await expect(setupStart).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain("uh_setup_tenant-a_dismissed=true");
  await page.reload();
  await expect(setupStart).toBeHidden();
  await page.evaluate(() => {
    document.cookie = "uh_setup_tenant-a_dismissed=; path=/; max-age=0; samesite=lax";
  });
  await page.reload();
  await expect(setupStart.getByText("Kurumunuzu kurmaya başlayın")).toBeVisible();
  await setupStart.getByRole("link", { name: "Kuruluma git" }).click();
  await expect(page).toHaveURL(/\/kurum\/kurulum$/);
  await expect(heading(page, { name: "Kurulum Sihirbazı" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Kurulum operasyon metrikleri" })).toContainText("5 adım");
  await expect(page.getByRole("tab", { name: /Kurum Genel Bilgileri/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Akademik Dönem Ayarları/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Sınıf ve Şubeler/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Derslerin Oluşturulması/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Kişi Yönetim Altyapısı/ })).toBeVisible();
  await expect(page.getByLabel("Kurum adı")).toHaveValue("DNA EĞİTİM KURUMU");

  await page.goto("/kurum/program");
  await expect(page.getByText("Ders programı boş")).toBeVisible();
  await page.goto("/kurum/etutler");
  await expect(page.getByText("Etüt planı boş")).toBeVisible();
  await page.goto("/kurum/akademik-takvim");
  await expect(page.getByText("Akademik yıl yok")).toBeVisible();
  await expect(page.getByText("Dönem yok")).toBeVisible();
  await page.goto("/kurum/materyaller");
  await expect(page.getByText("Ödev kaydı yok")).toBeVisible();
  await expect(page.getByText("Materyal havuzu boş")).toBeVisible();
  await page.goto("/kurum/kazanimlar");
  await expect(page.getByText("Kazanım yok")).toBeVisible();
  await page.goto("/kurum/kazanimlar?new=1");
  await expect(page.getByRole("dialog", { name: "Kazanım ekle" })).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç" }).click();
  await page.goto("/kurum/veliler");
  await expect(page.getByRole("heading", { name: "Veli kaydı yok" })).toBeVisible();
  await page.goto("/kurum/veliler?new=1");
  await expect(page.getByRole("dialog", { name: "Veli ekle" })).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç" }).click();
  await page.goto("/kurum/duyurular");
  await expect(page.getByText("Duyuru yok")).toBeVisible();
  await page.goto("/kurum/sablonlar");
  if (smsEnabled) {
    await expect(page.getByText("Şablon yok")).toBeVisible();
  } else {
    await expect(page).toHaveURL(/\/kurum$/);
  }
  await page.goto("/kurum/destek");
  await expect(page.getByText("Destek bildirimi yok")).toBeVisible();
  await page.goto("/kurum/kullanicilar");
  await expect(page.getByText("Kullanıcı yok")).toBeVisible();
  await page.goto("/kurum/devamsizlik");
  await expect(page.getByText("Devamsızlık kaydı yok")).toBeVisible();
  await page.goto("/kurum/notlar");
  await expect(page.getByText("Öğretmen notu yok")).toBeVisible();
  await page.goto("/kurum/finans");
  await expect(page.getByText("Ödeme taksiti yok")).toBeVisible();
  await page.goto("/kurum/denetim");
  await expect(page.getByText("Denetim kaydı yok")).toBeVisible();
  await page.goto("/kurum/kvkk");
  await expect(page.getByText("Temizlenecek kayıt yok")).toBeVisible();
});

test("Next sistem admin ayrı sistem panelinde kurum yönetir", async ({ page }) => {
  let activeEmail = "";
  let tenants: Array<{
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    seatLimit: number;
    activeSeatCount?: number;
  }> = [];
  let tenantCreateCount = 0;

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/v1/auth/refresh", async (route) => {
    if (!activeEmail) {
      await route.fulfill({ headers: corsHeaders, status: 401 });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse(activeEmail))),
    });
  });

  await page.route("**/api/v1/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { email?: string; nationalId?: string };
    activeEmail = loginEmailFromRequest(body);
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse(activeEmail))),
    });
  });

  await page.route("**/api/v1/auth/logout", async (route) => {
    activeEmail = "";
    await route.fulfill({ headers: corsHeaders, status: 204 });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path.startsWith("/auth/")) {
      await route.fallback();
      return;
    }

    expect(request.headers().authorization).toBe("Bearer next-access-token");

    if (path === "/me/institution-dashboard" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          generatedAt: "2026-06-17T08:00:00.000Z",
          institution: { name: "DNA EĞİTİM KURUMU", institutionType: "study-center" },
          activeStudentCount: 1,
          attention: {
            attendanceAlertCount: 0,
            openImportQuarantineCount: 0,
            openSupportTicketCount: 1,
          },
        })),
      });
      return;
    }

    if (path === "/me/notification-devices" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([])),
      });
      return;
    }

    if (path === "/tenants" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(tenants, request.url())),
      });
      return;
    }

    if (path === "/tenants" && request.method() === "POST") {
      const body = request.postDataJSON() as {
        name: string;
        slug: string;
        status: string;
        campuses: Array<{ name: string; code?: string; unitType: string }>;
        firstOwner: { name: string; email: string; nationalId?: string };
        licenseTerm: { planCode: string; startsAt: string; endsAt: string; activeStudentLimit: number; auditReference: string };
      };
      tenantCreateCount += 1;
      const id = tenantCreateCount === 1 ? "tenant-created" : `tenant-created-${tenantCreateCount}`;
      const created = {
        id,
        name: body.name,
        slug: body.slug,
        plan: body.licenseTerm.planCode,
        status: body.status,
        licenseStartsAt: body.licenseTerm.startsAt,
        licenseEndsAt: body.licenseTerm.endsAt,
        seatLimit: body.licenseTerm.activeStudentLimit,
        activeSeatCount: 1,
      };
      tenants = [created, ...tenants];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          tenant: created,
          owner: {
            id: "user-created-owner",
            employeeId: "employee-created-owner",
            tenantId: id,
            roles: ["TENANT_OWNER"],
          },
          campuses: body.campuses.map((campus, index) => ({ ...campus, id: `campus-created-${index + 1}`, tenantId: id })),
          licenseTerm: { ...body.licenseTerm, id: "license-created", tenantId: id, activeStudentLimit: body.licenseTerm.activeStudentLimit },
        })),
      });
      return;
    }

    if (path.startsWith("/tenants/") && request.method() === "GET") {
      const id = decodeURIComponent(path.replace("/tenants/", ""));
      const tenant = tenants.find((candidate) => candidate.id === id);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: tenant ? 200 : 404,
        body: JSON.stringify(envelope(tenant ?? null)),
      });
      return;
    }

    if (path.startsWith("/tenants/") && request.method() === "PATCH") {
      const id = decodeURIComponent(path.replace("/tenants/", ""));
      const body = request.postDataJSON() as Partial<typeof tenants[number]>;
      const updated = {
        ...(tenants.find((candidate) => candidate.id === id) ?? tenants[0]!),
        ...body,
        id,
      };
      tenants = tenants.map((tenant) => (tenant.id === id ? updated : tenant));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(updated)),
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope([])),
    });
  });

  await loginAs(page, "system@example.test");

  await expect(page).toHaveURL(/\/sistem$/);
  await expect(heading(page, { name: "Sistem Paneli" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kurumlar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Özet" })).toBeVisible();
  await expect(page.getByLabel("Sistem başlangıcı").getByText("Henüz kurum yok")).toBeVisible();
  await expect(page.getByLabel("Sistem başlangıcı").getByRole("link", { name: "Kurum oluştur" })).toBeVisible();
  await page.goto("/kurum");
  await expect(page).toHaveURL(/\/sistem$/);

  await page.getByRole("link", { name: "Kurumlar" }).click();
  await expect(page).toHaveURL(/\/sistem\/kurumlar$/);
  await expect(heading(page, { name: "Kurumlar" })).toBeVisible();
  await expect(page.getByLabel("Kurum yönetimi").getByText("Henüz kurum yok")).toBeVisible();

  await page.getByLabel("Kurum yönetimi").locator(".uh-empty-state").getByRole("button", { name: "Kurum oluştur" }).click();
  const createDialog = page.getByRole("dialog", { name: "Kurum oluştur" });
  await createDialog.getByLabel("Kurum adı").fill("Yeni Kurum");
  await createDialog.getByLabel("Kurum kodu").fill("");
  await createDialog.getByLabel("Kurum kodu").fill("yeni-kurum");
  await createDialog.getByLabel("Plan").selectOption("PRO");
  await createDialog.getByLabel("Lisans başlangıç").fill("2026-08-01");
  await createDialog.getByLabel("Lisans bitiş").fill("2027-08-01");
  await createDialog.getByLabel("Aktif öğrenci limiti").fill("50");
  await createDialog.getByLabel("Sözleşme referansı").fill("contract-2026-001");
  await createDialog.getByLabel("İlk kampüs adı").fill("Merkez Kampüs");
  await createDialog.getByLabel("İlk kurum sahibi ad soyad").fill("Yeni Yönetici");
  await createDialog.getByLabel("İlk kurum sahibi e-posta").fill("first.admin@example.test");
  await createDialog.getByLabel("Kurum sahibi TC kimlik no").fill("10000000450");
  await expect(createDialog.getByLabel("Kurum adı")).toHaveValue("Yeni Kurum");
  await expect(createDialog.getByLabel("Kurum kodu")).toHaveValue("yeni-kurum");
  await expect(createDialog.getByLabel("Aktif öğrenci limiti")).toHaveValue("50");
  await expect(createDialog.getByLabel("İlk kurum sahibi ad soyad")).toHaveValue("Yeni Yönetici");
  await createDialog.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.getByText("Yeni Kurum")).toBeVisible();
  await expect(page.getByText("1 / 50")).toBeVisible();

  await page.getByRole("button", { name: "Kurum oluştur" }).click();
  await createDialog.getByLabel("Kurum adı").fill("Davetli Kurum");
  await createDialog.getByLabel("Kurum kodu").fill("davetli-kurum");
  await createDialog.getByLabel("Lisans başlangıç").fill("2026-08-01");
  await createDialog.getByLabel("Lisans bitiş").fill("2027-08-01");
  await createDialog.getByLabel("Aktif öğrenci limiti").fill("50");
  await createDialog.getByLabel("Sözleşme referansı").fill("contract-2026-002");
  await createDialog.getByLabel("İlk kampüs adı").fill("Merkez Kampüs");
  await createDialog.getByLabel("İlk kurum sahibi ad soyad").fill("Davetli Yönetici");
  await createDialog.getByLabel("İlk kurum sahibi e-posta").fill("phone.admin@example.test");
  await createDialog.getByLabel("Kurum sahibi TC kimlik no").fill("10000001372");
  await createDialog.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.getByRole("row", { name: /Davetli Kurum/ }).getByRole("button", { name: "Sil" })).toHaveCount(0);

  await page.getByRole("row", { name: /Yeni Kurum/ }).getByRole("link", { name: "Detay" }).click();
  await expect(page).toHaveURL(/\/sistem\/kurumlar\/tenant-created$/);
  await expect(heading(page, { name: "Yeni Kurum" })).toBeVisible();
  await page.getByRole("tab", { name: "Kurum yönetimi" }).click();
  await page.getByRole("button", { name: "Düzenle" }).click();
  const editDialog = page.getByRole("dialog", { name: "Kurum düzenle" });
  await editDialog.getByLabel("Durum").selectOption("SUSPENDED");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByLabel("Kurum detayı").getByText("Pro", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Kurum detayı").getByText("Askıda")).toBeVisible();
  await expect(page.getByLabel("Kurum detayı").getByText("1 / 50")).toBeVisible();

  await page.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış" }).click();
  await loginAs(page, "first.admin@example.test", "5551234567");
  await expect(page).toHaveURL(/\/kurum$/);

  await page.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış" }).click();
  await loginAs(page, "admin-a@example.test");
  await page.goto("/sistem");
  await expect(page).toHaveURL(/\/kurum$/);

  await page.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış" }).click();
  await loginAs(page, "assistant@example.test");
  await expect(page).toHaveURL(/\/kurum$/);
  await expect(page.getByRole("link", { name: "Ödeme planları" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Kullanıcılar" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Rol Önizleme" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Denetim" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "KVKK" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Yedekleme" })).toHaveCount(0);
  await expandSidebarGroup(page, "İletişim");
  await expect(page.getByRole("link", { name: "Kurum içi destek", exact: true })).toBeVisible();
  await expect(page.getByLabel("Bugün ilgilenmeniz gerekenler").getByRole("link", { name: /Geciken ödeme/ })).toHaveCount(0);
  await expect(page.getByLabel("Bugün ilgilenmeniz gerekenler").getByRole("link", { name: /Öğrenci destek talepleri/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  const assistantCommandDialog = page.getByRole("dialog", { name: "Komut paleti" });
  await expect(assistantCommandDialog).toBeVisible();
  await assistantCommandDialog.getByLabel("Komut ara").fill("ödeme");
  await expect(assistantCommandDialog.getByRole("link", { name: /Ödeme planları/ })).toHaveCount(0);
  await assistantCommandDialog.getByLabel("Komut ara").fill("kullanıcı");
  await expect(assistantCommandDialog.getByRole("link", { name: /Kullanıcılar/ })).toHaveCount(0);
  await assistantCommandDialog.getByRole("button", { name: "Kapat" }).click();
  await page.goto("/kurum/finans");
  await expect(page).toHaveURL(/\/kurum$/);
  await page.goto("/kurum/kullanicilar");
  await expect(page).toHaveURL(/\/kurum$/);
  await page.goto("/kurum/kvkk");
  await expect(page).toHaveURL(/\/kurum$/);
  await page.goto("/kurum/yedek-restore");
  await expect(page).toHaveURL(/\/kurum$/);
});

test("Next rol portalları bağlı kişi verisini gösterir", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(new Date("2026-06-10T08:30:00.000Z"));

  const portalAnnouncementReads = new Map<string, string>();
  let portalNotificationDevices: NotificationDeviceFixture[] = [];
  let portalMaterialAssignments: Array<{
    id: string;
    tenantId: string;
    materialId: string;
    studentId: string;
    courseId?: string;
    termId?: string;
    assignedById: string;
    note?: string;
    dueAt?: string;
    createdAt: string;
  }> = [
    {
      id: "material-assignment-a",
      tenantId: "tenant-a",
      materialId: "material-a",
      studentId: "student-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      assignedById: "teacher-a",
      note: "Bireysel tekrar",
      dueAt: "2026-06-09T12:00:00.000Z",
      createdAt: "2026-06-08T09:20:00.000Z",
    },
  ];
  let lastPortalAttendanceBody:
    | { classId: string; date: string; entries: Array<{ studentId: string; status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" }> }
    | undefined;
  let lastPortalTeacherNoteBody:
    | {
        studentId: string;
        courseId?: string;
        termId?: string;
        visibility: "INTERNAL" | "GUARDIAN_STUDENT";
        body: string;
        developmentStatus?: string;
      }
    | undefined;
  let lastPortalMaterialAssignmentBody:
    | { studentId: string; courseId?: string; termId?: string; note?: string; dueAt?: string }
    | undefined;
  let lastPortalTeacherSupportTicketBody:
    | {
        subject: string;
        message: string;
        priority: "LOW" | "NORMAL" | "HIGH";
        studentId?: string;
        campusId?: string;
        gradeLevelId?: string;
        classId?: string;
        courseId?: string;
        termId?: string;
      }
    | undefined;
  let portalStudentSupportTickets: SupportTicketFixture[] = [
    {
      id: "support-ticket-student-a",
      tenantId: "tenant-a",
      requesterId: "student-tenant-a",
      studentId: "student-a",
      subject: "Ödev bağlantısı",
      message: "Materyal açılmıyor.",
      priority: "NORMAL",
      status: "OPEN",
      createdAt: "2026-06-09T11:00:00.000Z",
    },
  ];
  let portalGuardianSupportTickets: SupportTicketFixture[] = [
    {
      id: "support-ticket-guardian-a",
      tenantId: "tenant-a",
      requesterId: "guardian-tenant-a",
      studentId: "student-a",
      subject: "Rapor görüntüleme",
      message: "Rapor ekranı açılmıyor.",
      priority: "HIGH",
      status: "OPEN",
      createdAt: "2026-06-09T11:10:00.000Z",
    },
  ];
  let portalTeacherSupportTickets: SupportTicketFixture[] = [
    {
      id: "support-ticket-teacher-a",
      tenantId: "tenant-a",
      requesterId: "teacher-tenant-a",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      subject: "Yoklama ekranı",
      message: "Yoklama kaydı sonrası liste yenilenmiyor.",
      priority: "NORMAL",
      status: "OPEN",
      createdAt: "2026-06-09T11:20:00.000Z",
    },
  ];
  let portalGuardianPreferences = {
    id: "guardian-student-a",
    tenantId: "tenant-a",
    guardianId: "guardian-a",
    studentId: "student-a",
    canViewFinance: true,
    canReceiveSms: true,
    canReceiveAnnouncements: true,
    canOpenSupportTickets: true,
  };
  let portalGuardianClosedFinancePaymentPlanRequests = 0;

  await page.addInitScript(() => {
    Object.defineProperty(window, "__O_OKUL_WEB_PUSH_PUBLIC_KEY__", {
      value: "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      configurable: true,
    });
    Object.defineProperty(window, "Notification", {
      value: {
        requestPermission: async () => "granted",
      },
      configurable: true,
    });
    Object.defineProperty(window, "PushManager", {
      value: function PushManager() {},
      configurable: true,
    });
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        register: async () => ({
          pushManager: {
            getSubscription: async () => null,
            subscribe: async () => ({
              toJSON: () => ({
                endpoint: "https://push.example/subscription",
                keys: {
                  auth: "auth-key",
                  p256dh: "p256dh-key",
                },
              }),
            }),
          },
        }),
      },
      configurable: true,
    });
  });

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.fallback();
  });

  await page.route("**/api/v1/auth/refresh", async (route) => {
    await route.fulfill({ headers: corsHeaders, status: 401 });
  });

  await page.route("**/api/v1/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { email?: string; nationalId?: string };
    const email = loginEmailFromRequest(body);
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse(email))),
    });
  });

  await page.route("**/api/v1/auth/logout", async (route) => {
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
    if (path === "/me/notification-devices" && route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(portalNotificationDevices)),
      });
      return;
    }
    if (path === "/me/notification-devices" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { provider: string; token: string; platform?: string };
      const created: NotificationDeviceFixture = {
        id: "notification-device-web",
        tenantId: "tenant-a",
        userId: "student-tenant-a",
        provider: body.provider,
        token: body.token,
        platform: body.platform,
        lastSeenAt: "2026-06-10T12:00:00.000Z",
      };
      portalNotificationDevices = [created, ...portalNotificationDevices.filter((device) => device.id !== created.id)];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }
    if (path.startsWith("/me/notification-devices/") && route.request().method() === "DELETE") {
      const id = decodeURIComponent(path.replace("/me/notification-devices/", ""));
      const disabled = {
        ...(portalNotificationDevices.find((device) => device.id === id) ?? portalNotificationDevices[0]),
        id,
        disabledAt: "2026-06-10T12:05:00.000Z",
      } as NotificationDeviceFixture;
      portalNotificationDevices = portalNotificationDevices.map((device) => (device.id === id ? disabled : device));
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(disabled)),
      });
      return;
    }
    if (path === "/attendance/daily" && route.request().method() === "GET") {
      const url = new URL(route.request().url());
      const classId = url.searchParams.get("classId") ?? "class-a";
      const date = url.searchParams.get("date") ?? "2026-06-10";
      const roster = [
        { classId: "class-a", firstName: "Ada", id: "student-a", lastName: "A", studentNo: "101" },
        { classId: "class-a", firstName: "Bora", id: "student-b", lastName: "B", studentNo: "102" },
      ].filter((student) => student.classId === classId);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({ classId, date, students: roster, records: [], summary: { absent: 0, excused: 0, late: 0, present: 0, total: 0, unmarked: roster.length } })),
      });
      return;
    }
    if (path === "/attendance/daily" && route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        classId: string;
        date: string;
        entries: Array<{ studentId: string; status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" }>;
      };
      lastPortalAttendanceBody = body;
      const entry = body.entries[0]!;
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          records: [{ id: "attendance-created", tenantId: "tenant-a", studentId: entry.studentId, date: body.date, status: entry.status }],
          summary: { absent: 0, excused: 0, late: 1, present: 0, total: 1, unmarked: 1 },
        })),
      });
      return;
    }
    if (path === "/teacher-notes" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        studentId: string;
        courseId?: string;
        termId?: string;
        visibility: "INTERNAL" | "GUARDIAN_STUDENT";
        body: string;
        developmentStatus?: string;
      };
      lastPortalTeacherNoteBody = body;
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          id: "teacher-note-created",
          tenantId: "tenant-a",
          studentId: body.studentId,
          teacherId: "teacher-a",
          courseId: body.courseId,
          termId: body.termId,
          visibility: body.visibility,
          body: body.body,
          developmentStatus: body.developmentStatus,
          createdAt: "2026-06-10T11:00:00.000Z",
        })),
      });
      return;
    }
    if (path.startsWith("/homework/") && path.endsWith("/check-status") && route.request().method() === "PATCH") {
      const id = path.replace("/homework/", "").replace("/check-status", "");
      const body = route.request().postDataJSON() as { checked: boolean };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          id,
          tenantId: "tenant-a",
          classId: "class-a",
          sourceMaterialId: "material-a",
          sourceMaterialTitle: "Kesirler Çalışma Kağıdı",
          title: "Kesirler",
          description: "1-20 arası sorular",
          dueAt: "2026-06-10T12:00:00.000Z",
          checkedAt: body.checked ? "2026-06-10T12:30:00.000Z" : undefined,
          checkedBy: body.checked ? "teacher-a" : undefined,
        })),
      });
      return;
    }
    if (
      (path === "/homework/materials/material-a/assignments" ||
        path === "/homework/material-assignments" ||
        path === "/me/teacher/homework/material-assignments") &&
      route.request().method() === "GET"
    ) {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(portalMaterialAssignments)),
      });
      return;
    }
    if (path === "/homework/materials/material-a/assignments" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { studentId: string; courseId?: string; termId?: string; note?: string; dueAt?: string };
      lastPortalMaterialAssignmentBody = body;
      const created = {
        id: "material-assignment-created",
        tenantId: "tenant-a",
        materialId: "material-a",
        studentId: body.studentId,
        courseId: body.courseId,
        termId: body.termId,
        assignedById: "teacher-a",
        note: body.note,
        dueAt: body.dueAt ? `${body.dueAt}T00:00:00.000Z` : undefined,
        createdAt: "2026-06-10T12:40:00.000Z",
      };
      portalMaterialAssignments = [created, ...portalMaterialAssignments];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }
    if (path === "/me/student/support-tickets" && route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(portalStudentSupportTickets)),
      });
      return;
    }
    if (path === "/me/student/support-tickets" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { subject: string; message: string; priority: "LOW" | "NORMAL" | "HIGH" };
      const created: SupportTicketFixture = {
        id: "support-ticket-student-created",
        tenantId: "tenant-a",
        requesterId: "student-tenant-a",
        studentId: "student-a",
        subject: body.subject,
        message: body.message,
        priority: body.priority,
        status: "OPEN",
        createdAt: "2026-06-10T11:00:00.000Z",
      };
      portalStudentSupportTickets = [created, ...portalStudentSupportTickets];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }
    if (path === "/me/guardian/students/student-a/support-tickets" && route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(portalGuardianSupportTickets)),
      });
      return;
    }
    if (path === "/me/guardian/students/student-a/notification-preferences" && route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(portalGuardianPreferences)),
      });
      return;
    }
    if (path === "/me/guardian/students/student-a/notification-preferences" && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as Partial<typeof portalGuardianPreferences>;
      portalGuardianPreferences = { ...portalGuardianPreferences, ...body };
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(portalGuardianPreferences)),
      });
      return;
    }
    if (path === "/me/guardian/students/student-a/payment-plans" && !portalGuardianPreferences.canViewFinance) {
      portalGuardianClosedFinancePaymentPlanRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 403,
        body: JSON.stringify(envelope({ code: "FORBIDDEN_FINANCE_PERMISSION" })),
      });
      return;
    }
    if (path === "/me/guardian/students/student-a/support-tickets" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { subject: string; message: string; priority: "LOW" | "NORMAL" | "HIGH" };
      const created: SupportTicketFixture = {
        id: "support-ticket-guardian-created",
        tenantId: "tenant-a",
        requesterId: "guardian-tenant-a",
        studentId: "student-a",
        subject: body.subject,
        message: body.message,
        priority: body.priority,
        status: "OPEN",
        createdAt: "2026-06-10T11:10:00.000Z",
      };
      portalGuardianSupportTickets = [created, ...portalGuardianSupportTickets];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }
    if (path === "/me/teacher/support-tickets" && route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(portalTeacherSupportTickets)),
      });
      return;
    }
    if (path === "/me/teacher/support-tickets" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as NonNullable<typeof lastPortalTeacherSupportTicketBody>;
      lastPortalTeacherSupportTicketBody = body;
      const created: SupportTicketFixture = {
        id: "support-ticket-teacher-created",
        tenantId: "tenant-a",
        requesterId: "teacher-tenant-a",
        studentId: body.studentId,
        campusId: body.campusId,
        gradeLevelId: body.gradeLevelId,
        classId: body.classId,
        courseId: body.courseId,
        termId: body.termId,
        subject: body.subject,
        message: body.message,
        priority: body.priority,
        status: "OPEN",
        createdAt: "2026-06-10T11:20:00.000Z",
      };
      portalTeacherSupportTickets = [created, ...portalTeacherSupportTickets];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(created)),
      });
      return;
    }
    if (path === "/me/student/announcements") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([portalAnnouncement("announcement-student-a", "Öğrenci duyurusu", "STUDENTS", portalAnnouncementReads.get("student:announcement-student-a"))])),
      });
      return;
    }
    if (path === "/me/student/announcements/announcement-student-a/read" && route.request().method() === "POST") {
      portalAnnouncementReads.set("student:announcement-student-a", "2026-06-10T10:00:00.000Z");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(portalAnnouncement("announcement-student-a", "Öğrenci duyurusu", "STUDENTS", "2026-06-10T10:00:00.000Z"))),
      });
      return;
    }
    if (path === "/me/guardian/students/student-a/announcements") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([portalAnnouncement("announcement-guardian-a", "Veli duyurusu", "GUARDIANS", portalAnnouncementReads.get("guardian:announcement-guardian-a"))])),
      });
      return;
    }
    if (path === "/me/guardian/students/student-a/announcements/announcement-guardian-a/read" && route.request().method() === "POST") {
      portalAnnouncementReads.set("guardian:announcement-guardian-a", "2026-06-10T10:05:00.000Z");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(portalAnnouncement("announcement-guardian-a", "Veli duyurusu", "GUARDIANS", "2026-06-10T10:05:00.000Z"))),
      });
      return;
    }
    if (path === "/me/teacher/announcements") {
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope([portalAnnouncement("announcement-teacher-a", "Öğretmen duyurusu", "TEACHERS", portalAnnouncementReads.get("teacher:announcement-teacher-a"))])),
      });
      return;
    }
    if (path === "/me/teacher/announcements/announcement-teacher-a/read" && route.request().method() === "POST") {
      portalAnnouncementReads.set("teacher:announcement-teacher-a", "2026-06-10T10:10:00.000Z");
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(portalAnnouncement("announcement-teacher-a", "Öğretmen duyurusu", "TEACHERS", "2026-06-10T10:10:00.000Z"))),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(readPortalFixture(path))),
    });
  });

  await loginAs(page, "student-a@example.test");
  await expect(page).toHaveURL(/\/ogrenci$/);
  await expandSidebarGroup(page, "Öğrenci Paneli");
  let mainNav = page.getByRole("navigation", { name: "Ana menü" });
  await expect(mainNav.getByRole("link", { name: "Özet", exact: true })).toBeVisible();
  await expect(mainNav.getByRole("link", { name: "Sınav Raporu" })).toBeVisible();
  await expect(mainNav.getByRole("link", { name: "Kurum", exact: true })).toBeHidden();
  await expect(mainNav.getByRole("button", { name: "Öğretmen Paneli" })).toBeHidden();
  await expect(mainNav.getByRole("button", { name: "Veli Paneli" })).toBeHidden();
  await expect(heading(page, { name: "Öğrenci Portalı" })).toBeVisible();
  await expect(page.getByLabel("Günlük durum").getByText("Bugünün odağı")).toBeVisible();
  await expect(page.getByLabel("Günlük durum").getByText("1 okunmamış")).toBeVisible();
  await expect(page.getByLabel("Bildirim cihazı")).toHaveCount(0);
  expect(portalNotificationDevices).toHaveLength(0);
  await expect(page.getByLabel("Profil").getByText("Ada A")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("5551234567")).toHaveCount(0);
  await expect(page.getByLabel("Profil").getByText("••• ••• ••67")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("8-A")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Merkez Kampüs")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("8. Sınıf")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("A", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Ayse Ogretmen")).toBeVisible();
  await expect(page.getByLabel("Veli ilişkileri").getByText("Zeynep Veli")).toBeVisible();
  await expect(page.getByLabel("Veli ilişkileri").getByText(smsEnabled ? "Ödeme planları, SMS, Duyuru, Destek" : "Ödeme planları, Duyuru, Destek")).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("8-A").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("Merkez Kampüs / 8. Sınıf / A şube").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("İlk kayıt").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByRole("cell", { exact: true, name: "Aktif" })).toBeVisible();
  await expect(page.getByLabel("Duyurular").getByRole("cell", { name: "Öğrenci duyurusu", exact: true })).toBeVisible();
  await page.getByLabel("Duyurular").getByRole("button", { name: "Okundu işaretle" }).click();
  await expect(page.getByLabel("Duyurular").getByText("Okundu")).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByRole("cell", { name: "Bireysel tekrar" })).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Kesirler Çalışma Kağıdı")).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Matematik / 2. Donem")).toBeVisible();
  await expect(page.getByLabel("Destek talepleri").getByRole("cell", { exact: true, name: "Ödev bağlantısı" })).toBeVisible();
  await page.getByLabel("Destek talepleri").getByRole("textbox", { exact: true, name: "Konu" }).fill("Soru çözümü");
  await page.getByLabel("Destek talepleri").getByRole("textbox", { exact: true, name: "Mesaj" }).fill("Çözüm videosu açılmıyor.");
  await page.getByLabel("Destek talepleri").getByRole("combobox", { exact: true, name: "Öncelik" }).selectOption("HIGH");
  await page.getByLabel("Destek talepleri").getByRole("button", { name: "Destek talebi aç" }).click();
  await expect(page.getByLabel("Destek talepleri").getByRole("cell", { exact: true, name: "Soru çözümü" })).toBeVisible();
  const studentReportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
  await expect(studentReportSummary.getByText("%85,2").first()).toBeVisible();
  await studentReportSummary.getByRole("button", { name: "Karne detayını göster" }).click();
  const studentExamReport = page.getByLabel("Sınav raporu");
  await expect(studentExamReport.getByText("ÖĞRENCİ NO : 176")).toBeVisible();
  await expect(studentExamReport.getByRole("heading", { name: "Öğrenci gelişim grafiği" })).toBeVisible();
  await expect(studentExamReport.getByText("1/3", { exact: true }).first()).toBeVisible();
  await expect(studentExamReport.getByText("1/2", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Portal kazanım radar grafiği").getByText("Portal kazanım radar tablosu")).toHaveCount(1);
  await expect(page.getByLabel("Portal kazanım radar grafiği").getByRole("row", { name: /Geometri Matematik 7 %82,1 6 1 0 5,75/ })).toBeVisible();
  await expect(studentExamReport.getByRole("row", { name: /Matematik %100,0 20 20 0 0 20,00 19,92 9,46 9,39/ })).toBeVisible();
  await expect(page.getByLabel("Son sınav branş netleri").getByRole("row", { name: /Matematik 18,67 20,00 17,33 18,67 18,67/ })).toBeVisible();
  await expect(studentExamReport.getByText("1 soru").first()).toBeVisible();
  await capturePortalKarneVisualEvidence(page, test.info(), "portal-ogrenci-sinav-raporu");
  await page.evaluate(() => {
    window.history.pushState(null, "", "/ogrenci?examId=exam-demo");
  });
  await expect(page).toHaveURL(/\/ogrenci\?examId=exam-demo$/);
  await expect(studentReportSummary.getByText("17,5").first()).toBeVisible();
  await expect(page.getByLabel("Devamsızlık").getByRole("cell", { name: "Yok", exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğretmen notları").getByText("Problem çözme rutini güçleniyor.")).toBeVisible();

  await page.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs(page, "teacher-a@example.test");
  await expect(page).toHaveURL(/\/ogretmen$/);
  await expandSidebarGroup(page, "Öğretmen Paneli");
  mainNav = page.getByRole("navigation", { name: "Ana menü" });
  await expect(mainNav.getByRole("link", { name: "Özet", exact: true })).toBeVisible();
  await expect(mainNav.getByRole("link", { name: "Ders Akışı" })).toBeVisible();
  await expect(mainNav.getByRole("link", { name: "Kurum", exact: true })).toBeHidden();
  await expect(mainNav.getByRole("button", { name: "Öğrenci Paneli" })).toBeHidden();
  await expect(mainNav.getByRole("button", { name: "Veli Paneli" })).toBeHidden();
  await expect(heading(page, { name: "Öğretmen Portalı" })).toBeVisible();
  await expect(page.getByLabel("Günlük ders akışı").getByText("Bugünün odağı")).toBeVisible();
  await expect(page.getByLabel("Günlük ders akışı").getByText("Ödev kontrolü")).toBeVisible();
  await expect(page.getByLabel("Günlük ders akışı").getByText(/^(1 bekliyor|Tamam)$/u).first()).toBeVisible();
  await expect(page.getByLabel("Öğretmen profil özeti").getByText("Ayse Ogretmen")).toBeVisible();
  await expect(page.getByLabel("Öğretmen profil özeti").getByText("Matematik").first()).toBeVisible();
  await expect(page.getByLabel("Öğretmen profil özeti").getByText("2. Donem")).toBeVisible();
  await expect(page.getByLabel("Öğretmen profil özeti").getByText("8-A")).toBeVisible();
  await expect(page.getByLabel("Öğretmen profil özeti").getByText("Merkez Kampüs / 8. Sınıf / A şube")).toBeVisible();
  await expect(page.getByLabel("Öğretmen profil özeti").getByText("1 öğrenci")).toBeVisible();
  await expect(page.getByLabel("Bugünkü dersler").getByRole("row", { name: /Matematik 8-A Matematik 2\. Donem/ })).toBeVisible();
  await expect(page.getByLabel("Duyurular").getByRole("cell", { name: "Öğretmen duyurusu", exact: true })).toBeVisible();
  await page.getByLabel("Duyurular").getByRole("button", { name: "Okundu işaretle" }).click();
  await expect(page.getByLabel("Duyurular").getByText("Okundu")).toBeVisible();
  await expect(page.getByLabel("Destek talepleri").getByRole("cell", { exact: true, name: "Yoklama ekranı" })).toBeVisible();
  await page.getByLabel("Destek talepleri").getByRole("textbox", { exact: true, name: "Konu" }).fill("Portal raporu");
  await page.getByLabel("Destek talepleri").getByRole("textbox", { exact: true, name: "Mesaj" }).fill("Sınıf raporu geç yükleniyor.");
  await page.getByLabel("Destek talepleri").getByRole("combobox", { exact: true, name: "Öncelik" }).selectOption("HIGH");
  await page.getByLabel("Destek talepleri").getByRole("button", { name: "Destek talebi aç" }).click();
  await expect.poll(() => lastPortalTeacherSupportTicketBody?.studentId ?? "").toBe("student-a");
  expect(lastPortalTeacherSupportTicketBody).toMatchObject({
    studentId: "student-a",
    campusId: "campus-main",
    gradeLevelId: "grade-8",
    classId: "class-a",
    courseId: "course-math",
    termId: "term-2026-spring",
  });
  await expect(page.getByLabel("Destek talepleri").getByRole("cell", { exact: true, name: "Portal raporu" })).toBeVisible();
  await expect(page.getByLabel("Ders programı").getByRole("row", { name: /Matematik 8-A Matematik 2\. Donem/ })).toBeVisible();
  await expect(page.getByLabel("Yoklama branşı")).toHaveCount(0);
  await expect(page.getByLabel("Yoklama dönemi")).toHaveCount(0);
  await expect(page.getByLabel("Öğretmen öğrenci kapsamı").getByRole("button", { name: "Ada A / 8-A" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen yoklama kayıtları").getByRole("cell", { name: "Yok" })).toBeVisible();
  await page.getByLabel("Tarih").fill("2026-06-11");
  await page.getByRole("button", { name: "Tümünü Var" }).click();
  await page.getByLabel("Ada A yoklama durumu").selectOption("LATE");
  await page.getByRole("button", { name: "Yoklamayı kaydet" }).click();
  expect(lastPortalAttendanceBody).toEqual({
    classId: "class-a",
    date: "2026-06-11",
    entries: [
      { studentId: "student-a", status: "LATE" },
      { studentId: "student-b", status: "PRESENT" },
    ],
  });
  await expect(page.getByLabel("Öğretmen yoklama kayıtları", { exact: true })).toContainText("2026-06-11");
  await expect(page.getByLabel("Öğretmen yoklama kayıtları", { exact: true })).toContainText("Geç");
  await expect(page.getByLabel("Not branşı")).toHaveValue("course-math");
  await expect(page.getByLabel("Not dönemi")).toHaveValue("term-2026-spring");
  await page.getByLabel("Gelişim durumu").fill("FOCUS");
  await page.getByRole("form", { name: "Not ekle" }).getByRole("textbox", { name: /^Not\b/u }).fill("Derste aktif katılım gösterdi.");
  await page.getByRole("button", { name: "Not ekle" }).click();
  expect(lastPortalTeacherNoteBody?.courseId).toBe("course-math");
  expect(lastPortalTeacherNoteBody?.termId).toBe("term-2026-spring");
  await expect(page.getByLabel("Öğretmen notları").getByText("Derste aktif katılım gösterdi.")).toBeVisible();
  await expect(page.getByLabel("Öğretmen notları").getByRole("row", { name: /Ada A Matematik 2\. Donem Derste aktif katılım gösterdi\./ })).toBeVisible();
  await expect(page.getByLabel("Öğretmen ödev kontrolü").getByRole("cell", { name: "Kesirler", exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğretmen ödev kontrolü").getByRole("cell", { name: "Bekliyor" })).toBeVisible();
  await page.getByLabel("Öğretmen ödev kontrolü").getByRole("button", { name: "Kontrol et" }).click();
  await expect(page.getByLabel("Öğretmen ödev kontrolü").getByRole("cell", { name: "Kontrol edildi" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen materyal atamaları").getByRole("cell", { name: "Bireysel tekrar" })).toBeVisible();
  await expect(page.getByLabel("Materyal branşı")).toHaveValue("course-math");
  await expect(page.getByLabel("Materyal dönemi")).toHaveValue("term-2026-spring");
  await page.getByLabel("Atama notu").fill("Konu tekrarı");
  await page.getByLabel("Teslim").fill("2026-06-12");
  await page.getByRole("button", { name: "Materyal ata" }).click();
  expect(lastPortalMaterialAssignmentBody?.courseId).toBe("course-math");
  expect(lastPortalMaterialAssignmentBody?.termId).toBe("term-2026-spring");
  await expect(page.getByLabel("Öğretmen materyal atamaları").getByRole("cell", { name: "Konu tekrarı" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen materyal atamaları").getByRole("row", { name: /Ada A Kesirler Çalışma Kağıdı Matematik 2\. Donem Konu tekrarı/ })).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("8-A").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("Merkez Kampüs / 8. Sınıf / A şube").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("İlk kayıt").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByRole("cell", { name: "Aktif", exact: true })).toBeVisible();
  const teacherReportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
  await expect(teacherReportSummary.getByText("19,25").first()).toBeVisible();
  await expect(teacherReportSummary.getByText("440").first()).toBeVisible();
  await teacherReportSummary.getByRole("button", { name: "Karne detayını göster" }).click();
  const teacherExamReport = page.getByLabel("Sınav raporu");
  await expect(teacherExamReport.getByText("ÖĞRENCİ NO : 176")).toBeVisible();
  await expect(teacherExamReport.getByRole("heading", { name: "Öğrenci gelişim grafiği" })).toBeVisible();
  await expect(teacherExamReport.getByText("1/3", { exact: true }).first()).toBeVisible();
  await expect(teacherExamReport.getByText("1/2", { exact: true }).first()).toBeVisible();
  await expect(teacherExamReport.getByRole("row", { name: /Matematik %83,7 23 20 3 0 19,25/ })).toBeVisible();
  await capturePortalKarneVisualEvidence(page, test.info(), "portal-ogretmen-sinav-raporu");
  await expect(page.getByLabel("Öğretmen sınıf raporları").getByRole("cell", { name: "8-A" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen sınıf raporları").getByRole("cell", { name: "Turkce / 2. Donem" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen sınıf raporları").getByRole("cell", { name: "18,25" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen sınıf raporları").getByRole("cell", { name: "8-B" })).toBeHidden();

  await page.getByLabel("Üst gezinme").getByRole("button", { name: "Çıkış" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs(page, "guardian-a@example.test");
  await expect(page).toHaveURL(/\/veli$/);
  await expandSidebarGroup(page, "Veli Paneli");
  mainNav = page.getByRole("navigation", { name: "Ana menü" });
  await expect(mainNav.getByRole("link", { name: "Özet", exact: true })).toBeVisible();
  await expect(mainNav.getByRole("link", { name: "Ödeme planları" })).toBeVisible();
  await expect(mainNav.getByRole("link", { name: "Kurum", exact: true })).toBeHidden();
  await expect(mainNav.getByRole("button", { name: "Öğretmen Paneli" })).toBeHidden();
  await expect(mainNav.getByRole("button", { name: "Öğrenci Paneli" })).toBeHidden();
  await expect(heading(page, { name: "Veli Portalı" })).toBeVisible();
  await expect(page.getByLabel("Günlük durum").getByText("Bugünün odağı")).toBeVisible();
  await expect(page.getByLabel("Günlük durum").getByText("500,00 TRY")).toBeVisible();
  await expect(page.getByLabel("Duyurular").getByRole("cell", { name: "Veli duyurusu", exact: true })).toBeVisible();
  await page.getByLabel("Duyurular").getByRole("button", { name: "Okundu işaretle" }).click();
  await expect(page.getByLabel("Duyurular").getByText("Okundu")).toBeVisible();
  if (smsEnabled) {
    await expect(page.getByLabel("Bildirim tercihleri").getByLabel("SMS al")).toBeChecked();
    await page.getByLabel("Bildirim tercihleri").getByLabel("SMS al").click();
    await expect(page.getByLabel("Bildirim tercihleri").getByLabel("SMS al")).not.toBeChecked();
  } else {
    await expect(page.getByLabel("Bildirim tercihleri").getByLabel("SMS al")).toHaveCount(0);
  }
  await expect(page.getByLabel("Ödevler").getByRole("cell", { name: "Bireysel tekrar" })).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Kesirler Çalışma Kağıdı")).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Matematik / 2. Donem")).toBeVisible();
  await expect(page.getByLabel("Destek talepleri").getByRole("cell", { exact: true, name: "Rapor görüntüleme" })).toBeVisible();
  await page.getByLabel("Destek talepleri").getByRole("textbox", { exact: true, name: "Konu" }).fill("Ödeme sorusu");
  await page.getByLabel("Destek talepleri").getByRole("textbox", { exact: true, name: "Mesaj" }).fill("Taksit tarihi hakkında bilgi istiyorum.");
  await page.getByLabel("Destek talepleri").getByRole("button", { name: "Destek talebi aç" }).click();
  await expect(page.getByLabel("Destek talepleri").getByRole("cell", { exact: true, name: "Ödeme sorusu" })).toBeVisible();
  const guardianReportSummary = page.getByRole("region", { name: "Portal rapor özeti" });
  await expect(guardianReportSummary.getByText("%85,2").first()).toBeVisible();
  await guardianReportSummary.getByRole("button", { name: "Karne detayını göster" }).click();
  const guardianExamReport = page.getByLabel("Sınav raporu");
  await expect(guardianExamReport.getByText("ÖĞRENCİ NO : 176")).toBeVisible();
  await expect(guardianExamReport.getByRole("heading", { name: "Öğrenci gelişim grafiği" })).toBeVisible();
  await expect(guardianExamReport.getByText("1/3", { exact: true }).first()).toBeVisible();
  await expect(guardianExamReport.getByText("1/2", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Portal kazanım radar grafiği").getByText("Portal kazanım radar tablosu")).toHaveCount(1);
  await expect(page.getByLabel("Portal kazanım radar grafiği").getByRole("row", { name: /Geometri Matematik 7 %82,1 6 1 0 5,75/ })).toBeVisible();
  await expect(guardianExamReport.getByRole("row", { name: /Matematik %100,0 20 20 0 0 20,00 19,92 9,46 9,39/ })).toBeVisible();
  await expect(page.getByLabel("Son sınav branş netleri").getByRole("row", { name: /Matematik 18,67 20,00 17,33 18,67 18,67/ })).toBeVisible();
  await capturePortalKarneVisualEvidence(page, test.info(), "portal-veli-sinav-raporu");
  await page.evaluate(() => {
    window.history.pushState(null, "", "/veli?examId=exam-demo");
  });
  await expect(page).toHaveURL(/\/veli\?examId=exam-demo$/);
  await expect(guardianReportSummary.getByText("17,5").first()).toBeVisible();
  await expect(page.getByLabel("Portal özeti").getByText("500,00 TRY")).toBeVisible();
  await expect(page.getByLabel("Ödeme planları").getByText("2026 Haziran ödeme planı")).toBeVisible();
  await expect(page.getByLabel("Ödeme planları").getByText("1. taksit / 500,00 TRY")).toBeVisible();
  await expect(page.getByLabel("Ödeme planları").getByRole("row", { name: /1\. taksit .* Bekliyor/ })).toBeVisible();
  portalGuardianPreferences = { ...portalGuardianPreferences, canViewFinance: false };
  if (smsEnabled) {
    await page.getByLabel("Bildirim tercihleri").getByLabel("SMS al").click();
    await expect(page.getByLabel("Bildirim tercihleri").getByLabel("SMS al")).toBeChecked();
  }
  await mainNav.getByRole("link", { name: "Ödeme planları" }).click();
  await mainNav.getByRole("link", { name: "Özet", exact: true }).click();
  expect(portalGuardianClosedFinancePaymentPlanRequests).toBe(0);
  await expect(page.getByLabel("Portal özeti").getByText("Kapalı").first()).toBeVisible();
  await expect(page.getByLabel("Ödeme planları").getByText("Ödeme görünümü kapalı.")).toBeVisible();
  await expect(page.getByLabel("Ödeme planları").getByText("2026 Haziran ödeme planı")).toBeHidden();
  await expect(page.getByLabel("Profil").getByText("*******0146")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("8-A")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Merkez Kampüs")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("8. Sınıf")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("A", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Ayse Ogretmen")).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("8-A").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("Merkez Kampüs / 8. Sınıf / A şube").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("İlk kayıt").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByRole("cell", { name: "Aktif", exact: true })).toBeVisible();
  await expect(page.getByLabel("Veli ilişki özeti").getByText("Kapalı")).toBeVisible();
  await expect(page.getByLabel("Veli ilişki özeti").getByText(smsEnabled ? "SMS, Duyuru, Destek" : "Duyuru, Destek")).toBeVisible();
});

async function loginAs(page: Page, email: string, password = "password") {
  await page.goto(email === "system@example.test" ? "/sistem/giris" : "/k/dna-egitim/giris");
  await page.getByLabel("Kullanıcı adı veya e-posta").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  const homeUrlByEmail: Record<string, RegExp> = {
    "system@example.test": /\/sistem$/,
    "student-a@example.test": /\/ogrenci$/,
    "teacher-a@example.test": /\/ogretmen$/,
    "guardian-a@example.test": /\/veli$/,
  };
  await expect(page).toHaveURL(homeUrlByEmail[email] ?? /\/kurum$/, { timeout: 15_000 });
  await page.context().addCookies([{ name: "csrfToken", url: appOrigin, value: "csrf-token" }]);
}

function loginEmailFromRequest(body: { email?: string; loginName?: string }) {
  return body.loginName ?? body.email ?? "admin-a@example.test";
}

type TestAuthSession = {
  id: string;
  userId: string;
  tenantId: string;
  roles: string[];
  membershipVersion: number;
  status: string;
  mustChangePassword?: boolean;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
};

type TestAuthResponse = {
  accessToken: string;
  session: TestAuthSession;
  mustChangePassword?: boolean;
};

function createAuthResponse(email = "admin-a@example.test"): TestAuthResponse {
  const profileByEmail: Record<
    string,
    { userId: string; roles: string[]; tenantId?: string; subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER"; subjectId?: string }
  > = {
    "system@example.test": { userId: "user-system", roles: ["SYSTEM_ADMIN"] },
    "first.admin@example.test": { userId: "user-created-admin", roles: ["TENANT_ADMIN"], tenantId: "tenant-created" },
    "assistant@example.test": { userId: "user-assistant", roles: ["ASSISTANT_ADMIN"] },
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
      tenantId: profile.tenantId ?? "tenant-a",
      roles: profile.roles,
      membershipVersion: 1,
      status: "ACTIVE",
      subjectType: profile.subjectType,
      subjectId: profile.subjectId,
    },
  };
}

function readPortalFixture(path: string): unknown {
  if (path === "/me/teacher/students") return readPortalFixture("/students");
  if (path === "/me/teacher/attendance") return readPortalFixture("/attendance");
  if (path === "/me/teacher/homework") return readPortalFixture("/homework");
  if (path === "/me/teacher/homework/materials") return readPortalFixture("/homework/materials");
  if (path === "/me/teacher/teacher-notes") return [];
  if (path === "/me/teacher/lookups") {
    return {
      attendanceClassIds: ["class-a"],
      campuses: readPortalFixture("/campuses"),
      classes: readPortalFixture("/classes"),
      courses: readPortalFixture("/courses"),
      gradeLevels: readPortalFixture("/grade-levels"),
      terms: readPortalFixture("/academic-terms"),
    };
  }
  const teacherReportSnapshotMatch = path.match(/^\/me\/teacher\/reports\/([^/]+)\/snapshots$/u);
  if (teacherReportSnapshotMatch) {
    return readFixture(`/exams/${teacherReportSnapshotMatch[1]}/reports/snapshots`);
  }
  const teacherReportStudentMatch = path.match(/^\/me\/teacher\/reports\/([^/]+)\/snapshots\/([^/]+)\/students\/([^/]+)$/u);
  if (teacherReportStudentMatch) {
    return readFixture(`/exams/${teacherReportStudentMatch[1]}/reports/snapshots/${teacherReportStudentMatch[2]}/students/${teacherReportStudentMatch[3]}`);
  }
  const teacherReportErrorBookletMatch = path.match(/^\/me\/teacher\/reports\/([^/]+)\/snapshots\/([^/]+)\/students\/([^/]+)\/error-booklet$/u);
  if (teacherReportErrorBookletMatch) {
    return readFixture(`/exams/${teacherReportErrorBookletMatch[1]}/reports/snapshots/${teacherReportErrorBookletMatch[2]}/students/${teacherReportErrorBookletMatch[3]}/error-booklet`);
  }
  const teacherReportProgressMatch = path.match(/^\/me\/teacher\/reports\/([^/]+)\/students\/([^/]+)\/progress$/u);
  if (teacherReportProgressMatch) {
    return readFixture(`/exams/${teacherReportProgressMatch[1]}/reports/students/${teacherReportProgressMatch[2]}/progress`);
  }
  if (path === "/me/teacher/students/student-a/class-history") return readPortalFixture("/me/student/class-history");
  if (path === "/me/teacher/students/student-a/enrollments") return readPortalFixture("/me/student/enrollments");
  if (path === "/campuses") return [{ id: "campus-main", tenantId: "tenant-a", name: "Merkez Kampüs", code: "MRK" }];
  if (path === "/classes") return [{ id: "class-a", tenantId: "tenant-a", name: "8-A", campusId: "campus-main", gradeLevelId: "grade-8", section: "A" }];
  if (path === "/teachers") return [];
  if (path === "/grade-levels") return [{ id: "grade-8", tenantId: "tenant-a", name: "8. Sınıf", code: "8" }];
  if (path === "/courses") {
    return [
      { id: "course-math", tenantId: "tenant-a", name: "Matematik", code: "MAT" },
      { id: "course-turkish", tenantId: "tenant-a", name: "Turkce", code: "TUR" },
    ];
  }
  if (path === "/academic-terms") {
    return [
      {
        id: "term-2026-spring",
        tenantId: "tenant-a",
        academicYearId: "academic-year-2026",
        name: "2. Donem",
        startsAt: "2026-02-01",
        endsAt: "2026-06-30",
        isActive: true,
      },
    ];
  }
  if (path === "/students") return [{ id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A", classId: "class-a", responsibleTeacherId: "teacher-a", status: "ACTIVE" }];
  if (path === "/me/student/profile" || path === "/me/guardian/students/student-a/profile") {
    return {
      id: "student-a",
      tenantId: "tenant-a",
      firstName: "Ada",
      lastName: "A",
      classId: "class-a",
      className: "8-A",
      campusName: "Merkez Kampüs",
      gradeLevelName: "8. Sınıf",
      section: "A",
      responsibleTeacherId: "teacher-a",
      responsibleTeacherName: "Ayse Ogretmen",
      nationalIdMasked: "*******0146",
      phone: "5551234567",
      status: "ACTIVE",
    };
  }
  if (path === "/me/student/guardians") {
    return [{ id: "guardian-a", tenantId: "tenant-a", firstName: "Zeynep", lastName: "Veli", phone: "5550000000" }];
  }
  if (path === "/me/student/guardian-links") {
    return [{
      id: "guardian-student-a",
      tenantId: "tenant-a",
      guardianId: "guardian-a",
      studentId: "student-a",
      canViewFinance: true,
      canReceiveSms: true,
      canReceiveAnnouncements: true,
      canOpenSupportTickets: true,
    }];
  }
  if (path === "/me/student/class-history" || path === "/me/guardian/students/student-a/class-history") {
    return [{
      id: "student-class-history-a",
      tenantId: "tenant-a",
      studentId: "student-a",
      classId: "class-a",
      className: "8-A",
      campusName: "Merkez Kampüs",
      gradeLevelName: "8. Sınıf",
      section: "A",
      termId: "term-2026-spring",
      startsAt: "2026-06-01",
      reason: "CREATED",
    }];
  }
  if (path === "/me/student/enrollments" || path === "/me/guardian/students/student-a/enrollments") {
    return [{
      id: "student-enrollment-a",
      tenantId: "tenant-a",
      studentId: "student-a",
      classId: "class-a",
      className: "8-A",
      campusName: "Merkez Kampüs",
      gradeLevelName: "8. Sınıf",
      section: "A",
      termId: "term-2026-spring",
      status: "ACTIVE",
      startsAt: "2026-06-01",
      reason: "CREATED",
    }];
  }
  if (path === "/me/student/attendance" || path === "/me/guardian/students/student-a/attendance") {
    return [{ id: "attendance-a", tenantId: "tenant-a", studentId: "student-a", date: "2026-06-03", status: "ABSENT" }];
  }
  if (path === "/me/student/attendance/summary" || path === "/me/guardian/students/student-a/attendance/summary") {
    return { studentId: "student-a", total: 1, present: 0, absent: 1, late: 0, excused: 0 };
  }
  if (
    path === "/me/student/homework/material-assignments" ||
    path === "/me/guardian/homework/material-assignments" ||
    path === "/me/guardian/students/student-a/homework/material-assignments"
  ) {
    return [
      {
        id: "material-assignment-a",
        tenantId: "tenant-a",
        materialId: "material-a",
        materialTitle: "Kesirler Çalışma Kağıdı",
        studentId: "student-a",
        courseId: "course-math",
        termId: "term-2026-spring",
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
  if (path === "/me/student/announcements") {
    return [
      {
        id: "announcement-student-a",
        tenantId: "tenant-a",
        title: "Öğrenci duyurusu",
        body: "8-A öğrencileri cuma deneme sınavına katılacaktır.",
        audience: "STUDENTS",
        classId: "class-a",
        publishedAt: "2026-06-09T09:00:00.000Z",
      },
    ];
  }
  if (path === "/me/guardian/students/student-a/announcements") {
    return [
      {
        id: "announcement-guardian-a",
        tenantId: "tenant-a",
        title: "Veli duyurusu",
        body: "8-A velileri için bilgilendirme toplantısı yapılacaktır.",
        audience: "GUARDIANS",
        classId: "class-a",
        publishedAt: "2026-06-09T10:00:00.000Z",
      },
    ];
  }
  if (
    path === "/me/student/reports" ||
    path === "/me/guardian/students/student-a/reports" ||
    path === "/me/teacher/reports"
  ) {
    return [
      {
        examId: "exam-demo-isem-lgs-1",
        latestGeneratedAt: "2026-06-17T10:00:00.000Z",
        latestReadySnapshotId: "snapshot-a",
        title: "İSEM - LGS - 1",
      },
      {
        examId: "exam-demo",
        latestGeneratedAt: "2026-06-10T10:00:00.000Z",
        latestReadySnapshotId: "snapshot-demo",
        title: "Kurum Deneme Sınavı",
      },
    ];
  }
  if (
    path === "/me/student/reports/exam-demo-isem-lgs-1/latest" ||
    path === "/me/guardian/students/student-a/reports/exam-demo-isem-lgs-1/latest"
  ) {
    return {
      tenantId: "tenant-a",
      institutionName: "DNA EĞİTİM KURUMU",
      examId: "exam-demo-isem-lgs-1",
      examTitle: "İSEM - LGS - 1",
      examStartsAt: "2025-11-05T00:00:00.000Z",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      studentName: "Ada A",
      participantNo: "176",
      bookletType: "B",
      classId: "class-a",
      className: "8-A",
      courseId: "course-math",
      resultKey: "student-a",
      termId: "term-2026-spring",
      total: {
        correct: 80,
        wrong: 10,
        blank: 0,
        net: 76.67,
        standardScore: 420,
      },
      branches: [
        { branch: "TÜRKÇE", correct: 15, wrong: 5, blank: 0, net: 13.33, classNetAverage: 16.78, schoolNetAverage: 10.87, generalNetAverage: 11.14 },
        { branch: "İNKILAP TARİHİ", correct: 9, wrong: 1, blank: 0, net: 8.67, classNetAverage: 9.61, schoolNetAverage: 7.98, generalNetAverage: 7.97 },
        { branch: "DİN KÜLTÜRÜ", correct: 9, wrong: 1, blank: 0, net: 8.67, classNetAverage: 8.67, schoolNetAverage: 5.53, generalNetAverage: 4.89 },
        { branch: "İNGİLİZCE", correct: 10, wrong: 0, blank: 0, net: 10, classNetAverage: 8.75, schoolNetAverage: 4.81, generalNetAverage: 5.14 },
        { branch: "MATEMATİK", correct: 20, wrong: 0, blank: 0, net: 20, classNetAverage: 19.92, schoolNetAverage: 9.46, generalNetAverage: 9.39 },
        { branch: "FEN BİLİMLERİ", correct: 17, wrong: 3, blank: 0, net: 16, classNetAverage: 18.98, schoolNetAverage: 12.32, generalNetAverage: 11.7 },
      ],
      outcomes: [
        { outcomeCode: "Sayılar", branch: "Matematik", correct: 8, wrong: 1, blank: 0, net: 7.5 },
        { outcomeCode: "Geometri", branch: "Matematik", correct: 6, wrong: 1, blank: 0, net: 5.75 },
        { outcomeCode: "Problemler", branch: "Matematik", correct: 4, wrong: 0, blank: 0, net: 4 },
      ],
      statistics: {
        standardScore: 420,
        general: { rank: 1, outOf: 3, percentile: 100 },
        class: { rank: 1, outOf: 2, percentile: 100 },
        branches: [
          {
            branch: "MATEMATİK",
            standardScore: 420,
            general: { rank: 1, outOf: 3, percentile: 100 },
            class: { rank: 1, outOf: 2, percentile: 100 },
          },
        ],
      },
      generatedAt: "2026-06-08T09:00:00.000Z",
    };
  }
  if (
    path === "/me/student/reports/exam-demo/latest" ||
    path === "/me/guardian/students/student-a/reports/exam-demo/latest"
  ) {
    return {
      tenantId: "tenant-a",
      institutionName: "DNA EĞİTİM KURUMU",
      examId: "exam-demo",
      examTitle: "İSEM - LGS - 1",
      examStartsAt: "2025-11-05T00:00:00.000Z",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      studentName: "Ada A",
      participantNo: "176",
      bookletType: "B",
      classId: "class-a",
      className: "8-A",
      courseId: "course-math",
      resultKey: "student-a",
      termId: "term-2026-spring",
      total: {
        correct: 18,
        wrong: 2,
        blank: 0,
        net: 17.5,
        standardScore: 420,
      },
      branches: [{ branch: "Matematik", correct: 18, wrong: 2, blank: 0, net: 17.5, classNetAverage: 16.75, schoolNetAverage: 11.5, generalNetAverage: 15.5 }],
      outcomes: [
        { outcomeCode: "Sayılar", branch: "Matematik", correct: 8, wrong: 1, blank: 0, net: 7.5 },
        { outcomeCode: "Geometri", branch: "Matematik", correct: 6, wrong: 1, blank: 0, net: 5.75 },
        { outcomeCode: "Problemler", branch: "Matematik", correct: 4, wrong: 0, blank: 0, net: 4 },
      ],
      statistics: {
        standardScore: 420,
        general: { rank: 1, outOf: 3, percentile: 100 },
        class: { rank: 1, outOf: 2, percentile: 100 },
        branches: [
          {
            branch: "Matematik",
            standardScore: 420,
            general: { rank: 1, outOf: 3, percentile: 100 },
            class: { rank: 1, outOf: 2, percentile: 100 },
          },
        ],
      },
      generatedAt: "2026-06-08T09:00:00.000Z",
    };
  }
  if (
    path === "/me/student/reports/exam-demo/latest/error-booklet" ||
    path === "/me/student/reports/exam-demo-isem-lgs-1/latest/error-booklet" ||
    path === "/me/guardian/students/student-a/reports/exam-demo/latest/error-booklet" ||
    path === "/me/guardian/students/student-a/reports/exam-demo-isem-lgs-1/latest/error-booklet"
  ) {
    return {
      tenantId: "tenant-a",
      institutionName: "DNA EĞİTİM KURUMU",
      examId: "exam-demo",
      examTitle: "İSEM - LGS - 1",
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
  if (
    path === "/me/student/reports/exam-demo-isem-lgs-1/progress" ||
    path === "/me/guardian/students/student-a/reports/exam-demo-isem-lgs-1/progress"
  ) {
    return buildIsemProgress("exam-demo-isem-lgs-1");
  }

  if (
    path === "/me/student/reports/exam-demo/progress" ||
    path === "/me/guardian/students/student-a/reports/exam-demo/progress"
  ) {
    return {
      tenantId: "tenant-a",
      examId: "exam-demo",
      studentId: "student-a",
      points: [
        {
          snapshotId: "snapshot-prev",
          courseId: "course-turkish",
          generatedAt: "2026-05-25T09:00:00.000Z",
          termId: "term-2026-spring",
          total: { net: 14.5, questionCount: 20, standardScore: 380 },
          branches: [
            { branch: "TÜRKÇE", net: 12.33 },
            { branch: "İNKILAP TARİHİ", net: 8 },
            { branch: "DİN KÜLTÜRÜ", net: 7.67 },
            { branch: "İNGİLİZCE", net: 9 },
            { branch: "MATEMATİK", net: 14.5 },
            { branch: "FEN BİLİMLERİ", net: 14 },
          ],
        },
        {
          snapshotId: "snapshot-a",
          courseId: "course-math",
          generatedAt: "2026-06-08T09:00:00.000Z",
          termId: "term-2026-spring",
          total: { net: 17.5, questionCount: 20, standardScore: 420 },
          branches: [
            { branch: "TÜRKÇE", net: 13.33 },
            { branch: "İNKILAP TARİHİ", net: 8.67 },
            { branch: "DİN KÜLTÜRÜ", net: 8.67 },
            { branch: "İNGİLİZCE", net: 10 },
            { branch: "MATEMATİK", net: 20 },
            { branch: "FEN BİLİMLERİ", net: 16 },
          ],
        },
      ],
      netDelta: 3,
      standardScoreDelta: 40,
      successRateDelta: 15,
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
        courseId: "course-math",
        termId: "term-2026-spring",
        title: "Matematik",
        startsAt: "2026-06-10T09:00:00.000Z",
        endsAt: "2026-06-10T10:00:00.000Z",
      },
    ];
  }
  if (path === "/me/teacher/announcements") {
    return [
      {
        id: "announcement-teacher-a",
        tenantId: "tenant-a",
        title: "Öğretmen duyurusu",
        body: "Zümre toplantısı salı günü yapılacaktır.",
        audience: "TEACHERS",
        classId: "class-a",
        publishedAt: "2026-06-09T11:00:00.000Z",
      },
    ];
  }
  if (path === "/attendance") {
    return [
      {
        id: "attendance-a",
        tenantId: "tenant-a",
        studentId: "student-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        date: "2026-06-03",
        status: "ABSENT",
      },
    ];
  }
  if (path === "/homework") {
    return [
      {
        id: "homework-a",
        tenantId: "tenant-a",
        classId: "class-a",
        sourceMaterialId: "material-a",
        sourceMaterialTitle: "Kesirler Çalışma Kağıdı",
        title: "Kesirler",
        description: "1-20 arası sorular",
        dueAt: "2026-06-10T12:00:00.000Z",
      },
    ];
  }
  if (path === "/homework/materials") {
    return [
      {
        id: "material-a",
        tenantId: "tenant-a",
        title: "Kesirler Çalışma Kağıdı",
        description: "Kesirlerle dört işlem alıştırmaları",
      },
    ];
  }
  if (path === "/teacher-notes") {
    return [
      {
        id: "teacher-note-internal-a",
        tenantId: "tenant-a",
        studentId: "student-a",
        teacherId: "teacher-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        visibility: "INTERNAL",
        body: "Dikkat takibi iç notu",
        developmentStatus: "WATCH",
        createdAt: "2026-06-04T09:00:00.000Z",
      },
    ];
  }
  return readFixture(path);
}

function readFixture(path: string) {
  if (path === "/me/institution-dashboard") {
    return {
      generatedAt: "2026-06-08T12:00:00.000Z",
      institution: {
        name: "DNA EĞİTİM KURUMU",
        institutionType: "study-center",
      },
      activeStudentCount: 3,
      attention: {
        attendanceAlertCount: 1,
        openImportQuarantineCount: 1,
        openSupportTicketCount: 1,
      },
      latestExam: {
        examId: "exam-demo",
        title: "LGS deneme sınavı",
        startsAt: "2026-06-08T09:00:00.000Z",
        registeredParticipantCount: 1,
        attendedParticipantCount: 1,
        absentParticipantCount: 0,
        reportStatus: "READY",
        report: {
          snapshotId: "snapshot-demo",
          generatedAt: "2026-06-08T12:00:00.000Z",
          resultCount: 1,
          successRate: 91.5,
          net: 18.3,
          questionCount: 20,
          classes: [{
            classId: "class-a",
            className: "8-A",
            resultCount: 1,
            successRate: 91.5,
            net: 18.3,
            questionCount: 20,
          }],
        },
      },
    };
  }

  if (path === "/me/tenant") {
    return {
      id: "tenant-a",
      name: "DNA EĞİTİM KURUMU",
      slug: "dna-egitim",
      plan: "PRO",
      status: "ACTIVE",
      institutionType: "study-center",
      contactEmail: "info@dna.test",
    };
  }

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

  if (path === "/exams/exam-demo/reports/snapshots" || path === "/exams/exam-demo-isem-lgs-1/reports/snapshots") {
    return [
      {
        id: "snapshot-a",
        tenantId: "tenant-a",
        examId: "exam-demo",
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
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
          outcomes: [
            {
              outcomeCode: "Sayılar",
              branch: "Matematik",
              resultCount: 3,
              correct: 8,
              wrong: 1,
              blank: 0,
              net: 7.5,
            },
            {
              outcomeCode: "Paragraf",
              branch: "Türkçe",
              resultCount: 3,
              correct: 5,
              wrong: 1,
              blank: 0,
              net: 4.75,
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
              statistics: {
                standardScore: 420,
                general: { rank: 1, outOf: 3, percentile: 100 },
                class: { rank: 1, outOf: 2, percentile: 100 },
                branches: [],
              },
            },
            {
              studentId: "student-b",
              classId: "class-a",
              className: "8-A",
              resultKey: "student-b",
              total: {
                correct: 15,
                wrong: 5,
                blank: 0,
                net: 13.33,
                standardScore: 390,
              },
              statistics: {
                standardScore: 390,
                general: { rank: 2, outOf: 3, percentile: 50 },
                class: { rank: 2, outOf: 2, percentile: 50 },
                branches: [],
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
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-b",
        courseId: "course-turkish",
        termId: "term-2026-spring",
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
          outcomes: [
            {
              outcomeCode: "Sayılar",
              branch: "Matematik",
              resultCount: 3,
              correct: 10,
              wrong: 1,
              blank: 0,
              net: 9.5,
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
              statistics: {
                standardScore: 440,
                general: { rank: 1, outOf: 3, percentile: 100 },
                class: { rank: 1, outOf: 2, percentile: 100 },
                branches: [],
              },
            },
          ],
        },
        createdAt: "2026-06-15T09:00:00.000Z",
        updatedAt: "2026-06-15T09:00:00.000Z",
      },
    ];
  }

  if (path === "/exams/exam-a/reports/snapshots") {
    return [
      {
        id: "snapshot-optik-a",
        tenantId: "tenant-a",
        examId: "exam-a",
        campusId: "campus-main",
        gradeLevelId: "grade-8",
        classId: "class-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        reportType: "EXAM_RESULT_SUMMARY",
        status: "READY",
        inputRefs: { contentHash: "abcdef1234567890", rawImportId: "raw-import-a" },
        snapshotData: {
          resultCount: 2,
          averages: {
            correct: 17,
            wrong: 3,
            blank: 0,
            net: 16.25,
            questionCount: 20,
            standardScore: 410,
            successRate: 81.25,
          },
          branches: [
            { branch: "Matematik", resultCount: 2, correct: 11, wrong: 2, blank: 0, net: 10.5, questionCount: 13, successRate: 80.77 },
            { branch: "Türkçe", resultCount: 2, correct: 6, wrong: 1, blank: 0, net: 5.75, questionCount: 7, successRate: 82.14 },
          ],
          outcomes: [
            { outcomeCode: "Geometri", branch: "Matematik", resultCount: 2, correct: 6, wrong: 1, blank: 0, net: 5.75, questionCount: 7, successRate: 82.14 },
            { outcomeCode: "Problemler", branch: "Matematik", resultCount: 2, correct: 5, wrong: 1, blank: 0, net: 4.75, questionCount: 6, successRate: 79.17 },
          ],
          classes: [
            {
              classId: "class-a",
              className: "8-A",
              resultCount: 2,
              averages: {
                correct: 17,
                wrong: 3,
                blank: 0,
                net: 16.25,
                questionCount: 20,
                standardScore: 410,
                successRate: 81.25,
              },
            },
          ],
          students: [
            {
              studentId: "student-a",
              classId: "class-a",
              className: "8-A",
              resultKey: "student-a",
              total: {
                correct: 17,
                wrong: 3,
                blank: 0,
                net: 16.25,
                questionCount: 20,
                standardScore: 410,
                successRate: 81.25,
              },
              statistics: {
                standardScore: 410,
                general: { rank: 1, outOf: 2, percentile: 75 },
                class: { rank: 1, outOf: 2, percentile: 75 },
                branches: [],
              },
            },
            {
              studentId: "student-b",
              classId: "class-a",
              className: "8-A",
              resultKey: "student-b",
              total: {
                correct: 16,
                wrong: 4,
                blank: 0,
                net: 14.75,
                questionCount: 20,
                standardScore: 390,
                successRate: 73.75,
              },
              statistics: {
                standardScore: 390,
                general: { rank: 2, outOf: 2, percentile: 25 },
                class: { rank: 2, outOf: 2, percentile: 25 },
                branches: [],
              },
            },
          ],
        },
        createdAt: "2026-06-09T09:30:00.000Z",
        updatedAt: "2026-06-09T09:30:00.000Z",
      },
    ];
  }

  if (path === "/exams/exam-demo/reports/snapshots/snapshot-a/students/student-a") {
    return {
      tenantId: "tenant-a",
      institutionName: "DNA EĞİTİM KURUMU",
      examId: "exam-demo",
      examStartsAt: "2025-11-05T00:00:00.000Z",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      studentName: "Ada A",
      participantNo: "176",
      bookletType: "B",
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
          classNetAverage: 16.75,
          schoolNetAverage: 11.5,
          generalNetAverage: 15.5,
        },
      ],
      outcomes: [
        {
          outcomeCode: "Sayılar",
          branch: "Matematik",
          correct: 8,
          wrong: 1,
          blank: 0,
          net: 7.5,
        },
        {
          outcomeCode: "Geometri",
          branch: "Matematik",
          correct: 6,
          wrong: 1,
          blank: 0,
          net: 5.75,
        },
        {
          outcomeCode: "Problemler",
          branch: "Matematik",
          correct: 4,
          wrong: 0,
          blank: 0,
          net: 4,
        },
      ],
      statistics: {
        standardScore: 420,
        general: { rank: 1, outOf: 3, percentile: 100 },
        class: { rank: 1, outOf: 2, percentile: 100 },
        branches: [
          {
            branch: "Matematik",
            standardScore: 420,
            general: { rank: 1, outOf: 3, percentile: 100 },
            class: { rank: 1, outOf: 2, percentile: 100 },
          },
        ],
      },
      generatedAt: "2026-06-08T09:00:00.000Z",
    };
  }

  if (path === "/exams/exam-demo/reports/snapshots/snapshot-a/students/student-b") {
    return {
      tenantId: "tenant-a",
      institutionName: "DNA EĞİTİM KURUMU",
      examId: "exam-demo",
      examStartsAt: "2025-11-05T00:00:00.000Z",
      snapshotId: "snapshot-a",
      studentId: "student-b",
      studentName: "Bora B",
      participantNo: "201",
      bookletType: "B",
      classId: "class-a",
      className: "8-A",
      resultKey: "student-b",
      total: {
        correct: 15,
        wrong: 5,
        blank: 0,
        net: 13.33,
        standardScore: 390,
      },
      branches: [
        {
          branch: "Matematik",
          correct: 15,
          wrong: 5,
          blank: 0,
          net: 13.33,
          classNetAverage: 16.75,
          schoolNetAverage: 11.5,
          generalNetAverage: 15.5,
        },
      ],
      outcomes: [
        {
          outcomeCode: "Sayılar",
          branch: "Matematik",
          correct: 6,
          wrong: 2,
          blank: 0,
          net: 5.33,
        },
      ],
      statistics: {
        standardScore: 390,
        general: { rank: 2, outOf: 3, percentile: 50 },
        class: { rank: 2, outOf: 2, percentile: 50 },
        branches: [
          {
            branch: "Matematik",
            standardScore: 390,
            general: { rank: 2, outOf: 3, percentile: 50 },
            class: { rank: 2, outOf: 2, percentile: 50 },
          },
        ],
      },
      generatedAt: "2026-06-08T09:00:00.000Z",
    };
  }

  if (path === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-a/students/student-a") {
    return {
      tenantId: "tenant-a",
      institutionName: "DNA EĞİTİM KURUMU",
      examId: "exam-demo-isem-lgs-1",
      examTitle: "İSEM - LGS - 1",
      examStartsAt: "2025-11-05T00:00:00.000Z",
      snapshotId: "snapshot-a",
      studentId: "student-a",
      studentName: "Ada A",
      participantNo: "176",
      bookletType: "B",
      classId: "class-a",
      className: "8-A",
      resultKey: "student-a",
      total: {
        correct: 80,
        wrong: 10,
        blank: 0,
        net: 76.67,
        standardScore: 420,
      },
      branches: [
        {
          branch: "TÜRKÇE",
          correct: 15,
          wrong: 5,
          blank: 0,
          net: 13.33,
          classNetAverage: 16.78,
          schoolNetAverage: 10.87,
          generalNetAverage: 11.14,
        },
        {
          branch: "İNKILAP TARİHİ",
          correct: 9,
          wrong: 1,
          blank: 0,
          net: 8.67,
          classNetAverage: 9.61,
          schoolNetAverage: 7.98,
          generalNetAverage: 7.97,
        },
        {
          branch: "DİN KÜLTÜRÜ",
          correct: 9,
          wrong: 1,
          blank: 0,
          net: 8.67,
          classNetAverage: 8.67,
          schoolNetAverage: 5.53,
          generalNetAverage: 4.89,
        },
        {
          branch: "İNGİLİZCE",
          correct: 10,
          wrong: 0,
          blank: 0,
          net: 10,
          classNetAverage: 8.75,
          schoolNetAverage: 4.81,
          generalNetAverage: 5.14,
        },
        {
          branch: "MATEMATİK",
          correct: 20,
          wrong: 0,
          blank: 0,
          net: 20,
          classNetAverage: 19.92,
          schoolNetAverage: 9.46,
          generalNetAverage: 9.39,
        },
        {
          branch: "FEN BİLİMLERİ",
          correct: 17,
          wrong: 3,
          blank: 0,
          net: 16,
          classNetAverage: 18.98,
          schoolNetAverage: 12.32,
          generalNetAverage: 11.7,
        },
      ],
      outcomes: [
        {
          outcomeCode: "Sayılar",
          branch: "Matematik",
          correct: 8,
          wrong: 1,
          blank: 0,
          net: 7.5,
        },
        {
          outcomeCode: "Geometri",
          branch: "Matematik",
          correct: 6,
          wrong: 1,
          blank: 0,
          net: 5.75,
        },
        {
          outcomeCode: "Problemler",
          branch: "Matematik",
          correct: 4,
          wrong: 0,
          blank: 0,
          net: 4,
        },
      ],
      statistics: {
        standardScore: 420,
        general: { rank: 1, outOf: 3, percentile: 100 },
        class: { rank: 1, outOf: 2, percentile: 100 },
        branches: [
          {
            branch: "Matematik",
            standardScore: 420,
            general: { rank: 1, outOf: 3, percentile: 100 },
            class: { rank: 1, outOf: 2, percentile: 100 },
          },
        ],
      },
      generatedAt: "2026-06-08T09:00:00.000Z",
    };
  }

  if (path === "/exams/exam-a/reports/snapshots/snapshot-optik-a/students/student-a") {
    return {
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotId: "snapshot-optik-a",
      studentId: "student-a",
      classId: "class-a",
      className: "8-A",
      resultKey: "student-a",
      total: {
        correct: 17,
        wrong: 3,
        blank: 0,
        net: 16.25,
        standardScore: 410,
      },
      branches: [
        { branch: "Matematik", correct: 11, wrong: 2, blank: 0, net: 10.5 },
        { branch: "Türkçe", correct: 6, wrong: 1, blank: 0, net: 5.75 },
      ],
      outcomes: [
        { outcomeCode: "Geometri", branch: "Matematik", correct: 6, wrong: 1, blank: 0, net: 5.75 },
        { outcomeCode: "Problemler", branch: "Matematik", correct: 5, wrong: 1, blank: 0, net: 4.75 },
      ],
      statistics: {
        standardScore: 410,
        general: { rank: 2, outOf: 2, percentile: 50 },
        class: { rank: 2, outOf: 2, percentile: 50 },
        branches: [
          {
            branch: "Matematik",
            standardScore: 410,
            general: { rank: 2, outOf: 2, percentile: 50 },
            class: { rank: 2, outOf: 2, percentile: 50 },
          },
        ],
      },
      generatedAt: "2026-06-09T09:30:00.000Z",
    };
  }

  if (
    path === "/exams/exam-demo/reports/snapshots/snapshot-b/students/student-a" ||
    path === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-b/students/student-a"
  ) {
    return {
      tenantId: "tenant-a",
      institutionName: "DNA EĞİTİM KURUMU",
      examId: "exam-demo",
      examTitle: "İSEM - LGS - 1",
      examStartsAt: "2025-11-05T00:00:00.000Z",
      snapshotId: "snapshot-b",
      studentId: "student-a",
      studentName: "Ada A",
      participantNo: "176",
      bookletType: "B",
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
      outcomes: [
        {
          outcomeCode: "Sayılar",
          branch: "Matematik",
          correct: 10,
          wrong: 1,
          blank: 0,
          net: 9.5,
        },
      ],
      statistics: {
        standardScore: 440,
        general: { rank: 1, outOf: 3, percentile: 100 },
        class: { rank: 1, outOf: 2, percentile: 100 },
        branches: [
          {
            branch: "Matematik",
            standardScore: 440,
            general: { rank: 1, outOf: 3, percentile: 100 },
            class: { rank: 1, outOf: 2, percentile: 100 },
          },
        ],
      },
      generatedAt: "2026-06-15T09:00:00.000Z",
    };
  }

  if (
    path === "/exams/exam-demo/reports/snapshots/snapshot-b/students/student-a/error-booklet" ||
    path === "/exams/exam-demo-isem-lgs-1/reports/snapshots/snapshot-b/students/student-a/error-booklet"
  ) {
    return {
      tenantId: "tenant-a",
      examId: "exam-demo",
      snapshotId: "snapshot-b",
      studentId: "student-a",
      items: [
        { questionNo: 4, branch: "Matematik", answer: "A", correctAnswer: "D", status: "WRONG" },
      ],
      generatedAt: "2026-06-15T09:00:00.000Z",
    };
  }

  if (path === "/exams/exam-a/reports/snapshots/snapshot-optik-a/students/student-a/error-booklet") {
    return {
      tenantId: "tenant-a",
      examId: "exam-a",
      snapshotId: "snapshot-optik-a",
      studentId: "student-a",
      items: [
        { questionNo: 7, branch: "Matematik", answer: "C", correctAnswer: "D", status: "WRONG" },
      ],
      generatedAt: "2026-06-09T09:30:00.000Z",
    };
  }

  if (path === "/exams/exam-demo-isem-lgs-1/reports/students/student-a/progress") {
    return buildIsemProgress("exam-demo-isem-lgs-1");
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
            questionCount: 20,
            standardScore: 380,
          },
          branches: [
            { branch: "TÜRKÇE", net: 12.33 },
            { branch: "İNKILAP TARİHİ", net: 8 },
            { branch: "DİN KÜLTÜRÜ", net: 7.67 },
            { branch: "İNGİLİZCE", net: 9 },
            { branch: "MATEMATİK", net: 14.5 },
            { branch: "FEN BİLİMLERİ", net: 14 },
          ],
        },
        {
          snapshotId: "snapshot-a",
          generatedAt: "2026-06-08T09:00:00.000Z",
          total: {
            net: 17.5,
            questionCount: 20,
            standardScore: 420,
          },
          branches: [
            { branch: "TÜRKÇE", net: 13.33 },
            { branch: "İNKILAP TARİHİ", net: 8.67 },
            { branch: "DİN KÜLTÜRÜ", net: 8.67 },
            { branch: "İNGİLİZCE", net: 10 },
            { branch: "MATEMATİK", net: 20 },
            { branch: "FEN BİLİMLERİ", net: 16 },
          ],
        },
      ],
      netDelta: 3,
      standardScoreDelta: 40,
      successRateDelta: 15,
    };
  }

  if (path === "/exams/exam-demo/reports/students/student-b/progress") {
    return {
      tenantId: "tenant-a",
      examId: "exam-demo",
      studentId: "student-b",
      points: [
        {
          snapshotId: "snapshot-prev",
          generatedAt: "2026-05-25T09:00:00.000Z",
          total: {
            net: 12.33,
            questionCount: 20,
            standardScore: 370,
          },
        },
        {
          snapshotId: "snapshot-a",
          generatedAt: "2026-06-08T09:00:00.000Z",
          total: {
            net: 13.33,
            questionCount: 20,
            standardScore: 390,
          },
        },
      ],
      netDelta: 1,
      standardScoreDelta: 20,
      successRateDelta: 5,
    };
  }

  if (path === "/exams/exam-a/reports/students/student-a/progress") {
    return {
      tenantId: "tenant-a",
      examId: "exam-a",
      studentId: "student-a",
      points: [
        { snapshotId: "snapshot-prev", generatedAt: "2026-06-01T09:00:00.000Z", total: { net: 14.5, questionCount: 20, standardScore: 390 } },
        { snapshotId: "snapshot-optik-a", generatedAt: "2026-06-09T09:30:00.000Z", total: { net: 16.25, questionCount: 20, standardScore: 410 } },
      ],
      netDelta: 1.75,
      standardScoreDelta: 20,
      successRateDelta: 8.8,
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
      className: "8-A",
      campusName: "Merkez Kampüs",
      gradeLevelName: "8. Sınıf",
      section: "A",
      academicYearId: "academic-year-2026",
      termId: "term-2026-spring",
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
      courseId: "course-math",
      termId: "term-2026-spring",
      role: "CLASS_TEACHER",
      createdAt: "2026-06-08T09:40:00.000Z",
      updatedAt: "2026-06-08T09:40:00.000Z",
    }];
  }

  if (path === "/students/student-a/enrollments") {
    return [{
      id: "student-enrollment-a",
      tenantId: "tenant-a",
      studentId: "student-a",
      academicYearId: "academic-year-2026",
      termId: "term-2026-spring",
      classId: "class-a",
      className: "8-A",
      campusName: "Merkez Kampüs",
      gradeLevelName: "8. Sınıf",
      section: "A",
      status: "ACTIVE",
      startsAt: "2026-06-01",
      reason: "CREATED",
      createdAt: "2026-06-08T09:45:00.000Z",
      updatedAt: "2026-06-08T09:45:00.000Z",
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

function portalAnnouncement(
  id: string,
  title: string,
  audience: AnnouncementFixture["audience"],
  readAt?: string,
): AnnouncementFixture {
  return {
    id,
    tenantId: "tenant-a",
    title,
    body: `${title} metni`,
    audience,
    classId: "class-a",
    publishedAt: "2026-06-09T09:00:00.000Z",
    ...(readAt ? { readAt } : {}),
  };
}

function auditActionLabel(action: string) {
  if (action.startsWith("auth.login")) return "Oturum açıldı";
  if (action.startsWith("auth.")) return "Kimlik olayı";
  if (action.startsWith("identity_invitation.")) return "Davet olayı";
  if (action.startsWith("kvkk.")) return "KVKK olayı";
  if (action.startsWith("tenant.")) return "Kurum olayı";
  if (action.startsWith("user.") && action.includes("finance")) return "Finans görünürlüğü güncellendi";
  if (action.startsWith("user.")) return "Kullanıcı kaydı güncellendi";
  const labels: Record<string, string> = {
    "announcement.created": "Duyuru oluşturuldu",
    "guardian_student.linked": "Veli ilişkisi kuruldu",
    "guardian_student.unlinked": "Veli ilişkisi kaldırıldı",
    "guardian_student.updated": "Veli ilişkisi güncellendi",
    "student.created": "Öğrenci oluşturuldu",
    "student.deleted": "Öğrenci silindi",
    "student.profile_updated": "Profil güncellendi",
    "student.profile_viewed": "Profil görüntülendi",
    "student.updated": "Öğrenci bilgisi güncellendi",
  };
  return labels[action] ?? "Öğrenci denetim kaydı";
}

function auditCategory(action: string, entityType: string) {
  const normalizedAction = auditText(action);
  const normalizedEntity = auditText(entityType);
  const combined = `${normalizedAction} ${normalizedEntity}`;
  if (normalizedAction.startsWith("auth.") || combined.includes("rolepreviewtoken")) return "identity";
  if (normalizedAction.startsWith("identity_invitation.") || combined.includes("invitation")) return "invitation";
  if (normalizedAction.startsWith("kvkk.") || combined.includes("kvkk")) return "kvkk";
  if (normalizedAction.startsWith("tenant.") || combined.includes("tenant")) return "tenant";
  if (combined.includes("finance") || combined.includes("payment")) return "finance";
  if (normalizedAction.startsWith("report.") || combined.includes("report")) return "report";
  if (
    normalizedAction.startsWith("student.") ||
    normalizedAction.startsWith("guardian_student.") ||
    normalizedAction.startsWith("announcement.") ||
    normalizedAction.startsWith("exam.") ||
    normalizedAction.startsWith("course.") ||
    normalizedAction.startsWith("class.")
  ) {
    return "academic";
  }
  if (normalizedAction.startsWith("user.") || combined.includes("user") || combined.includes("guardian")) return "user";
  return "operation";
}

function auditEntityLabel(entityType: string, action: string) {
  const combined = `${auditText(entityType)} ${auditText(action)}`;
  if (combined.includes("auth")) return "Kimlik kaydı";
  if (combined.includes("invitation")) return "Davet kaydı";
  if (combined.includes("finance") || combined.includes("payment")) return "Finans görünürlüğü kaydı";
  if (combined.includes("guardian_student")) return "Veli ilişki kaydı";
  if (combined.includes("guardian")) return "Veli kaydı";
  if (combined.includes("student")) return "Öğrenci kaydı";
  if (combined.includes("teacher")) return "Öğretmen kaydı";
  if (combined.includes("user")) return "Kullanıcı kaydı";
  if (combined.includes("tenant")) return "Kurum kaydı";
  if (combined.includes("kvkk")) return "KVKK kaydı";
  if (combined.includes("report")) return "Rapor kaydı";
  if (combined.includes("exam")) return "Sınav kaydı";
  if (combined.includes("announcement")) return "Duyuru kaydı";
  return "Operasyon kaydı";
}

function auditText(value: string) {
  return value.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

function announcementRecipientReport(announcementId: string) {
  return {
    announcementId,
    total: 3,
    read: 1,
    unread: 2,
    recipients: [
      {
        announcementId,
        recipientType: "GUARDIAN",
        subjectId: "guardian-a",
        userId: "guardian-tenant-a",
        displayName: "Zeynep Veli",
        relatedStudentId: "student-a",
        relatedStudentName: "Ada A",
        readAt: "2026-06-10T10:05:00.000Z",
      },
      {
        announcementId,
        recipientType: "STUDENT",
        subjectId: "student-a",
        userId: "student-tenant-a",
        displayName: "Ada A",
      },
      {
        announcementId,
        recipientType: "TEACHER",
        subjectId: "teacher-a",
        userId: "teacher-tenant-a",
        displayName: "Ayse Ogretmen",
      },
    ],
  };
}
