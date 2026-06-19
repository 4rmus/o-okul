import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "../prisma/schema.prisma");
const repoRoot = join(__dirname, "../../..");

const allowedLegacyRelations = new Map([
  ["DevelopmentAssessment.teacher", legacy("service tests keep teacher scope until composite migration", ["apps/api/src/development/development.service.test.ts"])],
  [
    "Student.class",
    legacy("student flows are tenant-filtered until composite migration", ["apps/api/src/student/student-profile.e2e.test.ts"], ["cross-tenant classId"]),
  ],
  [
    "Student.responsibleTeacher",
    legacy("teacher scope tests cover access until composite migration", ["apps/api/src/student/student-profile.e2e.test.ts"], ["responsibleTeacherId"]),
  ],
  [
    "StudentClassHistory.class",
    legacy("history writes are service-filtered until composite migration", ["apps/api/src/school/school.e2e.test.ts"], ["enrollments/renew", "enrollments/transfer", "class-b"]),
  ],
  [
    "StudentEnrollment.class",
    legacy("enrollment writes are service-filtered until composite migration", ["apps/api/src/school/school.e2e.test.ts"], ["enrollments/renew", "bulk-renew", "class-b"]),
  ],
  ["TeacherAssignment.teacher", legacy("assignment tests cover tenant scope until composite migration", ["apps/api/src/school/teacher-assignment-store.test.ts"])],
  ["TeacherAssignment.class", legacy("assignment tests cover tenant scope until composite migration", ["apps/api/src/school/teacher-assignment-store.test.ts"])],
  ["TeacherAssignment.student", legacy("assignment tests cover tenant scope until composite migration", ["apps/api/src/school/teacher-assignment-store.test.ts"])],
  ["GuardianStudent.guardian", legacy("guardian-student tests cover tenant scope until composite migration", ["apps/api/src/school/guardian-student-store.test.ts"])],
  ["GuardianStudent.student", legacy("guardian-student tests cover tenant scope until composite migration", ["apps/api/src/school/guardian-student-store.test.ts"])],
  ["TeacherNote.teacher", legacy("teacher note tests cover tenant scope until composite migration", ["apps/api/src/teacher-note/teacher-note.e2e.test.ts"])],
  ["PaymentPlan.class", legacy("payment tests cover tenant scope until composite migration", ["apps/api/src/payment/payment.e2e.test.ts"])],
  ["ScheduleLesson.class", legacy("schedule tests cover tenant scope until composite migration", ["apps/api/src/program/schedule.e2e.test.ts"])],
  ["ScheduleLesson.teacher", legacy("schedule tests cover tenant scope until composite migration", ["apps/api/src/program/schedule.e2e.test.ts"])],
  ["StudySession.class", legacy("study-session tests cover tenant scope until composite migration", ["apps/api/src/program/study-session.e2e.test.ts"])],
  ["StudySession.teacher", legacy("study-session tests cover tenant scope until composite migration", ["apps/api/src/program/study-session.e2e.test.ts"])],
  ["StudySessionStudent.studySession", legacy("study-session tests cover tenant scope until composite migration", ["apps/api/src/program/study-session.e2e.test.ts"])],
  ["StudySessionStudent.student", legacy("study-session tests cover tenant scope until composite migration", ["apps/api/src/program/study-session.e2e.test.ts"])],
  ["Homework.class", legacy("homework tests cover tenant scope until composite migration", ["apps/api/src/homework/homework.e2e.test.ts"])],
  ["Homework.sourceMaterial", legacy("homework tests cover tenant scope until composite migration", ["apps/api/src/homework/homework.e2e.test.ts"])],
  ["ReportSnapshot.class", legacy("report service tests cover tenant scope until composite migration", ["apps/api/src/report/report-generation.service.test.ts"])],
  ["AnnouncementDeliveryReport.announcement", legacy("announcement delivery tests cover tenant scope until composite migration", ["apps/api/src/announcement/announcement-delivery-report-store.test.ts"])],
  ["SupportTicket.class", legacy("support-ticket tests cover tenant scope until composite migration", ["apps/api/src/support-ticket/support-ticket.e2e.test.ts"])],
]);

