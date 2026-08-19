import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const expectedJourneyScenarios = [
  ["UAT-SYS-01", "SYSTEM_ADMIN"],
  ["UAT-SYS-02", "SYSTEM_ADMIN"],
  ["UAT-SYS-03", "SYSTEM_ADMIN"],
  ["UAT-SYS-04", "SYSTEM_ADMIN"],
  ["UAT-KURUM-01", "TENANT_ADMIN"],
  ["UAT-KURUM-02", "TENANT_ADMIN"],
  ["UAT-KURUM-03", "TENANT_ADMIN"],
  ["UAT-KURUM-04", "TENANT_ADMIN"],
  ["UAT-KURUM-05", "TENANT_ADMIN"],
  ["UAT-KURUM-06", "TENANT_ADMIN"],
  ["UAT-KURUM-07", "TENANT_ADMIN"],
  ["UAT-KURUM-08", "TENANT_ADMIN"],
  ["UAT-TEACHER-01", "TEACHER"],
  ["UAT-TEACHER-02", "TEACHER"],
  ["UAT-TEACHER-03", "TEACHER"],
  ["UAT-STUDENT-01", "STUDENT"],
  ["UAT-STUDENT-02", "STUDENT"],
  ["UAT-STUDENT-03", "STUDENT"],
  ["UAT-GUARDIAN-01", "GUARDIAN"],
  ["UAT-GUARDIAN-02", "GUARDIAN"],
  ["UAT-GUARDIAN-03", "GUARDIAN"],
];
const expectedFlowsVerified = [
  "tenant admin login",
  "teacher workflow",
  "guardian workflow",
  "raw import smoke",
  "report generation smoke",
  "live exam cycle evidence",
  "sms batch smoke",
  "notification provider smoke",
  "privacy purge",
];
const expectedCommandsPassed = [
  "pnpm run ci",
  "pnpm db:rls:check:live",
  "pnpm raw-import:smoke",
  "pnpm report-generation:smoke",
  "pnpm live:exam-cycle:check",
  "pnpm live:onboarding:smoke",
  "pnpm live:ui-worker:smoke",
  "pnpm sms:smoke",
  "pnpm notification:smoke",
  "pnpm traefik:https:smoke",
];
const commandEvidenceContracts = new Map([
  ["pnpm run ci", ["CI", ["artifact:artifacts/staging/reports/github-ci.json"]]],
  ["pnpm db:rls:check:live", ["STAGING", ["artifact:artifacts/staging/reports/rls-live.json"]]],
  ["pnpm raw-import:smoke", ["STAGING", ["artifact:artifacts/staging/reports/isem-optical-pipeline.json"]]],
  ["pnpm report-generation:smoke", ["STAGING", ["artifact:artifacts/staging/smoke/report-generation.json"]]],
  ["pnpm live:exam-cycle:check", ["STAGING", ["artifact:artifacts/staging/reports/live-exam-cycle.json"]]],
  ["pnpm live:onboarding:smoke", ["STAGING", ["artifact:artifacts/staging/reports/live-onboarding.json"]]],
  ["pnpm live:ui-worker:smoke", ["STAGING", ["artifact:artifacts/staging/reports/live-ui-worker-result.json"]]],
  ["pnpm sms:smoke", ["STAGING", ["artifact:artifacts/staging/smoke/sms-provider.json"]]],
  ["pnpm notification:smoke", ["STAGING", ["artifact:artifacts/staging/smoke/notification-provider.json"]]],
  ["pnpm traefik:https:smoke", ["STAGING", ["artifact:artifacts/staging/smoke/traefik-https.json"]]],
]);
const scenarioEvidenceContracts = new Map([
  ["UAT-SYS-01", contract("CI_AND_STAGING", ["pnpm ui-ux-redesign:visual-qa", "pnpm observability:uat:check"], [
    "artifact:artifacts/staging/reports/github-ci.json",
    "artifact:artifacts/staging/reports/observability-uat.json",
    "artifact:artifacts/staging/ui-ux-redesign/uat.json",
  ])],
  ["UAT-SYS-02", contract("STAGING", ["pnpm live:onboarding:smoke"], ["artifact:artifacts/staging/reports/live-onboarding.json"])],
  ["UAT-SYS-03", contract("CI", ["pnpm --filter @o-okul/api exec vitest run src/tenant/tenant.controller.e2e.test.ts"], [
    "artifact:artifacts/staging/reports/github-ci.json",
  ])],
  ["UAT-SYS-04", contract("STAGING_WITH_HISTORICAL_DRILL", ["pnpm deployment:rollback:check", "pnpm deployment:cutover:check"], [
    "artifact:artifacts/staging/reports/deployment-rollback.json",
    "artifact:artifacts/staging/reports/deployment-cutover.json",
  ])],
  ["UAT-KURUM-01", contract("STAGING", ["pnpm live:onboarding:smoke"], ["artifact:artifacts/staging/reports/live-onboarding.json"])],
  ["UAT-KURUM-02", contract("CI", ["pnpm --filter @o-okul/api exec vitest run src/school/school.e2e.test.ts src/student/student-profile.e2e.test.ts"], [
    "artifact:artifacts/staging/reports/github-ci.json",
  ])],
  ["UAT-KURUM-03", contract("CI_AND_STAGING", ["pnpm --filter @o-okul/api exec vitest run src/user-management/user-management.e2e.test.ts src/identity-invitation/identity-invitation.e2e.test.ts", "pnpm live:onboarding:smoke"], [
    "artifact:artifacts/staging/reports/github-ci.json",
    "artifact:artifacts/staging/reports/live-onboarding.json",
  ])],
  ["UAT-KURUM-04", contract("CI", ["pnpm --filter @o-okul/api exec vitest run src/program src/attendance"], [
    "artifact:artifacts/staging/reports/github-ci.json",
  ])],
  ["UAT-KURUM-05", contract("STAGING", ["pnpm isem-optical-pipeline:evidence-check", "pnpm live:exam-cycle:check", "pnpm live:ui-worker:smoke"], [
    "artifact:artifacts/staging/reports/isem-optical-pipeline.json",
    "artifact:artifacts/staging/reports/live-exam-cycle.json",
    "artifact:artifacts/staging/reports/live-ui-worker-result.json",
  ])],
  ["UAT-KURUM-06", contract("STAGING", ["pnpm report-generation:smoke", "pnpm live:exam-cycle:check", "pnpm live:ui-worker:smoke"], [
    "artifact:artifacts/staging/smoke/report-generation.json",
    "artifact:artifacts/staging/reports/live-exam-cycle.json",
    "artifact:artifacts/staging/reports/live-ui-worker-result.json",
  ])],
  ["UAT-KURUM-07", contract("CI", ["pnpm run ci"], ["artifact:artifacts/staging/reports/github-ci.json"])],
  ["UAT-KURUM-08", contract("CI_AND_STAGING", ["pnpm run ci", "pnpm sms:smoke", "pnpm notification:smoke"], [
    "artifact:artifacts/staging/reports/github-ci.json",
    "artifact:artifacts/staging/smoke/sms-provider.json",
    "artifact:artifacts/staging/smoke/notification-provider.json",
  ])],
  ["UAT-TEACHER-01", ciContract("pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts src/report/report-generation.service.test.ts")],
  ["UAT-TEACHER-02", ciContract("pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/homework/homework.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts")],
  ["UAT-TEACHER-03", ciContract("pnpm --filter @o-okul/api exec vitest run src/tenant src/school/assert-teacher-assigned.test.ts")],
  ["UAT-STUDENT-01", ciContract("pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/me/me-access-matrix.e2e.test.ts")],
  ["UAT-STUDENT-02", ciContract("pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts")],
  ["UAT-STUDENT-03", ciContract("pnpm --filter @o-okul/api exec vitest run src/me/me-access-matrix.e2e.test.ts")],
  ["UAT-GUARDIAN-01", ciContract("pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/payment/payment.e2e.test.ts")],
  ["UAT-GUARDIAN-02", ciContract("pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/announcement/announcement.e2e.test.ts src/support-ticket/support-ticket.e2e.test.ts")],
  ["UAT-GUARDIAN-03", ciContract("pnpm --filter @o-okul/api exec vitest run src/app.e2e.test.ts src/payment/payment.e2e.test.ts")],
]);
const evidenceReferencePrefixes = ["artifact:", "file://", "https://", "log:", "run:", "s3://", "url:"];

