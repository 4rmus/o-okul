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
  "pnpm prod:env:check",
  "pnpm db:rls:check:live",
  "pnpm raw-import:smoke",
  "pnpm report-generation:smoke",
  "pnpm live:exam-cycle:check",
  "pnpm queue:smoke",
  "pnpm live:onboarding:smoke",
  "pnpm live:ui-worker:smoke",
  "pnpm sms:smoke",
  "pnpm notification:smoke",
  "pnpm traefik:https:smoke",
];
const evidenceReferencePrefixes = ["artifact:", "file://", "https://", "log:", "run:", "s3://", "url:"];

const outputPath = readOption("--output") ?? process.env.UAT_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const tester = process.env.UAT_TESTER?.trim();
const releaseCandidate = process.env.UAT_RELEASE_CANDIDATE?.trim();
const rollbackImageTag = process.env.UAT_ROLLBACK_IMAGE_TAG?.trim();
const restoreBackupReference = process.env.UAT_RESTORE_BACKUP_REFERENCE?.trim();
const scenariosTarget = process.env.UAT_SCENARIOS_TARGET?.trim();
const commandEvidenceTarget = process.env.UAT_COMMAND_EVIDENCE_TARGET?.trim();

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
if (releaseCandidate && rollbackImageTag && releaseCandidate === rollbackImageTag) {
  failures.push("UAT_RELEASE_CANDIDATE ve UAT_ROLLBACK_IMAGE_TAG farklı olmalı.");
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile, "UAT_OUTPUT");

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
  }
  if (failures.length > 0) fail(failures);
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
    if (!Array.isArray(scenario.evidence) || scenario.evidence.length === 0) {
      failures.push(`${id}.evidence boş olmayan liste olmalı.`);
    } else {
      for (const [index, item] of scenario.evidence.entries()) {
        requireEvidenceReference(item, `${id}.evidence.${index}`, failures);
      }
    }
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
