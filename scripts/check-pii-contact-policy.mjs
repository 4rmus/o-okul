import { globSync, readFileSync } from "node:fs";

const paths = {
  decisions: "docs/DECISIONS.md",
  kvkkChecker: "scripts/check-kvkk-inventory-evidence.mjs",
  kvkkTemplate: "docs/evidence-templates/kvkk-inventory.example.json",
  productionSummaryTemplate: "docs/evidence-templates/production-evidence-summary.example.json",
  goLiveChecker: "scripts/check-go-live-evidence.mjs",
  rlsLive: "packages/db/scripts/check-rls-live.mjs",
  schema: "packages/db/prisma/schema.prisma",
  whatsappConsentMigration: "packages/db/prisma/migrations/20260808150000_add_whatsapp_consent_foundation/migration.sql",
  whatsappConsentLifecycleMigration: "packages/db/prisma/migrations/20260808170000_add_whatsapp_consent_lifecycle/migration.sql",
  whatsappConsentStore: "apps/api/src/whatsapp-consent/whatsapp-consent-store.ts",
  apiLogging: "apps/api/src/observability/logging.ts",
  apiSentry: "apps/api/src/observability/sentry.ts",
  apiLoggingTest: "apps/api/src/observability/logging.test.ts",
  apiSentryTest: "apps/api/src/observability/sentry.test.ts",
  readiness: "docs/phase-6-production-readiness.md",
  packageJson: "package.json",
};

const files = Object.fromEntries(
  Object.entries(paths).map(([key, path]) => [key, readFileSync(path, "utf8")]),
);
const packageJson = JSON.parse(files.packageJson);
const kvkkTemplate = JSON.parse(files.kvkkTemplate);
const productionSummaryTemplate = JSON.parse(files.productionSummaryTemplate);

const failures = [];

requireTokens(paths.decisions, files.decisions, [
  "DEC-20260613-05",
  "V1 contact PII retention policy",
  "Student.phone",
  "Student.email",
  "Guardian.phone",
  "User.email",
  "Guardian.email is not a persisted Guardian column",
  "STUDENT_PII_ENCRYPTION_KEY",
  "STUDENT_PII_HASH_KEY",
  "SENTRY_SEND_DEFAULT_PII=false",
  "scripts/check-pii-contact-policy.mjs",
  "pnpm pii:contact-policy:check",
  "pnpm privacy:inventory:check",
  "Real staging/prod KVKK inventory",
  "DEC-20260808-01",
  "WhatsAppConsent",
  "phoneHash",
], failures);

requireTokens(paths.kvkkChecker, files.kvkkChecker, [
  "expectedPurgeCoverage",
  'student: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone", "email", "photoKey"]',
  'teacher: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone"]',
  'guardian: ["firstName", "lastName", "phone"]',
  'user: ["email", "name"]',
  "expectedWhatsappConsentStoredFields",
  "requireWhatsappConsent(report.whatsappConsent, failures)",
  "NO_RECORDS_WHILE_DISABLED",
  "requireExactStringSet(coverage[subject], failures, `purgeCoverage.${subject}`, expectedFields, \"alan\")",
  "kvkk.student_pii_purged",
  "kvkk.guardian_pii_purged",
  "kvkk.user_pii_purged",
], failures);

requireTokens(paths.goLiveChecker, files.goLiveChecker, [
  'student: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone", "email", "photoKey"]',
  'teacher: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone"]',
  'guardian: ["firstName", "lastName", "phone"]',
  'user: ["email", "name"]',
  "expectedWhatsappConsentStoredFields",
  "requireSummaryWhatsappConsent(report, failures)",
  "NO_RECORDS_WHILE_DISABLED",
], failures);

requirePurgeCoverage(paths.kvkkTemplate, kvkkTemplate.purgeCoverage, failures);
requirePurgeCoverage(
  paths.productionSummaryTemplate,
  productionSummaryTemplate.reports?.kvkkInventory?.purgeCoverage,
  failures,
);
requireWhatsAppConsentInventory(paths.kvkkTemplate, kvkkTemplate.whatsappConsent, failures);
requireWhatsAppConsentInventory(
  paths.productionSummaryTemplate,
  productionSummaryTemplate.reports?.kvkkInventory?.whatsappConsent,
  failures,
);

