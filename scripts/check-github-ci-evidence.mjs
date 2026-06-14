import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.GITHUB_CI_EVIDENCE_TARGET;
const allowExampleEvidence = process.env.GITHUB_CI_ALLOW_EXAMPLE_EVIDENCE === "1";

const requiredCommands = ["pnpm run ci", "pnpm github-ci:check"];
const allowedEvents = ["push", "pull_request", "workflow_dispatch"];
const githubCiTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "repository",
  "commitSha",
  "branch",
  "workflow",
  "command",
  "jobs",
  "commandsPassed",
  "evidenceReferences",
  "gaps",
];
const workflowKeys = [
  "name",
  "path",
  "runId",
  "runAttempt",
  "runUrl",
  "conclusion",
  "event",
  "startedAt",
  "completedAt",
];
const commandKeys = ["workflowUsesSingleCiCommand", "command", "localCiParity"];
const jobKeys = ["name", "conclusion", "startedAt", "completedAt", "logUrl", "stepsPassed"];
const expectedCommandsPassed = ["pnpm run ci", "pnpm github-ci:check"];

if (!target) {
  fail(["GITHUB_CI_EVIDENCE_TARGET bos birakilamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["GITHUB_CI_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`GitHub CI kanit kontrolu gecti: ${report.repository} ${report.commitSha}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`GitHub CI raporu okunamadi: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["GITHUB_CI_EVIDENCE_TARGET yalniz file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["GITHUB_CI_EVIDENCE_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["GITHUB_CI_EVIDENCE_TARGET symlink olmayan file:// artifact olmali."]);
  }

  await assertParentPathAllowed(dirname(filePath));

  return readFile(filePath, "utf8");
}

async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);

    let stat;
    try {
      stat = await lstat(current);
    } catch {
      fail(["GITHUB_CI_EVIDENCE_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["GITHUB_CI_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["GITHUB_CI_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["GITHUB_CI_EVIDENCE_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["GITHUB_CI_EVIDENCE_TARGET production kaniti icin lokal temp path olmamali."]);
  }
}

function isPlaceholderEvidenceTargetHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".test") ||
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized.includes("example") ||
    normalized.includes("__set") ||
    normalized.includes("placeholder")
  );
}

function isLocalTempEvidenceTargetUrl(url) {
  const path = fileURLToPath(url).replace(/\/+$/g, "") || "/";
  return path === "/tmp" || path.startsWith("/tmp/") || path === "/var/tmp" || path.startsWith("/var/tmp/");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["GitHub CI raporu gecerli JSON olmali."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, githubCiTopLevelKeys, failures, "githubCi")) {
    return failures;
  }
  requireEqual(report, failures, "result", "PASS");
  requireEqual(report, failures, "environment", "github-actions");
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireRepository(report, failures);
  requireCommitSha(report, failures, "commitSha");
  requireString(report, failures, "branch");
  requireWorkflow(report.workflow, failures);
  requireCommand(report.command, failures);
  requireJobs(report.jobs, failures);
  requireCommands(report, failures);
  requireEvidenceReferences(report.evidenceReferences, failures);
  requireGithubActionsRunBindings(report, failures);
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requireRepository(report, failures) {
  requireString(report, failures, "repository");
  const value = report?.repository;
  if (typeof value !== "string") return;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    failures.push("repository owner/repo biciminde olmali.");
  }
}

function requireWorkflow(workflow, failures) {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    failures.push("workflow nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(workflow, workflowKeys, failures, "workflow");
  requireObjectString(workflow, failures, "workflow.name", "name");
  requireObjectEqual(workflow, failures, "workflow.path", "path", ".github/workflows/ci.yml");
  requireObjectString(workflow, failures, "workflow.runId", "runId");
  requireObjectIntegerAtLeast(workflow, failures, "workflow.runAttempt", "runAttempt", 1);
  requireHttpsUrl(workflow, failures, "workflow.runUrl", "runUrl");
  requireObjectEqual(workflow, failures, "workflow.conclusion", "conclusion", "success");
  requireObjectOneOf(workflow, failures, "workflow.event", "event", allowedEvents);
  requireDate(workflow, failures, "startedAt");
  requireDate(workflow, failures, "completedAt");
  requireDateNotInFuture(workflow, failures, "completedAt");
  requireDateNotAfter(workflow, failures, "startedAt", workflow, "completedAt");
}

function requireCommand(command, failures) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    failures.push("command nesnesi zorunlu.");
    return;
  }

  requireObjectKeySet(command, commandKeys, failures, "command");
  requireObjectTrue(command, failures, "command.workflowUsesSingleCiCommand", "workflowUsesSingleCiCommand");
  requireObjectEqual(command, failures, "command.command", "command", "pnpm run ci");
  requireObjectTrue(command, failures, "command.localCiParity", "localCiParity");
}

