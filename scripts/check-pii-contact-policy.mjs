import { readFileSync } from "node:fs";

const paths = {
  decisions: "docs/DECISIONS.md",
  kvkkChecker: "scripts/check-kvkk-inventory-evidence.mjs",
  kvkkTemplate: "docs/evidence-templates/kvkk-inventory.example.json",
  productionSummaryTemplate: "docs/evidence-templates/production-evidence-summary.example.json",
  goLiveChecker: "scripts/check-go-live-evidence.mjs",
  schema: "packages/db/prisma/schema.prisma",
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
], failures);

requireTokens(paths.kvkkChecker, files.kvkkChecker, [
  "expectedPurgeCoverage",
  'student: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone", "email", "photoKey"]',
  'teacher: ["firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone"]',
  'guardian: ["firstName", "lastName", "phone"]',
  'user: ["email", "name"]',
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
], failures);

requirePurgeCoverage(paths.kvkkTemplate, kvkkTemplate.purgeCoverage, failures);
requirePurgeCoverage(
  paths.productionSummaryTemplate,
  productionSummaryTemplate.reports?.kvkkInventory?.purgeCoverage,
  failures,
);

const studentModel = requirePrismaModel("Student", files.schema, failures);
const guardianModel = requirePrismaModel("Guardian", files.schema, failures);
const userModel = requirePrismaModel("User", files.schema, failures);

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
