import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { connect } from "node:tls";
import { fileURLToPath, pathToFileURL } from "node:url";

const evidenceReferenceEnvNames = [
  "EXTERNAL_MONITORING_MONITORS_EVIDENCE_REFERENCE",
  "EXTERNAL_MONITORING_OUTAGE_EVIDENCE_REFERENCE",
  "EXTERNAL_MONITORING_TLS_EVIDENCE_REFERENCE",
];

const outputPath = readOption("--output") ?? process.env.EXTERNAL_MONITORING_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const monitoringNode = {
  host: process.env.EXTERNAL_MONITORING_NODE_HOST?.trim(),
  region: process.env.EXTERNAL_MONITORING_NODE_REGION?.trim(),
  network: process.env.EXTERNAL_MONITORING_NODE_NETWORK?.trim(),
};
const apiHealthUrl = process.env.EXTERNAL_MONITORING_API_HEALTH_URL?.trim();
const apiReadyUrl = process.env.EXTERNAL_MONITORING_API_READY_URL?.trim();
const webLoginUrl = process.env.EXTERNAL_MONITORING_WEB_LOGIN_URL?.trim();
const tlsUrl = process.env.EXTERNAL_MONITORING_TLS_URL?.trim();
const alertWebhookStatus = Number(process.env.EXTERNAL_MONITORING_ALERT_WEBHOOK_STATUS);
const outageDrill = {
  inducedAt: process.env.EXTERNAL_MONITORING_OUTAGE_INDUCED_AT?.trim(),
  detectedAt: process.env.EXTERNAL_MONITORING_OUTAGE_DETECTED_AT?.trim(),
  webhookDeliveredAt: process.env.EXTERNAL_MONITORING_OUTAGE_WEBHOOK_DELIVERED_AT?.trim(),
  recoveredAt: process.env.EXTERNAL_MONITORING_OUTAGE_RECOVERED_AT?.trim(),
};
const evidenceReferences = evidenceReferenceEnvNames.map((name) => process.env[name]?.trim());

const failures = [];
requireValue(outputPath, "EXTERNAL_MONITORING_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireMonitoringNode(monitoringNode, failures);
requireHttpsUrl(apiHealthUrl, "EXTERNAL_MONITORING_API_HEALTH_URL", failures);
requireHttpsUrl(apiReadyUrl, "EXTERNAL_MONITORING_API_READY_URL", failures);
requireHttpsUrl(webLoginUrl, "EXTERNAL_MONITORING_WEB_LOGIN_URL", failures);
requireHttpsUrl(tlsUrl, "EXTERNAL_MONITORING_TLS_URL", failures);
requireStatus(alertWebhookStatus, "EXTERNAL_MONITORING_ALERT_WEBHOOK_STATUS", failures);
requireOutageDates(outageDrill, failures);
for (const [index, reference] of evidenceReferences.entries()) {
  requireEvidenceReference(reference, evidenceReferenceEnvNames[index], failures);
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const monitorsVerified = [
  await readHttpMonitor("API /health", apiHealthUrl),
  await readHttpMonitor("API /health/ready", apiReadyUrl),
  await readHttpMonitor("Web login", webLoginUrl),
  await readCertificateMonitor("Traefik TLS certificate", tlsUrl),
];
const drillWithLatencies = buildOutageDrill(outageDrill);

const report = {
  result: "PASS",
  environment,
  checkedAt: new Date().toISOString(),
  provider: "self-hosted-uptime-kuma",
  monitoringNode,
  monitorsVerified,
  outageDrill: drillWithLatencies,
  alertWebhookStatus,
  evidenceReferences,
  gaps: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);
runCheck(outputFile);
console.log(`External monitoring kanıtı yazıldı: ${outputFile}`);

async function readHttpMonitor(name, urlValue) {
  const startedAt = Date.now();
  const response = await fetch(urlValue, { redirect: "follow" });
  const responseTimeMs = Math.max(1, Date.now() - startedAt);
  if (response.status < 200 || response.status > 299) {
    fail([`${name} UP olmalı: ${urlValue} HTTP ${response.status}.`]);
  }
  if (responseTimeMs > 5000) {
    fail([`${name} responseTimeMs 5000ms altında olmalı: ${responseTimeMs}.`]);
  }
  return {
    name,
    type: "http",
    url: urlValue,
    status: "UP",
    responseTimeMs,
  };
}

async function readCertificateMonitor(name, urlValue) {
  const url = new URL(urlValue);
  const certificateDaysRemaining = await readCertificateDaysRemaining(url);
  if (certificateDaysRemaining < 14) {
    fail([`${name} certificateDaysRemaining en az 14 olmalı: ${certificateDaysRemaining}.`]);
  }
  return {
    name,
    type: "certificate",
    url: urlValue,
    status: "UP",
    certificateDaysRemaining,
  };
}

async function readCertificateDaysRemaining(url) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connect({
      host: url.hostname,
      port: Number(url.port || 443),
      servername: url.hostname,
      rejectUnauthorized: true,
      timeout: 5000,
    });

    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      if (!certificate?.valid_to) {
        rejectPromise(new Error("TLS sertifikası okunamadı."));
        return;
      }

      const validTo = Date.parse(certificate.valid_to);
      if (Number.isNaN(validTo)) {
        rejectPromise(new Error("TLS sertifika bitiş tarihi okunamadı."));
        return;
      }

      resolvePromise(Math.floor((validTo - Date.now()) / 86400000));
    });
    socket.once("timeout", () => {
      socket.destroy();
      rejectPromise(new Error("TLS sertifika kontrolü zaman aşımına uğradı."));
    });
    socket.once("error", rejectPromise);
  }).catch((error) => {
    fail([`TLS sertifika kontrolü başarısız: ${error.message}`]);
  });
}

