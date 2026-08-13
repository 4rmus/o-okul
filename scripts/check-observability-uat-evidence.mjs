import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.OBSERVABILITY_UAT_TARGET;
const allowExampleEvidence = process.env.OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE === "1";
const observabilityUatTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "prometheusScrapeOk",
  "grafanaDashboardOk",
  "lokiLogPanelOk",
  "alertWebhookStatus",
  "dashboardPanelsVerified",
  "alertsVerified",
  "alertDelivery",
  "evidenceReferences",
  "gaps",
];
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
  "OOkulApiHighErrorRate",
  "OOkulApiSlowRequests",
];

if (!target) {
  fail(["OBSERVABILITY_UAT_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["OBSERVABILITY_UAT_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Observability UAT kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Observability UAT raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["OBSERVABILITY_UAT_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["OBSERVABILITY_UAT_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["OBSERVABILITY_UAT_TARGET symlink olmayan file:// artifact olmali."]);
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
      fail(["OBSERVABILITY_UAT_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["OBSERVABILITY_UAT_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["OBSERVABILITY_UAT_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.username || url.password || url.search || url.hash) {
    fail(["OBSERVABILITY_UAT_TARGET userinfo, query veya fragment tasimamali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["OBSERVABILITY_UAT_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["OBSERVABILITY_UAT_TARGET production kaniti icin lokal temp path olmamali."]);
  }

  if (url.protocol === "file:" && isLocalSmokeEvidenceTargetUrl(url)) {
    fail(["OBSERVABILITY_UAT_TARGET production kaniti icin artifacts/local altinda olmamali."]);
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
  return (
    path === "/tmp" ||
    path.startsWith("/tmp/") ||
    path === "/var/tmp" ||
    path.startsWith("/var/tmp/") ||
    path === "/private/tmp" ||
    path.startsWith("/private/tmp/")
  );
}

function isLocalSmokeEvidenceTargetUrl(url) {
  const path = fileURLToPath(url).replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return path.endsWith("/artifacts/local") || path.includes("/artifacts/local/");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Observability UAT raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, observabilityUatTopLevelKeys, failures, "observabilityUat")) {
    return failures;
  }

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireTrue(report, failures, "prometheusScrapeOk");
  requireTrue(report, failures, "grafanaDashboardOk");
  requireTrue(report, failures, "lokiLogPanelOk");
  requireStatus(report, failures, "alertWebhookStatus");

  requireExactStringSet(report, failures, "dashboardPanelsVerified", requiredDashboardPanels, "panel");
  requireExactStringSet(report, failures, "alertsVerified", requiredAlerts, "alert");
  requireAlertDelivery(report.alertDelivery, failures);
  requireEvidenceReferences(report, failures, "evidenceReferences");
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requireAlertDelivery(value, failures) {
  const label = "alertDelivery";
  const keys = [
    "releaseCandidate",
    "alertName",
    "receiver",
    "firingStatus",
    "firingAt",
    "firingDeliveredAt",
    "resolvedStatus",
    "resolvedAt",
    "resolvedDeliveredAt",
    "failedNotificationDelta",
    "evidenceReference",
  ];
  if (!requireObjectKeySet(value, keys, failures, label)) return;
  if (typeof value.releaseCandidate !== "string" || !/^[a-f0-9]{40}$/.test(value.releaseCandidate)) {
    failures.push(`${label}.releaseCandidate 40 karakterlik lowercase commit SHA olmalı.`);
  }
  if (value.alertName !== "OOkulApiDown") failures.push(`${label}.alertName OOkulApiDown olmalı.`);
  if (value.receiver !== "authenticated-webhook") failures.push(`${label}.receiver authenticated-webhook olmalı.`);
  if (value.firingStatus !== "DELIVERED") failures.push(`${label}.firingStatus DELIVERED olmalı.`);
  if (value.resolvedStatus !== "DELIVERED") failures.push(`${label}.resolvedStatus DELIVERED olmalı.`);
  if (value.failedNotificationDelta !== 0) failures.push(`${label}.failedNotificationDelta 0 olmalı.`);
  const timestamps = ["firingAt", "firingDeliveredAt", "resolvedAt", "resolvedDeliveredAt"].map((key) => {
    if (typeof value[key] !== "string" || Number.isNaN(Date.parse(value[key]))) {
      failures.push(`${label}.${key} geçerli tarih olmalı.`);
    }
    return Date.parse(value[key]);
  });
  if (timestamps.every((timestamp) => !Number.isNaN(timestamp))) {
    if (!(timestamps[0] <= timestamps[1] && timestamps[1] <= timestamps[2] && timestamps[2] <= timestamps[3])) {
      failures.push(`${label} firing ve resolved teslim kronolojisi sıralı olmalı.`);
    }
    if (!allowExampleEvidence && timestamps.some((timestamp) => timestamp > Date.now() + 5 * 60 * 1000)) {
      failures.push(`${label} zamanları gelecekte olamaz.`);
    }
  }
  requireEvidenceReferenceValue(value.evidenceReference, failures, `${label}.evidenceReference`);
}

function requireEqual(report, failures, key, expected) {
  if (report[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
  }
}

function requireOneOf(report, failures, key, expectedValues) {
  if (!expectedValues.includes(report[key])) {
    failures.push(`${key} ${expectedValues.join(" veya ")} olmalı.`);
  }
}

function requireDate(report, failures, key) {
  const value = report[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} geçerli tarih olmalı.`);
  }
}

function requireDateNotInFuture(report, failures, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) {
    return;
  }

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${key} gelecekte olamaz.`);
  }
}

function requireTrue(report, failures, key) {
  if (report[key] !== true) {
    failures.push(`${key} true olmalı.`);
  }
}

function requireStatus(report, failures, key) {
  const value = report[key];
  if (!Number.isInteger(value) || value < 200 || value > 299) {
    failures.push(`${key} 2xx HTTP durum kodu olmalı.`);
  }
}

function requireExactStringSet(report, failures, key, expectedValues, itemLabel) {
  const value = report[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} alan listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${key} tam ${expectedValues.length} ${itemLabel} içermeli.`);
    return;
  }

  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${key}.${index} boş olmayan metin olmalı.`);
      return;
    }
  }

  for (const expected of expectedValues) {
    if (!value.includes(expected)) {
      failures.push(`${key} eksik: ${expected}`);
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
    failures.push(`${key} boş olmalı.`);
  }
}

function requireObjectKeySet(value, expectedKeys, failures, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} alan içermeli.`);
    return false;
  }

  for (const expectedKey of expectedKeys) {
    if (!Object.hasOwn(value, expectedKey)) {
      failures.push(`${label}.${expectedKey} alanı zorunlu.`);
    }
  }

  return true;
}

function requireEvidenceReferences(report, failures, label) {
  const value = report.evidenceReferences;
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`${label} boş olmayan liste olmalı.`);
    return;
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} boş olmayan metinlerden oluşmalı.`);
      return;
    }
    if (!allowExampleEvidence && hasPlaceholderToken(item)) {
      failures.push(`${label} production kanıtı için örnek/placeholder/redacted değer içermemeli.`);
      return;
    }
  }
}

function requireEvidenceReferenceValue(value, failures, label) {
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${label} boş olmayan referans olmalı.`);
    return;
  }
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    failures.push(`${label} production kanıtı için örnek/placeholder/redacted değer içermemeli.`);
  }
  if (/[?#]/.test(value)) {
    failures.push(`${label} query veya fragment taşımamalı.`);
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
  console.error("Observability UAT kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