const studentModel = requirePrismaModel("Student", files.schema, failures);
const guardianModel = requirePrismaModel("Guardian", files.schema, failures);
const userModel = requirePrismaModel("User", files.schema, failures);
const whatsappConsentModel = requirePrismaModel("WhatsAppConsent", files.schema, failures);
const whatsappConsentEventModel = requirePrismaModel("WhatsAppConsentEvent", files.schema, failures);

if (studentModel) {
  requirePrismaField(paths.schema, "Student", studentModel, "phone", /(^|\n)\s+phone\s+String\?/m, failures);
  requirePrismaField(paths.schema, "Student", studentModel, "email", /(^|\n)\s+email\s+String\?/m, failures);
  requirePrismaField(paths.schema, "Student", studentModel, "nationalIdEncrypted", /nationalIdEncrypted\s+String\?/m, failures);
  requirePrismaField(paths.schema, "Student", studentModel, "nationalIdHash", /nationalIdHash\s+String\?/m, failures);
}
if (whatsappConsentEventModel) {
  requirePrismaField(paths.schema, "WhatsAppConsentEvent", whatsappConsentEventModel, "studentContactId", /(^|\n)\s+studentContactId\s+String/m, failures);
  if (/(^|\n)\s+(phone|phoneHash|phoneEncrypted)\s+/m.test(whatsappConsentEventModel)) {
    failures.push(`${paths.schema} WhatsAppConsentEvent ham telefon veya telefon hash'i kopyalamamalı.`);
  }
}
if (guardianModel) {
  requirePrismaField(paths.schema, "Guardian", guardianModel, "phone", /(^|\n)\s+phone\s+String\?/m, failures);
  if (/(^|\n)\s+email\s+/m.test(guardianModel)) {
    failures.push(`${paths.schema} Guardian.email must not be a separate persisted column; guardian account email is User.email.`);
  }
}
if (userModel) {
  requirePrismaField(paths.schema, "User", userModel, "email", /(^|\n)\s+email\s+String/m, failures);
}
if (whatsappConsentModel) {
  requirePrismaField(paths.schema, "WhatsAppConsent", whatsappConsentModel, "phoneHash", /(^|\n)\s+phoneHash\s+String/m, failures);
  requirePrismaField(
    paths.schema,
    "WhatsAppConsent",
    whatsappConsentModel,
    "canReceiveWhatsapp",
    /(^|\n)\s+canReceiveWhatsapp\s+Boolean\s+@default\(false\)/m,
    failures,
  );
  if (/(^|\n)\s+(phone|phoneEncrypted|canReceiveSms)\s+/m.test(whatsappConsentModel)) {
    failures.push(`${paths.schema} WhatsAppConsent ham telefon, şifreli telefon veya SMS izni taşımamalı.`);
  }
}

requireTokens(paths.whatsappConsentMigration, files.whatsappConsentMigration, [
  `"phoneHash" TEXT NOT NULL`,
  `"canReceiveWhatsapp" BOOLEAN NOT NULL DEFAULT false`,
  "WhatsAppConsent_phoneHash_check",
  "WhatsAppConsent_state_check",
  `AND ("withdrawnAt" IS NULL OR "withdrawnAt" >= "recordedAt")`,
  `ALTER TABLE "WhatsAppConsent" FORCE ROW LEVEL SECURITY;`,
], failures);
if (/GuardianStudent|canReceiveSms/.test(files.whatsappConsentMigration)) {
  failures.push(`${paths.whatsappConsentMigration} SMS veya Guardian izninden WhatsApp opt-in üretmemeli.`);
}
requireTokens(paths.whatsappConsentLifecycleMigration, files.whatsappConsentLifecycleMigration, [
  `CREATE TABLE "WhatsAppConsentEvent"`,
  `FOREIGN KEY ("tenantId", "studentContactId")`,
  `contact."phoneHash"`,
  `WHATSAPP_CONSENT_CONTACT_INACTIVE_OR_PHONE_MISMATCH`,
], failures);
requireTokens(paths.whatsappConsentStore, files.whatsappConsentStore, [
  `studentContactId: string`,
  `commandKey: string`,
  `createHash("sha256")`,
  `o-okul:whatsapp-consent:command:v1`,
  `o-okul:whatsapp-consent:request:v1`,
  `FROM "StudentContact"`,
  `AND "deletedAt" IS NULL`,
  `AND "phoneHash" IS NOT NULL`,
  `consent."phoneHash" = contact."phoneHash"`,
  `latest_event."sequence" = consent."version"`,
  `latest_contact."phoneHash" = consent."phoneHash"`,
  `withTenantQuery(this.pool`,
], failures);
const recordDecisionInput = /interface RecordWhatsAppConsentDecisionInput \{([\s\S]*?)\n\}/.exec(files.whatsappConsentStore)?.[1] ?? "";
if (/\b(?:phone|phoneHash|phoneEncrypted)\b/.test(recordDecisionInput)) {
  failures.push(`${paths.whatsappConsentStore} recordDecision caller'dan telefon veya phoneHash kabul etmemeli.`);
}
if (/\b(?:commandKeyHash|requestHash)\b/.test(recordDecisionInput)) {
  failures.push(`${paths.whatsappConsentStore} recordDecision caller'dan prehashed idempotency alanı kabul etmemeli.`);
}

