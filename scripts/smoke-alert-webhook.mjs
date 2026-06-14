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

const body = {
  source: "uzman-hocam",
  event: "observability.alert_webhook_smoke",
  severity: "info",
  environment,
  message: "Uzman Hocam alert webhook smoke",
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
