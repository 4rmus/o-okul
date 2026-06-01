import pg from "pg";

const { Client } = pg;

const adminDatabaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://migration:migration@localhost:5432/uzman_hocam";
const appDatabaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/uzman_hocam";

const adminClient = new Client({ connectionString: adminDatabaseUrl });
const appClient = new Client({ connectionString: appDatabaseUrl });

const ids = {
  tenantA: "00000000-0000-4000-8000-0000000000a1",
  tenantB: "00000000-0000-4000-8000-0000000000b1",
  userA: "00000000-0000-4000-8000-0000000000a8",
  userB: "00000000-0000-4000-8000-0000000000b8",
  authSessionA: "00000000-0000-4000-8000-0000000000a0",
  authSessionB: "00000000-0000-4000-8000-0000000000b0",
  identityInvitationA: "00000000-0000-4000-8000-0000000000a7",
  identityInvitationB: "00000000-0000-4000-8000-0000000000b7",
  classA: "00000000-0000-4000-8000-0000000000a2",
  classB: "00000000-0000-4000-8000-0000000000b2",
  studentA: "00000000-0000-4000-8000-0000000000a3",
  studentB: "00000000-0000-4000-8000-0000000000b3",
  attendanceA: "00000000-0000-4000-8000-0000000000e3",
  attendanceB: "00000000-0000-4000-8000-0000000000e4",
  paymentPlanA: "00000000-0000-4000-8000-0000000000e7",
  paymentPlanB: "00000000-0000-4000-8000-0000000000e8",
  paymentInstallmentA: "00000000-0000-4000-8000-0000000000e9",
  paymentInstallmentB: "00000000-0000-4000-8000-0000000000e0",
  teacherA: "00000000-0000-4000-8000-0000000000a4",
  teacherB: "00000000-0000-4000-8000-0000000000b4",
  teacherNoteA: "00000000-0000-4000-8000-0000000000e5",
  teacherNoteB: "00000000-0000-4000-8000-0000000000e6",
  scheduleA: "00000000-0000-4000-8000-0000000000a5",
  scheduleB: "00000000-0000-4000-8000-0000000000b5",
  studyA: "00000000-0000-4000-8000-0000000000a6",
  studyB: "00000000-0000-4000-8000-0000000000b6",
  studyStudentA: "00000000-0000-4000-8000-0000000000a6",
  studyStudentB: "00000000-0000-4000-8000-0000000000b6",
  materialA: "00000000-0000-4000-8000-0000000000a8",
  materialB: "00000000-0000-4000-8000-0000000000b8",
  materialAssignmentA: "00000000-0000-4000-8000-0000000000d5",
  materialAssignmentB: "00000000-0000-4000-8000-0000000000d6",
  homeworkA: "00000000-0000-4000-8000-0000000000a9",
  homeworkB: "00000000-0000-4000-8000-0000000000b9",
  examA: "00000000-0000-4000-8000-0000000000ea",
  examA2: "00000000-0000-4000-8000-0000000000e2",
  examB: "00000000-0000-4000-8000-0000000000eb",
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
  messageTemplateA: "00000000-0000-4000-8000-0000000000d3",
  messageTemplateB: "00000000-0000-4000-8000-0000000000d4",
  supportTicketA: "00000000-0000-4000-8000-0000000000d7",
  supportTicketB: "00000000-0000-4000-8000-0000000000d8",
  supportTicketAttachmentA: "00000000-0000-4000-8000-0000000000d9",
  supportTicketAttachmentB: "00000000-0000-4000-8000-0000000000da",
  supportTicketCommentA: "00000000-0000-4000-8000-0000000000db",
  supportTicketCommentB: "00000000-0000-4000-8000-0000000000dc",
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
      `INSERT INTO "MessageTemplate" ("id", "tenantId", "name", "channel", "body", "updatedAt")
       VALUES
         ($1, $2, 'RLS Şablon A', 'SMS', 'A mesajı', now()),
         ($3, $4, 'RLS Şablon B', 'SMS', 'B mesajı', now())
       ON CONFLICT ("id") DO NOTHING`,
      [ids.messageTemplateA, ids.tenantA, ids.messageTemplateB, ids.tenantB],
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
  for (const table of [
    "AuthSession",
    "IdentityInvitation",
    "Student",
    "Attendance",
    "PaymentPlan",
    "PaymentInstallment",
    "TeacherNote",
    "ScheduleLesson",
    "StudySession",
    "StudySessionStudent",
    "HomeworkMaterial",
    "HomeworkMaterialAssignment",
    "Homework",
    "Exam",
    "ParserConfig",
    "LearningOutcome",
    "ExamParticipant",
    "RawImport",
    "AnswerKey",
    "ExamResult",
    "ParsedAnswer",
    "ImportQuarantine",
    "ReportSnapshot",
    "Announcement",
    "MessageTemplate",
    "SupportTicket",
    "SupportTicketAttachment",
    "SupportTicketComment",
  ]) {
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
  console.log("Canlı RLS kontrolü geçti: tenant okuma/yazma izolasyonu doğrulandı.");
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