for (const seedPath of globSync("packages/db/prisma/seed*.ts")) {
  const seedSource = readFileSync(seedPath, "utf8");
  if (/WhatsAppConsent(?:Event)?/.test(seedSource)) {
    failures.push(`${seedPath} WhatsApp consent runtime/seed kaydı üretmemeli.`);
  }
}
for (const runtimePath of globSync(["apps/api/src/**/*.ts", "apps/worker/src/**/*.ts"])) {
  if (runtimePath === paths.whatsappConsentStore || runtimePath.endsWith("whatsapp-consent-store.test.ts")) continue;
  const runtimeSource = readFileSync(runtimePath, "utf8");
  if (/PostgresWhatsAppConsentStore|whatsapp-consent\/whatsapp-consent-store/.test(runtimeSource)) {
    failures.push(`${runtimePath} WhatsApp consent store runtime wiring yapmamalı.`);
  }
}

requireTokens(paths.rlsLive, files.rlsLive, [
  "assertWhatsAppConsentTenantIsolationAndDefaultOff",
  `"WhatsAppConsentEvent"`,
  "Grant-withdraw-regrant immutable lifecycle/projection sonucu geçersiz.",
  "WhatsApp projection/event cross-tenant read rowCount=0 olmadı.",
], failures);
const seedFixturesSource = /async function seedFixtures\(\) \{([\s\S]*?)\n\}\n\nasync function assertTenantAOnlyReadsTenantA/.exec(files.rlsLive)?.[1];
if (!seedFixturesSource) {
  failures.push(`${paths.rlsLive} seedFixtures source could not be inspected.`);
} else if (seedFixturesSource.includes(`INSERT INTO "WhatsAppConsent"`) || seedFixturesSource.includes(`INSERT INTO "WhatsAppConsentEvent"`)) {
  failures.push(`${paths.rlsLive} WhatsApp consent fixtures must stay inside a rollback transaction.`);
}

requireTokens(paths.apiLogging, files.apiLogging, [
  "redactLogValue",
  "emailPattern",
  "turkishPhonePattern",
  "[FilteredEmail]",
  "[FilteredPhone]",
  '"email"',
  '"phone"',
  '"body.email"',
  '"body.phone"',
], failures);

requireTokens(paths.apiSentry, files.apiSentry, [
  "SENTRY_SEND_DEFAULT_PII_MUST_BE_FALSE",
  "sendDefaultPii: false",
  "emailPattern",
  "turkishPhonePattern",
  "[FilteredEmail]",
  "[FilteredPhone]",
  "dataCollection",
  "userInfo: false",
  "queryParams: false",
], failures);

requireTokens(paths.apiLoggingTest, files.apiLoggingTest, [
  "redacts PII keys and string values",
  "veli@example.test",
  "phone",
  "not.toContain(\"veli@example.test\")",
], failures);

requireTokens(paths.apiSentryTest, files.apiSentryTest, [
  "Sentry SDK options keep default PII collection disabled",
  "PII collection cannot be enabled by env drift",
  "scrubs explicit event payload fields before send",
  "SENTRY_SEND_DEFAULT_PII_MUST_BE_FALSE",
], failures);

requireTokens(paths.readiness, files.readiness, [
  "DEC-20260613-05",
  "Student.phone",
  "Student.email",
  "Guardian.phone",
  "User.email",
  "pnpm pii:contact-policy:check",
  "pnpm privacy:inventory:check",
  "WhatsAppConsent",
  "WhatsApp smoke",
  "WhatsAppConsent.recordCount=0",
  "WhatsAppConsentEvent.eventRecordCount=0",
  "NO_RECORDS_WHILE_DISABLED",
], failures);

