import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const sourceRoots = ["apps/api/src", "apps/worker/src"];
const ignoredFiles = new Set([
  "apps/api/src/db/tenant-query.ts",
  "apps/api/src/health/health.service.ts",
]);
const tenantScopedTables = [
  "TenantMembership",
  "Class",
  "Student",
  "Teacher",
  "Guardian",
  "GuardianStudent",
  "ScheduleLesson",
  "StudySession",
  "StudySessionStudent",
  "HomeworkMaterial",
  "HomeworkMaterialFile",
  "HomeworkMaterialAssignment",
  "Homework",
  "Exam",
  "ParserConfig",
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
  "AuditLog",
];

const failures = [];

for (const file of sourceRoots.flatMap(listTsFiles)) {
  if (ignoredFiles.has(file) || file.endsWith(".test.ts") || file.endsWith(".e2e.test.ts")) {
    continue;
  }

  const contents = readFileSync(file, "utf8");
  if (!usesSql(contents) || !touchesTenantScopedTable(contents)) {
    continue;
  }

  if (!contents.includes("withTenantQuery") && !contents.includes("withTenantDb")) {
    failures.push(`${file}: tenant tablosu SQL'i withTenantQuery/withTenantDb dışından çalışıyor.`);
  }
}

if (failures.length > 0) {
  console.error("Tenant DB erişim kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Tenant DB erişim kontrolü geçti.");

function listTsFiles(root) {
  const entries = readdirSync(root);
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listTsFiles(path));
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

function usesSql(contents) {
  return contents.includes(".query(") || contents.includes(".query<") || contents.includes("new pg.Pool");
}

function touchesTenantScopedTable(contents) {
  return tenantScopedTables.some((table) => contents.includes(`"${table}"`));
}
