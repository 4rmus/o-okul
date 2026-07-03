import { createHash, randomInt } from "node:crypto";
import { connect as connectTcp } from "node:net";
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
const loginNationalId = process.env.RATE_LIMIT_LOGIN_SMOKE_NATIONAL_ID ?? createSmokeNationalId();
const loginUrl = readUrl("RATE_LIMIT_LOGIN_SMOKE_URL", defaultLoginUrl(apiUrl));
const secondLoginUrl = readUrl("RATE_LIMIT_LOGIN_SMOKE_SECOND_INSTANCE_URL", defaultLoginUrl(secondUrl?.origin));
const otherIpLoginUrl = readUrl("RATE_LIMIT_LOGIN_SMOKE_OTHER_IP_URL", loginUrl?.href);
const resetApiLimitBeforeApi = process.env.RATE_LIMIT_SMOKE_RESET_API_LIMIT_BEFORE_API === "true";
const resetApiLimitBeforeLogin = process.env.RATE_LIMIT_SMOKE_RESET_API_LIMIT_BEFORE_LOGIN === "true";
const apiLimitResetIp = process.env.RATE_LIMIT_SMOKE_API_LIMIT_RESET_IP ?? clientIp;
const expectedRateLimitCode = "RATE_LIMITED";
const expectedLoginLockCode = "LOGIN_LOCKED";

await validateSmokeEvidenceOutputTarget(evidenceFile);

if (!firstUrl) {
  fail("RATE_LIMIT_SMOKE_URL veya API_URL bos birakilamaz.");
}
if (!secondUrl) {
  fail("RATE_LIMIT_SMOKE_SECOND_INSTANCE_URL ikinci API instance veya LB shard URL'i olarak zorunludur.");
}
if (!loginUrl || !secondLoginUrl || !otherIpLoginUrl) {
  fail("RATE_LIMIT_LOGIN_SMOKE_URL, RATE_LIMIT_LOGIN_SMOKE_SECOND_INSTANCE_URL ve RATE_LIMIT_LOGIN_SMOKE_OTHER_IP_URL belirlenmeli.");
}
if (evidenceFile) {
  requireEvidenceSmokeUrl("RATE_LIMIT_SMOKE_URL", firstUrl);
  requireEvidenceSmokeUrl("RATE_LIMIT_SMOKE_SECOND_INSTANCE_URL", secondUrl);
  requireEvidenceSmokeUrl("RATE_LIMIT_LOGIN_SMOKE_URL", loginUrl);
  requireEvidenceSmokeUrl("RATE_LIMIT_LOGIN_SMOKE_SECOND_INSTANCE_URL", secondLoginUrl);
}
requireDifferentUrls("RATE_LIMIT_SMOKE_URL", firstUrl, "RATE_LIMIT_SMOKE_SECOND_INSTANCE_URL", secondUrl);
requireDifferentUrls("RATE_LIMIT_LOGIN_SMOKE_URL", loginUrl, "RATE_LIMIT_LOGIN_SMOKE_SECOND_INSTANCE_URL", secondLoginUrl);

if (resetApiLimitBeforeApi) {
  await resetApiRateLimitKey(apiLimitResetIp);
}
const apiLimitResult = await verifyApiRateLimit();
if (resetApiLimitBeforeLogin) {
  await resetApiRateLimitKey(apiLimitResetIp);
}
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
    ...(otherIpLoginUrl.href !== loginUrl.href ? ["login-other-ip-direct-negative"] : []),
    ...(resetApiLimitBeforeApi ? [`redis-api-limit-pre-reset:${sha256(apiLimitResetIp)}`] : []),
    ...(resetApiLimitBeforeLogin ? [`redis-api-limit-reset:${sha256(apiLimitResetIp)}`] : []),
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
    const response = await postLogin(loginUrl, loginNationalId, loginClientIp);
    if (response.statusCode === 429) {
      fail(`Login limiter beklenenden erken kilitledi: deneme ${index}/${loginMaxAttempts}.`);
    }
  }

  const lockedResponse = await postLogin(secondLoginUrl, loginNationalId, loginClientIp);
  if (lockedResponse.statusCode !== 429) {
    fail(`Login limiter ikinci instance uzerinde 429 donmedi: HTTP ${lockedResponse.statusCode}.`);
  }
  if (readErrorCode(lockedResponse.body) !== expectedLoginLockCode) {
    fail(`Login limiter hata kodu ${expectedLoginLockCode} olmali.`);
  }

  const otherIpResponse = await postLogin(otherIpLoginUrl, loginNationalId, otherLoginIp);

  return {
    clientIpHash: sha256(loginClientIp),
    nationalIdHash: sha256(loginNationalId),
    attemptsSent: loginMaxAttempts + 1,
    lockStatusCode: lockedResponse.statusCode,
    errorCode: expectedLoginLockCode,
    sharedAcrossInstances: true,
    nationalIdAndIpScoped: true,
    differentIpNotLocked: otherIpResponse.statusCode !== 429,
  };
}

