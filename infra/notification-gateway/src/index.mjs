const FROM_EMAIL = "bildirim@o-okul.com";
const REPLY_TO_EMAIL = "destek@o-okul.com";
const MAX_MESSAGES = 25;
const MAX_WEBHOOK_BYTES = 256 * 1024;
const MAX_WEBHOOK_CHALLENGE_LENGTH = 200;
const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const WHATSAPP_STATUSES = new Set(["sent", "delivered", "read", "failed"]);
const WHATSAPP_MESSAGE_KEYS = new Set(["channel", "to", "templateName", "languageCode", "idempotencyKey"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/webhooks/whatsapp") return whatsappWebhook(request, env, url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", releaseSha: env.RELEASE_SHA ?? "unknown" }, 200);
    }
    if (request.method !== "POST") {
      return json({ errorCode: "METHOD_NOT_ALLOWED" }, 405, { Allow: "POST" });
    }

    const authorization = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${env.NOTIFICATION_BEARER_TOKEN ?? ""}`;
    if (!env.NOTIFICATION_BEARER_TOKEN || !(await secretsEqual(authorization, expected))) {
      return json({ errorCode: "NOTIFICATION_HTTP_401" }, 401);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ errorCode: "INVALID_JSON" }, 400);
    }

    if (!Array.isArray(payload.messages) || payload.messages.length < 1 || payload.messages.length > MAX_MESSAGES) {
      return json({ errorCode: "INVALID_MESSAGES" }, 400);
    }

    const results = [];
    for (const message of payload.messages) {
      const validationError = validateMessage(message);
      if (validationError) {
        results.push(failed(message, validationError));
        continue;
      }

      if (message.channel === "PUSH") {
        results.push(failed(message, "NOTIFICATION_PUSH_NOT_CONFIGURED"));
        continue;
      }
      if (message.channel === "WHATSAPP" && env.WHATSAPP_ENABLED !== "true") {
        results.push(failed(message, "NOTIFICATION_WHATSAPP_DISABLED"));
        continue;
      }

      try {
        const outcome = message.idempotencyKey
          ? await sendIdempotently(message, env)
          : await dispatchMessage(message, env);
        results.push(complete(message, outcome));
      } catch (error) {
        results.push(failed(message, providerErrorCode(error, message.channel)));
      }
    }

    return json({ results }, 200);
  },
};

function validateMessage(message) {
  if (!message || typeof message !== "object") return "INVALID_MESSAGE";
  if (message.channel !== "EMAIL" && message.channel !== "PUSH" && message.channel !== "WHATSAPP") return "INVALID_CHANNEL";
  if (typeof message.to !== "string" || message.to.length < 1 || message.to.length > 4096) return "INVALID_RECIPIENT";

  if (message.channel === "WHATSAPP") {
    if (Object.keys(message).some((key) => !WHATSAPP_MESSAGE_KEYS.has(key))) return "INVALID_WHATSAPP_CONTENT";
    if (!/^\+[1-9]\d{7,14}$/.test(message.to)) return "INVALID_RECIPIENT";
    if (typeof message.templateName !== "string" || message.templateName.length < 1 || message.templateName.length > 512) {
      return "INVALID_TEMPLATE_NAME";
    }
    if (message.languageCode !== "tr") return "INVALID_LANGUAGE_CODE";
    if (typeof message.idempotencyKey !== "string" || message.idempotencyKey.length < 1 || message.idempotencyKey.length > 200) {
      return "INVALID_IDEMPOTENCY_KEY";
    }
    return undefined;
  }

  if (message.channel === "EMAIL" && (message.to.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.to))) {
    return "INVALID_RECIPIENT";
  }
  if (typeof message.body !== "string" || message.body.length < 1 || message.body.length > 20_000) return "INVALID_BODY";
  if (message.subject !== undefined && (typeof message.subject !== "string" || message.subject.length > 200)) return "INVALID_SUBJECT";
  if (message.from !== undefined && message.from !== FROM_EMAIL) return "INVALID_FROM";
  if (message.replyTo !== undefined && message.replyTo !== REPLY_TO_EMAIL) return "INVALID_REPLY_TO";
  if (message.idempotencyKey !== undefined && (typeof message.idempotencyKey !== "string" || message.idempotencyKey.length > 200)) {
    return "INVALID_IDEMPOTENCY_KEY";
  }
  return undefined;
}

export class NotificationIdempotency {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    return new URL(request.url).pathname === "/webhook"
      ? this.storeWebhookEvent(request)
      : this.sendMessage(request);
  }

  async sendMessage(request) {
    let outcome;
    await this.state.blockConcurrencyWhile(async () => {
      try {
        const { message } = await request.json();
        const fingerprint = await messageFingerprint(message);
        const stored = await this.state.storage.get("record");
        if (stored) {
          outcome = stored.fingerprint === fingerprint
            ? stored.outcome
            : { status: "failed", errorCode: "NOTIFICATION_IDEMPOTENCY_CONFLICT" };
          return;
        }

        const uncertain = { status: "failed", errorCode: "NOTIFICATION_DELIVERY_UNCERTAIN" };
        await this.state.storage.put("record", { fingerprint, outcome: uncertain });
        await this.state.storage.setAlarm(Date.now() + IDEMPOTENCY_RETENTION_MS);

        try {
          outcome = await dispatchMessage(message, this.env);
        } catch (error) {
          outcome = { status: "failed", errorCode: providerErrorCode(error, message.channel) };
        }
        await this.state.storage.put("record", { fingerprint, outcome });
      } catch {
        outcome = { status: "failed", errorCode: "NOTIFICATION_IDEMPOTENCY_FAILED" };
      }
    });
    return json({ outcome }, 200);
  }

  async storeWebhookEvent(request) {
    let input;
    try {
      input = await request.json();
    } catch {
      return json({ errorCode: "WHATSAPP_WEBHOOK_EVENT_INVALID" }, 400);
    }
    const event = {
      eventKeyHash: input?.eventKeyHash,
      tenantId: input?.tenantId,
      status: input?.status,
      receivedAt: input?.receivedAt,
    };
    if (!/^[0-9a-f]{64}$/.test(event.eventKeyHash ?? "") || !isCanonicalUuid(event.tenantId)
      || !WHATSAPP_STATUSES.has(event.status) || !isIsoTimestamp(event.receivedAt)) {
      return json({ errorCode: "WHATSAPP_WEBHOOK_EVENT_INVALID" }, 400);
    }

    let duplicate = false;
    await this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get("event");
      if (stored) {
        duplicate = true;
        return;
      }
      await this.state.storage.put("event", event);
      await this.state.storage.setAlarm(Date.now() + IDEMPOTENCY_RETENTION_MS);
    });
    return json({ duplicate }, 200);
  }

  async alarm() {
    await this.state.storage.deleteAll();
  }
}

async function sendIdempotently(message, env) {
  const objectId = env.IDEMPOTENCY.idFromName(message.idempotencyKey);
  const response = await env.IDEMPOTENCY.get(objectId).fetch("https://idempotency.internal/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) throw new Error("IDEMPOTENCY_OBJECT_FAILED");
  const payload = await response.json();
  if (!payload.outcome || (payload.outcome.status !== "sent" && payload.outcome.status !== "failed")) {
    throw new Error("IDEMPOTENCY_OBJECT_INVALID");
  }
  return payload.outcome;
}

function dispatchMessage(message, env) {
  return message.channel === "WHATSAPP" ? sendWhatsapp(message, env) : sendEmail(message, env);
}

async function sendEmail(message, env) {
  const sent = await env.EMAIL.send({
    to: message.to,
    from: FROM_EMAIL,
    replyTo: REPLY_TO_EMAIL,
    subject: message.subject ?? "o-okul bildirimi",
    text: message.body,
    ...(message.idempotencyKey ? { headers: { "X-O-Okul-Idempotency-Key": message.idempotencyKey } } : {}),
  });
  return { status: "sent", providerMessageId: sent.messageId };
}

async function sendWhatsapp(message, env) {
  if (!validWhatsappSendConfig(env)) {
    throw providerError("NOTIFICATION_WHATSAPP_NOT_CONFIGURED");
  }
  if (message.templateName !== env.WHATSAPP_UTILITY_TEMPLATE_NAME) {
    throw providerError("NOTIFICATION_WHATSAPP_TEMPLATE_NOT_ALLOWED");
  }

  let response;
  try {
    response = await (env.WHATSAPP_FETCH ?? fetch)(
      `https://graph.facebook.com/${env.WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)}/messages`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: message.to,
          type: "template",
          template: { name: message.templateName, language: { code: "tr" } },
        }),
      },
    );
  } catch {
    throw providerError("NOTIFICATION_WHATSAPP_PROVIDER_FAILED");
  }
  if (!response.ok) throw providerError("NOTIFICATION_WHATSAPP_PROVIDER_FAILED");

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw providerError("NOTIFICATION_WHATSAPP_INVALID_RESPONSE");
  }
  if (typeof payload?.messages?.[0]?.id !== "string" || payload.messages[0].id.length < 1) {
    throw providerError("NOTIFICATION_WHATSAPP_INVALID_RESPONSE");
  }
  return { status: "sent", providerMessageId: payload.messages[0].id };
}

