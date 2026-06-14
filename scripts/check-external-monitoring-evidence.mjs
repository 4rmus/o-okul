import { lstat, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.EXTERNAL_MONITORING_TARGET;
const allowExampleEvidence = process.env.EXTERNAL_MONITORING_ALLOW_EXAMPLE_EVIDENCE === "1";
const externalMonitoringTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "provider",
  "monitoringNode",
  "monitorsVerified",
  "outageDrill",
  "alertWebhookStatus",
  "evidenceReferences",
  "gaps",
];
const monitoringNodeKeys = ["host", "region", "network"];
const httpMonitorKeys = ["name", "type", "url", "status", "responseTimeMs"];
const certificateMonitorKeys = ["name", "type", "url", "status", "certificateDaysRemaining"];
const outageDrillKeys = [
  "inducedAt",
  "detectedAt",
  "webhookDeliveredAt",
  "recoveredAt",
  "detectionLatencySeconds",
  "webhookDeliveryLatencySeconds",
];
const expectedMonitors = [
  ["API /health", "http"],
  ["API /health/ready", "http"],
  ["Web login", "http"],
  ["Traefik TLS certificate", "certificate"],
];

if (!target) {
  fail(["EXTERNAL_MONITORING_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["EXTERNAL_MONITORING_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`External monitoring kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`External monitoring raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["EXTERNAL_MONITORING_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["EXTERNAL_MONITORING_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["EXTERNAL_MONITORING_TARGET symlink olmayan file:// artifact olmali."]);
  }

  await assertParentPathAllowed(dirname(filePath));

  return readFile(filePath, "utf8");
}

async function assertParentPathAllowed(parentPath) {
  let stat;
  try {
    stat = await lstat(parentPath);
  } catch {
    fail(["EXTERNAL_MONITORING_TARGET parent dizini okunabilir olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(["EXTERNAL_MONITORING_TARGET parent dizini symlink olmayan dizin olmali."]);
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["EXTERNAL_MONITORING_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["EXTERNAL_MONITORING_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["EXTERNAL_MONITORING_TARGET production kaniti icin lokal temp path olmamali."]);
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
    fail(["External monitoring raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, externalMonitoringTopLevelKeys, failures, "externalMonitoring")) {
    return failures;
  }

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireEqual(report, failures, "provider", "self-hosted-uptime-kuma");
  requireMonitoringNode(report, failures);
  requireMonitors(report, failures);
  requireOutageDrill(report, failures);
  requireStatus(report, failures, "alertWebhookStatus");
  requireEvidenceReferences(report, failures, "evidenceReferences");
  requireEmptyArray(report, failures, "gaps");

  return failures;
}

function requireMonitoringNode(report, failures) {
  const value = report.monitoringNode;
  if (!value || typeof value !== "object") {
    failures.push("monitoringNode obje olmalı.");
    return;
  }

  requireObjectKeySet(value, monitoringNodeKeys, failures, "monitoringNode");
  for (const key of ["host", "region", "network"]) {
    if (typeof value[key] !== "string" || value[key].trim() === "") {
      failures.push(`monitoringNode.${key} boş olmayan metin olmalı.`);
    } else if (!allowExampleEvidence && hasPlaceholderToken(value[key])) {
      failures.push(`monitoringNode.${key} gerçek kanıtta placeholder içeremez.`);
    }
  }
}

function requireMonitors(report, failures) {
  const monitors = report.monitorsVerified;
  if (!Array.isArray(monitors)) {
    failures.push("monitorsVerified alan listesi zorunlu.");
    return;
  }

  if (monitors.length !== expectedMonitors.length) {
    failures.push(`monitorsVerified tam ${expectedMonitors.length} monitor içermeli.`);
    return;
  }

  for (const [name, type] of expectedMonitors) {
    const monitor = monitors.find((candidate) => candidate?.name === name);
    if (!monitor) {
      failures.push(`monitorsVerified eksik: ${name}`);
      continue;
    }
    const expectedKeys = type === "certificate" ? certificateMonitorKeys : httpMonitorKeys;
    if (!requireObjectKeySet(monitor, expectedKeys, failures, `monitorsVerified.${name}`)) {
      continue;
    }
    if (monitor.type !== type) {
      failures.push(`${name} type ${type} olmalı.`);
    }
    if (monitor.status !== "UP") {
      failures.push(`${name} status UP olmalı.`);
    }
    requireHttpsEvidenceUrl(monitor, failures, `${name}.url`);
    if (type === "http") {
      const responseTimeMs = monitor.responseTimeMs;
      if (!Number.isInteger(responseTimeMs) || responseTimeMs < 1 || responseTimeMs > 5000) {
        failures.push(`${name} responseTimeMs 1-5000 arası integer olmalı.`);
      }
    }
    if (type === "certificate") {
      const daysRemaining = monitor.certificateDaysRemaining;
      if (!Number.isInteger(daysRemaining) || daysRemaining < 14) {
        failures.push(`${name} certificateDaysRemaining en az 14 olmalı.`);
      }
    }
  }
}

function requireOutageDrill(report, failures) {
  const drill = report.outageDrill;
  if (!drill || typeof drill !== "object") {
    failures.push("outageDrill obje olmalı.");
    return;
  }

  requireObjectKeySet(drill, outageDrillKeys, failures, "outageDrill");
  for (const key of ["inducedAt", "detectedAt", "webhookDeliveredAt", "recoveredAt"]) {
    requireDate(drill, failures, `outageDrill.${key}`, key);
    requireDateNotInFuture(drill, failures, `outageDrill.${key}`, key);
  }
  requireIntegerAtMost(drill, failures, "detectionLatencySeconds", 120);
  requireIntegerAtMost(drill, failures, "webhookDeliveryLatencySeconds", 120);
  requireDateOrder(drill, failures, "outageDrill.inducedAt", "inducedAt", "outageDrill.detectedAt", "detectedAt");
  requireDateOrder(drill, failures, "outageDrill.detectedAt", "detectedAt", "outageDrill.webhookDeliveredAt", "webhookDeliveredAt");
  requireDateOrder(drill, failures, "outageDrill.webhookDeliveredAt", "webhookDeliveredAt", "outageDrill.recoveredAt", "recoveredAt");
  requireLatencyMatches(
    drill,
    failures,
    "outageDrill.detectionLatencySeconds",
    "detectionLatencySeconds",
    "inducedAt",
    "detectedAt",
  );
  requireLatencyMatches(
    drill,
    failures,
    "outageDrill.webhookDeliveryLatencySeconds",
    "webhookDeliveryLatencySeconds",
    "inducedAt",
    "webhookDeliveredAt",
  );
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

function requireDate(report, failures, label, key = label) {
  const value = report[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${label} geçerli tarih olmalı.`);
  }
}

function requireDateNotInFuture(report, failures, label, key = label) {
  if (allowExampleEvidence) return;

  const value = report[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) {
    return;
  }

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${label} gelecekte olamaz.`);
  }
}

function requireStatus(report, failures, key) {
  const value = report[key];
  if (!Number.isInteger(value) || value < 200 || value > 299) {
    failures.push(`${key} 2xx HTTP durum kodu olmalı.`);
  }
}

function requireIntegerAtMost(report, failures, key, maximum) {
  const value = report[key];
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    failures.push(`outageDrill.${key} 0-${maximum} arası integer olmalı.`);
  }
}

function requireDateOrder(report, failures, firstLabel, firstKey, secondLabel, secondKey) {
  const first = Date.parse(report[firstKey]);
  const second = Date.parse(report[secondKey]);
  if (Number.isNaN(first) || Number.isNaN(second)) return;
  if (first > second) {
    failures.push(`${firstLabel} ${secondLabel} sonrasında olamaz.`);
  }
}

function requireLatencyMatches(report, failures, label, key, startKey, endKey) {
  const start = Date.parse(report[startKey]);
  const end = Date.parse(report[endKey]);
  const value = report[key];
  if (Number.isNaN(start) || Number.isNaN(end) || !Number.isInteger(value)) return;

  const seconds = Math.round((end - start) / 1000);
  if (value !== seconds) {
    failures.push(`${label} ${startKey}/${endKey} farkıyla eşleşmeli.`);
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

function requireHttpsEvidenceUrl(report, failures, label) {
  const value = report.url;
  if (typeof value !== "string" || !value.startsWith("https://")) {
    failures.push(`${label} https:// URL olmalı.`);
    return;
  }
  if (!allowExampleEvidence && hasPlaceholderToken(value)) {
    failures.push(`${label} gerçek kanıtta placeholder içeremez.`);
  }
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
  console.error("External monitoring kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
