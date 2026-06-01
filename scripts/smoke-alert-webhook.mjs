const webhookUrl = process.env.ALERT_WEBHOOK_URL;
const token = process.env.ALERT_WEBHOOK_TOKEN;
const environment = process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";

if (!webhookUrl) {
  fail("ALERT_WEBHOOK_URL boş bırakılamaz.");
}

let url;
try {
  url = new URL(webhookUrl);
} catch {
  fail("ALERT_WEBHOOK_URL geçerli URL olmalı.");
}

const body = {
  source: "uzman-hocam",
  event: "observability.alert_webhook_smoke",
  severity: "info",
  environment,
  message: "Uzman Hocam alert webhook smoke",
  sentAt: new Date().toISOString(),
};

const headers = {
  "content-type": "application/json",
};
if (token) {
  headers.authorization = `Bearer ${token}`;
}

const response = await fetch(url, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
});

if (!response.ok) {
  fail(`Alert webhook smoke başarısız: HTTP ${response.status}`);
}

console.log(`Alert webhook smoke geçti: HTTP ${response.status}`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
