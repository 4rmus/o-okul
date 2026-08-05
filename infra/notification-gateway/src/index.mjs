const FROM_EMAIL = "bildirim@o-okul.com";
const REPLY_TO_EMAIL = "destek@o-okul.com";
const MAX_MESSAGES = 25;
const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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

      try {
        const outcome = message.idempotencyKey
          ? await sendIdempotently(message, env)
          : await sendEmail(message, env);
        results.push(complete(message, outcome));
      } catch (error) {
        results.push(failed(message, providerErrorCode(error)));
      }
    }

    return json({ results }, 200);
  },
};

function validateMessage(message) {
  if (!message || typeof message !== "object") return "INVALID_MESSAGE";
  if (message.channel !== "EMAIL" && message.channel !== "PUSH") return "INVALID_CHANNEL";
  if (typeof message.to !== "string" || message.to.length < 1 || message.to.length > 4096) {
    return "INVALID_RECIPIENT";
  }
  if (message.channel === "EMAIL" && (message.to.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.to))) return "INVALID_RECIPIENT";
  if (typeof message.body !== "string" || message.body.length < 1 || message.body.length > 20_000) return "INVALID_BODY";
  if (message.subject !== undefined && (typeof message.subject !== "string" || message.subject.length > 200)) {
    return "INVALID_SUBJECT";
  }
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
          outcome = await sendEmail(message, this.env);
        } catch (error) {
          outcome = { status: "failed", errorCode: providerErrorCode(error) };
        }
        await this.state.storage.put("record", { fingerprint, outcome });
      } catch {
        outcome = { status: "failed", errorCode: "NOTIFICATION_IDEMPOTENCY_FAILED" };
      }
    });
    return json({ outcome }, 200);
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

function complete(message, outcome) {
  return {
    channel: "EMAIL",
    to: message.to,
    status: outcome.status,
    ...(outcome.providerMessageId ? { providerMessageId: outcome.providerMessageId } : {}),
    ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
  };
}

function providerErrorCode(error) {
  const providerCode = typeof error?.code === "string" ? error.code.replace(/[^A-Z0-9_]/g, "") : "FAILED";
  return `CLOUDFLARE_EMAIL_${providerCode || "FAILED"}`;
}

async function messageFingerprint(message) {
  const input = JSON.stringify({
    channel: message.channel,
    to: message.to,
    subject: message.subject ?? "o-okul bildirimi",
    body: message.body,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function failed(message, errorCode) {
  return {
    channel: message?.channel === "PUSH" ? "PUSH" : "EMAIL",
    to: typeof message?.to === "string" ? message.to : "invalid",
    status: "failed",
    errorCode,
  };
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

function json(payload, status, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}
