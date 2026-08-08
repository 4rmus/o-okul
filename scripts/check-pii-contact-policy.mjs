import { readFileSync } from "node:fs";

const paths = {
  decisions: "docs/DECISIONS.md",
  kvkkChecker: "scripts/check-kvkk-inventory-evidence.mjs",
  kvkkTemplate: "docs/evidence-templates/kvkk-inventory.example.json",
  productionSummaryTemplate: "docs/evidence-templates/production-evidence-summary.example.json",
  goLiveChecker: "scripts/check-go-live-evidence.mjs",
  rlsLive: "packages/db/scripts/check-rls-live.mjs",
  schema: "packages/db/prisma/schema.prisma",
  whatsappConsentMigration: "packages/db/prisma/migrations/20260808150000_add_whatsapp_consent_foundation/migration.sql",
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

if (studentModel) {
  requirePrismaField(paths.schema, "Student", studentModel, "phone", /(^|\n)\s+phone\s+String\?/m, failures);
  requirePrismaField(paths.schema, "Student", studentModel, "email", /(^|\n)\s+email\s+String\?/m, failures);
  requirePrismaField(paths.schema, "Student", studentModel, "nationalIdEncrypted", /nationalIdEncrypted\s+String\?/m, failures);
  requirePrismaField(paths.schema, "Student", studentModel, "nationalIdHash", /nationalIdHash\s+String\?/m, failures);
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

requireTokens(paths.rlsLive, files.rlsLive, [
  "assertWhatsAppConsentTenantIsolationAndDefaultOff",
  `if (table === "WhatsAppConsent") continue;`,
  "RLS_TRANSACTION_FIXTURE",
  "WhatsApp izin kayıtları tenant okuma izolasyonunu korumadı.",
], failures);
const seedFixturesSource = /async function seedFixtures\(\) \{([\s\S]*?)\n\}\n\nasync function assertTenantAOnlyReadsTenantA/.exec(files.rlsLive)?.[1];
if (!seedFixturesSource) {
  failures.push(`${paths.rlsLive} seedFixtures source could not be inspected.`);
} else if (seedFixturesSource.includes(`INSERT INTO "WhatsAppConsent"`)) {
  failures.push(`${paths.rlsLive} WhatsAppConsent fixtures must stay inside a rollback transaction.`);
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
  requireArrayIncludes(
    path,
    "whatsappConsent.storedFields",
    inventory.storedFields,
    ["phoneHash", "purpose", "canReceiveWhatsapp", "noticeVersion", "source", "recordedAt", "withdrawnAt"],
    output,
  );
  if (inventory.storedFields?.length !== 7) {
    output.push(`${path} whatsappConsent.storedFields must contain exactly 7 fields.`);
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
