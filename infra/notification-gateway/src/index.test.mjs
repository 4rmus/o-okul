import assert from "node:assert/strict";
import test from "node:test";
import worker, { NotificationIdempotency } from "./index.mjs";

const token = "notification-bearer-token-for-tests";
const evidenceToken = "live-onboarding-evidence-bearer-token-for-tests";

test("reports the deployed release SHA without authentication", async () => {
  const response = await worker.fetch(new Request("https://notify.o-okul.com/health"), env());
  assert.deepEqual(await response.json(), { status: "ok", releaseSha: "a".repeat(40) });
});

test("rejects requests without the bearer token", async () => {
  const response = await worker.fetch(new Request("https://notify.o-okul.com", { method: "POST", body: "{}" }), env());
  assert.equal(response.status, 401);
});

test("sends a contract-compliant email", async () => {
  const sent = [];
  const environment = env(sent);
  const response = await worker.fetch(request({
    messages: [{
      channel: "EMAIL",
      to: "recipient@outside.example.org",
      from: "bildirim@o-okul.com",
      replyTo: "destek@o-okul.com",
      subject: "Deneme",
      body: "Bildirim metni",
      idempotencyKey: "notification-1",
    }],
  }), environment);

  assert.equal(response.status, 200);
  assert.deepEqual(sent, [{
    to: "recipient@outside.example.org",
    from: "bildirim@o-okul.com",
    replyTo: "destek@o-okul.com",
    subject: "Deneme",
    text: "Bildirim metni",
    headers: { "X-O-Okul-Idempotency-Key": "notification-1" },
  }]);
  assert.deepEqual(await response.json(), {
    results: [{
      channel: "EMAIL",
      to: "recipient@outside.example.org",
      status: "sent",
      providerMessageId: "email-message-1",
    }],
  });
});

test("stores and returns only a recent allowlisted activation after provider acceptance", async () => {
  const objectNames = [];
  const environment = env([], undefined, { objectNames });
  const recipient = "tenant.admin+gate-d+run@example.com";
  const activationUrl = "https://uat-kurumu.o-okul.com/parola-sifirla#token=single-use-token";
  const createdAfter = new Date(Date.now() - 1_000).toISOString();

  const sendResponse = await worker.fetch(request({
    messages: [{
      channel: "EMAIL",
      to: recipient,
      subject: "O-Okul hesap aktivasyonu",
      body: `Hesabınızı 24 saat içinde etkinleştirmek için bağlantıyı açın: ${activationUrl}`,
      idempotencyKey: "onboarding-capture-1",
    }],
  }), environment);
  const lookupResponse = await worker.fetch(evidenceRequest({ recipient, purpose: "PASSWORD_RESET", createdAfter }), environment);

  assert.equal((await sendResponse.json()).results[0].status, "sent");
  assert.equal(lookupResponse.status, 200);
  assert.deepEqual(await lookupResponse.json(), { activationUrl });
  assert.equal(objectNames.some((name) => name.includes(recipient)), false);
  assert.equal(objectNames.some((name) => /^onboarding-evidence:[0-9a-f]{64}$/.test(name)), true);
});

test("keeps onboarding evidence bearer protected and out of the request URL", async () => {
  const environment = env();
  const recipient = "tenant.admin+gate-d+run@example.com";
  const query = { recipient, purpose: "PASSWORD_RESET", createdAfter: new Date().toISOString() };
  const missingBearer = await worker.fetch(evidenceRequest(query, ""), environment);
  const getResponse = await worker.fetch(new Request("https://notify.o-okul.com/messages/latest"), environment);
  const wrongDomain = await worker.fetch(evidenceRequest({ ...query, recipient: "admin@outside.example.org" }), environment);
  const wrongRecipient = await worker.fetch(evidenceRequest({ ...query, recipient: "other.admin@example.com" }), environment);

  assert.equal(missingBearer.status, 401);
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get("allow"), "POST");
  assert.equal(wrongDomain.status, 400);
  assert.equal(wrongRecipient.status, 400);
  assert.equal(evidenceRequest(query).url.includes(recipient), false);
});

