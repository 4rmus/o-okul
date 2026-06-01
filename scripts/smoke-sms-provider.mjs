import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createSmsAdapterFromEnv } = require("../packages/sms-adapter/dist/index.js");

const provider = process.env.SMS_PROVIDER ?? "noop";
const to = process.env.SMS_SMOKE_TO;
const body = process.env.SMS_SMOKE_BODY ?? "Uzman Hocam SMS smoke";

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

console.log(
  [
    "SMS provider smoke geçti:",
    `provider=${provider}`,
    `to=${maskRecipient(to)}`,
    `segments=${result.segmentEstimate?.segments ?? 0}`,
    result.providerMessageId ? `providerMessageId=${result.providerMessageId}` : undefined,
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
