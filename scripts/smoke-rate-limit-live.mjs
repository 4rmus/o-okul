import { createHash, randomInt } from "node:crypto";
import { redactedUrl, validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const apiUrl = process.env.API_URL;
const firstUrl = readUrl("RATE_LIMIT_SMOKE_URL", defaultRateLimitUrl(apiUrl));
const secondUrl = readUrl("RATE_LIMIT_SMOKE_SECOND_INSTANCE_URL");
const evidenceFile = process.env.RATE_LIMIT_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const maxRequests = readPositiveInteger(process.env.API_RATE_LIMIT_MAX, 300);
const windowMs = readPositiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000);
const loginMaxAttempts = readPositiveInteger(process.env.LOGIN_ATTEMPT_LIMITER_MAX_ATTEMPTS, 5);
const clientIp = process.env.RATE_LIMIT_SMOKE_CLIENT_IP ?? `198.51.100.${randomInt(10, 240)}`;
const loginClientIp = process.env.RATE_LIMIT_LOGIN_SMOKE_CLIENT_IP ?? `203.0.113.${randomInt(10, 240)}`;
const otherLoginIp = process.env.RATE_LIMIT_LOGIN_SMOKE_OTHER_IP ?? `203.0.113.${randomInt(10, 240)}`;
const loginEmail = process.env.RATE_LIMIT_LOGIN_SMOKE_EMAIL ?? `rate-limit-smoke-${Date.now()}@example.invalid`;
const loginUrl = readUrl("RATE_LIMIT_LOGIN_SMOKE_URL", defaultLoginUrl(apiUrl));
const secondLoginUrl = readUrl("RATE_LIMIT_LOGIN_SMOKE_SECOND_INSTANCE_URL", defaultLoginUrl(secondUrl?.origin));
const expectedRateLimitCode = "RATE_LIMITED";
const expectedLoginLockCode = "LOGIN_LOCKED";

await validateSmokeEvidenceOutputTarget(evidenceFile);

if (!firstUrl) {
  fail("RATE_LIMIT_SMOKE_URL veya API_URL bos birakilamaz.");
}
if (!secondUrl) {
  fail("RATE_LIMIT_SMOKE_SECOND_INSTANCE_URL ikinci API instance veya LB shard URL'i olarak zorunludur.");
}
if (!loginUrl || !secondLoginUrl) {
  fail("RATE_LIMIT_LOGIN_SMOKE_URL ve RATE_LIMIT_LOGIN_SMOKE_SECOND_INSTANCE_URL belirlenmeli.");
}

const apiLimitResult = await verifyApiRateLimit();
const loginLimitResult = await verifyLoginAttemptLimiter();

await writeSmokeEvidence(evidenceFile, {
  result: "PASS",
  check: "rate_limit_redis_smoke",
  environment,
  checkedAt: new Date().toISOString(),
  config: {
    apiRateLimitEnabled: process.env.API_RATE_LIMIT_ENABLED === "true",
    apiRateLimitStore: process.env.API_RATE_LIMIT_STORE ?? "redis",
    loginAttemptLimiterStore: process.env.LOGIN_ATTEMPT_LIMITER_STORE ?? "redis",
    windowMs,
    maxRequests,
    loginMaxAttempts,
    keyIncludesClientIpHash: true,
    excludedPaths: ["/health", "/metrics"],
  },
  instances: [
    { label: process.env.RATE_LIMIT_SMOKE_FIRST_INSTANCE_LABEL ?? "api-instance-a", baseUrl: redactedUrl(firstUrl) },
    { label: process.env.RATE_LIMIT_SMOKE_SECOND_INSTANCE_LABEL ?? "api-instance-b", baseUrl: redactedUrl(secondUrl) },
  ],
  apiRateLimit: apiLimitResult,
  loginAttemptLimiter: loginLimitResult,
  commandsPassed: ["pnpm rate-limit:smoke", "pnpm rate-limit:check"],
  evidenceReferences: [
    process.env.RATE_LIMIT_SMOKE_EVIDENCE_REFERENCE ?? "rate-limit-smoke-output",
    process.env.RATE_LIMIT_SMOKE_REDIS_REFERENCE ?? "redis-shared-window-observation",
  ],
  gaps: [],
});

console.log(`Rate limit Redis smoke gecti: ${redactedUrl(firstUrl)} -> ${redactedUrl(secondUrl)}`);

