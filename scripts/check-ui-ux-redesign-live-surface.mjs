import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const baseUrl = readOption("--base-url") ?? process.env.UI_UX_REDESIGN_LIVE_BASE_URL ?? "https://o-okul.com";
const outputPath = allowedLocalPath(
  readOption("--output") ??
    process.env.UI_UX_REDESIGN_LIVE_SURFACE_OUTPUT ??
    "artifacts/local/ui-ux-redesign-live-surface.json",
  "UI_UX_REDESIGN_LIVE_SURFACE_OUTPUT",
);
const timeoutMs = Number(readOption("--timeout-ms") ?? process.env.UI_UX_REDESIGN_LIVE_SURFACE_TIMEOUT_MS ?? "10000");

const failures = [];
const checks = [];
const startedAt = new Date().toISOString();
const appUrl = requireLiveBaseUrl(baseUrl, failures);

if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
  failures.push("UI_UX_REDESIGN_LIVE_SURFACE_TIMEOUT_MS 1000-60000 arası sayı olmalı.");
}

if (failures.length === 0) {
  await runLiveChecks(appUrl);
}

const report = {
  result: failures.length === 0 ? "PASS" : "GAP",
  overallStatus: failures.length === 0 ? "READY" : "BLOCKED",
  releaseEvidence: false,
  generatedAt: new Date().toISOString(),
  startedAt,
  baseUrl: appUrl ? appUrl.origin : baseUrl,
  note:
    "Bu dosya UI/UX canlı yüzey kontrolüdür; Netgsm, S3, Sentry veya tam production release evidence yerine geçmez.",
  checks,
  gaps: failures,
  commandsPassed: failures.length === 0 ? ["pnpm ui-ux-redesign:live-surface:check"] : [],
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (failures.length > 0) {
  console.error("UI/UX canlı yüzey kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(`- rapor: ${formatPath(outputPath)}`);
  process.exit(1);
}

console.log(`UI/UX canlı yüzey kontrolü geçti: ${appUrl.origin}`);
console.log(`Rapor: ${formatPath(outputPath)}`);

async function runLiveChecks(url) {
  const loginUrl = new URL("/login", url);
  const login = await fetchText(loginUrl, "web_login");
  requireStatus("web_login", login, 200, 399);
  requireHeaders("web_login", login.headers, [
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "content-security-policy",
  ]);
  requireHeaderValue("web_login", login.headers, "x-content-type-options", "nosniff");
  requireHeaderValue("web_login", login.headers, "x-frame-options", "DENY");
  if (login.headers["x-powered-by"]) {
    failures.push("web_login X-Powered-By header'ı kapalı olmalı.");
  }

  const healthUrl = new URL("/health", url);
  const health = await fetchText(healthUrl, "api_health");
  requireStatus("api_health", health, 200, 200);
  requireJsonField("api_health", health.body, "status", "ok");

  const readinessUrl = new URL("/health/ready", url);
  const readiness = await fetchText(readinessUrl, "api_readiness");
  requireStatus("api_readiness", readiness, 200, 200);
}

async function fetchText(url, label) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: "application/json,text/html,text/plain,*/*",
        "user-agent": "o-okul-ui-ux-live-surface/1.0",
      },
    });
    const body = await response.text();
    const headers = Object.fromEntries([...response.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
    const entry = {
      name: label,
      url: redactUrl(url),
      status: response.status,
      durationMs: Date.now() - started,
      headers: pickHeaders(headers, [
        "strict-transport-security",
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "permissions-policy",
        "content-security-policy",
        "x-powered-by",
      ]),
    };
    checks.push(entry);
    return { status: response.status, body, headers };
  } catch (error) {
    failures.push(`${label} isteği başarısız: ${error.message}`);
    const entry = {
      name: label,
      url: redactUrl(url),
      status: "ERROR",
      durationMs: Date.now() - started,
    };
    checks.push(entry);
    return { status: 0, body: "", headers: {} };
  }
}

function requireStatus(label, response, min, max) {
  if (response.status < min || response.status > max) {
    failures.push(`${label} HTTP ${min === max ? min : `${min}-${max}`} dönmeli; gelen HTTP ${response.status}.`);
  }
}

function requireHeaders(label, headers, requiredHeaders) {
  for (const header of requiredHeaders) {
    if (!headers[header]) failures.push(`${label} header eksik: ${header}.`);
  }
}

function requireHeaderValue(label, headers, header, expected) {
  const actual = headers[header];
  if (actual && actual.toLowerCase() !== expected.toLowerCase()) {
    failures.push(`${label} ${header}=${expected} olmalı; gelen ${actual}.`);
  }
}

function requireJsonField(label, body, field, expected) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    failures.push(`${label} JSON yanıt dönmeli.`);
    return;
  }
  if (parsed?.[field] !== expected) {
    failures.push(`${label} ${field}=${expected} olmalı.`);
  }
}

function requireLiveBaseUrl(value, output) {
  let url;
  try {
    url = new URL(value);
  } catch {
    output.push("UI/UX canlı yüzey base URL geçerli https URL olmalı.");
    return null;
  }

  if (url.protocol !== "https:") output.push("UI/UX canlı yüzey base URL https:// olmalı.");
  if (url.username || url.password || url.search || url.hash) {
    output.push("UI/UX canlı yüzey base URL userinfo, query veya fragment taşımamalı.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    output.push("UI/UX canlı yüzey base URL path taşımamalı; path kontrolleri script tarafından eklenir.");
  }
  if (isLocalOrPlaceholderHost(url.hostname)) {
    output.push("UI/UX canlı yüzey base URL gerçek domain olmalı; localhost/example/test kabul edilmez.");
  }

  return url;
}

function isLocalOrPlaceholderHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.") ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".test") ||
    normalized.includes("example") ||
    normalized.includes("placeholder") ||
    normalized.includes("__set")
  );
}

function pickHeaders(headers, names) {
  const picked = {};
  for (const name of names) {
    if (headers[name]) picked[name] = headers[name];
  }
  return picked;
}

function redactUrl(url) {
  return `${url.origin}${url.pathname}`;
}

function allowedLocalPath(value, label) {
  const outputFile = resolve(value);
  const allowedRoot = resolve("artifacts/local");
  if (outputFile === allowedRoot || !outputFile.startsWith(`${allowedRoot}/`)) {
    fail([`${label} artifacts/local altında olmalı.`]);
  }
  if (existsSync(outputFile) && lstatSync(outputFile).isSymbolicLink()) {
    fail([`${label} symlink olmayan hedef olmalı.`]);
  }
  requireParentPathAllowed(dirname(outputFile), label);
  return outputFile;
}

function requireParentPathAllowed(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail([`${label} parent dizini symlink olmayan dizin olmalı.`]);
    }
  }
}

function readOption(name) {
  const index = args.lastIndexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail([`${name} için değer gerekli.`]);
  return value;
}

function formatPath(path) {
  const cwd = resolve(".");
  const relativePath = relative(cwd, path);
  return relativePath && !relativePath.startsWith("..") ? relativePath : path;
}

function fail(messages) {
  console.error("UI/UX canlı yüzey kontrolü başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