test("does not retain ordinary reset mail or provider failures", async () => {
  const recipient = "tenant.admin+gate-d+run@example.com";
  const createdAfter = new Date(Date.now() - 1_000).toISOString();
  const environment = env([], async () => {
    throw Object.assign(new Error("provider failed"), { code: "E_PROVIDER" });
  });
  const failedSend = await worker.fetch(request({
    messages: [{
      channel: "EMAIL",
      to: recipient,
      subject: "O-Okul hesap aktivasyonu",
      body: "Hesabınızı açın: https://tenant.o-okul.com/parola-sifirla#token=must-not-store",
    }],
  }), environment);
  const lookup = await worker.fetch(evidenceRequest({ recipient, purpose: "PASSWORD_RESET", createdAfter }), environment);

  assert.equal((await failedSend.json()).results[0].status, "failed");
  assert.equal(lookup.status, 404);
});

test("does not send the same idempotency key twice", async () => {
  const sent = [];
  const environment = env(sent);
  const payload = {
    messages: [{
      channel: "EMAIL",
      to: "recipient@outside.example.org",
      subject: "Deneme",
      body: "Bildirim metni",
      idempotencyKey: "notification-deduplicated",
    }],
  };

  const first = await worker.fetch(request(payload), environment);
  const second = await worker.fetch(request(payload), environment);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual(await second.json(), await first.json());
});

test("rejects payload changes for an existing idempotency key", async () => {
  const sent = [];
  const environment = env(sent);
  const base = {
    channel: "EMAIL",
    to: "recipient@outside.example.org",
    body: "İlk bildirim",
    idempotencyKey: "notification-conflict",
  };

  await worker.fetch(request({ messages: [base] }), environment);
  const response = await worker.fetch(request({ messages: [{ ...base, body: "Değiştirilmiş bildirim" }] }), environment);

  assert.equal(sent.length, 1);
  assert.deepEqual(await response.json(), {
    results: [{
      channel: "EMAIL",
      to: "recipient@outside.example.org",
      status: "failed",
      errorCode: "NOTIFICATION_IDEMPOTENCY_CONFLICT",
    }],
  });
});

test("does not retry an uncertain provider outcome with the same key", async () => {
  let attempts = 0;
  const environment = env([], async () => {
    attempts += 1;
    throw Object.assign(new Error("rate limited"), { code: "E_RATE_LIMIT_EXCEEDED" });
  });
  const payload = {
    messages: [{
      channel: "EMAIL",
      to: "recipient@outside.example.org",
      body: "Tek gönderim",
      idempotencyKey: "notification-uncertain",
    }],
  };

  const first = await worker.fetch(request(payload), environment);
  const second = await worker.fetch(request(payload), environment);

  assert.equal(attempts, 1);
  assert.deepEqual(await second.json(), await first.json());
});

test("fails closed for push without pretending delivery", async () => {
  const response = await worker.fetch(request({
    messages: [{ channel: "PUSH", to: "ops-device-token", body: "Bildirim" }],
  }), env());
  assert.deepEqual(await response.json(), {
    results: [{
      channel: "PUSH",
      to: "ops-device-token",
      status: "failed",
      errorCode: "NOTIFICATION_PUSH_NOT_CONFIGURED",
    }],
  });
});

test("fails closed for WhatsApp without calling Meta", async () => {
  let fetches = 0;
  const response = await worker.fetch(request({ messages: [whatsappMessage()] }), env([], undefined, {
    WHATSAPP_ENABLED: "false",
    WHATSAPP_FETCH: async () => {
      fetches += 1;
      throw new Error("must not run");
    },
  }));

  assert.equal(fetches, 0);
  assert.deepEqual(await response.json(), {
    results: [{
      channel: "WHATSAPP",
      to: "+905000000001",
      status: "failed",
      errorCode: "NOTIFICATION_WHATSAPP_DISABLED",
    }],
  });
});

test("keeps the WhatsApp webhook hidden while disabled", async () => {
  const response = await worker.fetch(new Request("https://notify.o-okul.com/webhooks/whatsapp?hub.mode=subscribe"), env());
  assert.equal(response.status, 404);
});