const outputPath = readOption("--output") ?? process.env.UAT_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const tester = process.env.UAT_TESTER?.trim();
const releaseCandidate = process.env.UAT_RELEASE_CANDIDATE?.trim();
const rollbackImageTag = process.env.UAT_ROLLBACK_IMAGE_TAG?.trim();
const restoreBackupReference = process.env.UAT_RESTORE_BACKUP_REFERENCE?.trim();
const scenariosTarget = process.env.UAT_SCENARIOS_TARGET?.trim();
const commandEvidenceTarget = process.env.UAT_COMMAND_EVIDENCE_TARGET?.trim();
const sourceSha = process.env.UAT_SOURCE_SHA?.trim();
const verifierRunUrl = process.env.UAT_VERIFIER_RUN_URL?.trim();
const githubCiRunUrl = process.env.UAT_GITHUB_CI_RUN_URL?.trim();
const githubCiEvidenceTarget = process.env.UAT_GITHUB_CI_EVIDENCE_TARGET?.trim();

const failures = [];
requireValue(outputPath, "UAT_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireEvidenceValue(tester, "UAT_TESTER", failures);
requireEvidenceValue(releaseCandidate, "UAT_RELEASE_CANDIDATE", failures);
requireEvidenceValue(rollbackImageTag, "UAT_ROLLBACK_IMAGE_TAG", failures);
requireEvidenceValue(restoreBackupReference, "UAT_RESTORE_BACKUP_REFERENCE", failures);
requireNoSecretBearingReference(restoreBackupReference, "UAT_RESTORE_BACKUP_REFERENCE", failures);
requireEvidenceTarget(scenariosTarget, "UAT_SCENARIOS_TARGET", failures);
requireEvidenceTarget(commandEvidenceTarget, "UAT_COMMAND_EVIDENCE_TARGET", failures);
requireCommitSha(sourceSha, "UAT_SOURCE_SHA", failures);
requireGithubRunUrl(verifierRunUrl, "UAT_VERIFIER_RUN_URL", failures);
requireGithubRunUrl(githubCiRunUrl, "UAT_GITHUB_CI_RUN_URL", failures);
requireEvidenceTarget(githubCiEvidenceTarget, "UAT_GITHUB_CI_EVIDENCE_TARGET", failures);
if (releaseCandidate && rollbackImageTag && releaseCandidate === rollbackImageTag) {
  failures.push("UAT_RELEASE_CANDIDATE ve UAT_ROLLBACK_IMAGE_TAG farklı olmalı.");
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile, "UAT_OUTPUT");

const githubCiEvidence = await readJsonTarget(githubCiEvidenceTarget, "UAT_GITHUB_CI_EVIDENCE_TARGET");
validateGithubCiEvidence(githubCiEvidence);
validateCiScenarioCoverage();
const commandEvidence = await readJsonTarget(commandEvidenceTarget, "UAT_COMMAND_EVIDENCE_TARGET");
validateCommandEvidence(commandEvidence);
const scenariosPayload = await readJsonTarget(scenariosTarget, "UAT_SCENARIOS_TARGET");
const journeyScenariosVerified = validateAndReadScenarios(scenariosPayload);

const report = {
  result: "PASS",
  environment,
  checkedAt: new Date().toISOString(),
  tester,
  releaseCandidate,
  rollbackImageTag,
  restoreBackupReference,
  flowsVerified: expectedFlowsVerified,
  commandsPassed: expectedCommandsPassed,
  journeyScenariosVerified,
  defects: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile, "UAT_OUTPUT");
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile, "UAT_OUTPUT");
runCheck(outputFile);
console.log(`UAT kanıtı yazıldı: ${outputFile}`);