async function whatsappWebhook(request, env, url) {
  if (env.WHATSAPP_ENABLED !== "true") return json({ errorCode: "NOT_FOUND" }, 404);

  if (request.method === "GET") {
    const mode = url.searchParams.get("hub.mode") ?? "";
    const token = url.searchParams.get("hub.verify_token") ?? "";
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode !== "subscribe" || challenge.length < 1 || challenge.length > MAX_WEBHOOK_CHALLENGE_LENGTH
      || !env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || !(await secretsEqual(token, env.WHATSAPP_WEBHOOK_VERIFY_TOKEN))) {
      return json({ errorCode: "WHATSAPP_WEBHOOK_VERIFICATION_FAILED" }, 403);
    }
    return text(challenge, 200);
  }
  if (request.method !== "POST") return json({ errorCode: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, POST" });
  if (!validWhatsappWebhookConfig(env)) return json({ errorCode: "WHATSAPP_WEBHOOK_NOT_CONFIGURED" }, 503);

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return json({ errorCode: "WHATSAPP_WEBHOOK_TOO_LARGE" }, 413);
  }
  let bytes;
  try {
    bytes = await readWebhookBodyWithinLimit(request, MAX_WEBHOOK_BYTES);
  } catch {
    return json({ errorCode: "WHATSAPP_WEBHOOK_BODY_FAILED" }, 400);
  }
  if (!bytes) return json({ errorCode: "WHATSAPP_WEBHOOK_TOO_LARGE" }, 413);
  if (!(await validWebhookSignature(bytes, request.headers.get("x-hub-signature-256"), env.WHATSAPP_APP_SECRET))) {
    return json({ errorCode: "WHATSAPP_WEBHOOK_UNAUTHORIZED" }, 401);
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ errorCode: "INVALID_JSON" }, 400);
  }

  const events = webhookStatusEvents(payload, env.WHATSAPP_PHONE_NUMBER_ID);
  if (events.length === 0) {
    return json({ status: "ignored" }, 200);
  }

  try {
    for (const event of events) await storeWebhookEvent(event, env);
  } catch {
    return json({ errorCode: "WHATSAPP_WEBHOOK_STORAGE_FAILED" }, 503);
  }
  return json({ status: "accepted" }, 200);
}