test("sends the exact Meta utility template once for an idempotency key", async () => {
  const calls = [];
  const environment = whatsappEnv(async (input, init) => {
    calls.push({ input, init });
    return Response.json({ messages: [{ id: "wamid.accepted-1" }] });
  });
  const payload = { messages: [whatsappMessage()] };

  const first = await worker.fetch(request(payload), environment);
  const second = await worker.fetch(request(payload), environment);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "https://graph.facebook.com/v23.0/123456789/messages");
  assert.deepEqual(Object.fromEntries(new Headers(calls[0].init.headers)), {
    authorization: "Bearer test-access-token",
    "content-type": "application/json",
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "+905000000001",
    type: "template",
    template: { name: "school_announcement_v1", language: { code: "tr" } },
  });
  assert.deepEqual(await first.json(), {
    results: [{
      channel: "WHATSAPP",
      to: "+905000000001",
      status: "sent",
      providerMessageId: "wamid.accepted-1",
    }],
  });
  assert.deepEqual(await second.json(), {
    results: [{
      channel: "WHATSAPP",
      to: "+905000000001",
      status: "sent",
      providerMessageId: "wamid.accepted-1",
    }],
  });
});

test("returns fixed errors for WhatsApp config and provider failures", async (context) => {
  await context.test("missing config", async () => {
    const response = await worker.fetch(request({ messages: [whatsappMessage("missing-config")] }), env([], undefined, {
      WHATSAPP_ENABLED: "true",
    }));
    assert.equal((await response.json()).results[0].errorCode, "NOTIFICATION_WHATSAPP_NOT_CONFIGURED");
  });

  await context.test("invalid config", async () => {
    for (const override of [
      { WHATSAPP_GRAPH_API_VERSION: "23.0" },
      { WHATSAPP_PHONE_NUMBER_ID: "phone-id" },
      { WHATSAPP_UTILITY_TEMPLATE_NAME: "School-Announcement" },
    ]) {
      let fetches = 0;
      const response = await worker.fetch(request({ messages: [whatsappMessage(`invalid-config-${Object.keys(override)[0]}`)] }), whatsappEnv(async () => {
        fetches += 1;
        return Response.json({ messages: [{ id: "must-not-send" }] });
      }, override));
      assert.equal(fetches, 0);
      assert.equal((await response.json()).results[0].errorCode, "NOTIFICATION_WHATSAPP_NOT_CONFIGURED");
    }
  });

  await context.test("template outside allowlist", async () => {
    let fetches = 0;
    const response = await worker.fetch(request({ messages: [{ ...whatsappMessage("template-denied"), templateName: "other_template" }] }), whatsappEnv(async () => {
      fetches += 1;
      return Response.json({ messages: [{ id: "must-not-send" }] });
    }));
    assert.equal(fetches, 0);
    assert.equal((await response.json()).results[0].errorCode, "NOTIFICATION_WHATSAPP_TEMPLATE_NOT_ALLOWED");
  });

  await context.test("non-2xx", async () => {
    const response = await worker.fetch(request({ messages: [whatsappMessage("provider-failed")] }), whatsappEnv(async () => new Response("secret provider detail", { status: 400 })));
    assert.equal((await response.json()).results[0].errorCode, "NOTIFICATION_WHATSAPP_PROVIDER_FAILED");
  });

  await context.test("invalid response", async () => {
    const response = await worker.fetch(request({ messages: [whatsappMessage("invalid-response")] }), whatsappEnv(async () => Response.json({ messages: [] })));
    assert.equal((await response.json()).results[0].errorCode, "NOTIFICATION_WHATSAPP_INVALID_RESPONSE");
  });
});

test("rejects unknown WhatsApp message fields", async () => {
  const response = await worker.fetch(request({ messages: [{ ...whatsappMessage("unknown-key"), body: "free text" }] }), whatsappEnv());
  assert.equal((await response.json()).results[0].errorCode, "INVALID_WHATSAPP_CONTENT");
});

test("verifies the WhatsApp webhook challenge exactly", async () => {
  const environment = whatsappEnv();
  const accepted = await worker.fetch(new Request("https://notify.o-okul.com/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge-123"), environment);
  const rejected = await worker.fetch(new Request("https://notify.o-okul.com/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123"), environment);
  const wrongMode = await worker.fetch(new Request("https://notify.o-okul.com/webhooks/whatsapp?hub.mode=other&hub.verify_token=verify-token&hub.challenge=challenge-123"), environment);
  const emptyChallenge = await worker.fetch(new Request("https://notify.o-okul.com/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge="), environment);
  const longChallenge = await worker.fetch(new Request(`https://notify.o-okul.com/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=${"a".repeat(201)}`), environment);

  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await accepted.text(), "challenge-123");
  assert.equal(rejected.status, 403);
  assert.equal(wrongMode.status, 403);
  assert.equal(emptyChallenge.status, 403);
  assert.equal(longChallenge.status, 403);
});

