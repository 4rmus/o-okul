import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsPath = join(__dirname, "../prisma/migrations");
const sql = readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readFileSync(join(migrationsPath, entry.name, "migration.sql"), "utf8"))
  .join("\n");

const tenantTables = [
  "TenantMembership",
  "AuthSession",
  "IdentityInvitation",
  "NotificationDeviceToken",
  "Class",
  "Student",
  "StudentEnrollment",
  "Attendance",
  "TeacherNote",
  "PaymentPlan",
  "PaymentInstallment",
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
  "LearningOutcome",
  "ExamParticipant",
  "RawImport",
  "AnswerKey",
  "ExamBookletVariant",
  "ExamResult",
  "ParsedAnswer",
  "ImportQuarantine",
  "ReportSnapshot",
  "Announcement",
  "AnnouncementDeliveryReport",
  "MessageTemplate",
  "SmsBatchDeliveryReport",
  "SupportTicket",
  "SupportTicketAttachment",
  "SupportTicketComment",
  "AuditLog",
];

const failures = [];
const appGrantTables = new Set(
  [...sql.matchAll(/GRANT SELECT, INSERT, UPDATE, DELETE ON([\s\S]*?)TO app;/g)].flatMap((match) =>
    [...(match[1] ?? "").matchAll(/"([^"]+)"/g)].map((tableMatch) => tableMatch[1]),
  ),
);

for (const table of tenantTables) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const enable = new RegExp(`ALTER TABLE "${escaped}" ENABLE ROW LEVEL SECURITY;`);
  const force = new RegExp(`ALTER TABLE "${escaped}" FORCE ROW LEVEL SECURITY;`);
  const policy = new RegExp(`CREATE POLICY "${escaped}_tenant_isolation" ON "${escaped}"[\\s\\S]*?USING[\\s\\S]*?WITH CHECK`, "m");
  const tenantSetting = new RegExp(`"${escaped}"[\\s\\S]*?app\\.current_tenant_id`, "m");
  const bypassSetting = new RegExp(`"${escaped}"[\\s\\S]*?app\\.bypass_rls`, "m");

  if (!enable.test(sql)) failures.push(`${table}: ENABLE ROW LEVEL SECURITY eksik`);
  if (!force.test(sql)) failures.push(`${table}: FORCE ROW LEVEL SECURITY eksik`);
  if (!policy.test(sql)) failures.push(`${table}: USING + WITH CHECK policy eksik`);
  if (!tenantSetting.test(sql)) failures.push(`${table}: app.current_tenant_id kontrolü eksik`);
  if (!bypassSetting.test(sql)) failures.push(`${table}: app.bypass_rls kontrolü eksik`);
  if (!appGrantTables.has(table)) failures.push(`${table}: app rolü için SELECT/INSERT/UPDATE/DELETE yetkisi eksik`);
}

if (failures.length > 0) {
  console.error("RLS policy kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`RLS policy kontrolü geçti: ${tenantTables.length} tenant tablosu doğrulandı.`);