function requireJobs(jobs, failures) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    failures.push("jobs bos olmayan liste olmali.");
    return;
  }

  let ciCommandSeen = false;
  for (const [index, job] of jobs.entries()) {
    if (!job || typeof job !== "object" || Array.isArray(job)) {
      failures.push(`jobs.${index} nesnesi zorunlu.`);
      continue;
    }
    requireObjectKeySet(job, jobKeys, failures, `jobs.${index}`);
    requireObjectString(job, failures, `jobs.${index}.name`, "name");
    requireObjectEqual(job, failures, `jobs.${index}.conclusion`, "conclusion", "success");
    requireDate(job, failures, "startedAt");
    requireDate(job, failures, "completedAt");
    requireDateNotInFuture(job, failures, "completedAt");
    requireDateNotAfter(job, failures, "startedAt", job, "completedAt");
    requireHttpsUrl(job, failures, `jobs.${index}.logUrl`, "logUrl");
    requireStringList(job.stepsPassed, failures, `jobs.${index}.stepsPassed`, 1);
    if (Array.isArray(job.stepsPassed) && job.stepsPassed.includes("pnpm run ci")) {
      ciCommandSeen = true;
    }
  }

  if (!ciCommandSeen) {
    failures.push("jobs stepsPassed icinde pnpm run ci gorulmeli.");
  }
}

function requireCommands(report, failures) {
  if (!Array.isArray(report.commandsPassed)) {
    failures.push("commandsPassed listesi zorunlu.");
    return;
  }

  if (report.commandsPassed.length !== expectedCommandsPassed.length) {
    failures.push(`commandsPassed tam ${expectedCommandsPassed.length} komut icermeli.`);
  }

  const expected = new Set(expectedCommandsPassed);
  const seen = new Set();
  for (const command of report.commandsPassed) {
    if (typeof command !== "string" || command.trim() === "") {
      failures.push("commandsPassed bos olmayan metinlerden olusmali.");
      continue;
    }
    if (seen.has(command)) {
      failures.push(`commandsPassed tekrarli komut iceriyor: ${command}`);
    }
    seen.add(command);
    if (!expected.has(command)) {
      failures.push(`commandsPassed beklenmeyen komut iceriyor: ${command}`);
    }
  }

  for (const command of requiredCommands) {
    if (!seen.has(command)) {
      failures.push(`commandsPassed eksik: ${command}`);
    }
  }
}

function requireEmptyArray(report, failures, key) {
  const value = report?.[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} listesi zorunlu.`);
    return;
  }
  if (value.length > 0) {
    failures.push(`${key} bos olmali.`);
  }
}

function requireEvidenceReferences(references, failures) {
  requireStringList(references, failures, "evidenceReferences", 2);
  if (!Array.isArray(references)) return;

  const hasRunUrl = references.some((reference) => {
    if (typeof reference !== "string") return false;
    try {
      const url = new URL(reference);
      return url.hostname === "github.com" && url.pathname.includes("/actions/runs/");
    } catch {
      return false;
    }
  });
  if (!hasRunUrl) {
    failures.push("evidenceReferences en az bir GitHub Actions run URL'i icermeli.");
  }

  if (allowExampleEvidence) return;

  for (const [index, value] of references.entries()) {
    if (hasPlaceholderToken(value)) {
      failures.push(`evidenceReferences.${index} production kaniti icin placeholder/redacted deger olmamali.`);
    }
  }
}

function requireGithubActionsRunBindings(report, failures) {
  const repository = report?.repository;
  const runId = report?.workflow?.runId;
  if (typeof repository !== "string" || repository.trim() === "" || typeof runId !== "string" || runId.trim() === "") {
    return;
  }

  const workflowRun = parseGithubActionsUrl(report?.workflow?.runUrl, "run");
  requireGithubActionsMatch(workflowRun, failures, "workflow.runUrl", repository, runId);

  if (Array.isArray(report?.jobs)) {
    for (const [index, job] of report.jobs.entries()) {
      const jobRun = parseGithubActionsUrl(job?.logUrl, "job");
      requireGithubActionsMatch(jobRun, failures, `jobs.${index}.logUrl`, repository, runId);
    }
  }

  if (!Array.isArray(report?.evidenceReferences)) return;

  let matchingRunReferenceSeen = false;
  for (const [index, reference] of report.evidenceReferences.entries()) {
    const referenceRun = parseGithubActionsUrl(reference, "run");
    if (!referenceRun) continue;

    if (
      referenceRun.repository.toLowerCase() === repository.toLowerCase() &&
      referenceRun.runId === runId
    ) {
      matchingRunReferenceSeen = true;
    } else {
      requireGithubActionsMatch(referenceRun, failures, `evidenceReferences.${index}`, repository, runId);
    }
  }

  if (!matchingRunReferenceSeen) {
    failures.push("evidenceReferences GitHub Actions run URL'i workflow.runUrl ile eslesmeli.");
  }
}

function requireGithubActionsMatch(parsed, failures, label, repository, runId) {
  if (!parsed) {
    failures.push(`${label} GitHub Actions run URL'i olmali.`);
    return;
  }
  if (parsed.repository.toLowerCase() !== repository.toLowerCase()) {
    failures.push(githubActionsRepositoryMismatchMessage(label));
  }
  if (parsed.runId !== runId) {
    failures.push(githubActionsRunIdMismatchMessage(label));
  }
}

