import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const requiredDashboardPanels = [
  "API up",
  "Request rate",
  "Average duration",
  "Readiness failures",
  "Docker logs",
];
const requiredAlerts = [
  "OOkulApiDown",
  "OOkulReadinessFailing",
  "OOkulHigh5xxRate",
  "OOkulSlowRequests",
];
const evidenceReferenceEnvNames = [
  "OBSERVABILITY_UAT_PROMETHEUS_EVIDENCE_REFERENCE",
  "OBSERVABILITY_UAT_GRAFANA_EVIDENCE_REFERENCE",
  "OBSERVABILITY_UAT_LOKI_EVIDENCE_REFERENCE",
  "OBSERVABILITY_UAT_ALERT_WEBHOOK_EVIDENCE_REFERENCE",
];

const outputPath = readOption("--output") ?? process.env.OBSERVABILITY_UAT_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const prometheusUrl = process.env.OBSERVABILITY_UAT_PROMETHEUS_URL?.trim();
const grafanaUrl = process.env.OBSERVABILITY_UAT_GRAFANA_URL?.trim();
const lokiUrl = process.env.OBSERVABILITY_UAT_LOKI_URL?.trim();
const alertWebhookTarget = process.env.OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET?.trim();
const dashboardPanelsVerified = parseCommaList(process.env.OBSERVABILITY_UAT_DASHBOARD_PANELS_VERIFIED);
const alertsVerified = parseCommaList(process.env.OBSERVABILITY_UAT_ALERTS_VERIFIED);
const evidenceReferences = evidenceReferenceEnvNames.map((name) => process.env[name]?.trim());

