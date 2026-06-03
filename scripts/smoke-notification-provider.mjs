import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createNotificationAdapterFromEnv } = require("../packages/notification-adapter/dist/index.js");

const provider = process.env.NOTIFICATION_PROVIDER ?? "noop";
const emailTo = process.env.NOTIFICATION_SMOKE_EMAIL_TO;
const pushTo = process.env.NOTIFICATION_SMOKE_PUSH_TO;
const subject = process.env.NOTIFICATION_SMOKE_SUBJECT ?? "Uzman Hocam notification smoke";
const body = process.env.NOTIFICATION_SMOKE_BODY ?? "Uzman Hocam notification smoke";

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