function githubActionsRepositoryMismatchMessage(label) {
  if (label === "workflow.runUrl") return "workflow.runUrl repository ile eslesmeli.";
  return `${label} repository ile eslesmeli.`;
}

function githubActionsRunIdMismatchMessage(label) {
  if (label === "workflow.runUrl") return "workflow.runUrl runId ile eslesmeli.";
  return `${label} runId ile eslesmeli.`;
}

function parseGithubActionsUrl(value, expectedKind) {
  if (typeof value !== "string" || value.trim() === "") return null;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const actionsIndex = segments.indexOf("actions");
  if (actionsIndex < 2) return null;
  if (segments[actionsIndex + 1] !== "runs" || typeof segments[actionsIndex + 2] !== "string") return null;

  if (expectedKind === "run" && segments[actionsIndex + 3] === "job") return null;
  if (
    expectedKind === "job" &&
    (segments[actionsIndex + 3] !== "job" || typeof segments[actionsIndex + 4] !== "string")
  ) {
    return null;
  }

  return {
    repository: segments.slice(0, actionsIndex).join("/"),
    runId: segments[actionsIndex + 2],
  };
}

function requireEqual(report, failures, key, expected) {
  if (report?.[key] !== expected) {
    failures.push(`${key} ${expected} olmali.`);
  }
}

function requireObjectEqual(scope, failures, label, key, expected) {
  if (scope?.[key] !== expected) {
    failures.push(`${label} ${expected} olmali.`);
  }
}

function requireObjectTrue(scope, failures, label, key) {
  if (scope?.[key] !== true) {
    failures.push(`${label} true olmali.`);
  }
}

function requireObjectOneOf(scope, failures, label, key, expectedValues) {
  if (!expectedValues.includes(scope?.[key])) {
    failures.push(`${label} ${expectedValues.join(" veya ")} olmali.`);
  }
}

function requireObjectKeySet(value, expectedKeys, failures, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }

  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} alan icermeli.`);
  }

  const expected = new Set(expectedKeys);
  for (const key of actualKeys) {
    if (!expected.has(key)) {
      failures.push(`${label}.${key} beklenmeyen alan.`);
    }
  }
  for (const key of expectedKeys) {
    if (!actualKeys.includes(key)) {
      failures.push(`${label}.${key} eksik.`);
    }
  }

  return true;
}

function requireObjectString(scope, failures, label, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${label} bos olmayan metin olmali.`);
    return;
  }
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    failures.push(`${label} production kaniti icin placeholder/redacted deger olmamali.`);
  }
}

function requireString(report, failures, key) {
  const value = report?.[key];
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${key} bos olmayan metin olmali.`);
    return;
  }
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    failures.push(`${key} production kaniti icin placeholder/redacted deger olmamali.`);
  }
}

function requireCommitSha(report, failures, key) {
  const value = report?.[key];
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) {
    failures.push(`${key} 40 karakter git SHA olmali.`);
  }
}

function requireObjectIntegerAtLeast(scope, failures, label, key, min) {
  if (!Number.isInteger(scope?.[key]) || scope[key] < min) {
    failures.push(`${label} en az ${min} tam sayi olmali.`);
  }
}

function requireHttpsUrl(scope, failures, label, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${label} bos olmayan URL olmali.`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      failures.push(`${label} https:// olmali.`);
    }
  } catch {
    failures.push(`${label} gecerli URL olmali.`);
  }
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    failures.push(`${label} production kaniti icin placeholder/redacted deger olmamali.`);
  }
}

function requireStringList(value, failures, label, minLength) {
  if (!Array.isArray(value) || value.length < minLength) {
    failures.push(`${label} en az ${minLength} metin icermeli.`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label}.${index} bos olmayan metin olmali.`);
    }
  }
}

function requireDate(report, failures, key) {
  const value = report?.[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} gecerli tarih olmali.`);
  }
}

function requireDateNotInFuture(report, failures, key) {
  if (allowExampleEvidence) return;

  const value = report?.[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) return;

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${key} gelecekte olamaz.`);
  }
}

function requireDateNotAfter(source, failures, sourceKey, target, targetKey) {
  const sourceTimestamp = Date.parse(source?.[sourceKey]);
  const targetTimestamp = Date.parse(target?.[targetKey]);
  if (Number.isNaN(sourceTimestamp) || Number.isNaN(targetTimestamp)) return;
  if (sourceTimestamp > targetTimestamp) {
    failures.push(`${sourceKey} ${targetKey} tarihinden sonra olamaz.`);
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
  ].some((token) => normalized.includes(token));
}

function fail(failures) {
  console.error("GitHub CI kanit kontrolu basarisiz:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
