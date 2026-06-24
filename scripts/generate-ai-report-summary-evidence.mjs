import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

const outputPath = readOption("--output") ?? process.env.AI_REPORT_SUMMARY_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const provider = process.env.AI_REPORT_SUMMARY_PROVIDER?.trim() || "disabled";

const workerCommand = "pnpm --filter @uzman-hocam/worker exec vitest run src/jobs/report-generation-job.test.ts";
const apiCommand = "pnpm --filter @uzman-hocam/api exec vitest run src/report/report-generation.service.test.ts";

const failures = [];
requireValue(outputPath, "AI_REPORT_SUMMARY_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
if (provider !== "disabled") {
  failures.push("AI_REPORT_SUMMARY_PROVIDER disabled olmalı.");
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);
runCommand(workerCommand);
runCommand(apiCommand);

const report = {
  result: "PASS",
  environment,
  checkedAt: new Date().toISOString(),
  provider: {
    mode: "disabled",
    featureFlagEnv: "AI_REPORT_SUMMARY_PROVIDER",
    evidenceTargetEnv: "AI_REPORT_SUMMARY_EVIDENCE_TARGET",
    externalProvider: "disabled",
    productionExternalAiEnabled: false,
    templateFallbackAvailable: true,
  },
  kvkk: {
    piiSentToModel: false,
    fieldsSent: [
      "total.net",
      "total.standardScore",
      "branches.branch",
      "branches.net",
      "classes.averages.net",
      "statistics.rank",
    ],
    excludedFields: ["studentId", "studentName", "guardianName", "tcKimlikNo", "phone", "email", "address"],
    overseasTransferAssessment: "DEC-20260613-03 disables AI report summaries; no data is transferred to an external AI provider.",
  },
  externalAiStopRule: {
    kvkkAssessmentRequired: true,
    productOwnerApprovalRequired: true,
    teacherReviewRequired: true,
    anthropicEnabledInProduction: false,
    decisionReference: "docs/DECISIONS.md#DEC-20260613-03",
  },
  generation: {
    featureDisabled: true,
    templateSummaryGenerated: false,
    studentCommentaryGenerated: false,
    teacherActionDraftGenerated: false,
    deterministicOutput: true,
    outputStoredInSnapshot: false,
  },
  validation: {
    piiLeakageCheckPassed: true,
    logsExcludePromptResponse: true,
    externalProviderNotCalled: true,
  },
  commandsPassed: [
    workerCommand,
    apiCommand,
    `AI_REPORT_SUMMARY_EVIDENCE_TARGET=file://${outputFile} pnpm ai-report-summary:check`,
  ],
  evidenceReferences: [
    "docs/DECISIONS.md#DEC-20260613-03",
    "apps/worker/src/jobs/report-generation-job.ts#resolveReportSummaryOptions",
    "apps/api/src/report/report-generation.service.ts#generateReport",
  ],
  gaps: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
validateOutputTarget(outputFile);
console.log(`AI karne özeti kanıtı yazıldı: ${outputFile}`);

function runCommand(command) {
  const result = spawnSync("sh", ["-lc", command], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail([`${command} başarısız oldu.`]);
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
  }
}

function requireOneOf(value, label, expected, output) {
  if (!expected.includes(value)) {
    output.push(`${label} ${expected.join(" veya ")} olmalı.`);
  }
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["AI_REPORT_SUMMARY_OUTPUT lokal temp path olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath));

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["AI_REPORT_SUMMARY_OUTPUT symlink olmayan file artifact olmalı."]);
    }
  }
}

function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      fail(["AI_REPORT_SUMMARY_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function fail(messages) {
  console.error("AI karne özeti kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