test("fails closed when the enabled WhatsApp webhook is not configured", async () => {
  const body = JSON.stringify(statusWebhook());
  const response = await worker.fetch(webhookRequest(body, await signature(body)), whatsappEnv(undefined, { WHATSAPP_APP_SECRET: undefined }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { errorCode: "WHATSAPP_WEBHOOK_NOT_CONFIGURED" });
});

test("rejects missing, wrong, and tampered WhatsApp webhook signatures", async (context) => {
  const environment = whatsappEnv();
  const body = JSON.stringify(statusWebhook());

  await context.test("missing", async () => {
    const response = await worker.fetch(webhookRequest(body), environment);
    assert.equal(response.status, 401);
  });
  await context.test("wrong", async () => {
    const response = await worker.fetch(webhookRequest(body, `sha256=${"0".repeat(64)}`), environment);
    assert.equal(response.status, 401);
  });
  await context.test("tampered", async () => {
    const response = await worker.fetch(webhookRequest(`${body} `, await signature(body)), environment);
    assert.equal(response.status, 401);
  });
});

test("stops reading an oversized WhatsApp webhook body at the byte limit", async () => {
  let pulls = 0;
  let cancelled = false;
  const chunk = new Uint8Array(128 * 1024);
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const request = new Request("https://notify.o-okul.com/webhooks/whatsapp", {
    method: "POST",
    body,
    duplex: "half",
  });

  const response = await worker.fetch(request, whatsappEnv());

  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { errorCode: "WHATSAPP_WEBHOOK_TOO_LARGE" });
  assert.equal(pulls, 3);
  assert.equal(cancelled, true);
});

test("stores one PII-free record for duplicate WhatsApp delivery status", async () => {
  const storedEvents = [];
  const environment = whatsappEnv(undefined, { storedEvents });
  const body = JSON.stringify(statusWebhook());
  const requestSignature = await signature(body);

  const first = await worker.fetch(webhookRequest(body, requestSignature), environment);
  const second = await worker.fetch(webhookRequest(body, requestSignature), environment);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(storedEvents.length, 1);
  assert.deepEqual(Object.keys(storedEvents[0]).sort(), ["eventKeyHash", "receivedAt", "status", "tenantId"]);
  assert.match(storedEvents[0].eventKeyHash, /^[0-9a-f]{64}$/);
  assert.equal(storedEvents[0].tenantId, "11111111-1111-4111-8111-111111111111");
  assert.equal(storedEvents[0].status, "delivered");
  assert.equal(storedEvents[0].eventKeyHash.includes("wamid"), false);
});

test("reconstructs a safe webhook record before Durable Object storage", async () => {
  const storedEvents = [];
  const object = new NotificationIdempotency(state(storedEvents), {});
  const response = await object.fetch(new Request("https://idempotency.internal/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventKeyHash: "a".repeat(64),
      tenantId: "11111111-1111-4111-8111-111111111111",
      status: "delivered",
      receivedAt: "2026-08-08T00:00:00.000Z",
      phone: "+905000000001",
      wamid: "wamid.must-not-store",
      raw: { secret: true },
    }),
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(storedEvents, [{
    eventKeyHash: "a".repeat(64),
    tenantId: "11111111-1111-4111-8111-111111111111",
    status: "delivered",
    receivedAt: "2026-08-08T00:00:00.000Z",
  }]);
});

test("returns 503 so Meta can retry when webhook storage fails", async () => {
  const environment = whatsappEnv();
  environment.IDEMPOTENCY = {
    idFromName(name) {
      return name;
    },
    get() {
      return { fetch: async () => new Response(null, { status: 500 }) };
    },
  };
  const body = JSON.stringify(statusWebhook());
  const response = await worker.fetch(webhookRequest(body, await signature(body)), environment);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { errorCode: "WHATSAPP_WEBHOOK_STORAGE_FAILED" });
});