const schema = readFileSync(schemaPath, "utf8");
const models = parseModels(schema);
const failures = [];
let compositeCount = 0;
let exceptionCount = 0;

for (const model of models.values()) {
  if (!model.hasTenantId) continue;

  for (const relation of parseOwningRelations(model.body)) {
    const target = models.get(relation.targetModel);
    if (!target?.hasTenantId) continue;

    const relationKey = `${model.name}.${relation.fieldName}`;
    if (hasAlignedTenantId(relation)) {
      compositeCount += 1;
      continue;
    }

    const exception = allowedLegacyRelations.get(relationKey);
    if (exception) {
      validateLegacyException(relationKey, exception, failures);
      exceptionCount += 1;
      continue;
    }

    failures.push(
      `${relationKey}: tenant model iliskisi composite FK degil; fields=[${relation.fields.join(",")}] references=[${relation.references.join(",")}]`,
    );
  }
}

for (const relationKey of allowedLegacyRelations.keys()) {
  if (!relationExists(models, relationKey)) {
    failures.push(`${relationKey}: legacy FK istisnasi artik schema'da yok; allowlist'ten kaldirilmali.`);
  }
}

if (failures.length > 0) {
  console.error("Tenant relation FK kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Tenant relation FK kontrolü geçti: ${compositeCount} composite, ${exceptionCount} izlenen legacy istisna.`);

function parseModels(source) {
  const output = new Map();
  for (const match of source.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)) {
    const [, name, body = ""] = match;
    output.set(name, {
      name,
      body,
      hasTenantId: /^\s*tenantId\s+String\??\b/m.test(body),
    });
  }
  return output;
}

function parseOwningRelations(modelBody) {
  const relations = [];
  for (const line of modelBody.split(/\r?\n/)) {
    const relation = line
      .trim()
      .match(/^(\w+)\s+(\w+)\??\s+@relation\(([^)]*)\)/);
    if (!relation) continue;

    const [, fieldName, targetModel, args] = relation;
    const fields = readRelationList(args, "fields");
    const references = readRelationList(args, "references");
    if (fields.length === 0 || references.length === 0) continue;

    relations.push({ fieldName, targetModel, fields, references });
  }
  return relations;
}

function readRelationList(args, key) {
  const match = args.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
  return (match?.[1] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasAlignedTenantId(relation) {
  const fieldIndex = relation.fields.indexOf("tenantId");
  const referenceIndex = relation.references.indexOf("tenantId");
  return fieldIndex !== -1 && fieldIndex === referenceIndex;
}

function legacy(reason, tests, sentinels = []) {
  return { reason, sentinels, tests };
}

function validateLegacyException(relationKey, exception, output) {
  if (!exception.reason || exception.tests.length === 0) {
    output.push(`${relationKey}: legacy FK istisnasi reason ve test dosyasi tasimali.`);
    return;
  }
  for (const testPath of exception.tests) {
    const fullPath = join(repoRoot, testPath);
    if (!existsSync(fullPath)) {
      output.push(`${relationKey}: legacy FK test kaniti bulunamadi: ${testPath}`);
      continue;
    }
    const contents = readFileSync(fullPath, "utf8");
    for (const sentinel of exception.sentinels) {
      if (!contents.includes(sentinel)) {
        output.push(`${relationKey}: legacy FK test kaniti sentinel icermiyor: ${testPath} -> ${sentinel}`);
      }
    }
  }
}

function relationExists(models, relationKey) {
  const [modelName, fieldName] = relationKey.split(".");
  const model = models.get(modelName);
  if (!model) return false;
  return parseOwningRelations(model.body).some((relation) => relation.fieldName === fieldName);
}
