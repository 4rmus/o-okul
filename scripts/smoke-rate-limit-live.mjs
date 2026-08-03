import { spawnSync } from "node:child_process";
import { createHash, randomInt } from "node:crypto";
import { connect as connectTcp, isIP } from "node:net";
import { redactedUrl, validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const rateLimitShardEgressClient = `
const chunks = [];
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
  try {
    const input = JSON.parse(chunks.join(""));
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        accept: "application/json,text/plain,*/*",
        "content-type": "application/json",
        "user-agent": "o-okul-rate-limit-egress/1.0",
      },
      body: JSON.stringify({
        tenantSlug: input.tenantSlug,
        loginName: input.loginName,
        password: input.password,
      }),
    });
    process.stdout.write(JSON.stringify({ statusCode: response.status, body: await response.text() }));
  } catch {
    process.exitCode = 1;
  }
});
`;

const apiUrl = process.env.API_URL;
const firstUrl = readUrl("RATE_LIMIT_SMOKE_URL", defaultRateLimitUrl(apiUrl));
const secondUrl = readUrl("RATE_LIMIT_SMOKE_SECOND_INSTANCE_URL");
const evidenceFile = process.env.RATE_LIMIT_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const maxRequests = readPositiveInteger(process.env.API_RATE_LIMIT_MAX, 300);
const windowMs = readPositiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 60_000);
const loginMaxAttempts = readPositiveInteger(process.env.LOGIN_ATTEMPT_LIMITER_MAX_ATTEMPTS, 5);
const clientIp = readIp("RATE_LIMIT_SMOKE_CLIENT_IP");
const loginClientIp = readIp("RATE_LIMIT_LOGIN_SMOKE_CLIENT_IP");
const proxyNetworkName = (process.env.DOCKER_PROXY_NETWORK ?? "o-okul_proxy_net").trim();
const traefikProxyIp = readIp("TRAEFIK_PROXY_IP", "172.31.255.2");
const apiProxyIp = readIp("API_PROXY_IP", "172.31.255.3");
const otherLoginIp = readIp("RATE_LIMIT_SMOKE_EGRESS_IP", "172.31.255.4");
const loginTenantSlug = process.env.RATE_LIMIT_LOGIN_SMOKE_TENANT_SLUG?.trim();
const loginName = process.env.RATE_LIMIT_LOGIN_SMOKE_LOGIN_NAME ?? createSmokeLoginName();
const loginUrl = readUrl("RATE_LIMIT_LOGIN_SMOKE_URL", defaultLoginUrl(apiUrl));
const secondLoginUrl = readUrl("RATE_LIMIT_LOGIN_SMOKE_SECOND_INSTANCE_URL", defaultLoginUrl(secondUrl?.origin));
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
if (!loginUrl || !secondLoginUrl) {
  fail("RATE_LIMIT_LOGIN_SMOKE_URL ve RATE_LIMIT_LOGIN_SMOKE_SECOND_INSTANCE_URL belirlenmeli.");
}
if (!loginTenantSlug) {
  fail("RATE_LIMIT_LOGIN_SMOKE_TENANT_SLUG mevcut ve aktif bir kurum kodu olarak zorunludur.");
}
if (apiProxyIp === otherLoginIp) {
  fail("API_PROXY_IP ve RATE_LIMIT_SMOKE_EGRESS_IP farklı sabit proxy ağı IP'leri olmalı.");
}
if (evidenceFile) {
  requireEvidenceSmokeUrl("RATE_LIMIT_SMOKE_URL", firstUrl);
  requireEvidenceSmokeUrl("RATE_LIMIT_SMOKE_SECOND_INSTANCE_URL", secondUrl);
  requireEvidenceSmokeUrl("RATE_LIMIT_LOGIN_SMOKE_URL", loginUrl);
  requireEvidenceSmokeUrl("RATE_LIMIT_LOGIN_SMOKE_SECOND_INSTANCE_URL", secondLoginUrl);
}
requireDifferentUrls("RATE_LIMIT_SMOKE_URL", firstUrl, "RATE_LIMIT_SMOKE_SECOND_INSTANCE_URL", secondUrl);
requireDifferentUrls("RATE_LIMIT_LOGIN_SMOKE_URL", loginUrl, "RATE_LIMIT_LOGIN_SMOKE_SECOND_INSTANCE_URL", secondLoginUrl);
assertRateLimitSmokeProxyTopology();

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
    "login-other-ip-container-egress",
    `rate-limit-egress-ip:${sha256(otherLoginIp)}`,
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
      headers: rateLimitHeaders(),
    });
    if (response.statusCode === 429) {
      fail(`API rate limit beklenenden erken devreye girdi: istek ${index}/${maxRequests}.`);
    }
  }

  limitedResponse = await request(secondUrl, {
    method: "GET",
    headers: rateLimitHeaders(),
  });

  if (limitedResponse.statusCode !== 429) {
    fail(`API rate limit ikinci instance uzerinde 429 donmedi: HTTP ${limitedResponse.statusCode}.`);
  }
  if (readErrorCode(limitedResponse.body) !== expectedRateLimitCode) {
    fail(`API rate limit hata kodu ${expectedRateLimitCode} olmali.`);
  }

  const healthResponse = await request(new URL("/health", firstUrl.origin), {
    method: "GET",
    headers: rateLimitHeaders(),
  });
  const metricsResponse = await request(new URL("/metrics", firstUrl.origin), {
    method: "GET",
    headers: rateLimitHeaders(),
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
    const response = await postLogin(loginUrl, loginTenantSlug, loginName);
    if (response.statusCode === 429) {
      fail(`Login limiter beklenenden erken kilitledi: deneme ${index}/${loginMaxAttempts}.`);
    }
  }

  const lockedResponse = await postLogin(secondLoginUrl, loginTenantSlug, loginName);
  if (lockedResponse.statusCode !== 429) {
    fail(`Login limiter ikinci instance uzerinde 429 donmedi: HTTP ${lockedResponse.statusCode}.`);
  }
  if (readErrorCode(lockedResponse.body) !== expectedLoginLockCode) {
    fail(`Login limiter hata kodu ${expectedLoginLockCode} olmali.`);
  }

  const otherIpResponse = await postLoginFromRateLimitShard(loginTenantSlug, loginName);

  return {
    clientIpHash: sha256(loginClientIp),
    loginNameHash: sha256(loginName.trim().toLowerCase()),
    attemptsSent: loginMaxAttempts + 1,
    lockStatusCode: lockedResponse.statusCode,
    errorCode: expectedLoginLockCode,
    sharedAcrossInstances: true,
    tenantAndLoginNameAndIpScoped: true,
    differentIpNotLocked: otherIpResponse.statusCode !== 429,
  };
}

