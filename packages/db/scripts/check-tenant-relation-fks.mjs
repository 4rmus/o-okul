import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "../prisma/schema.prisma");
const repoRoot = join(__dirname, "../../..");

const allowedLegacyRelations = new Map([]);

const requiredCompositeRelations = new Set([
  "Exam.linkedTytExam",
  "AnnouncementReceipt.announcement",
  "AnnouncementDeliveryReport.announcement",
  "Homework.class",
  "ScheduleLesson.class",
  "StudySession.class",
  "StudySessionStudent.studySession",
  "StudySessionStudent.student",
  "TeacherAssignment.class",
  "TeacherAssignment.student",
  "GuardianStudent.guardian",
  "GuardianStudent.student",
  "DevelopmentAssessment.teacher",
  "TeacherAssignment.teacher",
  "TeacherNote.teacher",
  "ScheduleLesson.teacher",
  "StudySession.teacher",
  "Homework.sourceMaterial",
  "SupportTicket.class",
  "PaymentPlan.class",
  "PaymentTransaction.installment",
  "PaymentTransaction.plan",
  "ReportSnapshot.class",
  "StudentEnrollment.class",
  "Student.class",
  "Student.responsibleTeacher",
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

for (const relationKey of requiredCompositeRelations) {
  const relation = findRelation(models, relationKey);
  if (!relation) {
    failures.push(`${relationKey}: zorunlu tenant composite FK relation'i schema'da yok.`);
  } else if (!hasAlignedTenantId(relation)) {
    failures.push(
      `${relationKey}: zorunlu tenant composite FK degil; fields=[${relation.fields.join(",")}] references=[${relation.references.join(",")}]`,
    );
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
  return Boolean(findRelation(models, relationKey));
}

function findRelation(models, relationKey) {
  const [modelName, fieldName] = relationKey.split(".");
  const model = models.get(modelName);
  if (!model) return undefined;
  return parseOwningRelations(model.body).find((relation) => relation.fieldName === fieldName);
}
