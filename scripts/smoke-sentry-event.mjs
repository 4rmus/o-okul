import * as Sentry from "@sentry/node";
import { redactedUrl, validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const message = process.env.SENTRY_SMOKE_MESSAGE ?? "Uzman Hocam Sentry smoke";
const evidenceFile = process.env.SENTRY_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const checkedAt = new Date().toISOString();

await validateSmokeEvidenceOutputTarget(evidenceFile);

if (!dsn) {
  fail("SENTRY_DSN boş bırakılamaz.");
}

if (process.env.SENTRY_SMOKE_CONFIRM !== "send") {
  fail("Sentry test event'i için SENTRY_SMOKE_CONFIRM=send gerekli.");
}

assertDefaultPiiDisabled();

Sentry.init({
  dsn,
  environment,
  sendDefaultPii: false,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    queryParams: false,
    genAI: { inputs: false, outputs: false },
    stackFrameVariables: false,
  },
  registerEsmLoaderHooks: false,
  tracesSampleRate: 0,
  beforeSend(event) {
    delete event.user;
    if (event.message) event.message = sanitizeString(event.message);
    return { ...event, tags: { ...event.tags, runtime: "smoke" } };
  },
});

const eventId = Sentry.captureMessage(sanitizeString(message), "info");
const flushed = await Sentry.flush(5000).catch((error) => fail(`Sentry smoke flush başarısız: ${error.message}`));
if (!flushed) fail("Sentry smoke başarısız: event flush timeout.");

await writeSmokeEvidence(evidenceFile, {
  result: "PASS",
  check: "sentry_smoke",
  environment,
  checkedAt,
  dsn: summarizeDsn(dsn),
  eventId,
  commandsPassed: ["pnpm sentry:smoke"],
  gaps: [],
});

console.log(`Sentry smoke geçti: environment=${environment} eventId=${eventId}`);

function assertDefaultPiiDisabled() {
  if (process.env.SENTRY_SEND_DEFAULT_PII && process.env.SENTRY_SEND_DEFAULT_PII !== "false") {
    fail("SENTRY_SEND_DEFAULT_PII false olmalı.");
  }
}

function sanitizeString(value) {
  return value
    .replace(emailPattern, "[FilteredEmail]")
    .replace(turkishPhonePattern, "[FilteredPhone]")
    .replace(turkishNationalIdPattern, "[FilteredNationalId]");
}

function summarizeDsn(value) {
  try {
    return redactedUrl(value);
  } catch {
    return "[redacted-invalid-dsn]";
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const turkishPhonePattern = /\b(?:\+?90[\s.-]?)?0?5\d{2}[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g;
const turkishNationalIdPattern = /\b[1-9]\d{10}\b/g;