async function readJsonTarget(target, label) {
  const url = new URL(target);
  let text;
  if (url.protocol === "file:") {
    const filePath = fileURLToPath(url);
    validateReadableEvidenceFile(filePath, label);
    text = readFileSync(filePath, "utf8");
  } else if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`${label} okunamadı: HTTP ${response.status}.`]);
    }
    text = await response.text();
  } else {
    fail([`${label} file:// veya https:// URL olmalı.`]);
  }

  try {
    return JSON.parse(text);
  } catch {
    fail([`${label} geçerli JSON olmalı.`]);
  }
}

function validateCommandEvidence(payload) {
  const commands = Array.isArray(payload?.commands) ? payload.commands : [];
  const failures = [];
  if (commands.length !== expectedCommandsPassed.length) {
    failures.push(`UAT_COMMAND_EVIDENCE_TARGET tam ${expectedCommandsPassed.length} komut içermeli.`);
  }

  for (const command of expectedCommandsPassed) {
    const item = commands.find((candidate) => candidate?.command === command);
    if (!item) {
      failures.push(`UAT_COMMAND_EVIDENCE_TARGET eksik komut: ${command}`);
      continue;
    }
    if (item.status !== "PASS") {
      failures.push(`${command} status PASS olmalı.`);
    }
    requireEvidenceReference(item.evidence, `${command} evidence`, failures);
    const [evidenceClass, requiredReferences] = commandEvidenceContracts.get(command);
    if (item.evidenceClass !== evidenceClass) failures.push(`${command} evidenceClass ${evidenceClass} olmalı.`);
    if (item.sourceSha?.toLowerCase() !== sourceSha.toLowerCase()) failures.push(`${command} sourceSha UAT_SOURCE_SHA ile eşleşmeli.`);
    for (const reference of requiredReferences) {
      if (item.evidence !== reference) failures.push(`${command} evidence ${reference} olmalı.`);
    }
    if (evidenceClass === "CI" && item.evidence !== `artifact:artifacts/staging/reports/github-ci.json`) {
      failures.push(`${command} exact GitHub CI artifact'ine bağlanmalı.`);
    }
  }

  const seen = new Set();
  for (const item of commands) {
    if (seen.has(item?.command)) {
      failures.push(`UAT_COMMAND_EVIDENCE_TARGET tekrarlı komut içeriyor: ${item.command}`);
    }
    seen.add(item?.command);
    if (!expectedCommandsPassed.includes(item?.command)) {
      failures.push(`UAT_COMMAND_EVIDENCE_TARGET beklenmeyen komut içeriyor: ${item?.command}`);
    }
    requireExactKeys(item, ["command", "status", "evidence", "evidenceClass", "sourceSha"], `commands.${item?.command ?? "unknown"}`, failures);
  }
  if (failures.length > 0) fail(failures);
}