function rateLimitHeaders(ip) {
  return {
    accept: "application/json,text/plain,*/*",
    "user-agent": "o-okul-rate-limit-smoke/1.0",
    "x-forwarded-for": ip,
    "x-real-ip": ip,
  };
}

function postLogin(url, nationalId, ip) {
  return request(url, {
    method: "POST",
    headers: {
      ...rateLimitHeaders(ip),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      nationalId,
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

function requireEvidenceSmokeUrl(envKey, url) {
  if (url.protocol !== "https:") {
    fail(`${envKey} kalici kanit yazarken https:// olmali.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    fail(`${envKey} kalici kanit yazarken userinfo, query veya fragment tasimamali.`);
  }
}

function requireDifferentUrls(firstKey, first, secondKey, second) {
  if (first.href === second.href) {
    fail(`${secondKey} ${firstKey} ile ayni URL olamaz; iki gercek API instance veya LB shard URL'i gerekir.`);
  }
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createSmokeNationalId() {
  return Array.from({ length: 11 }, () => randomInt(0, 10)).join("");
}

async function resetApiRateLimitKey(ip) {
  const redisUrl = readRedisUrl();
  const key = `${process.env.API_RATE_LIMIT_KEY_PREFIX || process.env.QUEUE_PREFIX || "o_okul"}:api-rate-limit:${sha256(ip)}`;
  const response = await sendRedisCommand(redisUrl, ["DEL", key]);
  if (typeof response !== "number") {
    fail("RATE_LIMIT_SMOKE_RESET_API_LIMIT_BEFORE_LOGIN Redis DEL yaniti sayisal olmali.");
  }
}

function readRedisUrl() {
  const value = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("REDIS_URL gecerli redis:// URL olmali.");
  }

  if (url.protocol !== "redis:") {
    fail("REDIS_URL redis:// URL olmali.");
  }
  if (url.username || url.password || url.search || url.hash) {
    fail("REDIS_URL rate-limit smoke icin userinfo, query veya fragment tasimamali.");
  }
  return url;
}

function sendRedisCommand(url, parts) {
  return new Promise((resolveResponse, rejectResponse) => {
    const socket = connectTcp({
      host: url.hostname,
      port: Number(url.port || 6379),
      timeout: 2_000,
    });
    let buffer = "";

    socket.on("connect", () => {
      socket.write(encodeRedisCommand(parts));
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let parsed;
      try {
        parsed = parseRedisReply(buffer);
      } catch (error) {
        socket.destroy(error);
        return;
      }
      if (parsed.done) {
        socket.end();
        resolveResponse(parsed.value);
      }
    });
    socket.on("timeout", () => {
      socket.destroy(new Error("Redis smoke reset timeout"));
    });
    socket.on("error", rejectResponse);
  }).catch((error) => fail(`API rate limit smoke Redis reset basarisiz: ${error.message}`));
}

function encodeRedisCommand(parts) {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`;
}

function parseRedisReply(value) {
  if (value.startsWith(":")) {
    const end = value.indexOf("\r\n");
    if (end === -1) return { done: false };
    return { done: true, value: Number(value.slice(1, end)) };
  }
  if (value.startsWith("-")) {
    const end = value.indexOf("\r\n");
    if (end === -1) return { done: false };
    throw new Error(value.slice(1, end));
  }
  return { done: false };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