function rateLimitHeaders() {
  return {
    accept: "application/json,text/plain,*/*",
    "user-agent": "o-okul-rate-limit-smoke/1.0",
  };
}

function postLogin(url, tenantSlug, loginNameValue) {
  return request(url, {
    method: "POST",
    headers: {
      ...rateLimitHeaders(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      tenantSlug,
      loginName: loginNameValue,
      password: `invalid-${Date.now()}`,
    }),
  });
}

function postLoginFromRateLimitShard(tenantSlug, loginNameValue) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.rate-limit-shard.yml",
      "exec",
      "-T",
      "api-rate-limit-shard",
      "node",
      "-e",
      rateLimitShardEgressClient,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      input: JSON.stringify({
        url: `http://${apiProxyIp}:3100/api/v1/auth/login`,
        tenantSlug,
        loginName: loginNameValue,
        password: `invalid-${Date.now()}`,
      }),
      timeout: 10_000,
    },
  );

  if (result.error || result.status !== 0) {
    fail("Farklı IP login negatifi için api-rate-limit-shard container isteği başarısız oldu.");
  }

  try {
    const response = JSON.parse(result.stdout);
    if (!Number.isInteger(response?.statusCode) || typeof response?.body !== "string") {
      throw new Error("invalid response");
    }
    return response;
  } catch {
    fail("Farklı IP login negatifi için api-rate-limit-shard geçerli yanıt üretmedi.");
  }
}

function assertRateLimitSmokeProxyTopology() {
  if (proxyNetworkName !== "o-okul_proxy_net") {
    fail("DOCKER_PROXY_NETWORK rate-limit smoke için o-okul_proxy_net olmalı.");
  }

  const result = spawnSync("docker", ["network", "inspect", proxyNetworkName], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    fail("Rate-limit smoke proxy ağı docker inspect ile doğrulanamadı.");
  }

  let containers;
  try {
    containers = JSON.parse(result.stdout)?.[0]?.Containers;
  } catch {
    fail("Rate-limit smoke proxy ağı docker inspect geçerli çıktı üretmedi.");
  }
  if (!containers || typeof containers !== "object") {
    fail("Rate-limit smoke proxy ağı çalışan container bilgisi içermiyor.");
  }

  const expected = {
    traefik: traefikProxyIp,
    api: apiProxyIp,
    "api-rate-limit-shard": otherLoginIp,
  };
  const seen = new Set();
  for (const [containerId, endpoint] of Object.entries(containers)) {
    const serviceResult = spawnSync(
      "docker",
      ["inspect", "--format", '{{ index .Config.Labels "com.docker.compose.service" }}', containerId],
      { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 },
    );
    if (serviceResult.error || serviceResult.status !== 0) {
      fail("Rate-limit smoke proxy container etiketi docker inspect ile doğrulanamadı.");
    }

    const service = serviceResult.stdout.trim();
    if (!(service in expected)) continue;
    const actualIp = typeof endpoint?.IPv4Address === "string" ? endpoint.IPv4Address.split("/")[0] : "";
    if (actualIp !== expected[service]) {
      fail(`Rate-limit smoke ${service} proxy ağ IP'si beklenen sabit adresle eşleşmiyor.`);
    }
    if (seen.has(service)) {
      fail(`Rate-limit smoke proxy ağında ${service} için birden fazla çalışan container var.`);
    }
    seen.add(service);
  }

  for (const service of Object.keys(expected)) {
    if (!seen.has(service)) {
      fail(`Rate-limit smoke proxy ağında ${service} container'ı çalışır durumda olmalı.`);
    }
  }
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

function readIp(envKey, fallback) {
  const value = (process.env[envKey] ?? fallback ?? "").trim();
  if (!value || isIP(value) === 0) {
    fail(`${envKey} gerçek istemci veya sabit container IP'si olarak zorunludur.`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createSmokeLoginName() {
  return `rate-limit-smoke-${randomInt(100_000, 999_999)}`;
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
