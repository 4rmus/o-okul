import assert from "node:assert/strict";
import test from "node:test";
import worker, { NotificationIdempotency } from "./index.mjs";

const token = "notification-bearer-token-for-tests";

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

function request(payload) {
  return new Request("https://notify.o-okul.com", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function env(sent = [], emailSend) {
  const instances = new Map();
  const environment = {
    NOTIFICATION_BEARER_TOKEN: token,
    RELEASE_SHA: "a".repeat(40),
    EMAIL: {
      async send(message) {
        if (emailSend) return emailSend(message);
        sent.push(message);
        return { messageId: "email-message-1" };
      },
    },
  };
  environment.IDEMPOTENCY = {
    idFromName(name) {
      return name;
    },
    get(id) {
      if (!instances.has(id)) instances.set(id, new NotificationIdempotency(state(), environment));
      return {
        fetch(input, init) {
          return instances.get(id).fetch(new Request(input, init));
        },
      };
    },
  };
  return environment;
}

function state() {
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
      },
      setAlarm() {},
      deleteAll() {
        values.clear();
      },
    },
  };
}
