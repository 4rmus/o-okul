import { createRequire } from "node:module";
import { validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const require = createRequire(import.meta.url);
const { createNotificationAdapterFromEnv } = require("../packages/notification-adapter/dist/index.js");

const provider = process.env.NOTIFICATION_PROVIDER ?? "noop";
const emailTo = process.env.NOTIFICATION_SMOKE_EMAIL_TO;
const pushTo = process.env.NOTIFICATION_SMOKE_PUSH_TO;
const subject = process.env.NOTIFICATION_SMOKE_SUBJECT ?? "o-okul notification smoke";
const body = process.env.NOTIFICATION_SMOKE_BODY ?? "o-okul notification smoke";
const evidenceFile = process.env.NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const checkedAt = new Date().toISOString();

await validateSmokeEvidenceOutputTarget(evidenceFile);

const messages = [
  emailTo ? { channel: "EMAIL", to: emailTo, subject, body } : undefined,
  pushTo ? { channel: "PUSH", to: pushTo, body } : undefined,
].filter(Boolean);

if (messages.length === 0) {
  fail("NOTIFICATION_SMOKE_EMAIL_TO veya NOTIFICATION_SMOKE_PUSH_TO değerlerinden en az biri gerekli.");
}

if (provider !== "noop" && process.env.NOTIFICATION_SMOKE_CONFIRM !== "send") {
  fail("Gerçek notification sağlayıcısı için NOTIFICATION_SMOKE_CONFIRM=send gerekli.");
}

const adapter = createNotificationAdapterFromEnv(process.env);
const results = await adapter.sendBatch(messages);

if (results.length !== messages.length) {
  fail("Notification provider smoke başarısız: sonuç sayısı mesaj sayısıyla eşleşmedi.");
}

const failed = results.find((result) => result.status !== "sent");
if (failed) {
  fail(`Notification provider smoke başarısız: ${failed.channel} ${failed.errorCode ?? "UNKNOWN"}`);
}

await writeSmokeEvidence(evidenceFile, {
  result: "PASS",
  check: "notification_provider_smoke",
  environment: process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
  checkedAt,
  provider,
  channels: results.map((result) => result.channel),
  recipients: results.map((result) => maskRecipient(result.to)),
  commandsPassed: ["pnpm notification:smoke"],
  gaps: [],
});

console.log(
  [
    "Notification provider smoke geçti:",
    `provider=${provider}`,
    `channels=${results.map((result) => result.channel).join(",")}`,
    `recipients=${results.map((result) => maskRecipient(result.to)).join(",")}`,
  ].join(" "),
);

function maskRecipient(value) {
  const visible = value.slice(-4);
  return `${"*".repeat(Math.max(0, value.length - visible.length))}${visible}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