function validateGithubCiEvidence(report) {
  const failures = [];
  if (report?.result !== "PASS") failures.push("GitHub CI artifact result PASS olmalı.");
  if (report?.environment !== "github-actions") failures.push("GitHub CI artifact environment github-actions olmalı.");
  if (report?.commitSha?.toLowerCase() !== sourceSha.toLowerCase()) {
    failures.push("GitHub CI artifact commitSha UAT_SOURCE_SHA ile eşleşmeli.");
  }
  if (report?.workflow?.runUrl !== githubCiRunUrl) {
    failures.push("GitHub CI artifact workflow.runUrl UAT_GITHUB_CI_RUN_URL ile eşleşmeli.");
  }
  if (report?.workflow?.conclusion !== "success") failures.push("GitHub CI artifact workflow conclusion success olmalı.");
  if (report?.workflow?.path !== ".github/workflows/ci.yml") failures.push("GitHub CI artifact workflow path CI workflow olmalı.");
  if (report?.command?.command !== "pnpm run ci" || report?.command?.workflowUsesSingleCiCommand !== true
    || report?.command?.localCiParity !== true) {
    failures.push("GitHub CI artifact exact pnpm run ci ve local parity bağını taşımalı.");
  }
  if (!Array.isArray(report?.commandsPassed) || !report.commandsPassed.includes("pnpm run ci")) {
    failures.push("GitHub CI artifact commandsPassed pnpm run ci içermeli.");
  }
  const ciRun = parseGithubRunUrl(githubCiRunUrl);
  const verifyJob = Array.isArray(report?.jobs)
    ? report.jobs.find((job) => job?.conclusion === "success" && job?.stepsPassed?.includes("pnpm run ci"))
    : undefined;
  if (!verifyJob) {
    failures.push("GitHub CI artifact success job içinde pnpm run ci adımını taşımalı.");
  } else if (!isGithubJobUrlForRun(verifyJob.logUrl, ciRun)) {
    failures.push("GitHub CI artifact pnpm run ci job URL'si exact CI run'a bağlanmalı.");
  }
  if (!Array.isArray(report?.gaps) || report.gaps.length !== 0) failures.push("GitHub CI artifact gaps boş olmalı.");

  const releaseMatch = /^ghcr\.io\/([^/]+\/[^/]+)\/api:([a-f0-9]{40})$/iu.exec(releaseCandidate ?? "");
  if (!releaseMatch || releaseMatch[1].toLowerCase() !== report?.repository?.toLowerCase()
    || releaseMatch[2].toLowerCase() !== sourceSha.toLowerCase()) {
    failures.push("UAT release candidate repository/SHA GitHub CI artifact ile eşleşmeli.");
  }
  if (failures.length > 0) fail(failures);
}