const scripts = packageJson.scripts ?? {};
if (scripts["pii:contact-policy:check"] !== "node scripts/check-pii-contact-policy.mjs") {
  failures.push("package.json pii:contact-policy:check must run node scripts/check-pii-contact-policy.mjs.");
}
if (!scripts["ops:check"]?.includes("pnpm pii:contact-policy:check")) {
  failures.push("package.json ops:check must run pii:contact-policy:check.");
}
if (!scripts.ci?.includes("pnpm pii:contact-policy:check")) {
  failures.push("package.json ci must run pii:contact-policy:check.");
}

if (failures.length > 0) {
  console.error("PII contact policy check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("PII contact policy check passed.");

function requireTokens(path, source, tokens, output) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      output.push(`${path} missing expected token: ${token}`);
    }
  }
}

function requirePurgeCoverage(path, coverage, output) {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
    output.push(`${path} purgeCoverage object is required.`);
    return;
  }
  requireArrayIncludes(path, "purgeCoverage.student", coverage.student, ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone", "email", "photoKey"], output);
  requireArrayIncludes(path, "purgeCoverage.teacher", coverage.teacher, ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone"], output);
  requireArrayIncludes(path, "purgeCoverage.guardian", coverage.guardian, ["firstName", "lastName", "phone"], output);
  requireArrayIncludes(path, "purgeCoverage.user", coverage.user, ["email", "name"], output);
}

function requireWhatsAppConsentInventory(path, inventory, output) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    output.push(`${path} whatsappConsent object is required.`);
    return;
  }
  if (inventory.recordCount !== 0) {
    output.push(`${path} whatsappConsent.recordCount must be 0 while WhatsApp is disabled.`);
  }
  if (inventory.eventRecordCount !== 0) {
    output.push(`${path} whatsappConsent.eventRecordCount must be 0 while WhatsApp is disabled.`);
  }
  requireArrayIncludes(
    path,
    "whatsappConsent.piiRelevantStoredFields",
    inventory.piiRelevantStoredFields,
    ["phoneHash", "purpose", "canReceiveWhatsapp", "version", "noticeVersion", "source", "recordedAt", "withdrawnAt"],
    output,
  );
  if (inventory.piiRelevantStoredFields?.length !== 8) {
    output.push(`${path} whatsappConsent.piiRelevantStoredFields must contain exactly 8 fields.`);
  }
  requireArrayIncludes(
    path,
    "whatsappConsent.piiRelevantEventStoredFields",
    inventory.piiRelevantEventStoredFields,
    ["whatsappConsentId", "studentContactId", "purpose", "sequence", "eventType", "noticeVersion", "source", "recordedAt", "commandKeyHash", "requestHash"],
    output,
  );
  if (inventory.piiRelevantEventStoredFields?.length !== 10) {
    output.push(`${path} whatsappConsent.piiRelevantEventStoredFields must contain exactly 10 fields.`);
  }

  const policy = inventory.policy;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    output.push(`${path} whatsappConsent.policy object is required.`);
    return;
  }
  if (policy.featureEnabled !== false || policy.retentionPeriodDays !== 0
    || policy.disposalMethod !== "NO_RECORDS_WHILE_DISABLED" || policy.purgeException !== false) {
    output.push(`${path} whatsappConsent.policy must keep the disabled no-records contract.`);
  }
  if (typeof policy.explanation !== "string" || policy.explanation.trim() === "") {
    output.push(`${path} whatsappConsent.policy.explanation must be non-empty.`);
  }
}

function requireArrayIncludes(path, label, value, expected, output) {
  if (!Array.isArray(value)) {
    output.push(`${path} ${label} must be an array.`);
    return;
  }
  for (const item of expected) {
    if (!value.includes(item)) {
      output.push(`${path} ${label} missing ${item}.`);
    }
  }
}

function requirePrismaModel(name, source, output) {
  const match = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!match) {
    output.push(`${paths.schema} missing Prisma model ${name}.`);
    return undefined;
  }
  return match[1];
}

function requirePrismaField(path, modelName, modelSource, fieldName, pattern, output) {
  if (!pattern.test(modelSource)) {
    output.push(`${path} ${modelName}.${fieldName} field contract missing.`);
  }
}
