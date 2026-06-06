import { createHash } from "node:crypto";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const corsHeaders = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "authorization,content-type,x-csrf-token",
  "access-control-allow-methods": "DELETE,GET,PATCH,POST,OPTIONS",
  "access-control-allow-origin": "http://localhost:3001",
};

function heading(page: Page, options: Parameters<Page["getByRole"]>[1]) {
  return page.getByRole("heading", options).first();
}

async function expandSidebarGroup(page: Page, name: string) {
  const groupButton = page.getByRole("button", { name, exact: true });
  if ((await groupButton.getAttribute("aria-expanded")) !== "true") {
    await groupButton.click();
  }
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

async function captureKarneVisualEvidence(page: Page, testInfo: TestInfo, label: string) {
  await captureVisualEvidence(page, testInfo, "Öğrenci karne özeti", label);
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
        total: { net: 82.01, standardScore: 430 },
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
        total: { net: 84.66, standardScore: 440 },
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
        total: { net: 79.33, standardScore: 410 },
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
        total: { net: 80.67, standardScore: 420 },
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
        total: { net: 83.34, standardScore: 435 },
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
  const sourceCode = sourceClass.gradeLevelId ? gradeLevelById.get(sourceClass.gradeLevelId)?.code : sourceClass.level;
  if (!sourceCode || !/^\d+$/.test(sourceCode)) return undefined;
  const targetCode = String(Number.parseInt(sourceCode, 10) + 1);
  return classes.find((klass) =>
    klass.id !== sourceClass.id &&
    (klass.gradeLevelId ? gradeLevelById.get(klass.gradeLevelId)?.code : klass.level) === targetCode &&
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
  relationshipType: "MOTHER" | "FATHER" | "GUARDIAN" | "EMERGENCY_CONTACT" | "OTHER";
  isPrimary: boolean;
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
  status: "PENDING" | "ACCEPTED";
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
  contentHash?: string;
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
  test.setTimeout(60_000);

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
    { id: "class-a", tenantId: "tenant-a", name: "8-A", level: "8", campusId: "campus-main", gradeLevelId: "grade-8", section: "A" },
    { id: "class-b", tenantId: "tenant-a", name: "8-B", level: "8", campusId: "campus-main", gradeLevelId: "grade-8", section: "B" },
  ];
  let campuses: CampusFixture[] = [
    { id: "campus-main", tenantId: "tenant-a", name: "Merkez Kampüs", code: "MRK" },
  ];
  let gradeLevels: GradeLevelFixture[] = [
    { id: "grade-8", tenantId: "tenant-a", name: "8. Sınıf", code: "8" },
  ];
  const reportGenerationRequests: ReportGenerationRequestFixture[] = [];
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
      startsAt: "2026-06-08T09:00:00.000Z",
      createdAt: "2026-06-01T09:00:00.000Z",
      updatedAt: "2026-06-01T09:00:00.000Z",
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
      relationshipType: "MOTHER",
      isPrimary: true,
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

  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.continue();
  });

  await page.route("**/auth/refresh", async (route) => {
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
        "# TYPE uzman_hocam_process_uptime_seconds gauge",
        "uzman_hocam_process_uptime_seconds 123.4",
        "# TYPE uzman_hocam_http_requests_total counter",
        "uzman_hocam_http_requests_total{method=\"GET\",path=\"/health\",status=\"200\"} 3",
        "uzman_hocam_http_requests_total{method=\"GET\",path=\"/api/v1/students\",status=\"200\"} 4",
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
        relationshipType: body.relationshipType ?? "GUARDIAN",
        isPrimary: body.isPrimary ?? false,
        canViewFinance: body.canViewFinance ?? true,
        canReceiveSms: body.canReceiveSms ?? true,
        canReceiveAnnouncements: body.canReceiveAnnouncements ?? true,
        canOpenSupportTickets: body.canOpenSupportTickets ?? true,
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

    if (path === "/announcements" && request.method() === "POST") {
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

    if (path === "/exams/exam-a/answer-keys/imports" && request.method() === "POST") {
      const body = request.postDataJSON() as { version: string; fileBase64: string };
      expect(body.version).toBe(observedAnswerKeyVersion);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 201,
        body: JSON.stringify(envelope({
          imported: true,
          answerKey: {
            id: "answer-key-a",
            tenantId: "tenant-a",
            examId: "exam-a",
            version: body.version,
            questionCount: 90,
            branches: [{ branch: "LGS TÜRKÇE", questionCount: 20 }],
            scoringConfig: { wrongPenalty: 1 / 3 },
            status: "DRAFT",
            createdAt: "2026-06-09T09:15:00.000Z",
            updatedAt: "2026-06-09T09:15:00.000Z",
          },
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
            s3Key: `raw-imports/tenant-a/exam-a/${parserConfigVersion}/hash/optik-a.txt`,
            sha256: "abcdef1234567890",
            parserConfigVersion,
          },
          parseJob: { queueName: "optical-parse", jobId: "parse-job-a", status: "queued" },
          status: "uploaded",
        })),
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
        contentHash: "abcdef1234567890",
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
      const body = request.postDataJSON() as { title: string; startsAt?: string };
      const created: ExamFixture = {
        id: exams.some((exam) => exam.id === "exam-a") ? `exam-created-${exams.length + 1}` : "exam-a",
        tenantId: "tenant-a",
        title: body.title.trim(),
        status: "DRAFT",
        ...(body.startsAt ? { startsAt: body.startsAt } : {}),
        createdAt: "2026-06-09T09:00:00.000Z",
        updatedAt: "2026-06-09T09:00:00.000Z",
      };
      exams = [created, ...exams];
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
        path === "/exams/exam-a/reports/snapshots"
      ) &&
      request.method() === "GET"
    ) {
      const url = new URL(request.url());
      const snapshots = (readFixture(path) as ReportSnapshotFixture[]).filter((snapshot) =>
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
          jobId: `${examId}_${body.contentHash ?? "results-v1"}`,
          status: "queued",
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

  await page.getByLabel("E-posta").fill("admin-a@example.test");
  await page.getByLabel("Şifre").fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page).toHaveURL(/\/kurum$/);
  await expect(heading(page, { name: "DNA EĞİTİM KURUMU" })).toBeVisible();
  await expect(page.getByLabel("Kurum özeti").locator("article").filter({ hasText: "Sınıf" }).getByText("2")).toBeVisible();
  await expect(page.getByLabel("Kurum özeti").locator("article").filter({ hasText: "Öğretmen" }).getByText("1")).toBeVisible();
  await expect(page.getByLabel("Kurum özeti").locator("article").filter({ hasText: "Öğrenci" }).getByText("3")).toBeVisible();
  await expect(page.getByLabel("Karar sinyalleri").getByRole("link", { name: /Bekleyen destek 1/ })).toBeVisible();
  await expect(page.getByLabel("Karar sinyalleri").getByRole("link", { name: /Geciken ödeme 1/ })).toBeVisible();
  await expect(page.getByLabel("Karar sinyalleri").getByRole("link", { name: /Devamsızlık 1/ })).toBeVisible();
  await expect(page.getByLabel("Karar sinyalleri").getByRole("link", { name: /Optik kontrol 1/ })).toBeVisible();
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
  await expect(page.getByText("Eğitim", { exact: true })).toBeVisible();
  await expect(page.getByText("Sınav ve Analiz", { exact: true })).toBeVisible();
  await expect(page.getByText("İçerik", { exact: true })).toBeVisible();
  await expect(page.getByText("Finans ve Destek", { exact: true })).toBeVisible();
  await expect(page.getByText("Yönetim", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Denetim", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "KVKK" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Güvenlik Denetimi" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Gözlemlenebilirlik" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "UAT / Rollback" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Canlı Yayın" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sistem Sağlığı" })).toHaveCount(0);
  await expandSidebarGroup(page, "Kişiler");
  await expandSidebarGroup(page, "Yönetim");
  await expect(page.getByRole("link", { name: "Yedekleme" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kullanıcılar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Rol Önizleme" })).toBeVisible();
  await expandSidebarGroup(page, "Eğitim");
  await expect(page.getByRole("link", { name: "Kampüsler" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Takvim" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Seviyeler" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sınıflar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Dersler" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Program" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Etütler" })).toBeVisible();
  await expandSidebarGroup(page, "Sınav ve Analiz");
  await expandSidebarGroup(page, "İçerik");
  await expandSidebarGroup(page, "Finans ve Destek");
  await expect(page.getByRole("link", { name: "Öğretmen Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğrenci Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Veli Portalı" })).toBeHidden();
  await expect(page.getByText("tenant-a", { exact: true })).toBeVisible();
  await expect(page.getByText("user-tenant-a", { exact: true })).toBeVisible();
  expect(loginCount).toBe(1);
  await page.keyboard.press("ControlOrMeta+K");
  const commandDialog = page.getByRole("dialog", { name: "Komut paleti" });
  await expect(commandDialog).toBeVisible();
  await commandDialog.getByLabel("Komut ara").fill("finans");
  await commandDialog.getByRole("button", { name: /Ödemeler/ }).click();
  await expect(page).toHaveURL(/\/kurum\/finans$/);
  await expect(heading(page, { name: "Finans" })).toBeVisible();
  await expect(page.getByLabel("Son kullanılanlar")).toHaveCount(0);
  await expandSidebarGroup(page, "Başlangıç");
  await page.getByRole("link", { name: "Özet", exact: true }).click();
  await expect(heading(page, { name: "DNA EĞİTİM KURUMU" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  const workflowDialog = page.getByRole("dialog", { name: "Komut paleti" });
  await expect(workflowDialog).toBeVisible();
  await workflowDialog.getByLabel("Komut ara").fill("dönem");
  await workflowDialog.getByRole("button", { name: /Yeni dönem açılışı/ }).click();
  await expect(page).toHaveURL(/\/kurum\/kurulum$/);
  await expect(heading(page, { name: "Kurulum" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  const examCloseDialog = page.getByRole("dialog", { name: "Komut paleti" });
  await expect(examCloseDialog).toBeVisible();
  await examCloseDialog.getByLabel("Komut ara").fill("sınav sonrası");
  await examCloseDialog.getByRole("button", { name: /Sınav sonrası kapanış/ }).click();
  await expect(page).toHaveURL(/\/kurum\/raporlar$/);
  await expect(heading(page, { name: "Sınav Raporu" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  const entityDialog = page.getByRole("dialog", { name: "Komut paleti" });
  await entityDialog.getByLabel("Komut ara").fill("Ayse");
  await entityDialog.getByLabel("Varlık araması").getByRole("button", { name: /Ayse Ogretmen/ }).click();
  await expect(page).toHaveURL(/\/kurum\/ogretmenler\/teacher-a$/);
  await expect(heading(page, { name: "Ayse Ogretmen" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen özeti").getByText("Matematik")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  const studentEntityDialog = page.getByRole("dialog", { name: "Komut paleti" });
  await studentEntityDialog.getByLabel("Komut ara").fill("Ada");
  await studentEntityDialog.getByLabel("Varlık araması").getByRole("button", { name: /Ada A/ }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler\/student-a$/);
  await expect(heading(page, { name: "Ada A" })).toBeVisible();
  await expect(page.getByLabel("Öğrenci dashboard", { exact: true }).getByText("Aktif", { exact: true })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  const guardianEntityDialog = page.getByRole("dialog", { name: "Komut paleti" });
  await guardianEntityDialog.getByLabel("Komut ara").fill("Zeynep");
  await guardianEntityDialog.getByLabel("Varlık araması").getByRole("button", { name: /Zeynep Veli/ }).click();
  await expect(page).toHaveURL(/\/kurum\/veliler\/guardian-a$/);
  await expect(heading(page, { name: "Zeynep Veli" })).toBeVisible();
  await expect(page.getByLabel("Veli özeti").getByText("5550000000")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  const classEntityDialog = page.getByRole("dialog", { name: "Komut paleti" });
  await classEntityDialog.getByLabel("Komut ara").fill("8-A");
  await classEntityDialog.getByLabel("Varlık araması").getByRole("button", { name: /8-A/ }).click();
  await expect(page).toHaveURL(/\/kurum\/siniflar\/class-a$/);
  await expect(heading(page, { name: "8-A" })).toBeVisible();
  await expect(page.getByLabel("Sınıf özeti").getByText("8. Sınıf")).toBeVisible();

  await page.getByRole("link", { name: "Kullanıcılar" }).click();
  await expect(page).toHaveURL(/\/kurum\/kullanicilar$/);
  await expect(heading(page, { name: "Kullanıcılar" })).toBeVisible();
  await expect(page.getByText("Admin A")).toBeVisible();
  await expect(heading(page, { name: "Davetler" })).toBeVisible();
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

  await page.getByRole("link", { name: "Kampüsler" }).click();
  await expect(page).toHaveURL(/\/kurum\/kampusler$/);
  await expect(heading(page, { name: "Kampüsler" })).toBeVisible();
  await expect(page.getByText("Merkez Kampüs")).toBeVisible();
  await expect(page.getByText("1 kayıt")).toBeVisible();

  await page.getByRole("button", { name: "Kampüs ekle" }).click();
  await page.getByLabel("Kampüs adı", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Kampüs yönetimi").getByText("Kampüs adı zorunludur.")).toBeVisible();
  await page.getByLabel("Kampüs adı", { exact: true }).fill(" Kuzey Kampüs ");
  await page.getByLabel("Kod", { exact: true }).fill(" KZY ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Kuzey Kampüs")).toBeVisible();

  await page.getByRole("button", { name: "Kuzey Kampüs düzenle" }).click();
  await page.getByLabel("Kampüs adı", { exact: true }).fill("Kuzey Şube");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Kuzey Şube")).toBeVisible();
  await expect(page.getByText("Kuzey Kampüs")).toBeHidden();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Kuzey Şube sil" }).click();
  await expect(page.getByText("Kuzey Şube")).toBeHidden();

  await page.getByRole("link", { name: "Takvim" }).click();
  await expect(page).toHaveURL(/\/kurum\/akademik-takvim$/);
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

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Güz Dönemi dönemini sil" }).click();
  await expect(page.getByLabel("Akademik dönem yönetimi").getByText("Güz Dönemi")).toBeHidden();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "2026-27 yılını sil" }).click();
  await expect(page.getByLabel("Akademik yıl yönetimi").getByText("2026-27")).toBeHidden();

  await page.getByRole("link", { name: "Seviyeler" }).click();
  await expect(page).toHaveURL(/\/kurum\/seviyeler$/);
  await expect(heading(page, { name: "Seviyeler" })).toBeVisible();
  await expect(page.getByText("8. Sınıf")).toBeVisible();
  await expect(page.getByText("1 kayıt")).toBeVisible();

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

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Hazırlık sil" }).click();
  await expect(page.getByText("Hazırlık")).toBeHidden();

  await page.getByRole("link", { name: "Sınıflar" }).click();
  await expect(page).toHaveURL(/\/kurum\/siniflar$/);
  await expect(heading(page, { name: "Sınıflar" })).toBeVisible();
  await expect(page.getByText("8-A")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Merkez Kampüs" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "8. Sınıf" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "A", exact: true })).toBeVisible();
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
  const classDialog = page.getByRole("dialog", { name: "Sınıf ekle" });
  await classDialog.getByLabel("Sınıf adı", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Sınıf yönetimi").getByText("Sınıf adı zorunludur.")).toBeVisible();
  await classDialog.getByLabel("Sınıf adı", { exact: true }).fill(" 9-A ");
  await classDialog.getByRole("combobox", { name: "Seviye" }).selectOption("grade-8");
  await classDialog.getByLabel("Şube", { exact: true }).fill(" A ");
  await classDialog.getByRole("combobox", { name: "Kampüs" }).selectOption("campus-main");
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

  await page.getByRole("link", { name: "Dersler" }).click();
  await expect(page).toHaveURL(/\/kurum\/dersler$/);
  await expect(heading(page, { name: "Dersler" })).toBeVisible();
  await expect(page.getByText("Matematik")).toBeVisible();
  await expect(page.getByText("2 kayıt")).toBeVisible();

  await page.getByLabel("Ara").fill("Turkce");
  await expect(page.getByText("Turkce")).toBeVisible();
  await expect(page.getByText("Matematik")).toBeHidden();
  await page.getByLabel("Ara").fill("");

  await page.getByRole("button", { name: "Ders ekle" }).click();
  await page.getByLabel("Ders adı", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Ders yönetimi").getByText("Ders adı zorunludur.")).toBeVisible();
  await page.getByLabel("Ders adı", { exact: true }).fill(" Fen Bilimleri ");
  await page.getByLabel("Kod", { exact: true }).fill(" FEN ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Fen Bilimleri")).toBeVisible();

  await page.getByRole("button", { name: "Fen Bilimleri düzenle" }).click();
  await page.getByLabel("Ders adı", { exact: true }).fill("Fen");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Fen", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Fen Bilimleri", exact: true })).toBeHidden();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Fen sil" }).click();
  await expect(page.getByRole("cell", { name: "Fen", exact: true })).toBeHidden();

  await page.getByRole("link", { name: "Kazanımlar" }).click();
  await expect(page).toHaveURL(/\/kurum\/kazanimlar$/);
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

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "TUR.8.1.1 sil" }).click();
  await expect(page.getByRole("cell", { name: "Cümlede anlam", exact: true })).toBeHidden();

  await page.getByRole("link", { name: "Program" }).click();
  await expect(page).toHaveURL(/\/kurum\/program$/);
  await expect(heading(page, { name: "Ders Programı" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Matematik", exact: true }).first()).toBeVisible();
  await expect(page.getByText("1 kayıt")).toBeVisible();

  await page.getByLabel("Ara").fill("Matematik");
  await expect(page.getByRole("cell", { name: "Matematik", exact: true }).first()).toBeVisible();
  await page.getByLabel("Ara").fill("");

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

  page.once("dialog", (confirmDialog) => void confirmDialog.accept());
  await page.getByRole("button", { name: "Analitik Geometri sil" }).click();
  await expect(page.getByRole("cell", { name: "Analitik Geometri", exact: true })).toBeHidden();

  await page.getByRole("link", { name: "Etütler" }).click();
  await expect(page).toHaveURL(/\/kurum\/etutler$/);
  await expect(heading(page, { name: "Etütler" })).toBeVisible();
  await expect(page.getByText("Matematik Etut")).toBeVisible();
  await expect(page.getByText("1 kayıt")).toBeVisible();

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

  page.once("dialog", (confirmDialog) => void confirmDialog.accept());
  await page.getByRole("button", { name: "Problem Tekrarı sil" }).click();
  await expect(page.getByRole("cell", { name: "Problem Tekrarı", exact: true })).toBeHidden();

  await page.getByRole("link", { name: "Devamsızlık" }).click();
  await expect(page).toHaveURL(/\/kurum\/devamsizlik$/);
  await expect(heading(page, { name: "Devamsızlık" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Ada A", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Matematik", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "2. Donem", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Yok", exact: true })).toBeVisible();
  await page.getByLabel("Sınıf").selectOption("class-b");
  await expect(page.getByRole("cell", { name: "Ada A", exact: true })).toBeHidden();
  await page.getByLabel("Sınıf").selectOption("");
  await expect(page.getByRole("cell", { name: "Ada A", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Devamsızlık ekle" }).click();
  dialog = page.getByRole("dialog", { name: "Devamsızlık ekle" });
  await dialog.getByLabel("Öğrenci").selectOption("student-b");
  await dialog.getByLabel("Ders").selectOption("course-math");
  await dialog.getByLabel("Dönem").selectOption("term-2026-spring");
  await dialog.getByLabel("Tarih").fill("2026-06-04");
  await dialog.getByLabel("Durum").selectOption("LATE");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Bora B", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Geç", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Bora B devamsızlığını düzenle" }).click();
  dialog = page.getByRole("dialog", { name: "Devamsızlık düzenle" });
  await dialog.getByLabel("Durum").selectOption("EXCUSED");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("cell", { name: "İzinli", exact: true })).toBeVisible();

  page.once("dialog", (confirmDialog) => void confirmDialog.accept());
  await page.getByRole("button", { name: "Bora B devamsızlığını sil" }).click();
  await expect(page.getByRole("cell", { name: "Bora B", exact: true })).toBeHidden();

  await page.getByRole("link", { name: "Notlar" }).click();
  await expect(page).toHaveURL(/\/kurum\/notlar$/);
  await expect(heading(page, { name: "Öğretmen Notları" })).toBeVisible();
  await expect(page.getByText("Dikkat takibi iç notu")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Matematik", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "2. Donem", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "İç not", exact: true })).toBeVisible();
  await page.getByLabel("Sınıf").selectOption("class-b");
  await expect(page.getByText("Dikkat takibi iç notu")).toBeHidden();
  await page.getByLabel("Sınıf").selectOption("");
  await expect(page.getByText("Dikkat takibi iç notu")).toBeVisible();

  await page.getByRole("button", { name: "Not ekle" }).click();
  dialog = page.getByRole("dialog", { name: "Not ekle" });
  await dialog.locator("select").nth(0).selectOption("student-b");
  await dialog.locator("select").nth(1).selectOption("teacher-a");
  await dialog.locator("select").nth(2).selectOption("course-math");
  await dialog.locator("select").nth(3).selectOption("term-2026-spring");
  await dialog.locator("select").nth(4).selectOption("GUARDIAN_STUDENT");
  await dialog.getByLabel("Gelişim durumu").fill("FOCUS");
  await dialog.getByLabel("Not", { exact: true }).fill("Problem çözümü güçleniyor.");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Problem çözümü güçleniyor.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Veli/öğrenci görür", exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Bora B notunu düzenle" }).click();
  dialog = page.getByRole("dialog", { name: "Not düzenle" });
  await dialog.getByLabel("Not", { exact: true }).fill("Problem çözümü düzenli.");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Problem çözümü düzenli.")).toBeVisible();

  page.once("dialog", (confirmDialog) => void confirmDialog.accept());
  await page.getByRole("button", { name: "Bora B notunu sil" }).click();
  await expect(page.getByText("Problem çözümü düzenli.")).toBeHidden();

  await page.getByRole("link", { name: "Öğretmenler" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogretmenler$/);
  await expect(heading(page, { name: "Öğretmenler" })).toBeVisible();
  await expect(page.getByText("Ayse Ogretmen")).toBeVisible();

  await page.getByRole("link", { name: "Ayse portal daveti gönder" }).click();
  await expect(page).toHaveURL(/\/kurum\/kullanicilar\?invite=teacher&subjectId=teacher-a$/);
  dialog = page.getByRole("dialog", { name: "Davet oluştur" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Kişi türü")).toHaveValue("TEACHER");
  await expect(dialog.getByRole("combobox").nth(1)).toHaveValue("teacher-a");
  await expect(dialog.getByLabel("Ad Soyad")).toHaveValue("Ayse Ogretmen");
  await dialog.getByLabel("E-posta").fill("ayse.portal@example.test");
  await page.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.getByLabel("Son aktivasyon tokenı").getByText("ayse.portal@example.test")).toBeVisible();
  await expect(page.getByLabel("Son aktivasyon tokenı").getByText("activation-token-created")).toBeVisible();

  await page.getByRole("link", { name: "Öğretmenler" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogretmenler$/);

  await page.getByRole("button", { name: "Ayse düzenle" }).click();
  await expect(page.getByLabel("Öğretmen atamaları").getByText("Sınıf öğretmeni · 8-A · Matematik · 2. Donem")).toBeVisible();
  await page.getByLabel("Atama rolü").selectOption("GUIDANCE_COUNSELOR");
  await page.getByLabel("Atama öğrencisi").selectOption("student-a");
  await page.getByLabel("Atama branşı").selectOption("course-math");
  await page.getByLabel("Atama dönemi").selectOption("term-2026-spring");
  await page.getByRole("button", { name: "Atama ekle" }).click();
  await expect(page.getByLabel("Öğretmen atamaları").getByText("Rehber öğretmen · Ada A · Matematik · 2. Donem")).toBeVisible();
  expect(teacherAssignments.find((assignment) => assignment.id === "teacher-assignment-created")?.courseId).toBe("course-math");
  expect(teacherAssignments.find((assignment) => assignment.id === "teacher-assignment-created")?.termId).toBe("term-2026-spring");
  await page.getByRole("button", { name: "Rehber öğretmen atamasını sil" }).click();
  await expect(page.getByLabel("Öğretmen atamaları").getByText("Rehber öğretmen · Ada A · Matematik · 2. Donem")).toBeHidden();
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

  await page.getByRole("link", { name: "Veliler", exact: true }).click();
  await expect(page).toHaveURL(/\/kurum\/veliler$/);
  await expect(heading(page, { name: "Veliler" })).toBeVisible();
  await expect(page.getByText("Zeynep Veli")).toBeVisible();

  await page.getByRole("link", { name: "Zeynep detay" }).click();
  await expect(page).toHaveURL(/\/kurum\/veliler\/guardian-a$/);
  await expect(heading(page, { name: "Zeynep Veli" })).toBeVisible();
  await expect(page.getByLabel("Veli öğrenci bağlantıları").getByText("Ada A - Anne / Birincil")).toBeVisible();
  await page.getByLabel("Veli öğrenci bağı ekle").getByLabel("Öğrenci").selectOption("student-b");
  await page.getByLabel("Veli öğrenci bağı ekle").getByLabel("İlişki").selectOption("FATHER");
  await page.getByRole("button", { name: "Bağla" }).click();
  await expect(page.getByLabel("Veli öğrenci bağlantıları").getByText("Bora B - Baba / Birincil")).toBeVisible();

  await page.getByRole("link", { name: "Portal daveti gönder" }).click();
  await expect(page).toHaveURL(/\/kurum\/kullanicilar\?invite=guardian&subjectId=guardian-a$/);
  dialog = page.getByRole("dialog", { name: "Davet oluştur" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Kişi türü")).toHaveValue("GUARDIAN");
  await expect(dialog.getByRole("combobox").nth(1)).toHaveValue("guardian-a");
  await expect(dialog.getByLabel("Ad Soyad")).toHaveValue("Zeynep Veli");
  await dialog.getByLabel("E-posta").fill("zeynep.portal@example.test");
  await page.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.getByLabel("Son aktivasyon tokenı").getByText("zeynep.portal@example.test")).toBeVisible();

  await page.getByRole("link", { name: "Veliler", exact: true }).click();
  await expect(page).toHaveURL(/\/kurum\/veliler$/);

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

  gradeLevels = [...gradeLevels, { id: "grade-9", tenantId: "tenant-a", name: "9. Sınıf", code: "9" }];
  classes = [...classes, { id: "class-c", tenantId: "tenant-a", name: "9-A", level: "9", campusId: "campus-main", gradeLevelId: "grade-9", section: "A" }];

  await page.getByRole("link", { name: "Öğrenciler" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler$/);
  await expect(heading(page, { name: "Öğrenciler" })).toBeVisible();
  await expect(page.getByText("Ada A")).toBeVisible();
  const studentTableView = page.getByLabel("Öğrenci tablo görünümü");
  await studentTableView.getByLabel("Sorumlu").uncheck();
  await expect(page.getByRole("columnheader", { name: "Sorumlu öğretmen" })).toBeHidden();
  await studentTableView.getByLabel("Görünüm").selectOption("compact");
  await expect(page).toHaveURL(/density=compact/);
  await studentTableView.getByLabel("Sorumlu").check();
  await expect(page.getByRole("columnheader", { name: "Sorumlu öğretmen" })).toBeVisible();
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
  await expect(page.getByLabel("Öğrenci 360").getByText("Aktif", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("Sınıf geçmişi")).toBeVisible();
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
  await expect(page.getByLabel("Öğrenci 360").getByText("class-b")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("1.000,00 TRY")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("76,67")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("2 soru")).toBeVisible();
  await expect(page.getByLabel("Öğrenci 360").getByText("Dikkat takibi iç notu")).toBeVisible();
  await page.getByLabel("Kayıt durumu").selectOption("GRADUATED");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Mezun" })).toBeVisible();
  await page.getByRole("button", { name: "Ada düzenle" }).click();
  await page.getByLabel("Kayıt durumu").selectOption("ACTIVE");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();

  await page.getByRole("link", { name: "Ada öğrenci dashboard" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler\/student-a$/);
  await expect(heading(page, { name: "Ada A" })).toBeVisible();
  const studentDashboard = page.getByLabel("Öğrenci dashboard", { exact: true });
  await expect(studentDashboard.getByText("Aktif", { exact: true })).toBeVisible();
  await expect(studentDashboard.getByText("17,5", { exact: true })).toBeVisible();
  await expect(studentDashboard.getByText("2 soru", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğretmen notları").getByText("Problem çözme rutini güçleniyor.")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi").getByText("Zeynep Veli")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi").getByText("Anne - Birincil")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi").getByText("Ödeme görür, SMS alır")).toBeVisible();
  await expect(page.getByLabel("İlişki geçmişi").getByText("Destek kapalı")).toBeVisible();
  await expect(page.getByLabel("Öğretmen ilişkileri").getByText("Ayse Ogretmen")).toBeVisible();
  await expect(page.getByLabel("Öğretmen ilişkileri").getByText("Sınıf öğretmeni")).toBeVisible();
  await expect(page.getByLabel("Öğretmen ilişkileri").getByText("8-A · Matematik · 2. Donem")).toBeVisible();
  await expect(page.getByLabel("Sınıf geçmişi").getByText("class-a")).toBeVisible();
  await expect(page.getByLabel("Sınıf geçmişi").getByText("academic-year-2026 / term-2026-spring")).toBeVisible();
  await expect(page.getByLabel("Sınıf geçmişi").getByText("devam ediyor")).toBeVisible();
  await expect(page.getByLabel("Kayıt geçmişi").getByText("İlk kayıt")).toBeVisible();
  await expect(page.getByLabel("Kayıt geçmişi").getByText("Kayıt yenileme")).toBeVisible();
  await expect(page.getByLabel("Kayıt geçmişi").getByText("Nakil")).toBeVisible();
  await expect(page.getByLabel("Kayıt geçmişi").getByText("8-B")).toBeVisible();
  await expect(page.getByLabel("Kayıt geçmişi").getByText("academic-year-2026 / term-2026-spring").first()).toBeVisible();
  await expect(page.getByLabel("Denetim özeti").getByText("Öğrenci oluşturuldu")).toBeVisible();
  await expect(page.getByLabel("Denetim özeti").getByText("Veli ilişkisi kuruldu")).toBeVisible();
  await studentDashboard.getByRole("link", { name: "Sınav detayları" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler\/student-a\/sinavlar$/);
  const studentExamDetails = page.getByLabel("Öğrenci sınav detayları", { exact: true });
  await studentExamDetails.getByLabel("Sınav raporu", { exact: true }).selectOption("snapshot-b");
  await expect(page.getByLabel("Sınav rapor özeti").getByText("19,25", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Sınav rapor özeti").getByText("1 soru", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Öğrencilere dön" }).click();
  await expect(page).toHaveURL(/\/kurum\/ogrenciler$/);
  await page.getByLabel("Toplu dönem geçişi").getByLabel("Geçiş tarihi").fill("2026-06-08");
  await page.getByLabel("Toplu dönem geçişi").getByLabel("8-B hedefi").selectOption("class-a");
  await page.getByRole("button", { name: "Listelenenleri geçir" }).click();
  await expect(page.getByRole("cell", { name: "8-A", exact: true }).first()).toBeVisible();
  expect(studentEnrollments.some((record) => record.studentId === "student-a" && record.reason === "RENEWED" && record.startsAt === "2026-06-08")).toBe(true);
  await page.getByLabel("Toplu dönem geçişi").getByLabel("Geçiş tarihi").fill("2026-06-09");
  await page.getByLabel("Otomatik seviye yükselt").check();
  await page.getByRole("button", { name: "Listelenenleri geçir" }).click();
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

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Deniz sil" }).click();
  await expect(page.getByText("Deniz Güncel")).toBeHidden();

  await page.getByRole("link", { name: "Duyurular" }).click();
  await expect(page).toHaveURL(/\/kurum\/duyurular$/);
  await expect(heading(page, { name: "Duyurular" })).toBeVisible();
  await expect(page.getByText("Haftalık toplantı")).toBeVisible();
  await page.getByRole("row", { name: /Haftalık toplantı/ }).getByRole("button", { name: "Alıcılar" }).click();
  await expect(page.getByLabel("Duyuru alıcı raporu").getByText("Toplam: 3")).toBeVisible();
  await expect(page.getByLabel("Duyuru alıcı raporu").getByText("Bekleyen: 2")).toBeVisible();
  await expect(page.getByLabel("Duyuru alıcı raporu").getByText("Zeynep Veli")).toBeVisible();

  await page.getByRole("button", { name: "Duyuru ekle" }).click();
  await page.getByLabel("Başlık", { exact: true }).fill("   ");
  await page.getByLabel("Duyuru metni", { exact: true }).fill("Geçici metin");
  await page.getByRole("button", { name: "Yayınla", exact: true }).click();
  await expect(page.getByLabel("Duyuru yönetimi").getByText("Başlık zorunludur.")).toBeVisible();
  await page.getByLabel("Başlık", { exact: true }).fill(" Sınav hazırlığı ");
  await page.getByLabel("Duyuru metni", { exact: true }).fill(" Cuma deneme sınavı yapılacaktır. ");
  await page.getByRole("combobox", { name: "Hedef" }).selectOption("GUARDIANS");
  await page.getByRole("combobox", { name: "Kampüs" }).selectOption("campus-main");
  await page.getByRole("combobox", { name: "Seviye" }).selectOption("grade-8");
  await page.getByRole("combobox", { name: "Sınıf" }).selectOption("class-a");
  await page.getByRole("combobox", { name: "Ders" }).selectOption("course-math");
  await page.getByRole("combobox", { name: "Dönem" }).selectOption("term-2026-spring");
  await page.getByRole("button", { name: "Yayınla", exact: true }).click();
  await expect(page.getByText("Sınav hazırlığı")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Veliler", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Sınav hazırlığı/ }).getByText("Merkez Kampüs / 8. Sınıf / 8-A / Matematik / 2. Donem")).toBeVisible();
  await page.getByRole("row", { name: /Sınav hazırlığı/ }).getByRole("button", { name: "Alıcılar" }).click();
  await expect(page.getByLabel("Duyuru SMS gönderimi").getByText("SMS gönderimi")).toBeVisible();
  await page.getByLabel("Duyuru SMS gönderimi").getByRole("combobox", { name: "SMS şablonu" }).selectOption("message-template-a");
  await page.getByLabel("Duyuru SMS gönderimi").getByRole("button", { name: "SMS gönder" }).click();
  await expect(page.getByLabel("Duyuru SMS gönderimi").getByText("1 alıcı kuyruğa alındı.")).toBeVisible();
  await expect(page.getByLabel("Duyuru SMS gönderimi").getByLabel("SMS teslim raporu").getByText("completed")).toBeVisible();
  await page.getByRole("button", { name: "Kapat" }).click();
  await page.getByLabel("Ara").fill("Sınav");
  await expect(page.getByText("Sınav hazırlığı")).toBeVisible();
  await expect(page.getByText("Haftalık toplantı")).toBeHidden();
  await page.getByLabel("Ara").fill("");
  await page.getByLabel("Sırala").selectOption("-title");
  await expect(page.getByText("2 kayıt")).toBeVisible();

  await page.getByRole("link", { name: "Materyaller" }).click();
  await expect(page).toHaveURL(/\/kurum\/materyaller$/);
  await expect(heading(page, { name: "Ödev Kontrolü" })).toBeVisible();
  await expect(heading(page, { name: "Materyal Havuzu" })).toBeVisible();
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

  await page.getByRole("link", { name: "Sınavlar" }).click();
  await expect(page).toHaveURL(/\/kurum\/sinavlar$/);
  await expect(heading(page, { name: "Sınavlar" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "LGS deneme sınavı", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sınav ekle" }).click();
  await page.getByLabel("Sınav adı", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByText("Sınav adı zorunludur.", { exact: true })).toBeVisible();
  await page.getByLabel("Sınav adı", { exact: true }).fill("Haziran Genel Deneme");
  await page.getByLabel("Başlangıç", { exact: true }).fill("2026-06-12T09:30");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Haziran Genel Deneme", exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: /Haziran Genel Deneme/ }).getByText("Taslak")).toBeVisible();
  await page.getByRole("button", { name: "Haziran Genel Deneme yayınla" }).click();
  await expect(page.getByRole("row", { name: /Haziran Genel Deneme/ }).getByRole("cell", { name: "Yayında" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Haziran Genel Deneme katılımcıları" }).click();
  const participantPanel = page.getByLabel("Sınav katılımcıları");
  await expect(participantPanel.getByRole("heading", { name: "Haziran Genel Deneme katılımcıları" })).toBeVisible();
  const singleParticipantPanel = participantPanel.getByLabel("Tekil katılımcı ekleme");
  await singleParticipantPanel.getByLabel("Öğrenci").selectOption("student-b");
  await singleParticipantPanel.getByLabel("Katılımcı no").fill("201");
  await singleParticipantPanel.getByLabel("Kitapçık").fill("B");
  await singleParticipantPanel.getByRole("button", { name: "Katılımcı ekle" }).click();
  await expect(participantPanel.getByRole("row", { name: /Bora B/ }).getByText("201")).toBeVisible();
  await expect(participantPanel.getByRole("row", { name: /Bora B/ }).getByText("Kayıtlı")).toBeVisible();
  const bulkParticipantPanel = participantPanel.getByLabel("Toplu katılımcı ekleme");
  await bulkParticipantPanel.getByLabel("Sınıf").selectOption("class-c");
  await bulkParticipantPanel.locator("select[multiple]").evaluate((element) => {
    const select = element as HTMLSelectElement;
    for (const option of Array.from(select.options)) {
      option.selected = option.value === "student-a";
    }
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await bulkParticipantPanel.getByRole("spinbutton", { name: "Başlangıç no" }).fill("301");
  await bulkParticipantPanel.getByRole("textbox", { name: "Kitapçık" }).fill("A");
  await bulkParticipantPanel.getByRole("button", { name: "Toplu ekle" }).click();
  await expect(participantPanel.getByRole("row", { name: /Ada A/ }).getByText("301")).toBeVisible();
  await expect(participantPanel.getByRole("row", { name: /Ada A/ }).getByText("Kayıtlı")).toBeVisible();

  await page.getByRole("link", { name: "Optik" }).click();
  await expect(page).toHaveURL(/\/kurum\/optik$/);
  await expect(heading(page, { name: "Format seç ve ilerle" })).toBeVisible();
  const opticalExamSelector = page.getByLabel("Sınav seçimi");
  await opticalExamSelector.getByLabel("Sınav seç", { exact: true }).selectOption("");
  await opticalExamSelector.getByLabel("Yeni sınav adı", { exact: true }).fill("Optik Yeni Deneme");
  await opticalExamSelector.getByLabel("Başlangıç", { exact: true }).fill("2026-06-13T09:00");
  await opticalExamSelector.getByRole("button", { name: "Sınav oluştur" }).click();
  await expect(opticalExamSelector.getByText("Seçili sınav: Optik Yeni Deneme")).toBeVisible();
  await expect(opticalExamSelector.getByLabel("Yeni sınav adı")).toHaveCount(0);
  await expect(opticalExamSelector.getByRole("button", { name: "Sınav oluştur" })).toHaveCount(0);
  await opticalExamSelector.getByLabel("Sınav seç", { exact: true }).selectOption("exam-a");
  await expect(opticalExamSelector.getByLabel("Yeni sınav adı")).toHaveCount(0);
  await expect(opticalExamSelector.getByRole("button", { name: "Sınav oluştur" })).toHaveCount(0);
  await expect(page.getByLabel("Format seç ve ilerle").getByText(`Sürüm: ${parserConfigVersion}`)).toBeVisible();
  await page.getByRole("button", { name: "Seç ve ilerle" }).click();
  const answerKeyImportPanel = page.getByLabel("Cevap anahtarı Excel import");
  await answerKeyImportPanel.getByLabel("Cevap anahtarı dosyası").setInputFiles({
    name: "cevap-anahtari.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("answer-key"),
  });
  await answerKeyImportPanel.getByRole("button", { name: "Ön kontrol" }).click();
  await expect(page.getByLabel("Cevap anahtarı özeti").getByText("90 soru doğrulandı.")).toBeVisible();
  await expect(page.getByLabel("Cevap anahtarı özeti").getByText("B: 90 soru")).toBeVisible();
  await page.getByRole("button", { name: "İçe aktar" }).click();
  await expect(page.getByLabel("Cevap anahtarı özeti").getByText(/haziran-genel-deneme-\d{4}-\d{2}-\d{2} içe aktarıldı\./)).toBeVisible();
  const manualAnswerKeyPanel = page.getByLabel("Manuel cevap anahtarı");
  await manualAnswerKeyPanel.getByLabel("90 şık dizisi").fill("A".repeat(90));
  await manualAnswerKeyPanel.getByLabel("B kitapçık sırası").fill(Array.from({ length: 90 }, (_unused, index) => String(90 - index)).join(" "));
  await manualAnswerKeyPanel.getByRole("button", { name: "Gridi doldur" }).click();
  await manualAnswerKeyPanel.getByLabel("1. soru kazanımı", { exact: true }).fill("SÖZCÜKTE ANLAM");
  await manualAnswerKeyPanel.getByLabel("1. soru konusu", { exact: true }).fill("KONU 1");
  await manualAnswerKeyPanel.getByRole("button", { name: "Ön kontrol" }).click();
  await expect(manualAnswerKeyPanel.getByText("90 manuel soru doğrulandı. B: 90 soru")).toBeVisible();
  await manualAnswerKeyPanel.getByRole("button", { name: "Kaydet" }).click();
  await expect(manualAnswerKeyPanel.getByText("manual-key-v1 manuel kaydedildi.")).toBeVisible();
  await page.getByRole("button", { name: "Optik yükleme" }).click();
  await page.getByLabel("Optik cevap dosyası").setInputFiles({
    name: "optik-a.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(parserFileContent),
  });
  await page.getByRole("button", { name: "Yükle ve kontrol et" }).click();
  await expect(page.getByLabel("Eşleşmeyen satırlar ve rapor").getByRole("heading", { name: "Eşleşmeyen satırları çöz" })).toBeVisible();
  await page.getByRole("button", { name: "Eşleşmeyen satırları getir" }).click();
  const quarantineRow = page.getByRole("row", { name: /STUDENT_NOT_MATCHED/ });
  await expect(quarantineRow.getByText("OPEN")).toBeVisible();
  await quarantineRow.getByRole("combobox").selectOption("student-a");
  await quarantineRow.getByRole("button", { name: "7. satırı çöz" }).click();
  await expect(quarantineRow.getByText("OPEN")).not.toBeVisible();
  await expect(quarantineRow.getByText(/Kuyruk: evaluation-job-a|Çözüldü/)).toBeVisible();
  const opticalReportPanel = page.getByLabel("Optik rapor üretimi");
  await opticalReportPanel.getByText("Gelişmiş rapor bilgisi").click();
  await expect(opticalReportPanel.getByLabel("Teknik sonuç hash")).toHaveValue("abcdef1234567890");
  await opticalReportPanel.getByRole("button", { name: "Rapor üret" }).click();
  await expect(opticalReportPanel.getByText("report-job-a kuyruğa alındı.")).toBeVisible();

  await page.getByRole("link", { name: "Raporlar" }).click();
  await expect(page).toHaveURL(/\/kurum\/raporlar$/);
  await expect(heading(page, { name: "Sınav Raporu" })).toBeVisible();
  await page.getByLabel("Rapor sınav ID").fill("exam-a");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByLabel("Rapor özeti").getByText("READY")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Ortalama net" }).getByText("16,25")).toBeVisible();
  await expect(page.getByLabel("Branş Netleri").getByRole("rowheader", { name: "Matematik" })).toBeVisible();
  await expect(page.getByLabel("Kazanım radar grafiği").getByText("ÖĞRENCİ")).toBeVisible();
  await expect(page.getByLabel("Kazanım radar grafiği").getByRole("cell", { name: "Geometri", includeHidden: true })).toHaveCount(1);
  await expect(page.getByLabel("Hata kitapçığı").getByText("1 soru")).toBeVisible();
  await page.getByLabel("Rapor sınav ID").fill("   ");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByText("Rapor sınav ID zorunludur.")).toBeVisible();
  await page.getByLabel("Rapor sınav ID").fill("exam-demo");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByLabel("Rapor özeti").getByText("READY")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Ortalama net" }).getByText("17,5")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Bağlam" }).getByText("Merkez Kampüs / 8. Sınıf / 8-A / Matematik / 2. Donem")).toBeVisible();
  await expect(page.getByLabel("Branş Netleri").getByText("Branş net analizi")).toBeVisible();
  await expect(page.getByLabel("Branş Netleri").getByRole("rowheader", { name: "Matematik" })).toBeVisible();
  await expect(page.getByLabel("Branş Netleri").getByRole("cell", { name: "11.5" })).toBeVisible();
  await expect(page.getByLabel("Kazanım Netleri").getByRole("rowheader", { name: /Sayılar/ })).toBeVisible();
  await expect(page.getByLabel(/Sınıf karşılaştırması/i).getByRole("rowheader", { name: "8-A" })).toBeVisible();
  await expect(page.getByLabel(/Sınıf karşılaştırması/i).getByRole("cell", { name: "18.25" })).toBeVisible();
  await expect(page.getByLabel("Öğrenci karne özeti").getByText("+3 net / +40 puan")).toBeVisible();
  await expect(page.getByLabel("Öğrenci karne özeti").getByText("1/3")).toBeVisible();
  await expect(page.getByLabel("Kazanım radar grafiği").getByText("ÖĞRENCİ")).toBeVisible();
  await expect(page.getByLabel("Kazanım radar grafiği").getByText("Kazanım radar tablosu")).toHaveCount(1);
  await expect(page.getByLabel("Kazanım radar grafiği").getByRole("cell", { name: "Geometri", includeHidden: true })).toHaveCount(1);
  await expect(page.getByLabel("Öğrenci karne özeti").getByText("Öğrenci branş karne tablosu")).toBeVisible();
  await page.getByLabel("Rapor sınav ID").fill("exam-demo-isem-lgs-1");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByLabel("Rapor özeti").getByText("READY")).toBeVisible();
  await expect(page.getByLabel("Öğrenci karne özeti").getByRole("cell", { name: "76,67" }).first()).toBeVisible();
  await expect(page.getByLabel("Öğrenci karne özeti").getByRole("cell", { name: "TÜRKÇE" }).first()).toBeVisible();
  await captureKarneVisualEvidence(page, test.info(), "kurum-raporlar-ogrenci-karne");
  await expect(page.getByLabel("Hata kitapçığı").getByText("2 soru")).toBeVisible();
  await expect(page.getByLabel("Hata kitapçığı").getByText("2. soru Yanıt C Doğru B")).toBeVisible();
  await expect(page.getByLabel("Hata kitapçığı").getByText("5. soru Boş Doğru D")).toBeVisible();
  await page.getByLabel("Rapor sınav ID").fill("exam-demo");
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Ders" }).selectOption("course-turkish");
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Ortalama net" }).getByText("19,25")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Bağlam" }).getByText("Merkez Kampüs / 8. Sınıf / 8-B / Turkce / 2. Donem")).toBeVisible();
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Ders" }).selectOption("course-math");
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Kampüs" }).selectOption("campus-main");
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Seviye" }).selectOption("grade-8");
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Sınıf" }).selectOption("class-a");
  await page.getByLabel("Rapor filtreleri").getByRole("combobox", { name: "Dönem" }).selectOption("term-2026-spring");
  await page.getByRole("button", { name: "Rapor üret" }).click();
  await expect(page.getByText("exam-demo_results-v1 kuyruğa alındı.")).toBeVisible();
  expect(reportGenerationRequests.at(-1)).toEqual({
    reportType: "EXAM_RESULT_SUMMARY",
    contentHash: "results-v1",
    campusId: "campus-main",
    gradeLevelId: "grade-8",
    classId: "class-a",
    courseId: "course-math",
    termId: "term-2026-spring",
  });
  await page.getByRole("button", { name: "Raporu getir" }).click();
  await expect(page.getByRole("article").filter({ hasText: "Ortalama net" }).getByText("17,5")).toBeVisible();

  const reportDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel indir" }).click();
  await expect((await reportDownload).suggestedFilename()).toBe("exam-demo-snapshot-a.xlsx");
  const reportPdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF indir" }).click();
  await expect((await reportPdfDownload).suggestedFilename()).toBe("exam-demo-snapshot-a.pdf");

  await page.getByRole("link", { name: "Ödemeler" }).click();
  await expect(page).toHaveURL(/\/kurum\/finans$/);
  await expect(heading(page, { name: "Finans" })).toBeVisible();
  await expect(page.getByLabel("Finans özeti").getByText("₺1.000,00")).toBeVisible();
  await expect(page.getByLabel("Finans özeti").getByText("₺500,00").first()).toBeVisible();
  const firstPaymentRow = page.getByRole("row", { name: /1\. taksit/ });
  await expect(firstPaymentRow.getByRole("cell", { name: "2026 Haziran ödeme planı", exact: true })).toBeVisible();
  await expect(firstPaymentRow.getByRole("cell", { name: "Merkez Kampüs / 8. Sınıf / 8-A / Matematik / 2. Donem", exact: true })).toBeVisible();
  await expect(firstPaymentRow.getByRole("cell", { name: "Gecikmiş", exact: true })).toBeVisible();
  await page.getByLabel("Finans filtreleri").getByRole("combobox", { name: "Ders" }).selectOption("course-math");
  await expect(firstPaymentRow.getByRole("cell", { name: "2026 Haziran ödeme planı", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "2026 Haziran ödeme planı 1. taksit ödendi işaretle" }).click();
  await expect(firstPaymentRow.getByText("Ödendi")).toBeVisible();
  await expect(page.getByLabel("Finans özeti").getByText("₺0,00")).toBeVisible();

  await page.getByRole("link", { name: "Şablonlar" }).click();
  await expect(page).toHaveURL(/\/kurum\/sablonlar$/);
  await expect(heading(page, { name: "Şablonlar" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sınav hatırlatma", exact: true })).toBeVisible();
  await expect(page.getByLabel("SMS önizleme").getByText("Yarın deneme sınavı yapılacaktır.")).toBeVisible();
  await page.getByRole("combobox", { name: "Duyuru hedefi" }).selectOption("announcement-a");
  await expect(page.getByRole("combobox", { name: "Sınıf" })).toHaveValue("class-a");
  await expect(page.getByRole("combobox", { name: "Ders" })).toHaveValue("course-math");
  await expect(page.getByRole("combobox", { name: "Dönem" })).toHaveValue("term-2026-spring");
  await page.getByRole("button", { name: "Alıcıları getir" }).click();
  await expect(page.getByLabel("SMS alıcı önizleme").getByText("1 izinli veli")).toBeVisible();
  await expect(page.getByLabel("SMS alıcı önizleme").getByText("Ali Veli - Ada A")).toBeVisible();
  await expect(page.getByLabel("SMS alıcıları")).toHaveValue("905000000001");
  await expect(page.getByLabel("SMS önizleme").getByText("1 alıcı")).toBeVisible();
  await page.getByRole("button", { name: "SMS gönder" }).click();
  await expect(page.getByText("1 alıcı kuyruğa alındı.")).toBeVisible();
  await expect(page.getByLabel("SMS teslim raporu").getByText("completed")).toBeVisible();
  await expect(page.getByLabel("SMS teslim raporu").getByText("1", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Şablon ekle" }).click();
  await page.getByLabel("Şablon adı", { exact: true }).fill("   ");
  await page.getByLabel("Mesaj metni", { exact: true }).fill("Geçici metin");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByLabel("Şablon yönetimi").getByText("Şablon adı zorunludur.")).toBeVisible();
  await page.getByLabel("Şablon adı", { exact: true }).fill(" Devamsızlık ");
  await page.getByLabel("Mesaj metni", { exact: true }).fill(" Bugün öğrenciniz devamsız görünmektedir. ");
  await page.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Devamsızlık", exact: true })).toBeVisible();
  await page.getByLabel("Ara").fill("Devamsızlık");
  await expect(page.getByRole("cell", { name: "Devamsızlık", exact: true })).toBeVisible();
  await expect(page.getByText("Sınav hatırlatma")).toBeHidden();
  await page.getByLabel("Ara").fill("");

  await page.getByRole("button", { name: "Devamsızlık düzenle" }).click();
  await page.getByLabel("Mesaj metni", { exact: true }).fill("Bugün öğrenciniz derse katılmadı.");
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Bugün öğrenciniz derse katılmadı.")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Devamsızlık sil" }).click();
  await expect(page.getByRole("cell", { name: "Devamsızlık", exact: true })).toBeHidden();

  await page.getByRole("link", { name: "Destek" }).click();
  await expect(page).toHaveURL(/\/kurum\/destek$/);
  await expect(heading(page, { name: "Destek" })).toBeVisible();
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
  const supportDialog = page.getByRole("dialog", { name: "Destek bildirimi aç" });
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
  await expect(page).toHaveURL(/\/kurum$/);

  await page.getByRole("link", { name: "Rol Önizleme" }).click();
  await expect(page).toHaveURL(/\/kurum\/rol-onizleme$/);
  await expect(heading(page, { name: "Rol Önizleme" })).toBeVisible();
  await expect(page.getByLabel("Rol önizleme özeti").getByText("3 rol")).toBeVisible();
  const roleViewPreview = page.getByLabel("Rol görünüm önizleme");
  await expect(roleViewPreview.getByText("Ödemeler")).toBeVisible();
  await expect(roleViewPreview.getByText("Kullanıcılar")).toBeVisible();
  await roleViewPreview.getByLabel("Rol").selectOption("ASSISTANT_ADMIN");
  await expect(roleViewPreview.getByText("Öğrenciler")).toBeVisible();
  await expect(roleViewPreview.getByText("Ödemeler")).toHaveCount(0);
  await expect(roleViewPreview.getByText("Kullanıcılar")).toHaveCount(0);
  await roleViewPreview.getByLabel("Rol").selectOption("TEACHER");
  await expect(roleViewPreview.getByText("Öğretmen Portalı")).toBeVisible();
  await expect(roleViewPreview.getByText("/ogretmen")).toBeVisible();
  await expect(roleViewPreview.getByText("Kurum sol menüsü görünmez")).toBeVisible();
  await expect(page.getByLabel("Rol portal kartları").getByText("TEACHER + subjectType TEACHER")).toBeVisible();
  await expect(page.getByLabel("Rol portal kartları").getByText("student-a@example.test")).toBeVisible();
  await expect(page.getByLabel("Rol portal kartları").getByText("/veli")).toBeVisible();
  await page.getByLabel("Rol portal kartları").getByRole("button", { name: "Auditli öğretmen önizleme başlat" }).click();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Hedef rol: TEACHER")).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Kişi kaydı: teacher-a", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Mod: READ_ONLY")).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Portal context doğrulandı")).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Öğretmen portal verisi: teacher-a")).toBeVisible();
  await page.getByLabel("Aktif rol önizleme kaydı").getByRole("link", { name: "Öğretmen portalını önizle" }).click();
  await expect(page).toHaveURL(/\/ogretmen\?rolePreviewToken=preview-token-teacher$/);
  await expect(heading(page, { name: "Öğretmen Portalı" })).toBeVisible();
  await expect(page.getByLabel("Rol önizleme modu").getByText("Salt-okuma Önizleme")).toBeVisible();
  await expect(page.getByLabel("Öğretmen öğrenci kapsamı").getByText("Ada A")).toBeVisible();
  await expect(page.getByLabel("Öğretmen günlük işlemleri")).toHaveCount(0);
  await expect(page.getByLabel("Destek talepleri").getByText("Salt-okuma önizlemede destek talebi açılamaz.")).toBeVisible();
  await expect(page.getByLabel("Öğretmen ödev kontrolü").getByText("Salt-okuma")).toBeVisible();
  await page.getByRole("link", { name: "Rol Önizleme" }).click();
  await expect(page).toHaveURL(/\/kurum\/rol-onizleme$/);
  await expect(heading(page, { name: "Rol Önizleme" })).toBeVisible();
  await page.getByLabel("Rol portal kartları").getByRole("button", { name: "Auditli öğrenci önizleme başlat" }).click();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Hedef rol: STUDENT")).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Öğrenci portal verisi: student-a")).toBeVisible();
  await page.getByLabel("Aktif rol önizleme kaydı").getByRole("link", { name: "Öğrenci portalını önizle" }).click();
  await expect(page).toHaveURL(/\/ogrenci\?rolePreviewToken=preview-token-student$/);
  await expect(heading(page, { name: "Öğrenci Portalı" })).toBeVisible();
  await expect(page.getByLabel("Rol önizleme modu").getByText("Salt-okuma Önizleme")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Ada A")).toBeVisible();
  await expect(page.getByLabel("Destek talepleri").getByText("Salt-okuma önizlemede destek talebi açılamaz.")).toBeVisible();
  await page.getByRole("link", { name: "Rol Önizleme" }).click();
  await expect(page).toHaveURL(/\/kurum\/rol-onizleme$/);
  await page.getByLabel("Rol portal kartları").getByRole("button", { name: "Auditli veli önizleme başlat" }).click();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Hedef rol: GUARDIAN")).toBeVisible();
  await expect(page.getByLabel("Aktif rol önizleme kaydı").getByText("Veli portal verisi: 1 bağlı öğrenci")).toBeVisible();
  await page.getByLabel("Aktif rol önizleme kaydı").getByRole("link", { name: "Veli portalını önizle" }).click();
  await expect(page).toHaveURL(/\/veli\?rolePreviewToken=preview-token-guardian$/);
  await expect(heading(page, { name: "Veli Portalı" })).toBeVisible();
  await expect(page.getByLabel("Rol önizleme modu").getByText("Salt-okuma Önizleme")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Ada A")).toBeVisible();
  await expect(page.getByLabel("Bildirim tercihleri").getByText("Salt-okuma önizlemede bildirim tercihleri değiştirilemez.")).toBeVisible();
  await expect(page.getByLabel("Destek talepleri").getByText("Salt-okuma önizlemede destek talebi açılamaz.")).toBeVisible();
  await page.getByRole("link", { name: "Rol Önizleme" }).click();
  await expect(page).toHaveURL(/\/kurum\/rol-onizleme$/);
  await expect(page.getByText("Rehber / Referans")).toBeVisible();
  await expect(page.getByLabel("Rol portal kartları").getByRole("button", { name: "Auditli öğrenci önizleme başlat" })).toBeVisible();
  await expect(page.getByLabel("Rol portal kartları").getByRole("button", { name: "Auditli veli önizleme başlat" })).toBeVisible();
  await expect(page.getByLabel("Rol erişim kuralları").getByText("Kurum admin portalları normal sol menü rotası olarak görmez.")).toBeVisible();
  await expect(page.getByLabel("Rol erişim kuralları").getByText("Öğretmen yalnız sorumlu öğrenci veya ders programı kapsamını görür.")).toBeVisible();
  await expect(page.getByLabel("Rol önizleme kanıt komutları").getByText("me-access-matrix.e2e.test.ts")).toBeVisible();
  await expect(page.getByLabel("Operasyon kararı").getByText("Karar: panel audit'li ve süreli rol önizleme kaydı başlatır.")).toBeVisible();

  for (const hiddenOperationPath of [
    "/kurum/guvenlik-denetimi",
    "/kurum/gozlemlenebilirlik",
    "/kurum/uat-rollback",
    "/kurum/canli-yayin",
    "/kurum/sistem-sagligi",
  ]) {
    await page.goto(hiddenOperationPath);
    await expect(page).toHaveURL(/\/kurum$/);
  }

  await page.getByRole("link", { name: "Yedekleme" }).click();
  await expect(page).toHaveURL(/\/kurum\/yedek-restore$/);
  await expect(heading(page, { name: "Yedek / Restore" })).toBeVisible();
  await expect(page.getByText("Rehber / Referans")).toBeVisible();
  await expect(page.getByLabel("Yedek restore özeti").getByText("Hazır")).toBeVisible();
  await expect(page.getByLabel("Panel restore drill işi").getByText("Panel İş Tetikleme")).toBeVisible();
  await expect(page.getByLabel("Yedek restore işleri").getByText("Henüz panelden başlatılmış iş yok.")).toBeVisible();
  await page.getByLabel("Panel restore drill işi").getByLabel("İş tipi").selectOption("BACKUP");
  await page.getByLabel("Panel restore drill işi").getByLabel("Yedek hedefi").fill("file:///mnt/backups/tenant-a");
  await page.getByLabel("Panel restore drill işi").getByLabel("Onay metni").fill("YEDEK AL");
  await page.getByLabel("Panel restore drill işi").getByRole("button", { name: "Yedek alma işi başlat" }).click();
  await expect(page.getByLabel("Yedek restore işleri").getByRole("heading", { name: "Yedek alma" })).toBeVisible();
  await expect(page.getByLabel("Yedek restore işleri").getByText("backup-restore-job-created_backup")).toBeVisible();
  await page.getByLabel("Panel restore drill işi").getByLabel("İş tipi").selectOption("RESTORE_DRILL");
  await page.getByLabel("Panel restore drill işi").getByLabel("Restore kanıt dosyası").fill("file:///tmp/restore-drill.json");
  await page.getByLabel("Panel restore drill işi").getByLabel("Onay metni").fill("RESTORE DRILL");
  await page.getByLabel("Panel restore drill işi").getByRole("button", { name: "Restore drill işi başlat" }).click();
  const restoreDrillJob = page
    .getByLabel("Yedek restore işleri")
    .locator("article")
    .filter({ hasText: "backup-restore-job-created_restore-drill" });
  await expect(restoreDrillJob.getByRole("heading", { name: "Restore drill" })).toBeVisible();
  await expect(restoreDrillJob.getByText("Kuyrukta")).toBeVisible();
  await expect(page.getByLabel("Yedek restore kapıları").getByText("pnpm backup:restore:smoke")).toBeVisible();
  await expect(page.getByLabel("Yedek restore kapıları").getByText("pnpm backup:offsite:smoke")).toBeVisible();
  await expect(page.getByLabel("Yedek restore kapıları").getByText("pnpm wal:archive:smoke")).toBeVisible();
  await expect(page.getByLabel("Restore drill raporu").getByText("result = PASS")).toBeVisible();
  await expect(page.getByLabel("Kritik restore tabloları").getByText("_prisma_migrations")).toBeVisible();
  await expect(page.getByLabel("Operasyon kararı").getByText("Karar: panel yedek ve restore drill işini çift onayla kuyruğa alır.")).toBeVisible();

  await page.goto("/kurum/kvkk");
  await expect(page).toHaveURL(/\/kurum$/);

  const storageKeys = await page.evaluate(([first, second]) => ({
    first: Object.keys(window[first as keyof Window] as Storage),
    second: Object.keys(window[second as keyof Window] as Storage),
  }), ["local" + "Storage", "session" + "Storage"]);
  expect(storageKeys.first.filter((key) => key !== "des.sidebar.expandedGroups.v2")).toEqual([]);
  expect(storageKeys.second).toEqual([]);
});

test("Next sıfır-veri kurulum adımlarını ve yeni kayıt derin linkini gösterir", async ({ page }) => {
  let activeEmail = "";
  let campuses: Array<{ id: string; tenantId: string; name: string; code?: string }> = [];
  await page.route("**/*", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders, status: 204 });
      return;
    }

    await route.continue();
  });

  await page.route("**/auth/refresh", async (route) => {
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

  await page.route("**/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { email?: string };
    activeEmail = body.email ?? "";
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

  await page.goto("/login");
  await page.getByLabel("E-posta").fill("admin-a@example.test");
  await page.getByLabel("Şifre").fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page).toHaveURL(/\/kurum$/);
  const setupStart = page.getByLabel("Kurum kurulum başlangıcı");
  await expect(setupStart.getByText("Kurumunu kurmaya başla")).toBeVisible();
  await setupStart.getByRole("button", { name: "Daha sonra" }).click();
  await expect(setupStart).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain("uh_setup_tenant-a_dismissed=true");
  await page.reload();
  await expect(setupStart).toBeHidden();
  await page.evaluate(() => {
    document.cookie = "uh_setup_tenant-a_dismissed=; path=/; max-age=0; samesite=lax";
  });
  await page.reload();
  await expect(setupStart.getByText("Kurumunu kurmaya başla")).toBeVisible();
  await setupStart.getByRole("link", { name: "Kuruluma git" }).click();
  await expect(page).toHaveURL(/\/kurum\/kurulum$/);
  await expect(heading(page, { name: "Kurulum" })).toBeVisible();
  await expect(page.getByLabel("Kurulum özeti").getByText("0 / 9 adım tamam")).toBeVisible();
  await expect(page.getByLabel("Kurulum adımları").getByRole("heading", { name: "Kampüs" })).toBeVisible();
  await expect(page.getByLabel("Kurulum adımları").getByRole("heading", { name: "Veli-öğrenci bağı" })).toBeVisible();
  await expect(page.getByLabel("Kurulum adımları").getByRole("heading", { name: "Kazanım" })).toBeVisible();
  const campusStep = page.getByLabel("Kurulum adımları").locator("article").filter({ hasText: "Kampüs" });
  await campusStep.getByRole("button", { name: "Atla" }).click();
  await expect(campusStep.getByText("Atlandı")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.cookie)).toContain("uh_setup_tenant-a_skipped=");
  await expect.poll(() => page.evaluate(() => decodeURIComponent(document.cookie))).toContain("campuses");
  await page.reload();
  await expect(campusStep.getByText("Atlandı")).toBeVisible();

  await page.getByRole("link", { name: "Şimdi ekle" }).first().click();
  await expect(page).toHaveURL(/\/kurum\/kampusler\?new=1$/);
  const campusDialog = page.getByRole("dialog", { name: "Kampüs ekle" });
  await expect(campusDialog).toBeVisible();
  await campusDialog.getByLabel("Kampüs adı").fill("Merkez");
  await campusDialog.getByLabel("Kod").fill("MRK");
  await campusDialog.getByRole("button", { name: "Ekle", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Merkez", exact: true })).toBeVisible();
  await page.goto("/kurum/kurulum");
  await expect(page.getByLabel("Kurulum özeti").getByText("1 / 9 adım tamam")).toBeVisible();
  await expect(page.getByLabel("Kurulum adımları").locator("article").filter({ hasText: "Kampüs" }).getByText("Tamam")).toBeVisible();

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
  await expect(page.getByText("Veli kaydı yok")).toBeVisible();
  await page.goto("/kurum/veliler?new=1");
  await expect(page.getByRole("dialog", { name: "Veli ekle" })).toBeVisible();
  await page.getByRole("button", { name: "Vazgeç" }).click();
  await page.goto("/kurum/duyurular");
  await expect(page.getByText("Duyuru yok")).toBeVisible();
  await page.goto("/kurum/sablonlar");
  await expect(page.getByText("Şablon yok")).toBeVisible();
  await page.goto("/kurum/destek");
  await expect(page.getByText("Destek bildirimi yok")).toBeVisible();
  await page.goto("/kurum/kullanicilar");
  await expect(page.getByText("Kullanıcı yok")).toBeVisible();
  await expect(page.getByText("Davet yok")).toBeVisible();
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

    await route.continue();
  });

  await page.route("**/auth/refresh", async (route) => {
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

  await page.route("**/auth/login", async (route) => {
    const body = route.request().postDataJSON() as { email?: string };
    activeEmail = body.email ?? "";
    await route.fulfill({
      contentType: "application/json",
      headers: corsHeaders,
      status: 200,
      body: JSON.stringify(envelope(createAuthResponse(body.email))),
    });
  });

  await page.route("**/auth/logout", async (route) => {
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
      const body = request.postDataJSON() as typeof tenants[number] & {
        firstAdmin: { name: string; email: string; mode: "password" | "invitation"; password?: string };
      };
      tenantCreateCount += 1;
      const id = tenantCreateCount === 1 ? "tenant-created" : `tenant-created-${tenantCreateCount}`;
      const created = {
        id,
        name: body.name,
        slug: body.slug,
        plan: body.plan,
        status: body.status,
        seatLimit: body.seatLimit,
        activeSeatCount: 1,
      };
      tenants = [created, ...tenants];
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          tenant: created,
          admin: {
            id: "user-created-admin",
            email: body.firstAdmin.email.toLowerCase(),
            name: body.firstAdmin.name,
            tenantId: id,
            roles: ["TENANT_ADMIN"],
            ...(body.firstAdmin.mode === "invitation" ? { activationToken: "tenant-admin-activation-token" } : {}),
          },
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

    if (path.startsWith("/tenants/") && request.method() === "DELETE") {
      const id = decodeURIComponent(path.replace("/tenants/", ""));
      const deleted = { ...(tenants.find((candidate) => candidate.id === id) ?? tenants[0]!), status: "DELETED" };
      tenants = tenants.filter((tenant) => tenant.id !== id);
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope(deleted)),
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
  await page.getByLabel("E-posta").fill("system@example.test");
  await page.getByLabel("Şifre").fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();

  await expect(page).toHaveURL(/\/sistem$/);
  await expect(heading(page, { name: "Sistem Paneli" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kurumlar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sistem Paneli" })).toBeVisible();
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
  await createDialog.getByLabel("Slug").fill("");
  await createDialog.getByLabel("Slug").pressSequentially("yeni-kurum");
  await createDialog.getByLabel("Plan").selectOption("PRO");
  await createDialog.getByLabel("Koltuk limiti").pressSequentially("50");
  await createDialog.getByLabel("Admin ad soyad").pressSequentially("Yeni Yönetici");
  await createDialog.getByLabel("Admin e-posta").fill("first.admin@example.test");
  await createDialog.getByLabel("Admin şifre").fill("password1");
  await expect(createDialog.getByLabel("Kurum adı")).toHaveValue("Yeni Kurum");
  await expect(createDialog.getByLabel("Slug")).toHaveValue("yeni-kurum");
  await expect(createDialog.getByLabel("Koltuk limiti")).toHaveValue("50");
  await expect(createDialog.getByLabel("Admin ad soyad")).toHaveValue("Yeni Yönetici");
  await createDialog.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.getByText("Yeni Kurum")).toBeVisible();
  await expect(page.getByText("1 / 50")).toBeVisible();

  await page.getByRole("button", { name: "Kurum oluştur" }).click();
  await createDialog.getByLabel("Kurum adı").fill("Davetli Kurum");
  await createDialog.getByLabel("Slug").fill("davetli-kurum");
  await createDialog.getByLabel("İlk admin modu").selectOption("invitation");
  await createDialog.getByLabel("Admin ad soyad").fill("Davetli Yönetici");
  await createDialog.getByLabel("Admin e-posta").fill("invited.admin@example.test");
  await expect(createDialog.getByLabel("Admin şifre")).toHaveCount(0);
  await createDialog.getByRole("button", { name: "Oluştur", exact: true }).click();
  await expect(page.getByLabel("İlk admin aktivasyon tokenı").getByText("invited.admin@example.test")).toBeVisible();
  await expect(page.getByLabel("İlk admin aktivasyon tokenı").getByText("tenant-admin-activation-token")).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("row", { name: /Davetli Kurum/ }).getByRole("button", { name: "Sil" }).click();
  await expect(page.getByRole("row", { name: /Davetli Kurum/ })).toHaveCount(0);

  await page.getByRole("row", { name: /Yeni Kurum/ }).getByRole("link", { name: "Detay" }).click();
  await expect(page).toHaveURL(/\/sistem\/kurumlar\/tenant-created$/);
  await expect(heading(page, { name: "Yeni Kurum" })).toBeVisible();
  await page.getByRole("button", { name: "Düzenle" }).click();
  const editDialog = page.getByRole("dialog", { name: "Kurum düzenle" });
  await editDialog.getByLabel("Plan").selectOption("ENTERPRISE");
  await editDialog.getByLabel("Durum").selectOption("SUSPENDED");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByLabel("Kurum detayı").getByText("ENTERPRISE")).toBeVisible();
  await expect(page.getByLabel("Kurum detayı").getByText("Askıda")).toBeVisible();
  await expect(page.getByLabel("Kurum detayı").getByText("1 / 50")).toBeVisible();

  await page.getByRole("button", { name: "Çıkış" }).click();
  await page.getByLabel("E-posta").fill("first.admin@example.test");
  await page.getByLabel("Şifre").fill("password1");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/kurum$/);

  await page.getByRole("button", { name: "Çıkış" }).click();
  await page.getByLabel("E-posta").fill("admin-a@example.test");
  await page.getByLabel("Şifre").fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.goto("/sistem");
  await expect(page).toHaveURL(/\/kurum$/);

  await page.getByRole("button", { name: "Çıkış" }).click();
  await page.getByLabel("E-posta").fill("assistant@example.test");
  await page.getByLabel("Şifre").fill("password");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page).toHaveURL(/\/kurum$/);
  await expect(page.getByRole("link", { name: "Ödemeler" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Kullanıcılar" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Rol Önizleme" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Denetim" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "KVKK" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Yedekleme" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Destek", exact: true })).toBeVisible();
  await expect(page.getByLabel("Karar sinyalleri").getByRole("link", { name: /Geciken ödeme/ })).toHaveCount(0);
  await expect(page.getByLabel("Karar sinyalleri").getByRole("link", { name: /Bekleyen destek/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  const assistantCommandDialog = page.getByRole("dialog", { name: "Komut paleti" });
  await assistantCommandDialog.getByLabel("Komut ara").fill("ödeme");
  await expect(assistantCommandDialog.getByRole("button", { name: /Ödemeler/ })).toHaveCount(0);
  await assistantCommandDialog.getByLabel("Komut ara").fill("kullanıcı");
  await expect(assistantCommandDialog.getByRole("button", { name: /Kullanıcılar/ })).toHaveCount(0);
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
    | { studentId: string; courseId?: string; termId?: string; date: string; status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" }
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
    relationshipType: "MOTHER",
    isPrimary: true,
    canViewFinance: true,
    canReceiveSms: true,
    canReceiveAnnouncements: true,
    canOpenSupportTickets: true,
  };

  await page.addInitScript(() => {
    Object.defineProperty(window, "__UZMAN_HOCAM_WEB_PUSH_PUBLIC_KEY__", {
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
    if (path === "/attendance" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        studentId: string;
        courseId?: string;
        termId?: string;
        date: string;
        status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
      };
      lastPortalAttendanceBody = body;
      await route.fulfill({
        contentType: "application/json",
        headers: corsHeaders,
        status: 200,
        body: JSON.stringify(envelope({
          id: "attendance-created",
          tenantId: "tenant-a",
          studentId: body.studentId,
          courseId: body.courseId,
          termId: body.termId,
          date: body.date,
          status: body.status,
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
    if (path === "/homework/materials/material-a/assignments" && route.request().method() === "GET") {
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
  await expandSidebarGroup(page, "Portal");
  await expect(page.getByRole("link", { name: "Öğrenci Portalı" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kurum", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğretmen Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Veli Portalı" })).toBeHidden();
  await expect(heading(page, { name: "Öğrenci Portalı" })).toBeVisible();
  await expect(page.getByLabel("Bildirim cihazı").getByText("0 aktif cihaz")).toBeVisible();
  await page.getByLabel("Bildirim cihazı").getByRole("button", { name: "Push iznini aç" }).click();
  await expect(page.getByLabel("Bildirim cihazı").getByText("1 aktif cihaz")).toBeVisible();
  expect(portalNotificationDevices[0]?.provider).toBe("web-push");
  expect(portalNotificationDevices[0]?.token).toContain("https://push.example/subscription");
  await expect(page.getByLabel("Profil").getByText("Ada A")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("8-A")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Merkez Kampüs")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("8. Sınıf")).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("A", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Profil").getByText("Ayse Ogretmen")).toBeVisible();
  await expect(page.getByLabel("Veli ilişkileri").getByText("Zeynep Veli")).toBeVisible();
  await expect(page.getByLabel("Veli ilişkileri").getByText("Anne")).toBeVisible();
  await expect(page.getByLabel("Veli ilişkileri").getByText("Finans, SMS, Duyuru, Destek")).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("8-A").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("Merkez Kampüs / 8. Sınıf / A şube").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("İlk kayıt").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("Aktif")).toBeVisible();
  await expect(page.getByLabel("Duyurular").getByRole("cell", { name: "Öğrenci duyurusu", exact: true })).toBeVisible();
  await page.getByLabel("Duyurular").getByRole("button", { name: "Okundu işaretle" }).click();
  await expect(page.getByLabel("Duyurular").getByText("Okundu")).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Bireysel tekrar")).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Kesirler Çalışma Kağıdı")).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Matematik / 2. Donem")).toBeVisible();
  await expect(page.getByLabel("Destek talepleri").getByText("Ödev bağlantısı")).toBeVisible();
  await page.getByLabel("Destek talepleri").getByLabel("Konu").fill("Soru çözümü");
  await page.getByLabel("Destek talepleri").getByLabel("Mesaj").fill("Çözüm videosu açılmıyor.");
  await page.getByLabel("Destek talepleri").getByLabel("Öncelik").selectOption("HIGH");
  await page.getByLabel("Destek talepleri").getByRole("button", { name: "Destek talebi aç" }).click();
  await expect(page.getByLabel("Destek talepleri").getByText("Soru çözümü")).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("76,67").first()).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("ÖĞRENCİ NO : 176")).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByRole("heading", { name: "Öğrenci gelişim grafiği" })).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("1/3 (%100)").first()).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("1/2 (%100)").first()).toBeVisible();
  await expect(page.getByLabel("Portal kazanım radar grafiği").getByText("ÖĞRENCİ")).toBeVisible();
  await expect(page.getByLabel("Portal kazanım radar grafiği").getByText("Portal kazanım radar tablosu")).toHaveCount(1);
  await expect(page.getByLabel("Portal kazanım radar grafiği").getByRole("cell", { name: "Geometri", includeHidden: true })).toHaveCount(1);
  await expect(page.getByLabel("Sınav raporu").getByRole("row", { name: /MATEMATİK 20 20 0 0 20/ })).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByRole("row", { name: /MATEMATİK 20 20 0 0 20 19,92 9,46 9,39/ })).toBeVisible();
  await expect(page.getByLabel("Son sınav branş netleri").getByRole("row", { name: /MATEMATİK 18,67 20 17,33 18,67 18,67/ })).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("1 soru").first()).toBeVisible();
  await capturePortalKarneVisualEvidence(page, test.info(), "portal-ogrenci-sinav-raporu");
  await page.evaluate(() => {
    window.history.pushState(null, "", "/ogrenci?examId=exam-demo");
  });
  await expect(page).toHaveURL(/\/ogrenci\?examId=exam-demo$/);
  await expect(page.getByLabel("Sınav raporu").getByText("17,5").first()).toBeVisible();
  await expect(page.getByLabel("Devamsızlık").getByRole("cell", { name: "Yok", exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğretmen notları").getByText("Problem çözme rutini güçleniyor.")).toBeVisible();

  await page.getByRole("button", { name: "Çıkış" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs(page, "teacher-a@example.test");
  await expect(page).toHaveURL(/\/ogretmen$/);
  await expandSidebarGroup(page, "Portal");
  await expect(page.getByRole("link", { name: "Öğretmen Portalı" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kurum", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğrenci Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Veli Portalı" })).toBeHidden();
  await expect(heading(page, { name: "Öğretmen Portalı" })).toBeVisible();
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
  await expect(page.getByLabel("Destek talepleri").getByText("Yoklama ekranı")).toBeVisible();
  await page.getByLabel("Destek talepleri").getByLabel("Konu").fill("Portal raporu");
  await page.getByLabel("Destek talepleri").getByLabel("Mesaj").fill("Sınıf raporu geç yükleniyor.");
  await page.getByLabel("Destek talepleri").getByLabel("Öncelik").selectOption("HIGH");
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
  await expect(page.getByLabel("Destek talepleri").getByText("Portal raporu")).toBeVisible();
  await expect(page.getByLabel("Ders programı").getByRole("row", { name: /Matematik 8-A Matematik 2\. Donem/ })).toBeVisible();
  await expect(page.getByLabel("Yoklama branşı")).toHaveValue("course-math");
  await expect(page.getByLabel("Yoklama dönemi")).toHaveValue("term-2026-spring");
  await expect(page.getByLabel("Öğretmen öğrenci kapsamı").getByRole("button", { name: "Ada A / 8-A" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen yoklama kayıtları").getByRole("cell", { name: "Yok" })).toBeVisible();
  await page.getByLabel("Tarih").fill("2026-06-11");
  await page.getByLabel("Yoklama durumu").selectOption("LATE");
  await page.getByRole("button", { name: "Yoklama kaydet" }).click();
  expect(lastPortalAttendanceBody?.courseId).toBe("course-math");
  expect(lastPortalAttendanceBody?.termId).toBe("term-2026-spring");
  await expect(page.getByLabel("Öğretmen yoklama kayıtları").getByRole("row", { name: /Ada A Matematik 2\. Donem 2026-06-11 Geç/ })).toBeVisible();
  await expect(page.getByLabel("Not branşı")).toHaveValue("course-math");
  await expect(page.getByLabel("Not dönemi")).toHaveValue("term-2026-spring");
  await page.getByLabel("Gelişim durumu").fill("FOCUS");
  await page.getByLabel("Not", { exact: true }).fill("Derste aktif katılım gösterdi.");
  await page.getByRole("button", { name: "Not ekle" }).click();
  expect(lastPortalTeacherNoteBody?.courseId).toBe("course-math");
  expect(lastPortalTeacherNoteBody?.termId).toBe("term-2026-spring");
  await expect(page.getByLabel("Öğretmen notları").getByText("Derste aktif katılım gösterdi.")).toBeVisible();
  await expect(
    page
      .getByLabel("Öğretmen notları")
      .locator("article")
      .filter({ hasText: "Derste aktif katılım gösterdi." })
      .getByText("Matematik · 2. Donem"),
  ).toBeVisible();
  await expect(page.getByLabel("Öğretmen ödev kontrolü").getByRole("cell", { name: "Kesirler", exact: true })).toBeVisible();
  await expect(page.getByLabel("Öğretmen ödev kontrolü").getByRole("cell", { name: "Bekliyor" })).toBeVisible();
  await page.getByLabel("Öğretmen ödev kontrolü").getByRole("button", { name: "Kontrol et" }).click();
  await expect(page.getByLabel("Öğretmen ödev kontrolü").getByRole("cell", { name: "Kontrol edildi" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen materyal atamaları").getByText("Bireysel tekrar")).toBeVisible();
  await expect(page.getByLabel("Materyal branşı")).toHaveValue("course-math");
  await expect(page.getByLabel("Materyal dönemi")).toHaveValue("term-2026-spring");
  await page.getByLabel("Atama notu").fill("Konu tekrarı");
  await page.getByLabel("Teslim").fill("2026-06-12");
  await page.getByRole("button", { name: "Materyal ata" }).click();
  expect(lastPortalMaterialAssignmentBody?.courseId).toBe("course-math");
  expect(lastPortalMaterialAssignmentBody?.termId).toBe("term-2026-spring");
  await expect(page.getByLabel("Öğretmen materyal atamaları").getByText("Konu tekrarı")).toBeVisible();
  await expect(page.getByLabel("Öğretmen materyal atamaları").getByRole("row", { name: /Ada A Kesirler Çalışma Kağıdı Matematik 2\. Donem Konu tekrarı/ })).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("8-A").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("Merkez Kampüs / 8. Sınıf / A şube").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("İlk kayıt").first()).toBeVisible();
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("Aktif")).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("19,25").first()).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("440").first()).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("ÖĞRENCİ NO : 176")).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByRole("heading", { name: "Öğrenci gelişim grafiği" })).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("1/3 (%100)").first()).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("1/2 (%100)").first()).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByRole("row", { name: /Matematik 23 20 3 0 19,25/ })).toBeVisible();
  await capturePortalKarneVisualEvidence(page, test.info(), "portal-ogretmen-sinav-raporu");
  await expect(page.getByLabel("Öğretmen sınıf raporları").getByRole("cell", { name: "8-A" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen sınıf raporları").getByRole("cell", { name: "Turkce / 2. Donem" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen sınıf raporları").getByRole("cell", { name: "18,25" })).toBeVisible();
  await expect(page.getByLabel("Öğretmen sınıf raporları").getByRole("cell", { name: "8-B" })).toBeHidden();

  await page.getByRole("button", { name: "Çıkış" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await loginAs(page, "guardian-a@example.test");
  await expect(page).toHaveURL(/\/veli$/);
  await expandSidebarGroup(page, "Portal");
  await expect(page.getByRole("link", { name: "Veli Portalı" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Kurum", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğretmen Portalı" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Öğrenci Portalı" })).toBeHidden();
  await expect(heading(page, { name: "Veli Portalı" })).toBeVisible();
  await expect(page.getByLabel("Duyurular").getByRole("cell", { name: "Veli duyurusu", exact: true })).toBeVisible();
  await page.getByLabel("Duyurular").getByRole("button", { name: "Okundu işaretle" }).click();
  await expect(page.getByLabel("Duyurular").getByText("Okundu")).toBeVisible();
  await expect(page.getByLabel("Bildirim tercihleri").getByLabel("SMS al")).toBeChecked();
  await page.getByLabel("Bildirim tercihleri").getByLabel("SMS al").click();
  await expect(page.getByLabel("Bildirim tercihleri").getByLabel("SMS al")).not.toBeChecked();
  await expect(page.getByLabel("Ödevler").getByText("Bireysel tekrar")).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Kesirler Çalışma Kağıdı")).toBeVisible();
  await expect(page.getByLabel("Ödevler").getByText("Matematik / 2. Donem")).toBeVisible();
  await expect(page.getByLabel("Destek talepleri").getByText("Rapor görüntüleme")).toBeVisible();
  await page.getByLabel("Destek talepleri").getByLabel("Konu").fill("Ödeme sorusu");
  await page.getByLabel("Destek talepleri").getByLabel("Mesaj").fill("Taksit tarihi hakkında bilgi istiyorum.");
  await page.getByLabel("Destek talepleri").getByRole("button", { name: "Destek talebi aç" }).click();
  await expect(page.getByLabel("Destek talepleri").getByText("Ödeme sorusu")).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("76,67").first()).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("ÖĞRENCİ NO : 176")).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByRole("heading", { name: "Öğrenci gelişim grafiği" })).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("1/3 (%100)").first()).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByText("1/2 (%100)").first()).toBeVisible();
  await expect(page.getByLabel("Portal kazanım radar grafiği").getByText("ÖĞRENCİ")).toBeVisible();
  await expect(page.getByLabel("Portal kazanım radar grafiği").getByText("Portal kazanım radar tablosu")).toHaveCount(1);
  await expect(page.getByLabel("Portal kazanım radar grafiği").getByRole("cell", { name: "Geometri", includeHidden: true })).toHaveCount(1);
  await expect(page.getByLabel("Sınav raporu").getByRole("row", { name: /MATEMATİK 20 20 0 0 20/ })).toBeVisible();
  await expect(page.getByLabel("Sınav raporu").getByRole("row", { name: /MATEMATİK 20 20 0 0 20 19,92 9,46 9,39/ })).toBeVisible();
  await expect(page.getByLabel("Son sınav branş netleri").getByRole("row", { name: /MATEMATİK 18,67 20 17,33 18,67 18,67/ })).toBeVisible();
  await capturePortalKarneVisualEvidence(page, test.info(), "portal-veli-sinav-raporu");
  await page.evaluate(() => {
    window.history.pushState(null, "", "/veli?examId=exam-demo");
  });
  await expect(page).toHaveURL(/\/veli\?examId=exam-demo$/);
  await expect(page.getByLabel("Sınav raporu").getByText("17,5").first()).toBeVisible();
  await expect(page.getByLabel("Portal özeti").getByText("500,00 TRY")).toBeVisible();
  await expect(page.getByLabel("Ödeme planları").getByText("2026 Haziran ödeme planı")).toBeVisible();
  await expect(page.getByLabel("Ödeme planları").getByText("1. taksit / 500,00 TRY")).toBeVisible();
  await expect(page.getByLabel("Ödeme planları").getByRole("row", { name: /1\. taksit .* Bekliyor/ })).toBeVisible();
  portalGuardianPreferences = { ...portalGuardianPreferences, canViewFinance: false };
  await page.getByLabel("Bildirim tercihleri").getByLabel("SMS al").click();
  await expect(page.getByLabel("Bildirim tercihleri").getByLabel("SMS al")).toBeChecked();
  await expect(page.getByLabel("Portal özeti").getByText("Kapalı")).toBeVisible();
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
  await expect(page.getByLabel("Sınıf ve kayıt geçmişi").getByText("Aktif")).toBeVisible();
  await expect(page.getByLabel("Veli ilişki özeti").getByText("Anne")).toBeVisible();
  await expect(page.getByLabel("Veli ilişki özeti").getByText("Kapalı")).toBeVisible();
  await expect(page.getByLabel("Veli ilişki özeti").getByText("SMS, Duyuru, Destek")).toBeVisible();
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

function readPortalFixture(path: string) {
  if (path === "/campuses") return [{ id: "campus-main", tenantId: "tenant-a", name: "Merkez Kampüs", code: "MRK" }];
  if (path === "/classes") return [{ id: "class-a", tenantId: "tenant-a", name: "8-A", level: "8", campusId: "campus-main", gradeLevelId: "grade-8", section: "A" }];
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
      relationshipType: "MOTHER",
      isPrimary: true,
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
  if (path === "/me/student/homework/material-assignments" || path === "/me/guardian/homework/material-assignments") {
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
          total: { net: 14.5, standardScore: 380 },
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
          total: { net: 17.5, standardScore: 420 },
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
            standardScore: 410,
          },
          branches: [
            { branch: "Matematik", resultCount: 2, correct: 11, wrong: 2, blank: 0, net: 10.5 },
            { branch: "Türkçe", resultCount: 2, correct: 6, wrong: 1, blank: 0, net: 5.75 },
          ],
          outcomes: [
            { outcomeCode: "Geometri", branch: "Matematik", resultCount: 2, correct: 6, wrong: 1, blank: 0, net: 5.75 },
            { outcomeCode: "Problemler", branch: "Matematik", resultCount: 2, correct: 5, wrong: 1, blank: 0, net: 4.75 },
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
                standardScore: 410,
              },
            },
          ],
          students: [
            {
              studentId: "student-a",
              resultKey: "student-a",
              total: {
                correct: 17,
                wrong: 3,
                blank: 0,
                net: 16.25,
                standardScore: 410,
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
    };
  }

  if (path === "/exams/exam-a/reports/students/student-a/progress") {
    return {
      tenantId: "tenant-a",
      examId: "exam-a",
      studentId: "student-a",
      points: [
        { snapshotId: "snapshot-prev", generatedAt: "2026-06-01T09:00:00.000Z", total: { net: 14.5, standardScore: 390 } },
        { snapshotId: "snapshot-optik-a", generatedAt: "2026-06-09T09:30:00.000Z", total: { net: 16.25, standardScore: 410 } },
      ],
      netDelta: 1.75,
      standardScoreDelta: 20,
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