function validateCiScenarioCoverage() {
  const failures = [];
  const rootPackage = readJsonAtSource("package.json", "exact-SHA root package.json");
  const apiPackage = readJsonAtSource("apps/api/package.json", "exact-SHA API package.json");
  if (!rootPackage?.scripts?.ci?.includes("pnpm test")) failures.push("Root ci script pnpm test çalıştırmalı.");
  if (rootPackage?.scripts?.test !== "turbo run test --concurrency=1") {
    failures.push("Root test script tüm workspace testlerini serial Turbo zincirinde çalıştırmalı.");
  }
  if (apiPackage?.scripts?.test !== "vitest run --no-file-parallelism") {
    failures.push("API test script tüm Vitest dosyalarını çalıştırmalı.");
  }
  if (!rootPackage?.scripts?.ci?.includes("pnpm ui-ux-redesign:visual-qa")) {
    failures.push("Root ci script UI/UX visual QA kapısını çalıştırmalı.");
  }

  for (const [scenarioId, contract] of scenarioEvidenceContracts) {
    if (!new Set(["CI", "CI_AND_STAGING"]).has(contract.evidenceClass)) continue;
    const ciCommands = contract.verificationCommands.filter(isCiVerificationCommand);
    if (ciCommands.length === 0) failures.push(`${scenarioId} scenario-specific CI komutu taşımıyor.`);
    for (const command of ciCommands) {
      const prefix = "pnpm --filter @o-okul/api exec vitest run ";
      if (!command.startsWith(prefix)) continue;
      for (const sourcePath of command.slice(prefix.length).trim().split(/\s+/u)) {
        if (!sourcePath.startsWith("src/") || !gitPathExistsAtSource(`apps/api/${sourcePath}`)) {
          failures.push(`${scenarioId} CI kaynak yolu bulunamadı: ${sourcePath}`);
        }
      }
    }
  }
  if (failures.length > 0) fail(failures);
}

function isCiVerificationCommand(command) {
  return command === "pnpm run ci" || command === "pnpm ui-ux-redesign:visual-qa"
    || command.startsWith("pnpm --filter @o-okul/api exec vitest run ");
}