function buildOutageDrill(drill) {
  const induced = Date.parse(drill.inducedAt);
  const detected = Date.parse(drill.detectedAt);
  const delivered = Date.parse(drill.webhookDeliveredAt);
  const recovered = Date.parse(drill.recoveredAt);
  const detectionLatencySeconds = Math.round((detected - induced) / 1000);
  const webhookDeliveryLatencySeconds = Math.round((delivered - induced) / 1000);

  if (detectionLatencySeconds < 0 || detectionLatencySeconds > 120) {
    fail([`EXTERNAL_MONITORING_OUTAGE_DETECTED_AT inducedAt sonrası 120 saniye içinde olmalı: ${detectionLatencySeconds}.`]);
  }
  if (webhookDeliveryLatencySeconds < 0 || webhookDeliveryLatencySeconds > 120) {
    fail([`EXTERNAL_MONITORING_OUTAGE_WEBHOOK_DELIVERED_AT inducedAt sonrası 120 saniye içinde olmalı: ${webhookDeliveryLatencySeconds}.`]);
  }
  if (delivered > recovered) {
    fail(["EXTERNAL_MONITORING_OUTAGE_RECOVERED_AT webhookDeliveredAt sonrasında olmalı."]);
  }

  return {
    ...drill,
    detectionLatencySeconds,
    webhookDeliveryLatencySeconds,
  };
}

function runCheck(filePath) {
  const result = spawnSync("pnpm", ["external-monitoring:check"], {
    env: {
      ...process.env,
      EXTERNAL_MONITORING_TARGET: pathToFileURL(filePath).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(["pnpm external-monitoring:check başarısız oldu."]);
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

function requireStatus(value, label, output) {
  if (!Number.isInteger(value) || value < 200 || value > 299) {
    output.push(`${label} 2xx HTTP durum kodu olmalı.`);
  }
}

function requireMonitoringNode(value, output) {
  for (const key of ["host", "region", "network"]) {
    const field = value[key];
    if (typeof field !== "string" || field.trim() === "") {
      output.push(`EXTERNAL_MONITORING_NODE_${key.toUpperCase()} boş bırakılamaz.`);
    } else if (hasPlaceholderToken(field)) {
      output.push(`EXTERNAL_MONITORING_NODE_${key.toUpperCase()} gerçek değer olmalı; placeholder/example/redacted/test içeremez.`);
    }
  }
}

function requireOutageDates(drill, output) {
  for (const [key, value] of Object.entries(drill)) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      output.push(`EXTERNAL_MONITORING_OUTAGE_${key.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase()} geçerli tarih olmalı.`);
      continue;
    }
    if (Date.parse(value) > Date.now() + 5 * 60 * 1000) {
      output.push(`EXTERNAL_MONITORING_OUTAGE_${key.replace(/[A-Z]/g, (char) => `_${char}`).toUpperCase()} gelecekte olamaz.`);
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
    fail(["EXTERNAL_MONITORING_OUTPUT lokal temp path olmamalı."]);
  }
  if (isLocalSmokePath(filePath)) {
    fail(["EXTERNAL_MONITORING_OUTPUT artifacts/local altında olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath), "EXTERNAL_MONITORING_OUTPUT");

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["EXTERNAL_MONITORING_OUTPUT symlink olmayan file artifact olmalı."]);
    }
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
  console.error("External monitoring kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
