const dsn = process.env.SENTRY_DSN;
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const message = process.env.SENTRY_SMOKE_MESSAGE ?? "Uzman Hocam Sentry smoke";

if (!dsn) {
  fail("SENTRY_DSN boş bırakılamaz.");
}

if (process.env.SENTRY_SMOKE_CONFIRM !== "send") {
  fail("Sentry test event'i için SENTRY_SMOKE_CONFIRM=send gerekli.");
}

const endpoint = createEnvelopeEndpoint(dsn);
const eventId = crypto.randomUUID().replace(/-/g, "");
const envelope = [
  JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
  JSON.stringify({ type: "event" }),
  JSON.stringify({
    event_id: eventId,
    level: "info",
    logger: "uzman-hocam.smoke",
    message,
    environment,
    timestamp: new Date().toISOString(),
    platform: "node",
  }),
].join("\n");

const response = await fetch(endpoint.href, {
  method: "POST",
  headers: { "content-type": "application/x-sentry-envelope" },
  body: `${envelope}\n`,
}).catch((error) => fail(`Sentry smoke isteği gönderilemedi: ${error.cause?.code ?? error.message}`));

if (!response.ok) {
  fail(`Sentry smoke başarısız: HTTP ${response.status}`);
}

console.log(`Sentry smoke geçti: environment=${environment} eventId=${eventId}`);

function createEnvelopeEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("SENTRY_DSN geçerli URL olmalı.");
  }

  const publicKey = url.username;
  const projectId = url.pathname.split("/").filter(Boolean).at(-1);
  if (!publicKey || !projectId) {
    fail("SENTRY_DSN public key ve project id içermeli.");
  }

  const endpoint = new URL(`/api/${projectId}/envelope/`, url.origin);
  endpoint.searchParams.set("sentry_key", publicKey);
  endpoint.searchParams.set("sentry_version", "7");
  endpoint.searchParams.set("sentry_client", "uzman-hocam-smoke/1.0");
  return endpoint;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
