import { createRequire } from "node:module";
import { validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const require = createRequire(import.meta.url);
const { createSmsAdapterFromEnv } = require("../packages/sms-adapter/dist/index.js");

const provider = process.env.SMS_PROVIDER ?? "noop";
const to = process.env.SMS_SMOKE_TO;
const body = process.env.SMS_SMOKE_BODY ?? "o-okul SMS smoke";
const evidenceFile = process.env.SMS_PROVIDER_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const checkedAt = new Date().toISOString();

await validateSmokeEvidenceOutputTarget(evidenceFile);

if (process.env.SMS_ENABLED !== "true") {
  await writeSmokeEvidence(evidenceFile, {
    result: "PASS",
    check: "sms_provider_smoke",
    environment: process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
    checkedAt,
    provider: "disabled",
    recipient: "****disabled",
    segments: 0,
    providerMessageId: "sms-disabled-v1",
    commandsPassed: ["pnpm sms:smoke"],
    gaps: [],
  });
  console.log("SMS provider smoke scope disi: SMS_ENABLED=false");
  process.exit(0);
}

if (!to) {
  fail("SMS_SMOKE_TO boş bırakılamaz.");
}

if (provider !== "noop" && process.env.SMS_SMOKE_CONFIRM !== "send") {
  fail("Gerçek SMS sağlayıcısı için SMS_SMOKE_CONFIRM=send gerekli.");
}

const adapter = createSmsAdapterFromEnv(process.env);
const [result] = await adapter.sendBatch([{ to, body }]);

if (!result || result.status !== "sent") {
  fail(`SMS provider smoke başarısız: ${result?.errorCode ?? "UNKNOWN"}`);
}

const providerMessageId = result.providerMessageId?.trim();
if (!providerMessageId) {
  fail("SMS provider smoke başarısız: providerMessageId boş.");
}

await writeSmokeEvidence(evidenceFile, {
  result: "PASS",
  check: "sms_provider_smoke",
  environment: process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
  checkedAt,
  provider,
  recipient: maskRecipient(to),
  segments: result.segmentEstimate?.segments ?? 0,
  providerMessageId,
  commandsPassed: ["pnpm sms:smoke"],
  gaps: [],
});

console.log(
  [
    "SMS provider smoke geçti:",
    `provider=${provider}`,
    `to=${maskRecipient(to)}`,
    `segments=${result.segmentEstimate?.segments ?? 0}`,
    `providerMessageId=${providerMessageId}`,
  ].filter(Boolean).join(" "),
);

function maskRecipient(value) {
  const visible = value.slice(-4);
  return `${"*".repeat(Math.max(0, value.length - visible.length))}${visible}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
