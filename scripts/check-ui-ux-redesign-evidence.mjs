import { existsSync, lstatSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const target = process.env.UI_UX_REDESIGN_EVIDENCE_TARGET ?? process.argv[2];
const allowExampleEvidence = process.env.UI_UX_REDESIGN_ALLOW_EXAMPLE_EVIDENCE === "1";

const topLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "releaseCandidate",
  "redesignPlanPath",
  "localStaticEvidence",
  "stagingProductionEvidence",
  "phaseEvidence",
  "viewportCoverage",
  "privacy",
  "approvals",
  "openRisks",
];
const localKeys = ["result", "releaseBlocking", "commandsPassed", "note"];
const releaseKeys = ["result", "requiredForRelease", "commandsPassed", "evidenceReferences"];
const phaseKeys = ["phase", "status", "scope", "commandsPassed", "evidenceReferences"];
const viewportKeys = ["surface", "widths", "evidenceReferences"];
const privacyKeys = [
  "piiReview",
  "rawPiiInArtifacts",
  "smsRecipientPreviewExported",
  "guardianFinanceLeakageChecked",
  "forbiddenRawFields",
];
const approvalKeys = ["role", "decision", "approvedAt"];

const requiredPhases = ["Faz 0", "Faz 1", "Faz 2", "Faz 3", "Faz 4", "Faz 5"];
const requiredWidths = [375, 768, 1024, 1440];
const requiredSurfaces = ["kurum dashboard", "optik workspace", "rapor workspace", "portal shell"];
const localCommands = [
  "pnpm --filter @o-okul/web typecheck",
  "pnpm web:a11y:check",
  "pnpm web:ux-baseline:check",
  "pnpm web:ux-contract:check",
  "pnpm karne:visual-contract:check",
];
const releaseCommands = [
  "pnpm prod:evidence:templates:check",
  "pnpm prod:plan:check",
  "pnpm live:onboarding:smoke",
  "pnpm live:ui-worker:smoke",
  "pnpm uat:check",
];
const evidencePrefixes = ["artifact:", "file://", "https://", "log:", "run:", "s3://", "url:"];
const rawPiiPatterns = [/\b\d{11}\b/, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, /\b(?:\+90|0)?5\d{9}\b/];

if (!target) fail(["UI_UX_REDESIGN_EVIDENCE_TARGET veya dosya argümanı boş bırakılamaz."]);