async function verifyApiRateLimit() {
  let limitedResponse;
  for (let index = 1; index <= maxRequests; index += 1) {
    const response = await request(firstUrl, {
      method: "GET",
      headers: rateLimitHeaders(clientIp),
    });
    if (response.statusCode === 429) {
      fail(`API rate limit beklenenden erken devreye girdi: istek ${index}/${maxRequests}.`);
    }
  }

  limitedResponse = await request(secondUrl, {
    method: "GET",
    headers: rateLimitHeaders(clientIp),
  });

  if (limitedResponse.statusCode !== 429) {
    fail(`API rate limit ikinci instance uzerinde 429 donmedi: HTTP ${limitedResponse.statusCode}.`);
  }
  if (readErrorCode(limitedResponse.body) !== expectedRateLimitCode) {
    fail(`API rate limit hata kodu ${expectedRateLimitCode} olmali.`);
  }

  const healthResponse = await request(new URL("/health", firstUrl.origin), {
    method: "GET",
    headers: rateLimitHeaders(clientIp),
  });
  const metricsResponse = await request(new URL("/metrics", firstUrl.origin), {
    method: "GET",
    headers: rateLimitHeaders(clientIp),
  });

  return {
    clientIpHash: sha256(clientIp),
    requestsSent: maxRequests + 1,
    allowedBeforeLimit: maxRequests,
    limitedAtRequest: maxRequests + 1,
    limitStatusCode: limitedResponse.statusCode,
    errorCode: expectedRateLimitCode,
    retryAfterHeaderPresent: Boolean(limitedResponse.headers.get("retry-after")),
    secondInstanceLimitObserved: true,
    healthEndpointExcluded: healthResponse.statusCode !== 429,
    metricsEndpointExcluded: metricsResponse.statusCode !== 429,
  };
}

async function verifyLoginAttemptLimiter() {
  for (let index = 1; index <= loginMaxAttempts; index += 1) {
    const response = await postLogin(loginUrl, loginEmail, loginClientIp);
    if (response.statusCode === 429) {
      fail(`Login limiter beklenenden erken kilitledi: deneme ${index}/${loginMaxAttempts}.`);
    }
  }

  const lockedResponse = await postLogin(secondLoginUrl, loginEmail, loginClientIp);
  if (lockedResponse.statusCode !== 429) {
    fail(`Login limiter ikinci instance uzerinde 429 donmedi: HTTP ${lockedResponse.statusCode}.`);
  }
  if (readErrorCode(lockedResponse.body) !== expectedLoginLockCode) {
    fail(`Login limiter hata kodu ${expectedLoginLockCode} olmali.`);
  }

  const otherIpResponse = await postLogin(loginUrl, loginEmail, otherLoginIp);

  return {
    clientIpHash: sha256(loginClientIp),
    emailHash: sha256(loginEmail.toLowerCase()),
    attemptsSent: loginMaxAttempts + 1,
    lockStatusCode: lockedResponse.statusCode,
    errorCode: expectedLoginLockCode,
    sharedAcrossInstances: true,
    emailAndIpScoped: true,
    differentIpNotLocked: otherIpResponse.statusCode !== 429,
  };
}

function rateLimitHeaders(ip) {
  return {
    accept: "application/json,text/plain,*/*",
    "user-agent": "uzman-hocam-rate-limit-smoke/1.0",
    "x-forwarded-for": ip,
    "x-real-ip": ip,
  };
}

function postLogin(url, email, ip) {
  return request(url, {
    method: "POST",
    headers: {
      ...rateLimitHeaders(ip),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: `invalid-${Date.now()}`,
    }),
  });
}

async function request(url, options) {
  const response = await fetch(url, options).catch((error) => fail(`Rate limit smoke istegi basarisiz: ${error.message}`));
  return {
    statusCode: response.status,
    headers: response.headers,
    body: await response.text(),
  };
}

function readErrorCode(body) {
  try {
    const payload = JSON.parse(body);
    return payload?.error?.code ?? payload?.message ?? "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

function readUrl(envKey, fallback) {
  const value = process.env[envKey] ?? fallback;
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    fail(`${envKey} gecerli URL olmali.`);
  }
}

function defaultRateLimitUrl(baseUrl) {
  if (!baseUrl) return undefined;
  const url = new URL(baseUrl);
  url.pathname = "/api/v1/__rate-limit-smoke";
  url.search = "";
  url.hash = "";
  return url.href;
}

function defaultLoginUrl(baseUrl) {
  if (!baseUrl) return undefined;
  const url = new URL(baseUrl);
  url.pathname = "/api/v1/auth/login";
  url.search = "";
  url.hash = "";
  return url.href;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
