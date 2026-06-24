import pg from "pg";
import { getTenantScopedTables } from "./tenant-models.mjs";

const { Client } = pg;

const adminDatabaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://migration:migration@localhost:5432/o_okul";
const appDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul";

const adminClient = new Client({ connectionString: adminDatabaseUrl });
const appClient = new Client({ connectionString: appDatabaseUrl });
const tenantReadTables = getTenantScopedTables();

const ids = {
  tenantA: "00000000-0000-4000-8000-0000000000a1",
  tenantB: "00000000-0000-4000-8000-0000000000b1",
  userA: "00000000-0000-4000-8000-0000000000a8",
  userB: "00000000-0000-4000-8000-0000000000b8",
  tenantMembershipA: "00000000-0000-4000-8000-000000000011a1",
  tenantMembershipB: "00000000-0000-4000-8000-000000000011b1",
  notificationDeviceA: "00000000-0000-4000-8000-000000000012a1",
  notificationDeviceB: "00000000-0000-4000-8000-000000000012b1",
  authSessionA: "00000000-0000-4000-8000-0000000000a0",
  authSessionB: "00000000-0000-4000-8000-0000000000b0",
  idempotencyA: "00000000-0000-4000-8000-00000000002aa1",
  idempotencyB: "00000000-0000-4000-8000-00000000002bb1",
  identityInvitationA: "00000000-0000-4000-8000-0000000000a7",
  identityInvitationB: "00000000-0000-4000-8000-0000000000b7",
  campusA: "00000000-0000-4000-8000-000000000013a1",
  campusB: "00000000-0000-4000-8000-000000000013b1",
  gradeLevelA: "00000000-0000-4000-8000-000000000014a1",
  gradeLevelB: "00000000-0000-4000-8000-000000000014b1",
  courseA: "00000000-0000-4000-8000-000000000015a1",
  courseB: "00000000-0000-4000-8000-000000000015b1",
  academicYearA: "00000000-0000-4000-8000-000000000016a1",
  academicYearB: "00000000-0000-4000-8000-000000000016b1",
  academicTermA: "00000000-0000-4000-8000-000000000017a1",
  academicTermB: "00000000-0000-4000-8000-000000000017b1",
  classA: "00000000-0000-4000-8000-0000000000a2",
  classB: "00000000-0000-4000-8000-0000000000b2",
  studentA: "00000000-0000-4000-8000-0000000000a3",
  studentB: "00000000-0000-4000-8000-0000000000b3",
  studentClassHistoryA: "00000000-0000-4000-8000-000000000018a1",
  studentClassHistoryB: "00000000-0000-4000-8000-000000000018b1",
  studentEnrollmentA: "00000000-0000-4000-8000-0000000000f3",
  studentEnrollmentB: "00000000-0000-4000-8000-0000000000f4",
  attendanceA: "00000000-0000-4000-8000-0000000000e3",
  attendanceB: "00000000-0000-4000-8000-0000000000e4",
  paymentPlanA: "00000000-0000-4000-8000-0000000000e7",
  paymentPlanB: "00000000-0000-4000-8000-0000000000e8",
  paymentInstallmentA: "00000000-0000-4000-8000-0000000000e9",
  paymentInstallmentB: "00000000-0000-4000-8000-0000000000e0",
  teacherA: "00000000-0000-4000-8000-0000000000a4",
  teacherB: "00000000-0000-4000-8000-0000000000b4",
  teacherAssignmentA: "00000000-0000-4000-8000-000000000019a1",
  teacherAssignmentB: "00000000-0000-4000-8000-000000000019b1",
  teacherNoteA: "00000000-0000-4000-8000-0000000000e5",
  teacherNoteB: "00000000-0000-4000-8000-0000000000e6",
  guardianA: "00000000-0000-4000-8000-000000000020a1",
  guardianB: "00000000-0000-4000-8000-000000000020b1",
  guardianStudentA: "00000000-0000-4000-8000-000000000021a1",
  guardianStudentB: "00000000-0000-4000-8000-000000000021b1",
  scheduleA: "00000000-0000-4000-8000-0000000000a5",
  scheduleB: "00000000-0000-4000-8000-0000000000b5",
  studyA: "00000000-0000-4000-8000-0000000000a6",
  studyB: "00000000-0000-4000-8000-0000000000b6",
  studyStudentA: "00000000-0000-4000-8000-0000000000a6",
  studyStudentB: "00000000-0000-4000-8000-0000000000b6",
  materialA: "00000000-0000-4000-8000-0000000000a8",
  materialB: "00000000-0000-4000-8000-0000000000b8",
  materialFileA: "00000000-0000-4000-8000-000000000022a1",
  materialFileB: "00000000-0000-4000-8000-000000000022b1",
  materialAssignmentA: "00000000-0000-4000-8000-0000000000d5",
  materialAssignmentB: "00000000-0000-4000-8000-0000000000d6",
  homeworkA: "00000000-0000-4000-8000-0000000000a9",
  homeworkB: "00000000-0000-4000-8000-0000000000b9",
  examA: "00000000-0000-4000-8000-0000000000ea",
  examA2: "00000000-0000-4000-8000-0000000000e2",
  examB: "00000000-0000-4000-8000-0000000000eb",
  opticalFormTemplateA: "00000000-0000-4000-8000-000000000023a1",
  opticalFormTemplateB: "00000000-0000-4000-8000-000000000023b1",
  parserConfigA: "00000000-0000-4000-8000-0000000000ec",
  parserConfigB: "00000000-0000-4000-8000-0000000000ed",
  learningOutcomeA: "00000000-0000-4000-8000-0000000000f1",
  learningOutcomeB: "00000000-0000-4000-8000-0000000000f2",
  participantA: "00000000-0000-4000-8000-0000000000ae",
  participantB: "00000000-0000-4000-8000-0000000000be",
  rawImportA: "00000000-0000-4000-8000-0000000000aa",
  rawImportB: "00000000-0000-4000-8000-0000000000bb",
  answerKeyA: "00000000-0000-4000-8000-0000000000ac",
  answerKeyB: "00000000-0000-4000-8000-0000000000bc",
  bookletVariantA: "00000000-0000-4000-8000-0000000000f5",
  bookletVariantB: "00000000-0000-4000-8000-0000000000f6",
  examResultA: "00000000-0000-4000-8000-0000000000ad",
  examResultB: "00000000-0000-4000-8000-0000000000bd",
  parsedAnswerA: "00000000-0000-4000-8000-0000000000a0",
  parsedAnswerB: "00000000-0000-4000-8000-0000000000b0",
  quarantineA: "00000000-0000-4000-8000-0000000000af",
  quarantineB: "00000000-0000-4000-8000-0000000000bf",
  snapshotA: "00000000-0000-4000-8000-0000000000c1",
  snapshotB: "00000000-0000-4000-8000-0000000000c2",
  announcementA: "00000000-0000-4000-8000-0000000000d1",
  announcementB: "00000000-0000-4000-8000-0000000000d2",
  announcementReceiptA: "00000000-0000-4000-8000-000000000024a1",
  announcementReceiptB: "00000000-0000-4000-8000-000000000024b1",
  announcementDeliveryReportA: "00000000-0000-4000-8000-0000000000df",
  announcementDeliveryReportB: "00000000-0000-4000-8000-0000000000e1",
  messageTemplateA: "00000000-0000-4000-8000-0000000000d3",
  messageTemplateB: "00000000-0000-4000-8000-0000000000d4",
  smsBatchDeliveryReportA: "00000000-0000-4000-8000-0000000000dd",
  smsBatchDeliveryReportB: "00000000-0000-4000-8000-0000000000de",
  backupRestoreJobA: "00000000-0000-4000-8000-000000000025a1",
  backupRestoreJobB: "00000000-0000-4000-8000-000000000025b1",
  developmentCriterionA: "00000000-0000-4000-8000-000000000026a1",
  developmentCriterionB: "00000000-0000-4000-8000-000000000026b1",
  developmentAssessmentA: "00000000-0000-4000-8000-000000000027a1",
  developmentAssessmentB: "00000000-0000-4000-8000-000000000027b1",
  developmentScoreA: "00000000-0000-4000-8000-000000000028a1",
  developmentScoreB: "00000000-0000-4000-8000-000000000028b1",
  supportTicketA: "00000000-0000-4000-8000-0000000000d7",
  supportTicketB: "00000000-0000-4000-8000-0000000000d8",
  supportTicketAttachmentA: "00000000-0000-4000-8000-0000000000d9",
  supportTicketAttachmentB: "00000000-0000-4000-8000-0000000000da",
  supportTicketCommentA: "00000000-0000-4000-8000-0000000000db",
  supportTicketCommentB: "00000000-0000-4000-8000-0000000000dc",
  auditLogA: "00000000-0000-4000-8000-000000000029a1",
  auditLogB: "00000000-0000-4000-8000-000000000029b1",
};