let targetUrl;
try {
  targetUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? new URL(target) : pathToFileURL(resolve(target));
} catch {
  fail(["UI_UX_REDESIGN_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
}

requireTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) fail(failures);

console.log(`UI/UX redesign kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) fail([`UI/UX redesign kanıtı okunamadı: HTTP ${response.status}`]);
    return parseJson(await response.text());
  }

  if (url.protocol !== "file:") {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET yalnız file:// veya https:// destekler."]);
  }

  const filePath = fileURLToPath(url);
  await assertParentPathAllowed(dirname(filePath));

  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET okunabilir file:// artifact olmalı."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET symlink olmayan file:// artifact olmalı."]);
  }

  return parseJson(await readFile(filePath, "utf8"));
}

function validateReport(report) {
  const failures = [];
  if (!keys(report, topLevelKeys, failures, "uiUxRedesignEvidence")) return failures;

  eq(report.result, "PASS", failures, "result");
  oneOf(report.environment, ["staging", "production"], failures, "environment");
  date(report.checkedAt, failures, "checkedAt");
  notFuture(report.checkedAt, failures, "checkedAt");
  string(report.releaseCandidate, failures, "releaseCandidate");
  nonPlaceholder(report.releaseCandidate, failures, "releaseCandidate");
  eq(report.redesignPlanPath, "docs/ui-ux-redesign-plan.md", failures, "redesignPlanPath");

  validateLocal(report.localStaticEvidence, failures);
  validateRelease(report.stagingProductionEvidence, failures);
  validatePhases(report.phaseEvidence, failures);
  validateViewports(report.viewportCoverage, failures);
  validatePrivacy(report.privacy, failures);
  validateApprovals(report.approvals, failures);

  if (Array.isArray(report.openRisks) && report.openRisks.length > 0) failures.push("openRisks boş olmalı.");
  scanRawPii(report, failures);
  return failures;
}

function validateLocal(value, failures) {
  if (!keys(value, localKeys, failures, "localStaticEvidence")) return;
  eq(value.result, "PASS", failures, "localStaticEvidence.result");
  eq(value.releaseBlocking, false, failures, "localStaticEvidence.releaseBlocking");
  includes(value.commandsPassed, localCommands, failures, "localStaticEvidence.commandsPassed");
  string(value.note, failures, "localStaticEvidence.note");
}

function validateRelease(value, failures) {
  if (!keys(value, releaseKeys, failures, "stagingProductionEvidence")) return;
  eq(value.result, "PASS", failures, "stagingProductionEvidence.result");
  eq(value.requiredForRelease, true, failures, "stagingProductionEvidence.requiredForRelease");
  includes(value.commandsPassed, releaseCommands, failures, "stagingProductionEvidence.commandsPassed");
  refs(value.evidenceReferences, failures, "stagingProductionEvidence.evidenceReferences", 3);
}

function validatePhases(value, failures) {
  if (!Array.isArray(value)) {
    failures.push("phaseEvidence alan listesi zorunlu.");
    return;
  }
  if (value.length !== requiredPhases.length) failures.push(`phaseEvidence tam ${requiredPhases.length} faz içermeli.`);

  const seen = new Set();
  for (const item of value) {
    if (!keys(item, phaseKeys, failures, `phaseEvidence.${item?.phase ?? "unknown"}`)) continue;
    if (seen.has(item.phase)) failures.push(`phaseEvidence tekrarlı faz içeriyor: ${item.phase}`);
    seen.add(item.phase);
    if (!requiredPhases.includes(item.phase)) failures.push(`phaseEvidence beklenmeyen faz içeriyor: ${item.phase}`);
    eq(item.status, "PASS", failures, `${item.phase}.status`);
    oneOf(item.scope, ["local-static", "staging-production"], failures, `${item.phase}.scope`);
    list(item.commandsPassed, failures, `${item.phase}.commandsPassed`, 1);
    refs(item.evidenceReferences, failures, `${item.phase}.evidenceReferences`, 1);
  }

  for (const phase of requiredPhases) {
    if (!seen.has(phase)) failures.push(`phaseEvidence eksik: ${phase}`);
  }

  const phase5 = value.find((item) => item?.phase === "Faz 5");
  if (phase5) {
    eq(phase5.scope, "staging-production", failures, "Faz 5.scope");
    includes(phase5.commandsPassed, ["pnpm prod:evidence:templates:check", "pnpm uat:check"], failures, "Faz 5.commandsPassed");
  }
}

function validateViewports(value, failures) {
  if (!Array.isArray(value)) {
    failures.push("viewportCoverage alan listesi zorunlu.");
    return;
  }

  const seen = new Set();
  for (const item of value) {
    if (!keys(item, viewportKeys, failures, `viewportCoverage.${item?.surface ?? "unknown"}`)) continue;
    if (seen.has(item.surface)) failures.push(`viewportCoverage tekrarlı yüzey içeriyor: ${item.surface}`);
    seen.add(item.surface);
    if (!requiredSurfaces.includes(item.surface)) failures.push(`viewportCoverage beklenmeyen yüzey içeriyor: ${item.surface}`);
    widths(item.widths, failures, `viewportCoverage.${item.surface}.widths`);
    refs(item.evidenceReferences, failures, `viewportCoverage.${item.surface}.evidenceReferences`, requiredWidths.length);
  }

  for (const surface of requiredSurfaces) {
    if (!seen.has(surface)) failures.push(`viewportCoverage eksik: ${surface}`);
  }
}

function validatePrivacy(value, failures) {
  if (!keys(value, privacyKeys, failures, "privacy")) return;
  eq(value.piiReview, "PASS", failures, "privacy.piiReview");
  eq(value.rawPiiInArtifacts, false, failures, "privacy.rawPiiInArtifacts");
  eq(value.smsRecipientPreviewExported, false, failures, "privacy.smsRecipientPreviewExported");
  eq(value.guardianFinanceLeakageChecked, true, failures, "privacy.guardianFinanceLeakageChecked");
  includes(value.forbiddenRawFields, ["email", "phone", "nationalId", "rawLine", "rawRow"], failures, "privacy.forbiddenRawFields");
}

function validateApprovals(value, failures) {
  if (!Array.isArray(value) || value.length === 0) {
    failures.push("approvals boş olmayan liste olmalı.");
    return;
  }

  for (const [index, approval] of value.entries()) {
    if (!keys(approval, approvalKeys, failures, `approvals.${index}`)) continue;
    string(approval.role, failures, `approvals.${index}.role`);
    eq(approval.decision, "PASS", failures, `approvals.${index}.decision`);
    date(approval.approvedAt, failures, `approvals.${index}.approvedAt`);
    notFuture(approval.approvedAt, failures, `approvals.${index}.approvedAt`);
  }
}

function keys(value, expectedKeys, failures, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }
  const actual = Object.keys(value);
  if (actual.length !== expectedKeys.length) failures.push(`${label} tam ${expectedKeys.length} alan içermeli.`);
  for (const key of actual) {
    if (!expectedKeys.includes(key)) failures.push(`${label}.${key} beklenmeyen alan.`);
  }
  for (const key of expectedKeys) {
    if (!actual.includes(key)) failures.push(`${label}.${key} eksik.`);
  }
  return true;
}

function includes(actual, expected, failures, label) {
  list(actual, failures, label, expected.length);
  if (!Array.isArray(actual)) return;
  const values = new Set(actual);
  for (const item of expected) {
    if (!values.has(item)) failures.push(`${label} eksik: ${item}`);
  }
}

function list(value, failures, label, min) {
  if (!Array.isArray(value)) {
    failures.push(`${label} liste olmalı.`);
    return;
  }
  if (value.length < min) failures.push(`${label} en az ${min} değer içermeli.`);
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") failures.push(`${label} boş olmayan metinlerden oluşmalı.`);
    if (seen.has(item)) failures.push(`${label} tekrarlı değer içeriyor: ${item}`);
    seen.add(item);
  }
}

function refs(value, failures, label, min) {
  list(value, failures, label, min);
  if (!Array.isArray(value)) return;

  for (const reference of value) {
    if (typeof reference !== "string" || reference.trim() === "") continue;
    const normalized = reference.trim().toLowerCase();
    if (!evidencePrefixes.some((prefix) => normalized.startsWith(prefix))) {
      failures.push(`${label} kalıcı artifact/run/log/url referansı içermeli: ${reference}`);
      continue;
    }
    if (!allowExampleEvidence && placeholder(reference)) failures.push(`${label} placeholder/redacted değer içermemeli.`);
    if (secretUrl(reference)) failures.push(`${label} userinfo, query veya fragment taşımamalı.`);
    if (normalized.startsWith("artifact:")) artifact(reference.slice("artifact:".length), failures, label);
  }
}

function artifact(artifactPath, failures, label) {
  const segments = artifactPath.split("/");
  if (!artifactPath || artifactPath.startsWith("/") || artifactPath.includes("\\") || segments.includes("..")) {
    failures.push(`${label} artifact referansı repo içi relative path olmalı.`);
    return;
  }

  const resolvedPath = resolve(artifactPath);
  if (localTempPath(resolvedPath) || localArtifactPath(resolvedPath)) {
    failures.push(`${label} artifact referansı temp veya artifacts/local altında olmamalı.`);
    return;
  }

  if (allowExampleEvidence) return;

  const parentFailure = parentSymlinkFailure(dirname(resolvedPath), label);
  if (parentFailure) {
    failures.push(parentFailure);
    return;
  }
  if (!existsSync(resolvedPath)) {
    failures.push(`${label} artifact referansı mevcut dosyaya bağlanmalı: ${artifactPath}`);
    return;
  }
  const stat = lstatSync(resolvedPath);
  if (stat.isSymbolicLink() || !stat.isFile()) failures.push(`${label} artifact referansı symlink olmayan dosya olmalı.`);
}

function widths(value, failures, label) {
  if (!Array.isArray(value)) {
    failures.push(`${label} liste olmalı.`);
    return;
  }
  const seen = new Set(value);
  for (const width of value) {
    if (!Number.isInteger(width)) failures.push(`${label} sayılardan oluşmalı.`);
  }
  for (const width of requiredWidths) {
    if (!seen.has(width)) failures.push(`${label} eksik viewport: ${width}`);
  }
}

function eq(actual, expected, failures, label) {
  if (actual !== expected) failures.push(`${label} ${expected} olmalı.`);
}

function oneOf(actual, expected, failures, label) {
  if (!expected.includes(actual)) failures.push(`${label} ${expected.join(" veya ")} olmalı.`);
}

function string(value, failures, label) {
  if (typeof value !== "string" || value.trim() === "") failures.push(`${label} boş olmayan metin olmalı.`);
}

function date(value, failures, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) failures.push(`${label} geçerli tarih olmalı.`);
}

function notFuture(value, failures, label) {
  if (allowExampleEvidence || typeof value !== "string") return;
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp) && timestamp > Date.now() + 5 * 60 * 1000) failures.push(`${label} gelecekte olamaz.`);
}

function nonPlaceholder(value, failures, label) {
  if (!allowExampleEvidence && typeof value === "string" && placeholder(value)) {
    failures.push(`${label} production kanıtı için örnek/placeholder/redacted değer olmamalı.`);
  }
}

function requireTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") fail(["UI_UX_REDESIGN_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
  if (url.username || url.password || url.search || url.hash) fail(["UI_UX_REDESIGN_EVIDENCE_TARGET userinfo, query veya fragment taşımamalı."]);
  if (url.protocol === "https:" && placeholderHost(url.hostname)) {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET production kanıtı için gerçek https host olmalı."]);
  }
  if (url.protocol === "file:" && localTempPath(fileURLToPath(url))) {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET production kanıtı için lokal temp path olmamalı."]);
  }
  if (url.protocol === "file:" && localArtifactPath(fileURLToPath(url))) {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET production kanıtı için artifacts/local altında olmamalı."]);
  }
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
      fail(["UI_UX_REDESIGN_EVIDENCE_TARGET parent dizini okunabilir olmalı."]);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["UI_UX_REDESIGN_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function parentSymlinkFailure(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return null;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return `${label} artifact parent dizini symlink olmayan dizin olmalı.`;
  }
  return null;
}

function secretUrl(value) {
  const candidate = value.slice(value.indexOf(":") + 1);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return false;
  try {
    const url = new URL(candidate);
    return Boolean(url.username || url.password || url.search || url.hash);
  } catch {
    return false;
  }
}

function placeholder(value) {
  const normalized = value.toLowerCase();
  return normalized.includes("example") || normalized.includes("__set") || normalized.includes("placeholder") || normalized.includes("redacted") || normalized.includes("todo");
}

function placeholderHost(hostname) {
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

function localTempPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized === "/tmp" || normalized.startsWith("/tmp/") || normalized === "/var/tmp" || normalized.startsWith("/var/tmp/") || normalized === "/private/tmp" || normalized.startsWith("/private/tmp/");
}

function localArtifactPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function scanRawPii(value, failures) {
  const strings = [];
  collectStrings(value, strings);
  for (const candidate of strings) {
    if (candidate.startsWith("artifact:") || candidate.includes("github.com/")) continue;
    if (rawPiiPatterns.some((pattern) => pattern.test(candidate))) {
      failures.push("Kanıt JSON ham PII benzeri değer içermemeli.");
      return;
    }
  }
}

function collectStrings(value, strings) {
  if (typeof value === "string") strings.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, strings));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, strings));
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["UI/UX redesign kanıtı geçerli JSON olmalı."]);
  }
}

function fail(failures) {
  console.error("UI/UX redesign kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
