import { redactedUrl, validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const webhookUrl = process.env.ALERT_WEBHOOK_URL;
const token = process.env.ALERT_WEBHOOK_TOKEN;
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const evidenceFile = process.env.ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const checkedAt = new Date().toISOString();

await validateSmokeEvidenceOutputTarget(evidenceFile);

if (!webhookUrl) {
  fail("ALERT_WEBHOOK_URL boş bırakılamaz.");
}

if (!token || token.length < 32) {
  fail("ALERT_WEBHOOK_TOKEN en az 32 karakterlik gerçek bearer secret olmalı.");
}

let url;
try {
  url = new URL(webhookUrl);
} catch {
  fail("ALERT_WEBHOOK_URL geçerli URL olmalı.");
}
validateWebhookUrl(url);

const body = {
  source: "uzman-hocam",
  event: "observability.alert_webhook_smoke",
  severity: "info",
  environment,
  message: "o-okul alert webhook smoke",
  sentAt: checkedAt,
};

const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${token}`,
};

const response = await fetch(url, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});

if (!response.ok) {
  fail(`Alert webhook smoke başarısız: HTTP ${response.status}`);
}

await writeSmokeEvidence(evidenceFile, {
  result: "PASS",
  check: "alert_webhook_smoke",
  environment,
  checkedAt,
  webhookUrl: redactedUrl(url),
  statusCode: response.status,
  authorizationScheme: "bearer",
  commandsPassed: ["pnpm alert:webhook:smoke"],
  gaps: [],
});

console.log(`Alert webhook smoke geçti: HTTP ${response.status}`);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function validateWebhookUrl(url) {
  if (url.protocol !== "https:") {
    fail("ALERT_WEBHOOK_URL https olmalı.");
  }

  if (url.username || url.password || url.search || url.hash) {
    fail("ALERT_WEBHOOK_URL userinfo, query veya fragment içeremez.");
  }

  if (isPlaceholderOrLocalHost(url.hostname)) {
    fail("ALERT_WEBHOOK_URL production için gerçek host olmalı.");
  }
}

function isPlaceholderOrLocalHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.") ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".test") ||
    normalized.endsWith(".example") ||
    normalized.endsWith(".invalid") ||
    normalized.includes("example") ||
    normalized.includes("__set")
  );
}