function webhookStatusEvents(payload, phoneNumberId) {
  const events = [];
  if (payload?.object !== "whatsapp_business_account") return events;
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (change?.field !== "messages" || value?.metadata?.phone_number_id !== phoneNumberId || !Array.isArray(value.statuses)) continue;
      for (const status of value.statuses) {
        if (typeof status?.id !== "string" || status.id.length < 1 || status.id.length > 512
          || !/^\d{1,20}$/.test(status?.timestamp ?? "") || !WHATSAPP_STATUSES.has(status?.status)) continue;
        events.push({ phoneNumberId, wamid: status.id, status: status.status, timestamp: status.timestamp });
      }
    }
  }
  return events;
}

async function readWebhookBodyWithinLimit(request, limit) {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error("INVALID_BODY_CHUNK");
      totalBytes += value.byteLength;
      if (totalBytes > limit) {
        try {
          await reader.cancel();
        } catch {
          // The 413 response remains authoritative even if the source rejects cancellation.
        }
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function storeWebhookEvent(event, env) {
  const eventKeyHash = await sha256(`${event.phoneNumberId}\n${event.wamid}\n${event.status}\n${event.timestamp}`);
  const objectId = env.IDEMPOTENCY.idFromName(`whatsapp-webhook:${eventKeyHash}`);
  const response = await env.IDEMPOTENCY.get(objectId).fetch("https://idempotency.internal/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventKeyHash, tenantId: env.WHATSAPP_PILOT_TENANT_ID, status: event.status, receivedAt: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error("WHATSAPP_WEBHOOK_STORAGE_FAILED");
}

function validWhatsappSendConfig(env) {
  return typeof env.WHATSAPP_ACCESS_TOKEN === "string" && env.WHATSAPP_ACCESS_TOKEN.length > 0
    && /^\d{5,20}$/.test(env.WHATSAPP_PHONE_NUMBER_ID ?? "")
    && /^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_API_VERSION ?? "")
    && /^[a-z0-9_]{1,512}$/.test(env.WHATSAPP_UTILITY_TEMPLATE_NAME ?? "");
}

function validWhatsappWebhookConfig(env) {
  return typeof env.WHATSAPP_APP_SECRET === "string" && env.WHATSAPP_APP_SECRET.length > 0 && env.WHATSAPP_APP_SECRET.length <= 512
    && /^\d{5,20}$/.test(env.WHATSAPP_PHONE_NUMBER_ID ?? "") && isCanonicalUuid(env.WHATSAPP_PILOT_TENANT_ID);
}

function isCanonicalUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function isIsoTimestamp(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

async function validWebhookSignature(bytes, signature, secret) {
  if (!/^sha256=[0-9a-f]{64}$/.test(signature ?? "")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  const actual = Uint8Array.from(signature.slice(7).match(/../g), (byte) => Number.parseInt(byte, 16));
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
  return difference === 0;
}

function complete(message, outcome) {
  return {
    channel: message.channel,
    to: message.to,
    status: outcome.status,
    ...(outcome.providerMessageId ? { providerMessageId: outcome.providerMessageId } : {}),
    ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
  };
}

function providerError(errorCode) {
  return Object.assign(new Error(errorCode), { code: errorCode });
}

function providerErrorCode(error, channel) {
  if (channel === "WHATSAPP") {
    return typeof error?.code === "string" && error.code.startsWith("NOTIFICATION_WHATSAPP_")
      ? error.code
      : "NOTIFICATION_WHATSAPP_PROVIDER_FAILED";
  }
  const providerCode = typeof error?.code === "string" ? error.code.replace(/[^A-Z0-9_]/g, "") : "FAILED";
  return `CLOUDFLARE_EMAIL_${providerCode || "FAILED"}`;
}

async function messageFingerprint(message) {
  const input = message.channel === "WHATSAPP"
    ? JSON.stringify({ channel: message.channel, to: message.to, templateName: message.templateName, languageCode: message.languageCode })
    : JSON.stringify({ channel: message.channel, to: message.to, subject: message.subject ?? "o-okul bildirimi", body: message.body });
  return sha256(input);
}

function failed(message, errorCode) {
  return {
    channel: message?.channel === "PUSH" ? "PUSH" : message?.channel === "WHATSAPP" ? "WHATSAPP" : "EMAIL",
    to: typeof message?.to === "string" ? message.to : "invalid",
    status: "failed",
    errorCode,
  };
}

async function sha256(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function secretsEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = left.length ^ right.length;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function text(payload, status) {
  return new Response(payload, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function json(payload, status, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}