function readJsonAtSource(filePath, label) {
  const result = spawnSync("git", ["show", `${sourceSha}:${filePath}`], { encoding: "utf8" });
  if (result.status !== 0) fail([`${label} exact SHA'da okunamadı.`]);
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail([`${label} okunabilir geçerli JSON olmalı.`]);
  }
}

function gitPathExistsAtSource(filePath) {
  return spawnSync("git", ["cat-file", "-e", `${sourceSha}:${filePath}`], { stdio: "ignore" }).status === 0;
}

function parseGithubRunUrl(value) {
  const url = new URL(value);
  const match = /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/?$/u.exec(url.pathname);
  return match ? { repository: `${match[1]}/${match[2]}`.toLowerCase(), runId: match[3] } : undefined;
}

function isGithubJobUrlForRun(value, expectedRun) {
  try {
    const url = new URL(value);
    const match = /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/job\/(\d+)\/?$/u.exec(url.pathname);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password
      && !url.search && !url.hash && Boolean(match) && Boolean(expectedRun)
      && `${match[1]}/${match[2]}`.toLowerCase() === expectedRun.repository && match[3] === expectedRun.runId;
  } catch {
    return false;
  }
}

function validateAndReadScenarios(payload) {
  const scenarios = Array.isArray(payload?.journeyScenariosVerified)
    ? payload.journeyScenariosVerified
    : Array.isArray(payload?.scenarios)
      ? payload.scenarios
      : [];
  const failures = [];
  if (scenarios.length !== expectedJourneyScenarios.length) {
    failures.push(`UAT_SCENARIOS_TARGET tam ${expectedJourneyScenarios.length} senaryo içermeli.`);
  }

  const seen = new Set();
  for (const scenario of scenarios) {
    if (seen.has(scenario?.id)) {
      failures.push(`UAT_SCENARIOS_TARGET tekrarlı senaryo içeriyor: ${scenario.id}`);
    }
    seen.add(scenario?.id);
  }

  const output = [];
  for (const [id, persona] of expectedJourneyScenarios) {
    const scenario = scenarios.find((candidate) => candidate?.id === id);
    if (!scenario) {
      failures.push(`UAT_SCENARIOS_TARGET eksik: ${id}`);
      continue;
    }
    if (scenario.persona !== persona) {
      failures.push(`${id} persona ${persona} olmalı.`);
    }
    if (scenario.status !== "PASS") {
      failures.push(`${id} status PASS olmalı.`);
    }
    const contract = scenarioEvidenceContracts.get(id);
    if (scenario.evidenceClass !== contract.evidenceClass) {
      failures.push(`${id} evidenceClass ${contract.evidenceClass} olmalı.`);
    }
    if (scenario.sourceSha?.toLowerCase() !== sourceSha.toLowerCase()) {
      failures.push(`${id} sourceSha UAT_SOURCE_SHA ile eşleşmeli.`);
    }
    requireExactStringList(scenario.verificationCommands, contract.verificationCommands, `${id}.verificationCommands`, failures);
    if (!Array.isArray(scenario.evidence) || scenario.evidence.length === 0) {
      failures.push(`${id}.evidence boş olmayan liste olmalı.`);
    } else {
      for (const [index, item] of scenario.evidence.entries()) {
        requireEvidenceReference(item, `${id}.evidence.${index}`, failures);
      }
      for (const reference of contract.requiredReferences) {
        if (!scenario.evidence.includes(reference)) failures.push(`${id}.evidence eksik: ${reference}`);
      }
      if (["CI", "CI_AND_STAGING"].includes(contract.evidenceClass)) {
        for (const reference of ["artifact:artifacts/staging/reports/github-ci.json", `run:${githubCiRunUrl}`]) {
          if (!scenario.evidence.includes(reference)) failures.push(`${id}.evidence exact CI bağı eksik: ${reference}`);
        }
      }
      if (["STAGING", "CI_AND_STAGING", "STAGING_WITH_HISTORICAL_DRILL"].includes(contract.evidenceClass)
        && !scenario.evidence.includes(`run:${verifierRunUrl}`)) {
        failures.push(`${id}.evidence current verifier run URL'sine bağlanmalı.`);
      }
    }
    requireExactKeys(
      scenario,
      ["id", "persona", "status", "evidenceClass", "sourceSha", "verificationCommands", "evidence"],
      `scenarios.${id}`,
      failures,
    );
    output.push({
      id,
      persona,
      status: "PASS",
      evidence: scenario.evidence,
    });
  }

  for (const scenario of scenarios) {
    if (!expectedJourneyScenarios.some(([id]) => id === scenario?.id)) {
      failures.push(`UAT_SCENARIOS_TARGET beklenmeyen senaryo içeriyor: ${scenario?.id}`);
    }
  }
  if (failures.length > 0) fail(failures);
  return output;
}

