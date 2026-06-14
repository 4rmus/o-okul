import { request } from "node:https";
import { redactedUrl, validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const smokeUrl = process.env.TRAEFIK_HTTPS_SMOKE_URL ?? defaultSmokeUrl();
const expectedStatus = Number(process.env.TRAEFIK_HTTPS_SMOKE_EXPECTED_STATUS ?? "200");
const timeoutMs = Number(process.env.TRAEFIK_HTTPS_SMOKE_TIMEOUT_MS ?? "10000");
const allowLocal = process.env.TRAEFIK_HTTPS_SMOKE_ALLOW_LOCAL === "true";
const allowInsecureTls = process.env.TRAEFIK_HTTPS_SMOKE_ALLOW_INSECURE_TLS === "true";
const evidenceFile = process.env.TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const checkedAt = new Date().toISOString();

await validateSmokeEvidenceOutputTarget(evidenceFile);

if (!smokeUrl) {
  fail("TRAEFIK_HTTPS_SMOKE_URL boş bırakılamaz.");
}

let url;
try {
  url = new URL(smokeUrl);
} catch {
  fail("TRAEFIK_HTTPS_SMOKE_URL geçerli URL olmalı.");
}

if (url.protocol !== "https:") {
  fail("TRAEFIK_HTTPS_SMOKE_URL https olmalı.");
}

if (!allowLocal && isLocalHost(url.hostname)) {
  fail("TRAEFIK_HTTPS_SMOKE_URL production için gerçek host olmalı.");
}

if (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
  fail("TRAEFIK_HTTPS_SMOKE_EXPECTED_STATUS geçerli HTTP status olmalı.");
}

const response = await get(url).catch((error) => fail(`Traefik HTTPS smoke isteği başarısız: ${error.message}`));

if (response.statusCode !== expectedStatus) {
  fail(`Traefik HTTPS smoke başarısız: HTTP ${response.statusCode}, beklenen ${expectedStatus}.`);
}

if (!response.headers["strict-transport-security"]) {
  fail("Traefik HTTPS smoke başarısız: Strict-Transport-Security header'ı yok.");
}

if (url.pathname === "/health" && !response.body.includes('"status":"ok"')) {
  fail("Traefik HTTPS smoke başarısız: /health yanıtı status=ok içermiyor.");
}

await writeSmokeEvidence(evidenceFile, {
  result: "PASS",
  check: "traefik_https_smoke",
  environment: process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown",
  checkedAt,
  url: redactedUrl(url),
  expectedStatus,
  statusCode: response.statusCode,
  strictTransportSecurity: response.headers["strict-transport-security"],
  commandsPassed: ["pnpm traefik:https:smoke"],
  gaps: [],
});

console.log(`Traefik HTTPS smoke geçti: ${url.href} HTTP ${response.statusCode}`);

function defaultSmokeUrl() {
  if (!process.env.API_URL) {
    return undefined;
  }

  try {
    const apiUrl = new URL(process.env.API_URL);
    apiUrl.pathname = "/health";
    apiUrl.search = "";
    apiUrl.hash = "";
    return apiUrl.href;
  } catch {
    return undefined;
  }
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        rejectUnauthorized: !allowInsecureTls,
        timeout: timeoutMs,
        headers: {
          accept: "application/json,text/plain,*/*",
          "user-agent": "uzman-hocam-traefik-smoke/1.0",
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;

        res.on("data", (chunk) => {
          size += chunk.length;
          if (size <= 64 * 1024) {
            chunks.push(chunk);
          }
        });

        res.on("end", () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    req.on("timeout", () => req.destroy(new Error(`timeout ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end();
  });
}

function isLocalHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.") ||
    normalized === "::1" ||
    normalized === "0.0.0.0"
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