test("acknowledges unknown phones and inbound messages without storage", async () => {
  const storedEvents = [];
  const environment = whatsappEnv(undefined, { storedEvents });
  const payloads = [
    statusWebhook("unknown-phone"),
    {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "123456789" }, messages: [{ id: "wamid.inbound", from: "905000000001" }] } }] }],
    },
  ];

  for (const payload of payloads) {
    const body = JSON.stringify(payload);
    const response = await worker.fetch(webhookRequest(body, await signature(body)), environment);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ignored" });
  }
  assert.equal(storedEvents.length, 0);
});

function request(payload) {
  return new Request("https://notify.o-okul.com", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function evidenceRequest(payload, bearerToken = evidenceToken) {
  return new Request("https://notify.o-okul.com/messages/latest", {
    method: "POST",
    headers: {
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function env(sent = [], emailSend, overrides = {}) {
  const instances = new Map();
  const storedEvents = overrides.storedEvents ?? [];
  const objectNames = overrides.objectNames ?? [];
  const environment = {
    NOTIFICATION_BEARER_TOKEN: token,
    RELEASE_SHA: "a".repeat(40),
    LIVE_ONBOARDING_EMAIL_EVIDENCE_ENABLED: "true",
    LIVE_ONBOARDING_EMAIL_EVIDENCE_BEARER_TOKEN: evidenceToken,
    LIVE_ONBOARDING_EMAIL_EVIDENCE_HASH_KEY: "evidence-hmac-key-for-tests-0000000000000001",
    LIVE_ONBOARDING_EMAIL_EVIDENCE_RECIPIENT_BASE: "tenant.admin+gate-d@example.com",
    LIVE_ONBOARDING_EMAIL_EVIDENCE_ACTIVATION_DOMAIN: "o-okul.com",
    EMAIL: {
      async send(message) {
        if (emailSend) return emailSend(message);
        sent.push(message);
        return { messageId: "email-message-1" };
      },
    },
    ...overrides,
  };
  delete environment.storedEvents;
  delete environment.objectNames;
  environment.IDEMPOTENCY = {
    idFromName(name) {
      objectNames.push(name);
      return name;
    },
    get(id) {
      if (!instances.has(id)) instances.set(id, new NotificationIdempotency(state(storedEvents), environment));
      return {
        fetch(input, init) {
          return instances.get(id).fetch(new Request(input, init));
        },
      };
    },
  };
  return environment;
}

function state(storedEvents = []) {
  const values = new Map();
  return {
    blockConcurrencyWhile(callback) {
      return callback();
    },
    storage: {
      get(key) {
        return values.get(key);
      },
      put(key, value) {
        values.set(key, value);
        if (key === "event") storedEvents.push(value);
      },
      setAlarm() {},
      deleteAll() {
        values.clear();
      },
    },
  };
}

function whatsappMessage(suffix = "send-1") {
  return {
    channel: "WHATSAPP",
    to: "+905000000001",
    templateName: "school_announcement_v1",
    languageCode: "tr",
    idempotencyKey: `whatsapp:${suffix}`,
  };
}

function whatsappEnv(whatsappFetch, overrides = {}) {
  return env([], undefined, {
    WHATSAPP_ENABLED: "true",
    WHATSAPP_ACCESS_TOKEN: "test-access-token",
    WHATSAPP_PHONE_NUMBER_ID: "123456789",
    WHATSAPP_GRAPH_API_VERSION: "v23.0",
    WHATSAPP_UTILITY_TEMPLATE_NAME: "school_announcement_v1",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token",
    WHATSAPP_APP_SECRET: "app-secret",
    WHATSAPP_PILOT_TENANT_ID: "11111111-1111-4111-8111-111111111111",
    ...(whatsappFetch ? { WHATSAPP_FETCH: whatsappFetch } : {}),
    ...overrides,
  });
}

function statusWebhook(phoneNumberId = "123456789") {
  return {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        field: "messages",
        value: {
          metadata: { phone_number_id: phoneNumberId },
          statuses: [{ id: "wamid.delivery-1", status: "delivered", timestamp: "1786180000" }],
        },
      }],
    }],
  };
}

function webhookRequest(body, requestSignature) {
  return new Request("https://notify.o-okul.com/webhooks/whatsapp", {
    method: "POST",
    headers: requestSignature ? { "x-hub-signature-256": requestSignature } : {},
    body,
  });
}

async function signature(body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("app-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `sha256=${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