function runCheck(filePath) {
  const result = spawnSync("pnpm", ["uat:check"], {
    env: {
      ...process.env,
      UAT_EVIDENCE_TARGET: pathToFileURL(filePath).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(["pnpm uat:check başarısız oldu."]);
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

function contract(evidenceClass, verificationCommands, requiredReferences) {
  return { evidenceClass, verificationCommands, requiredReferences };
}

function ciContract(command) {
  return contract("CI", [command], ["artifact:artifacts/staging/reports/github-ci.json"]);
}

function requireCommitSha(value, label, output) {
  if (!/^[a-f0-9]{40}$/i.test(value ?? "")) output.push(`${label} 40 karakter hex SHA olmalı.`);
}

function requireGithubRunUrl(value, label, output) {
  let url;
  try {
    url = new URL(value ?? "");
  } catch {
    output.push(`${label} GitHub Actions run URL olmalı.`);
    return;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash
    || !/^\/[^/]+\/[^/]+\/actions\/runs\/\d+\/?$/u.test(url.pathname)) {
    output.push(`${label} secret taşımayan GitHub Actions run URL olmalı.`);
  }
}

function requireExactKeys(value, expectedKeys, label, output) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    output.push(`${label} nesnesi zorunlu.`);
    return;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) output.push(`${label} exact alan setini taşımalı: ${expectedKeys.join(", ")}`);
}

function requireExactStringList(value, expected, label, output) {
  if (!Array.isArray(value) || value.length !== expected.length || new Set(value).size !== value.length
    || !expected.every((item) => value.includes(item))) {
    output.push(`${label} exact komut setiyle eşleşmeli.`);
  }
}

function requireOneOf(value, label, expected, output) {
  if (!expected.includes(value)) {
    output.push(`${label} ${expected.join(" veya ")} olmalı.`);
  }
}

function requireEvidenceValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }
  if (hasPlaceholderToken(value)) {
    output.push(`${label} gerçek değer olmalı; placeholder/example/redacted/test içeremez.`);
  }
}