async function withTransaction(callback) {
  await adminClient.query("BEGIN");
  try {
    await callback();
    await adminClient.query("COMMIT");
  } catch (error) {
    await adminClient.query("ROLLBACK");
    throw error;
  }
}

async function withAppTransaction(callback) {
  await appClient.query("BEGIN");
  try {
    await callback();
    await appClient.query("ROLLBACK");
  } catch (error) {
    await appClient.query("ROLLBACK");
    throw error;
  }
}

async function setTenantContext(client, tenantId) {
  await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
}

async function seedFixtures() {
  await withTransaction(async () => {
    await adminClient.query("SELECT set_config('app.bypass_rls', 'true', true)");

    await adminClient.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt")
       VALUES ($1, 'RLS Tenant A', 'rls-tenant-a', now()), ($2, 'RLS Tenant B', 'rls-tenant-b', now())
       ON CONFLICT ("slug") DO NOTHING`,
      [ids.tenantA, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
       VALUES
         ($1, 'rls-a@example.test', 'RLS User A', 'hash-a', now()),
         ($2, 'rls-b@example.test', 'RLS User B', 'hash-b', now())
       ON CONFLICT ("email") DO NOTHING`,
      [ids.userA, ids.userB],
    );

    await adminClient.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
       VALUES
         ($1, $2, $3, 'TENANT_ADMIN', now()),
         ($4, $5, $6, 'TENANT_ADMIN', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.tenantMembershipA, ids.tenantA, ids.userA, ids.tenantMembershipB, ids.tenantB, ids.userB],
    );

    await adminClient.query(
      `INSERT INTO "NotificationDeviceToken" (
         "id", "tenantId", "userId", "subjectType", "subjectId", "provider", "token", "platform", "lastSeenAt", "updatedAt"
       )
       VALUES
         ($1, $2, $3, 'STUDENT', $4, 'webpush', 'rls-push-token-a', 'web', now(), now()),
         ($5, $6, $7, 'STUDENT', $8, 'webpush', 'rls-push-token-b', 'web', now(), now())
       ON CONFLICT ("tenantId", "userId", "token") DO NOTHING`,
      [ids.notificationDeviceA, ids.tenantA, ids.userA, ids.studentA, ids.notificationDeviceB, ids.tenantB, ids.userB, ids.studentB],
    );

    await adminClient.query(
      `INSERT INTO "AuthSession" (
         "id", "tenantId", "userId", "roles", "tokenFamilyId", "refreshTokenHash", "status", "membershipVersion", "updatedAt"
       )
       VALUES
         ($1, $2, $3, ARRAY['TENANT_ADMIN'], 'family-a', 'refresh-hash-a', 'ACTIVE', 1, now()),
         ($4, $5, $6, ARRAY['TENANT_ADMIN'], 'family-b', 'refresh-hash-b', 'ACTIVE', 1, now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.authSessionA, ids.tenantA, ids.userA, ids.authSessionB, ids.tenantB, ids.userB],
    );

    await adminClient.query(
      `INSERT INTO "IdempotencyKey" (
         "id", "tenantId", "key", "operation", "requestHash", "status", "responseBody", "completedAt", "updatedAt"
       )
       VALUES
         ($1, $2, 'rls-idempotency-a', 'payment.plan.create', 'hash-a', 'COMPLETED', '{"ok":true}'::jsonb, now(), now()),
         ($3, $4, 'rls-idempotency-b', 'payment.plan.create', 'hash-b', 'COMPLETED', '{"ok":true}'::jsonb, now(), now())
       ON CONFLICT ("tenantId", "key", "operation") DO NOTHING`,
      [ids.idempotencyA, ids.tenantA, ids.idempotencyB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "IdentityInvitation" (
         "id", "tenantId", "subjectType", "subjectId", "email", "name", "role", "tokenHash", "expiresAt", "updatedAt"
       )
       VALUES
         ($1, $2, 'STUDENT', $3, 'invite-a@example.test', 'Invite A', 'STUDENT', 'token-hash-a', now() + interval '1 day', now()),
         ($4, $5, 'STUDENT', $6, 'invite-b@example.test', 'Invite B', 'STUDENT', 'token-hash-b', now() + interval '1 day', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.identityInvitationA, ids.tenantA, ids.studentA, ids.identityInvitationB, ids.tenantB, ids.studentB],
    );

    await adminClient.query(
      `INSERT INTO "Campus" ("id", "tenantId", "name", "code", "updatedAt")
       VALUES
         ($1, $2, 'RLS Kampus A', 'RLS-CAMPUS-A', now()),
         ($3, $4, 'RLS Kampus B', 'RLS-CAMPUS-B', now())
       ON CONFLICT ("tenantId", "code") DO NOTHING`,
      [ids.campusA, ids.tenantA, ids.campusB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "GradeLevel" ("id", "tenantId", "name", "code", "updatedAt")
       VALUES
         ($1, $2, '8. Sınıf A', 'RLS-GRADE-A', now()),
         ($3, $4, '8. Sınıf B', 'RLS-GRADE-B', now())
       ON CONFLICT ("tenantId", "code") DO NOTHING`,
      [ids.gradeLevelA, ids.tenantA, ids.gradeLevelB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "Course" ("id", "tenantId", "name", "code", "updatedAt")
       VALUES
         ($1, $2, 'RLS Ders A', 'RLS-COURSE-A', now()),
         ($3, $4, 'RLS Ders B', 'RLS-COURSE-B', now())
       ON CONFLICT ("tenantId", "code") DO NOTHING`,
      [ids.courseA, ids.tenantA, ids.courseB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "AcademicYear" ("id", "tenantId", "name", "startsAt", "endsAt", "isActive", "updatedAt")
       VALUES
         ($1, $2, 'RLS 2026 A', '2026-01-01', '2026-12-31', true, now()),
         ($3, $4, 'RLS 2026 B', '2026-01-01', '2026-12-31', true, now())
       ON CONFLICT ("tenantId", "name") DO NOTHING`,
      [ids.academicYearA, ids.tenantA, ids.academicYearB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "AcademicTerm" ("id", "tenantId", "academicYearId", "name", "startsAt", "endsAt", "isActive", "updatedAt")
       VALUES
         ($1, $2, $3, 'RLS Donem A', '2026-01-01', '2026-06-30', true, now()),
         ($4, $5, $6, 'RLS Donem B', '2026-01-01', '2026-06-30', true, now())
       ON CONFLICT ("tenantId", "academicYearId", "name") DO NOTHING`,
      [ids.academicTermA, ids.tenantA, ids.academicYearA, ids.academicTermB, ids.tenantB, ids.academicYearB],
    );

    await adminClient.query(
      `INSERT INTO "Class" ("id", "tenantId", "name", "updatedAt")
       VALUES ($1, $2, 'A Sınıfı', now()), ($3, $4, 'B Sınıfı', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.classA, ids.tenantA, ids.classB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "Student" ("id", "tenantId", "classId", "firstName", "lastName", "studentNo", "updatedAt")
       VALUES ($1, $2, $3, 'Ada', 'A', 'A-001', now()), ($4, $5, $6, 'Bora', 'B', 'B-001', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.studentA, ids.tenantA, ids.classA, ids.studentB, ids.tenantB, ids.classB],
    );

    await adminClient.query(
      `INSERT INTO "StudentClassHistory" ("id", "tenantId", "studentId", "classId", "academicYearId", "termId", "startsAt", "reason", "updatedAt")
       VALUES
         ($1, $2, $3, $4, $5, $6, '2026-01-01', 'RLS', now()),
         ($7, $8, $9, $10, $11, $12, '2026-01-01', 'RLS', now())
       ON CONFLICT ("id") DO NOTHING`,
      [
        ids.studentClassHistoryA,
        ids.tenantA,
        ids.studentA,
        ids.classA,
        ids.academicYearA,
        ids.academicTermA,
        ids.studentClassHistoryB,
        ids.tenantB,
        ids.studentB,
        ids.classB,
        ids.academicYearB,
        ids.academicTermB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "StudentEnrollment" ("id", "tenantId", "studentId", "classId", "status", "startsAt", "reason", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 'ACTIVE', '2026-06-01', 'RLS', now()),
         ($5, $6, $7, $8, 'ACTIVE', '2026-06-01', 'RLS', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.studentEnrollmentA, ids.tenantA, ids.studentA, ids.classA, ids.studentEnrollmentB, ids.tenantB, ids.studentB, ids.classB],
    );

    await adminClient.query(
      `INSERT INTO "Attendance" ("id", "tenantId", "studentId", "date", "status", "updatedAt")
       VALUES
         ($1, $2, $3, '2026-06-03', 'ABSENT', now()),
         ($4, $5, $6, '2026-06-03', 'PRESENT', now())
       ON CONFLICT ("tenantId", "studentId", "date") DO NOTHING`,
      [ids.attendanceA, ids.tenantA, ids.studentA, ids.attendanceB, ids.tenantB, ids.studentB],
    );

    await adminClient.query(
      `INSERT INTO "PaymentPlan" ("id", "tenantId", "studentId", "title", "totalAmount", "currency", "updatedAt")
       VALUES
         ($1, $2, $3, 'RLS Ödeme A', 100000, 'TRY', now()),
         ($4, $5, $6, 'RLS Ödeme B', 100000, 'TRY', now())
       ON CONFLICT ("tenantId", "id") DO NOTHING`,
      [ids.paymentPlanA, ids.tenantA, ids.studentA, ids.paymentPlanB, ids.tenantB, ids.studentB],
    );

    await adminClient.query(
      `INSERT INTO "PaymentInstallment" ("id", "tenantId", "planId", "installmentNo", "amount", "dueDate", "status", "updatedAt")
       VALUES
         ($1, $2, $3, 1, 50000, '2026-07-01', 'PENDING', now()),
         ($4, $5, $6, 1, 50000, '2026-07-01', 'PENDING', now())
       ON CONFLICT ("tenantId", "planId", "installmentNo") DO NOTHING`,
      [
        ids.paymentInstallmentA,
        ids.tenantA,
        ids.paymentPlanA,
        ids.paymentInstallmentB,
        ids.tenantB,
        ids.paymentPlanB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "Teacher" ("id", "tenantId", "firstName", "lastName", "updatedAt")
       VALUES ($1, $2, 'Ayse', 'Ogretmen', now()), ($3, $4, 'Berk', 'Ogretmen', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.teacherA, ids.tenantA, ids.teacherB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "TeacherAssignment" ("id", "tenantId", "teacherId", "classId", "studentId", "courseId", "termId", "role", "startsAt", "updatedAt")
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, 'CLASS_TEACHER', '2026-01-01', now()),
         ($8, $9, $10, $11, $12, $13, $14, 'CLASS_TEACHER', '2026-01-01', now())
       ON CONFLICT ("id") DO NOTHING`,
      [
        ids.teacherAssignmentA,
        ids.tenantA,
        ids.teacherA,
        ids.classA,
        ids.studentA,
        ids.courseA,
        ids.academicTermA,
        ids.teacherAssignmentB,
        ids.tenantB,
        ids.teacherB,
        ids.classB,
        ids.studentB,
        ids.courseB,
        ids.academicTermB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "Guardian" ("id", "tenantId", "firstName", "lastName", "phone", "updatedAt")
       VALUES
         ($1, $2, 'Aylin', 'Veli', '+905550000001', now()),
         ($3, $4, 'Burcu', 'Veli', '+905550000002', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.guardianA, ids.tenantA, ids.guardianB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "GuardianStudent" ("id", "tenantId", "guardianId", "studentId", "relationshipType", "isPrimary", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 'MOTHER', true, now()),
         ($5, $6, $7, $8, 'MOTHER', true, now())
       ON CONFLICT ("tenantId", "guardianId", "studentId") DO NOTHING`,
      [ids.guardianStudentA, ids.tenantA, ids.guardianA, ids.studentA, ids.guardianStudentB, ids.tenantB, ids.guardianB, ids.studentB],
    );

    await adminClient.query(
      `INSERT INTO "DevelopmentCriterion" ("id", "tenantId", "name", "sortOrder", "updatedAt")
       VALUES
         ($1, $2, 'RLS Gelisim A', 1, now()),
         ($3, $4, 'RLS Gelisim B', 1, now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.developmentCriterionA, ids.tenantA, ids.developmentCriterionB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "DevelopmentAssessment" ("id", "tenantId", "studentId", "teacherId", "termId", "periodLabel", "mentorNote", "updatedAt")
       VALUES
         ($1, $2, $3, $4, $5, 'RLS A', 'A gelişim notu', now()),
         ($6, $7, $8, $9, $10, 'RLS B', 'B gelişim notu', now())
       ON CONFLICT ("id") DO NOTHING`,
      [
        ids.developmentAssessmentA,
        ids.tenantA,
        ids.studentA,
        ids.teacherA,
        ids.academicTermA,
        ids.developmentAssessmentB,
        ids.tenantB,
        ids.studentB,
        ids.teacherB,
        ids.academicTermB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "DevelopmentScore" ("id", "tenantId", "assessmentId", "criterionId", "score", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 4, now()),
         ($5, $6, $7, $8, 3, now())
       ON CONFLICT ("tenantId", "assessmentId", "criterionId") DO NOTHING`,
      [
        ids.developmentScoreA,
        ids.tenantA,
        ids.developmentAssessmentA,
        ids.developmentCriterionA,
        ids.developmentScoreB,
        ids.tenantB,
        ids.developmentAssessmentB,
        ids.developmentCriterionB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "TeacherNote" ("id", "tenantId", "studentId", "teacherId", "visibility", "body", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 'GUARDIAN_STUDENT', 'RLS not A', now()),
         ($5, $6, $7, $8, 'GUARDIAN_STUDENT', 'RLS not B', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.teacherNoteA, ids.tenantA, ids.studentA, ids.teacherA, ids.teacherNoteB, ids.tenantB, ids.studentB, ids.teacherB],
    );

    await adminClient.query(
      `INSERT INTO "ScheduleLesson" ("id", "tenantId", "classId", "teacherId", "title", "startsAt", "endsAt", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 'RLS Ders A', '2026-06-01T09:00:00.000Z', '2026-06-01T10:00:00.000Z', now()),
         ($5, $6, $7, $8, 'RLS Ders B', '2026-06-01T09:00:00.000Z', '2026-06-01T10:00:00.000Z', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.scheduleA, ids.tenantA, ids.classA, ids.teacherA, ids.scheduleB, ids.tenantB, ids.classB, ids.teacherB],
    );

    await adminClient.query(
      `INSERT INTO "StudySession" ("id", "tenantId", "classId", "teacherId", "title", "capacity", "startsAt", "endsAt", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 'RLS Etut A', 4, '2026-06-02T09:00:00.000Z', '2026-06-02T10:00:00.000Z', now()),
         ($5, $6, $7, $8, 'RLS Etut B', 4, '2026-06-02T09:00:00.000Z', '2026-06-02T10:00:00.000Z', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.studyA, ids.tenantA, ids.classA, ids.teacherA, ids.studyB, ids.tenantB, ids.classB, ids.teacherB],
    );

    await adminClient.query(
      `INSERT INTO "StudySessionStudent" ("id", "tenantId", "studySessionId", "studentId", "updatedAt")
       VALUES ($1, $2, $3, $4, now()), ($5, $6, $7, $8, now())
       ON CONFLICT ("tenantId", "studySessionId", "studentId") DO NOTHING`,
      [ids.studyStudentA, ids.tenantA, ids.studyA, ids.studentA, ids.studyStudentB, ids.tenantB, ids.studyB, ids.studentB],
    );

    await adminClient.query(
      `INSERT INTO "HomeworkMaterial" ("id", "tenantId", "title", "description", "updatedAt")
       VALUES ($1, $2, 'RLS Materyal A', 'A materyali', now()), ($3, $4, 'RLS Materyal B', 'B materyali', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.materialA, ids.tenantA, ids.materialB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "HomeworkMaterialFile" ("id", "tenantId", "materialId", "uploadedById", "fileName", "contentType", "byteSize", "sha256", "contentBase64", "updatedAt")
       VALUES
         ($1, $2, $3, 'user-tenant-a', 'rls-material-a.txt', 'text/plain', 1, 'sha-material-a', 'YQ==', now()),
         ($4, $5, $6, 'user-tenant-b', 'rls-material-b.txt', 'text/plain', 1, 'sha-material-b', 'Yg==', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.materialFileA, ids.tenantA, ids.materialA, ids.materialFileB, ids.tenantB, ids.materialB],
    );

    await adminClient.query(
      `INSERT INTO "HomeworkMaterialAssignment" ("id", "tenantId", "materialId", "studentId", "assignedById", "note", "dueAt", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 'user-tenant-a', 'RLS atama A', '2026-06-09T12:00:00.000Z', now()),
         ($5, $6, $7, $8, 'user-tenant-b', 'RLS atama B', '2026-06-09T12:00:00.000Z', now())
       ON CONFLICT ("id") DO NOTHING`,
      [
        ids.materialAssignmentA,
        ids.tenantA,
        ids.materialA,
        ids.studentA,
        ids.materialAssignmentB,
        ids.tenantB,
        ids.materialB,
        ids.studentB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "Homework" ("id", "tenantId", "classId", "sourceMaterialId", "sourceMaterialTitle", "title", "description", "dueAt", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 'RLS Materyal A', 'RLS Odev A', 'A odevi', '2026-06-05T12:00:00.000Z', now()),
         ($5, $6, $7, $8, 'RLS Materyal B', 'RLS Odev B', 'B odevi', '2026-06-05T12:00:00.000Z', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.homeworkA, ids.tenantA, ids.classA, ids.materialA, ids.homeworkB, ids.tenantB, ids.classB, ids.materialB],
    );

    await adminClient.query(
      `INSERT INTO "Exam" ("id", "tenantId", "title", "status", "startsAt", "updatedAt")
       VALUES
         ($1, $2, 'RLS Sınav A', 'PUBLISHED', '2026-06-10T09:00:00.000Z', now()),
         ($3, $4, 'RLS Sınav B', 'PUBLISHED', '2026-06-10T09:00:00.000Z', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.examA, ids.tenantA, ids.examB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "Exam" ("id", "tenantId", "title", "status", "startsAt", "updatedAt")
       VALUES ($1, $2, 'RLS Sınav A2', 'PUBLISHED', '2026-06-11T09:00:00.000Z', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.examA2, ids.tenantA],
    );

    await adminClient.query(
      `INSERT INTO "OpticalFormTemplate" ("id", "tenantId", "name", "version", "encoding", "delimiter", "fieldMapping", "status", "updatedAt")
       VALUES
         ($1, $2, 'RLS Optik Şablon A', 'v1', 'UTF-8', 'TAB', '{"studentNo":{"index":0},"answers":{"start":1}}'::jsonb, 'APPROVED', now()),
         ($3, $4, 'RLS Optik Şablon B', 'v1', 'UTF-8', 'TAB', '{"studentNo":{"index":0},"answers":{"start":1}}'::jsonb, 'APPROVED', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.opticalFormTemplateA, ids.tenantA, ids.opticalFormTemplateB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "ParserConfig" ("id", "tenantId", "examId", "version", "encoding", "delimiter", "fieldMapping", "updatedAt")
       VALUES
         ($1, $2, $3, 'parser-v1', 'UTF-8', 'TAB', '{"studentNo":{"index":0},"answers":{"start":1}}'::jsonb, now()),
         ($4, $5, $6, 'parser-v1', 'UTF-8', 'TAB', '{"studentNo":{"index":0},"answers":{"start":1}}'::jsonb, now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.parserConfigA, ids.tenantA, ids.examA, ids.parserConfigB, ids.tenantB, ids.examB],
    );

    await adminClient.query(
      `INSERT INTO "LearningOutcome" ("id", "tenantId", "code", "branch", "title", "level", "updatedAt")
       VALUES
         ($1, $2, 'MAT.8.1.1', 'Matematik', 'Çarpanlar ve katlar', '8', now()),
         ($3, $4, 'MAT.8.1.1', 'Matematik', 'Tenant B kazanımı', '8', now())
       ON CONFLICT ("tenantId", "code") DO NOTHING`,
      [ids.learningOutcomeA, ids.tenantA, ids.learningOutcomeB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "ExamParticipant" ("id", "tenantId", "examId", "studentId", "participantNo", "status", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 'A-001', 'REGISTERED', now()),
         ($5, $6, $7, $8, 'B-001', 'REGISTERED', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.participantA, ids.tenantA, ids.examA, ids.studentA, ids.participantB, ids.tenantB, ids.examB, ids.studentB],
    );

    await adminClient.query(
      `INSERT INTO "RawImport" ("id", "tenantId", "examId", "sourceType", "fileName", "s3Key", "sha256", "parserConfigVersion", "updatedAt")
       VALUES
         ($1, $2, $3, 'TXT', 'raw-import-a.txt', 'tenant-a/raw-import.txt', 'sha-a', 'parser-v1', now()),
         ($4, $5, $6, 'TXT', 'raw-import-b.txt', 'tenant-b/raw-import.txt', 'sha-b', 'parser-v1', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.rawImportA, ids.tenantA, ids.examA, ids.rawImportB, ids.tenantB, ids.examB],
    );

    await adminClient.query(
      `INSERT INTO "AnswerKey" ("id", "tenantId", "examId", "version", "keyData", "updatedAt")
       VALUES
         ($1, $2, $3, 'answer-key-v1', '{"questions":[{"questionNo":1,"correctAnswer":"A","branch":"Matematik"}]}'::jsonb, now()),
         ($4, $5, $6, 'answer-key-v1', '{"questions":[{"questionNo":1,"correctAnswer":"B","branch":"Matematik"}]}'::jsonb, now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.answerKeyA, ids.tenantA, ids.examA, ids.answerKeyB, ids.tenantB, ids.examB],
    );

    await adminClient.query(
      `INSERT INTO "ExamBookletVariant" ("id", "tenantId", "examId", "code", "permutation", "updatedAt")
       VALUES
         ($1, $2, $3, 'B', '[1]'::jsonb, now()),
         ($4, $5, $6, 'B', '[1]'::jsonb, now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.bookletVariantA, ids.tenantA, ids.examA, ids.bookletVariantB, ids.tenantB, ids.examB],
    );

    await adminClient.query(
      `INSERT INTO "ExamResult" ("id", "tenantId", "examId", "studentId", "participantId", "rawImportId", "answerKeyId", "answerKeyVersion", "parserConfigVersion", "engineVersion", "resultKey", "scoreData", "computedAt", "updatedAt")
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, 'answer-key-v1', 'parser-v1', 'engine-v1', $8, '{"total":{"net":1}}'::jsonb, now(), now()),
         ($9, $10, $11, $12, $13, $14, $15, 'answer-key-v1', 'parser-v1', 'engine-v1', $16, '{"total":{"net":1}}'::jsonb, now(), now())
       ON CONFLICT ("id") DO NOTHING`,
      [
        ids.examResultA,
        ids.tenantA,
        ids.examA,
        ids.studentA,
        ids.participantA,
        ids.rawImportA,
        ids.answerKeyA,
        `${ids.participantA}_answer-key-v1_parser-v1_engine-v1`,
        ids.examResultB,
        ids.tenantB,
        ids.examB,
        ids.studentB,
        ids.participantB,
        ids.rawImportB,
        ids.answerKeyB,
        `${ids.participantB}_answer-key-v1_parser-v1_engine-v1`,
      ],
    );

    await adminClient.query(
      `INSERT INTO "ParsedAnswer" ("id", "tenantId", "examId", "rawImportId", "participantId", "parserConfigVersion", "rowNumber", "answers", "updatedAt")
       VALUES
         ($1, $2, $3, $4, $5, 'parser-v1', 1, '[{"questionNo":1,"answer":"A"}]'::jsonb, now()),
         ($6, $7, $8, $9, $10, 'parser-v1', 1, '[{"questionNo":1,"answer":"B"}]'::jsonb, now())
       ON CONFLICT ("id") DO NOTHING`,
      [
        ids.parsedAnswerA,
        ids.tenantA,
        ids.examA,
        ids.rawImportA,
        ids.participantA,
        ids.parsedAnswerB,
        ids.tenantB,
        ids.examB,
        ids.rawImportB,
        ids.participantB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "ImportQuarantine" ("id", "tenantId", "examId", "rawImportId", "rowNumber", "rawRow", "reason", "updatedAt")
       VALUES
         ($1, $2, $3, $4, 1, '{"studentNo":"UNKNOWN-A"}'::jsonb, 'STUDENT_NOT_FOUND', now()),
         ($5, $6, $7, $8, 1, '{"studentNo":"UNKNOWN-B"}'::jsonb, 'STUDENT_NOT_FOUND', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.quarantineA, ids.tenantA, ids.examA, ids.rawImportA, ids.quarantineB, ids.tenantB, ids.examB, ids.rawImportB],
    );

    await adminClient.query(
      `INSERT INTO "ReportSnapshot" ("id", "tenantId", "examId", "reportType", "status", "inputRefs", "snapshotData", "updatedAt")
       VALUES
         ($1, $2, $3, 'EXAM_SUMMARY', 'READY', '{"rawImportIds":["a"]}'::jsonb, '{"total":1}'::jsonb, now()),
         ($4, $5, $6, 'EXAM_SUMMARY', 'READY', '{"rawImportIds":["b"]}'::jsonb, '{"total":1}'::jsonb, now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.snapshotA, ids.tenantA, ids.examA, ids.snapshotB, ids.tenantB, ids.examB],
    );

    await adminClient.query(
      `INSERT INTO "Announcement" ("id", "tenantId", "title", "body", "audience", "publishedAt", "updatedAt")
       VALUES
         ($1, $2, 'RLS Duyuru A', 'A duyurusu', 'SCHOOL', '2026-06-08T09:00:00.000Z', now()),
         ($3, $4, 'RLS Duyuru B', 'B duyurusu', 'SCHOOL', '2026-06-08T09:00:00.000Z', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.announcementA, ids.tenantA, ids.announcementB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "AnnouncementReceipt" (
         "id", "tenantId", "announcementId", "userId", "subjectType", "subjectId", "readAt", "updatedAt"
       )
       VALUES
         ($1, $2, $3, $4, 'STUDENT', $5, now(), now()),
         ($6, $7, $8, $9, 'STUDENT', $10, now(), now())
       ON CONFLICT ("tenantId", "announcementId", "userId", "subjectType", "subjectId") DO NOTHING`,
      [
        ids.announcementReceiptA,
        ids.tenantA,
        ids.announcementA,
        ids.userA,
        ids.studentA,
        ids.announcementReceiptB,
        ids.tenantB,
        ids.announcementB,
        ids.userB,
        ids.studentB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "MessageTemplate" ("id", "tenantId", "name", "channel", "body", "updatedAt")
       VALUES
         ($1, $2, 'RLS Şablon A', 'SMS', 'A mesajı', now()),
         ($3, $4, 'RLS Şablon B', 'SMS', 'B mesajı', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.messageTemplateA, ids.tenantA, ids.messageTemplateB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "AnnouncementDeliveryReport" (
         "id", "tenantId", "announcementId", "channel", "recipientCount", "deliveredCount", "failedCount", "status", "updatedAt"
       )
       VALUES
         ($1, $2, $3, 'EMAIL', 3, 2, 1, 'completed', now()),
         ($4, $5, $6, 'EMAIL', 1, 1, 0, 'completed', now())
       ON CONFLICT ("tenantId", "announcementId", "channel") DO NOTHING`,
      [
        ids.announcementDeliveryReportA,
        ids.tenantA,
        ids.announcementA,
        ids.announcementDeliveryReportB,
        ids.tenantB,
        ids.announcementB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "SmsBatchDeliveryReport" ("id", "tenantId", "jobId", "templateId", "recipientCount", "status", "updatedAt")
       VALUES
         ($1, $2, 'rls-job-a', $3, 2, 'queued', now()),
         ($4, $5, 'rls-job-b', $6, 1, 'queued', now())
       ON CONFLICT ("tenantId", "jobId") DO NOTHING`,
      [
        ids.smsBatchDeliveryReportA,
        ids.tenantA,
        ids.messageTemplateA,
        ids.smsBatchDeliveryReportB,
        ids.tenantB,
        ids.messageTemplateB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "BackupRestoreJob" (
         "id", "tenantId", "requestedByUserId", "operationType", "targetReference", "reason", "jobId", "status", "checkedTables", "updatedAt"
       )
       VALUES
         ($1, $2, $3, 'BACKUP', 'rls-backup-a', 'RLS smoke A', 'rls-backup-job-a', 'queued', ARRAY['Tenant'], now()),
         ($4, $5, $6, 'BACKUP', 'rls-backup-b', 'RLS smoke B', 'rls-backup-job-b', 'queued', ARRAY['Tenant'], now())
       ON CONFLICT ("tenantId", "jobId") DO NOTHING`,
      [ids.backupRestoreJobA, ids.tenantA, ids.userA, ids.backupRestoreJobB, ids.tenantB, ids.userB],
    );

    await adminClient.query(
      `INSERT INTO "SupportTicket" ("id", "tenantId", "requesterId", "subject", "message", "priority", "status", "updatedAt")
       VALUES
         ($1, $2, 'user-tenant-a', 'RLS Destek A', 'A destek mesajı', 'NORMAL', 'OPEN', now()),
         ($3, $4, 'user-tenant-b', 'RLS Destek B', 'B destek mesajı', 'LOW', 'OPEN', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.supportTicketA, ids.tenantA, ids.supportTicketB, ids.tenantB],
    );

    await adminClient.query(
      `INSERT INTO "SupportTicketAttachment" ("id", "tenantId", "ticketId", "uploadedById", "fileName", "contentType", "byteSize", "sha256", "contentBase64", "updatedAt")
       VALUES
         ($1, $2, $3, 'user-tenant-a', 'rls-a.txt', 'text/plain', 1, 'sha-support-a', 'YQ==', now()),
         ($4, $5, $6, 'user-tenant-b', 'rls-b.txt', 'text/plain', 1, 'sha-support-b', 'Yg==', now())
       ON CONFLICT ("id") DO NOTHING`,
      [
        ids.supportTicketAttachmentA,
        ids.tenantA,
        ids.supportTicketA,
        ids.supportTicketAttachmentB,
        ids.tenantB,
        ids.supportTicketB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "SupportTicketComment" ("id", "tenantId", "ticketId", "authorId", "body", "updatedAt")
       VALUES
         ($1, $2, $3, 'user-tenant-a', 'RLS yorum A', now()),
         ($4, $5, $6, 'user-tenant-b', 'RLS yorum B', now())
       ON CONFLICT ("id") DO NOTHING`,
      [
        ids.supportTicketCommentA,
        ids.tenantA,
        ids.supportTicketA,
        ids.supportTicketCommentB,
        ids.tenantB,
        ids.supportTicketB,
      ],
    );

    await adminClient.query(
      `INSERT INTO "AuditLog" ("id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff", "createdAt")
       VALUES
         ($1, $2, $3, 'RlsSmoke', $4, 'CREATE', '{"tenant":"A"}'::jsonb, '2026-06-12T00:00:00.000Z'),
         ($5, $6, $7, 'RlsSmoke', $8, 'CREATE', '{"tenant":"B"}'::jsonb, '2026-06-12T00:00:00.000Z')
       ON CONFLICT ("id", "createdAt") DO NOTHING`,
      [ids.auditLogA, ids.tenantA, ids.userA, ids.studentA, ids.auditLogB, ids.tenantB, ids.userB, ids.studentB],
    );
  });
}

async function assertTenantAOnlyReadsTenantA(table) {
  await withAppTransaction(async () => {
    await setTenantContext(appClient, ids.tenantA);

    const own = await appClient.query(`SELECT count(*)::int AS count FROM "${table}" WHERE "tenantId" = $1`, [
      ids.tenantA,
    ]);
    const other = await appClient.query(`SELECT count(*)::int AS count FROM "${table}" WHERE "tenantId" = $1`, [
      ids.tenantB,
    ]);

    if (own.rows[0].count < 1) {
      throw new Error(`Tenant A kendi ${table} kaydını okuyamadı.`);
    }

    if (other.rows[0].count !== 0) {
      throw new Error(`Tenant A, Tenant B ${table} kaydını okuyabildi.`);
    }
  });
}

async function assertWithCheckBlocksWrongTenantWrite() {
  await withAppTransaction(async () => {
    await setTenantContext(appClient, ids.tenantA);

    try {
      await appClient.query(
        `INSERT INTO "Student" ("id", "tenantId", "firstName", "lastName", "studentNo", "updatedAt")
         VALUES ('00000000-0000-4000-8000-0000000000ff', $1, 'Yanlış', 'Tenant', 'BAD-001', now())`,
        [ids.tenantB],
      );
    } catch {
      return;
    }

    throw new Error("WITH CHECK yanlış tenant yazımını engellemedi.");
  });
}

async function assertWithCheckBlocksWrongTenantHomeworkWrite() {
  await withAppTransaction(async () => {
    await setTenantContext(appClient, ids.tenantA);

    try {
      await appClient.query(
        `INSERT INTO "Homework" ("id", "tenantId", "classId", "title", "updatedAt")
         VALUES ('00000000-0000-4000-8000-0000000000ee', $1, $2, 'Yanlış Tenant Ödev', now())`,
        [ids.tenantB, ids.classA],
      );
    } catch {
      return;
    }

    throw new Error("WITH CHECK yanlış tenant ödev yazımını engellemedi.");
  });
}

async function assertWithCheckBlocksWrongTenantAnnouncementWrite() {
  await withAppTransaction(async () => {
    await setTenantContext(appClient, ids.tenantA);

    try {
      await appClient.query(
        `INSERT INTO "Announcement" ("id", "tenantId", "title", "body", "audience", "updatedAt")
         VALUES ('00000000-0000-4000-8000-0000000000df', $1, 'Yanlış Tenant Duyuru', 'Yanlış tenant', 'SCHOOL', now())`,
        [ids.tenantB],
      );
    } catch {
      return;
    }

    throw new Error("WITH CHECK yanlış tenant duyuru yazımını engellemedi.");
  });
}

async function assertWithCheckBlocksWrongTenantMessageTemplateWrite() {
  await withAppTransaction(async () => {
    await setTenantContext(appClient, ids.tenantA);

    try {
      await appClient.query(
        `INSERT INTO "MessageTemplate" ("id", "tenantId", "name", "channel", "body", "updatedAt")
         VALUES ('00000000-0000-4000-8000-0000000000de', $1, 'Yanlış Tenant Şablon', 'SMS', 'Yanlış tenant', now())`,
        [ids.tenantB],
      );
    } catch {
      return;
    }

    throw new Error("WITH CHECK yanlış tenant mesaj şablonu yazımını engellemedi.");
  });
}

async function assertExamResultBlocksCrossTenantReferences() {
  await withAppTransaction(async () => {
    await setTenantContext(appClient, ids.tenantA);

    try {
      await appClient.query(
        `INSERT INTO "ExamResult" ("id", "tenantId", "examId", "studentId", "participantId", "rawImportId", "answerKeyId", "answerKeyVersion", "parserConfigVersion", "engineVersion", "resultKey", "scoreData", "computedAt", "updatedAt")
         VALUES ('00000000-0000-4000-8000-0000000000ce', $1, $2, $3, $4, $5, $6, 'answer-key-v1', 'parser-v1', 'engine-v1', 'participant-cross_answer-key-v1_parser-v1_engine-v1', '{"total":{"net":1}}'::jsonb, now(), now())`,
        [ids.tenantA, ids.examA, ids.studentA, ids.participantA, ids.rawImportB, ids.answerKeyA],
      );
    } catch {
      return;
    }

    throw new Error("ExamResult başka tenant RawImport referansını engellemedi.");
  });
}

async function assertParsedAnswerBlocksCrossTenantReferences() {
  await withAppTransaction(async () => {
    await setTenantContext(appClient, ids.tenantA);

    try {
      await appClient.query(
        `INSERT INTO "ParsedAnswer" ("id", "tenantId", "examId", "rawImportId", "participantId", "parserConfigVersion", "answers", "updatedAt")
         VALUES ('00000000-0000-4000-8000-0000000000c3', $1, $2, $3, $4, 'parser-v1', '[{"questionNo":1,"answer":"A"}]'::jsonb, now())`,
        [ids.tenantA, ids.examA, ids.rawImportB, ids.participantA],
      );
    } catch {
      return;
    }

    throw new Error("ParsedAnswer başka tenant RawImport referansını engellemedi.");
  });
}

async function assertParsedAnswerBlocksCrossExamReferences() {
  await withAppTransaction(async () => {
    await setTenantContext(appClient, ids.tenantA);

    try {
      await appClient.query(
        `INSERT INTO "ParsedAnswer" ("id", "tenantId", "examId", "rawImportId", "participantId", "parserConfigVersion", "answers", "updatedAt")
         VALUES ('00000000-0000-4000-8000-0000000000c4', $1, $2, $3, $4, 'parser-v1', '[{"questionNo":1,"answer":"A"}]'::jsonb, now())`,
        [ids.tenantA, ids.examA2, ids.rawImportA, ids.participantA],
      );
    } catch {
      return;
    }

    throw new Error("ParsedAnswer aynı tenant içinde farklı sınav referansını engellemedi.");
  });
}

async function assertParsedAnswerBlocksDuplicateParsedRows() {
  await withAppTransaction(async () => {
    await setTenantContext(appClient, ids.tenantA);

    try {
      await appClient.query(
        `INSERT INTO "ParsedAnswer" ("id", "tenantId", "examId", "rawImportId", "participantId", "parserConfigVersion", "answers", "updatedAt")
         VALUES ('00000000-0000-4000-8000-0000000000c5', $1, $2, $3, $4, 'parser-v1', '[{"questionNo":1,"answer":"A"}]'::jsonb, now())`,
        [ids.tenantA, ids.examA, ids.rawImportA, ids.participantA],
      );
    } catch {
      return;
    }

    throw new Error("ParsedAnswer aynı raw import/participant/parser kombinasyonu tekrarını engellemedi.");
  });
}

let adminConnected = false;
let appConnected = false;

try {
  await adminClient.connect();
  adminConnected = true;
  await appClient.connect();
  appConnected = true;
  await seedFixtures();
  for (const table of tenantReadTables) {
    await assertTenantAOnlyReadsTenantA(table);
  }
  await assertWithCheckBlocksWrongTenantWrite();
  await assertWithCheckBlocksWrongTenantHomeworkWrite();
  await assertWithCheckBlocksWrongTenantAnnouncementWrite();
  await assertWithCheckBlocksWrongTenantMessageTemplateWrite();
  await assertExamResultBlocksCrossTenantReferences();
  await assertParsedAnswerBlocksCrossTenantReferences();
  await assertParsedAnswerBlocksCrossExamReferences();
  await assertParsedAnswerBlocksDuplicateParsedRows();
  console.log(`Canlı RLS kontrolü geçti: ${tenantReadTables.length} tenant tablosunda okuma/yazma izolasyonu doğrulandı.`);
} catch (error) {
  if (error?.code === "ECONNREFUSED") {
    console.error("Canlı RLS kontrolü çalışmadı: localhost:5432 üzerinde Postgres'e bağlanılamadı.");
    console.error("Önce migration uygulanmış lokal Postgres başlatılmalı, sonra tekrar deneyin.");
  } else {
    console.error(error);
  }
  process.exitCode = 1;
} finally {
  if (adminConnected) await adminClient.end();
  if (appConnected) await appClient.end();
}