const failures = [];
requireValue(outputPath, "OBSERVABILITY_UAT_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireHttpsUrl(prometheusUrl, "OBSERVABILITY_UAT_PROMETHEUS_URL", failures);
requireHttpsUrl(grafanaUrl, "OBSERVABILITY_UAT_GRAFANA_URL", failures);
requireHttpsUrl(lokiUrl, "OBSERVABILITY_UAT_LOKI_URL", failures);
requireEvidenceTarget(alertWebhookTarget, "OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET", failures);
requireExactSet(dashboardPanelsVerified, requiredDashboardPanels, "OBSERVABILITY_UAT_DASHBOARD_PANELS_VERIFIED", failures);
requireExactSet(alertsVerified, requiredAlerts, "OBSERVABILITY_UAT_ALERTS_VERIFIED", failures);
for (const [index, reference] of evidenceReferences.entries()) {
  requireEvidenceReference(reference, evidenceReferenceEnvNames[index], failures);
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

await requireEndpointOk(new URL("/-/ready", ensureTrailingSlash(prometheusUrl)), "Prometheus");
await requireEndpointOk(new URL("/api/health", ensureTrailingSlash(grafanaUrl)), "Grafana");
await requireEndpointOk(new URL("/ready", ensureTrailingSlash(lokiUrl)), "Loki");
const alertWebhook = await readAlertWebhookEvidence(alertWebhookTarget);

const report = {
  result: "PASS",
  environment,
  checkedAt: new Date().toISOString(),
  prometheusScrapeOk: true,
  grafanaDashboardOk: true,
  lokiLogPanelOk: true,
  alertWebhookStatus: alertWebhook.statusCode,
  dashboardPanelsVerified: requiredDashboardPanels,
  alertsVerified: requiredAlerts,
  evidenceReferences,
  gaps: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);
runCheck(outputFile);
console.log(`Observability UAT kanıtı yazıldı: ${outputFile}`);

async function requireEndpointOk(url, label) {
  const response = await fetch(url, { redirect: "follow" });
  if (response.status < 200 || response.status > 299) {
    fail([`${label} endpoint 2xx dönmeli: ${url.href} HTTP ${response.status}.`]);
  }
}

async function readAlertWebhookEvidence(target) {
  const url = new URL(target);
  let text;
  if (url.protocol === "file:") {
    const filePath = fileURLToPath(url);
    validateReadableEvidenceFile(filePath, "OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET");
    text = readFileSync(filePath, "utf8");
  } else if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET okunamadı: HTTP ${response.status}.`]);
    }
    text = await response.text();
  } else {
    fail(["OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET file:// veya https:// URL olmalı."]);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail(["OBSERVABILITY_UAT_ALERT_WEBHOOK_TARGET geçerli JSON olmalı."]);
  }

  const evidenceFailures = [];
  requireEqual(payload?.result, "alertWebhook.result", "PASS", evidenceFailures);
  requireEqual(payload?.check, "alertWebhook.check", "alert_webhook_smoke", evidenceFailures);
  requireOneOf(payload?.environment, "alertWebhook.environment", ["staging", "production"], evidenceFailures);
  requireStatus(payload?.statusCode, "alertWebhook.statusCode", evidenceFailures);
  requireEqual(payload?.authorizationScheme, "alertWebhook.authorizationScheme", "bearer", evidenceFailures);
  requireEmptyArray(payload?.gaps, "alertWebhook.gaps", evidenceFailures);
  if (!Array.isArray(payload?.commandsPassed) || !payload.commandsPassed.includes("pnpm alert:webhook:smoke")) {
    evidenceFailures.push("alertWebhook.commandsPassed pnpm alert:webhook:smoke içermeli.");
  }
  if (environment !== payload?.environment) {
    evidenceFailures.push(`alertWebhook.environment ${environment} ile eşleşmeli.`);
  }
  if (evidenceFailures.length > 0) fail(evidenceFailures);

  return payload;
}

function runCheck(filePath) {
  const result = spawnSync("pnpm", ["observability:uat:check"], {
    env: {
      ...process.env,
      OBSERVABILITY_UAT_TARGET: pathToFileURL(filePath).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(["pnpm observability:uat:check başarısız oldu."]);
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

function parseCommaList(rawValue) {
  if (typeof rawValue !== "string") return [];
  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function requireEqual(value, label, expected, output) {
  if (value !== expected) {
    output.push(`${label} ${expected} olmalı.`);
  }
}

function requireStatus(value, label, output) {
  if (!Number.isInteger(value) || value < 200 || value > 299) {
    output.push(`${label} 2xx HTTP durum kodu olmalı.`);
  }
}

function requireEmptyArray(value, label, output) {
  if (!Array.isArray(value) || value.length > 0) {
    output.push(`${label} boş liste olmalı.`);
  }
}

function requireExactSet(values, expectedValues, label, output) {
  if (values.length === 0) {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }

  const seen = new Set();
  const expected = new Set(expectedValues);
  for (const value of values) {
    if (seen.has(value)) {
      output.push(`${label} tekrarlı değer içeriyor: ${value}`);
    }
    seen.add(value);
    if (!expected.has(value)) {
      output.push(`${label} beklenmeyen değer içeriyor: ${value}`);
    }
  }

  for (const expectedValue of expectedValues) {
    if (!seen.has(expectedValue)) {
      output.push(`${label} eksik: ${expectedValue}`);
    }
  }
}

function requireHttpsUrl(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    output.push(`${label} geçerli https URL olmalı.`);
    return;
  }

  if (url.protocol !== "https:") {
    output.push(`${label} https:// olmalı.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    output.push(`${label} userinfo, query veya fragment taşımamalı.`);
  }
  if (hasPlaceholderToken(url.hostname)) {
    output.push(`${label} gerçek host olmalı; placeholder/example/test/localhost içeremez.`);
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

  if (hasPlaceholderToken(value)) {
    output.push(`${label} gerçek artifact/log/run referansı olmalı; placeholder/example/redacted/test içeremez.`);
  }
  if (hasSecretBearingReference(value)) {
    output.push(`${label} userinfo, query veya fragment taşımamalı.`);
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
    "todo",
    "tbd",
    "???",
  ].some((token) => normalized.includes(token));
}

function hasSecretBearingReference(value) {
  const normalized = value.trim();
  if (normalized.includes("?") || normalized.includes("#")) {
    return true;
  }

  const urlCandidate = normalized.toLowerCase().startsWith("url:") ? normalized.slice(4) : normalized;
  if (!/^(https|file|s3):\/\//i.test(urlCandidate)) {
    return false;
  }

  try {
    const url = new URL(urlCandidate);
    return Boolean(url.username || url.password || url.search || url.hash);
  } catch {
    return false;
  }
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["OBSERVABILITY_UAT_OUTPUT lokal temp path olmamalı."]);
  }
  if (isLocalSmokePath(filePath)) {
    fail(["OBSERVABILITY_UAT_OUTPUT artifacts/local altında olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath), "OBSERVABILITY_UAT_OUTPUT");

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["OBSERVABILITY_UAT_OUTPUT symlink olmayan file artifact olmalı."]);
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

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function fail(messages) {
  console.error("Observability UAT kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