function requireEvidenceTarget(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    output.push(`${label} file:// veya https:// URL olmalı.`);
    return;
  }

  if (url.protocol !== "file:" && url.protocol !== "https:") {
    output.push(`${label} file:// veya https:// URL olmalı.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    output.push(`${label} userinfo, query veya fragment taşımamalı.`);
  }
  if (url.protocol === "https:" && hasPlaceholderToken(url.hostname)) {
    output.push(`${label} gerçek https host olmalı.`);
  }
  if (url.protocol === "file:" && (isLocalTempPath(fileURLToPath(url)) || isLocalSmokePath(fileURLToPath(url)))) {
    output.push(`${label} temp veya artifacts/local altında olmamalı.`);
  }
}

function requireEvidenceReference(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }
  if (!hasEvidenceReference(value)) {
    output.push(`${label} artifact/file/https/log/run/s3/url referansı olmalı.`);
  }
  if (hasPlaceholderToken(value)) {
    output.push(`${label} placeholder/example/redacted/test içeremez.`);
  }
  if (hasSecretBearingReference(value)) {
    output.push(`${label} userinfo, query veya fragment taşımamalı.`);
  }
  validateArtifactReference(value, label, output);
}

function hasEvidenceReference(value) {
  const normalized = value.trim().toLowerCase();
  return evidenceReferencePrefixes.some((prefix) => normalized.startsWith(prefix));
}

function validateArtifactReference(value, label, output) {
  if (typeof value !== "string" || !value.trim().toLowerCase().startsWith("artifact:")) return;

  const artifactPath = value.trim().slice("artifact:".length);
  const artifactSegments = artifactPath.split("/");
  if (!artifactPath || artifactPath.startsWith("/") || artifactPath.includes("\\") || artifactSegments.includes("..")) {
    output.push(`${label} artifact referansı repo içi relative path olmalı.`);
    return;
  }

  const resolvedPath = resolve(artifactPath);
  if (isLocalTempPath(resolvedPath) || isLocalSmokePath(resolvedPath)) {
    output.push(`${label} artifact referansı temp veya artifacts/local altında olmamalı.`);
    return;
  }

  const parentFailures = validateArtifactParentPath(dirname(resolvedPath), label);
  output.push(...parentFailures);
  if (parentFailures.length > 0) return;

  if (!existsSync(resolvedPath)) {
    output.push(`${label} artifact referansı mevcut dosyaya bağlanmalı.`);
    return;
  }

  const stat = lstatSync(resolvedPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    output.push(`${label} artifact referansı symlink olmayan dosya olmalı.`);
  }
}

function validateArtifactParentPath(parentPath, label) {
  const failures = [];
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return failures;

    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      failures.push(`${label} artifact parent dizini symlink olmayan dizin olmalı.`);
      return failures;
    }
  }

  return failures;
}

function requireNoSecretBearingReference(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") return;
  if (hasSecretBearingReference(value)) {
    output.push(`${label} userinfo, query veya fragment taşımamalı.`);
  }
}

function hasSecretBearingReference(value) {
  const normalized = value.trim();
  if (normalized.includes("?") || normalized.includes("#")) return true;

  const urlCandidate = normalized.toLowerCase().startsWith("url:") ? normalized.slice(4) : normalized;
  if (!/^(https|file|s3):\/\//i.test(urlCandidate)) return false;

  try {
    const url = new URL(urlCandidate);
    return Boolean(url.username || url.password || url.search || url.hash);
  } catch {
    return false;
  }
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return [
    "__set",
    "change-me",
    "replace-me",
    "placeholder",
    "redacted",
    "example",
    ".test",
    ".invalid",
    "localhost",
    "127.0.0.1",
    "previous-pass",
    "backup-bucket",
    "qa-owner",
    "todo",
    "tbd",
    "???",
  ].some((token) => normalized.includes(token));
}

function validateOutputTarget(filePath, label) {
  if (isLocalTempPath(filePath)) {
    fail([`${label} lokal temp path olmamalı.`]);
  }
  if (isLocalSmokePath(filePath)) {
    fail([`${label} artifacts/local altında olmamalı.`]);
  }

  assertParentPathAllowed(dirname(filePath), label);

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail([`${label} symlink olmayan file artifact olmalı.`]);
    }
  }
}

function validateReadableEvidenceFile(filePath, label) {
  if (isLocalTempPath(filePath) || isLocalSmokePath(filePath)) {
    fail([`${label} temp veya artifacts/local altında olmamalı.`]);
  }
  assertParentPathAllowed(dirname(filePath), label);

  if (!existsSync(filePath)) {
    fail([`${label} okunabilir file artifact olmalı.`]);
  }

  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail([`${label} symlink olmayan file artifact olmalı.`]);
  }
}

function assertParentPathAllowed(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      fail([`${label} parent dizini symlink olmayan dizin olmalı.`]);
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

function isLocalSmokePath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function fail(messages) {
  console.error("UAT kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
