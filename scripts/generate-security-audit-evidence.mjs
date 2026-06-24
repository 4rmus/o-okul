import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requiredSecurityHeaders = [
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Content-Security-Policy",
];
const requiredAuthControls = [
  "COOKIE_SECURE=true",
  "login lockout",
  "strong JWT secrets",
  "refresh session revocation",
];
const requiredDataControls = [
  "RLS live check",
  "tenant isolation",
  "audit PII redaction",
  "SENTRY_SEND_DEFAULT_PII=false",
];
const verificationFlags = [
  "SECURITY_AUDIT_COOKIE_SECURE_VERIFIED",
  "SECURITY_AUDIT_LOGIN_LOCKOUT_VERIFIED",
  "SECURITY_AUDIT_STRONG_JWT_SECRETS_VERIFIED",
  "SECURITY_AUDIT_REFRESH_SESSION_REVOCATION_VERIFIED",
  "SECURITY_AUDIT_TENANT_ISOLATION_VERIFIED",
  "SECURITY_AUDIT_AUDIT_PII_REDACTION_VERIFIED",
  "SECURITY_AUDIT_SENTRY_PII_DISABLED_VERIFIED",
  "SECURITY_AUDIT_NO_CRITICAL_FINDINGS",
];
const evidenceReferenceEnvNames = [
  "SECURITY_AUDIT_PROD_ENV_REFERENCE",
  "SECURITY_AUDIT_HTTPS_HEADERS_REFERENCE",
  "SECURITY_AUDIT_RLS_LIVE_REFERENCE",
  "SECURITY_AUDIT_AUTH_CONTROLS_REFERENCE",
  "SECURITY_AUDIT_DATA_CONTROLS_REFERENCE",
];

const outputPath = readOption("--output") ?? process.env.SECURITY_AUDIT_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const appUrl = readOption("--app-url") ?? process.env.SECURITY_AUDIT_APP_URL ?? process.env.APP_URL;
const apiUrl = readOption("--api-url") ?? process.env.SECURITY_AUDIT_API_URL ?? process.env.API_URL;
const headersUrl = readOption("--headers-url") ?? process.env.SECURITY_AUDIT_HEADERS_URL ?? appUrl;
const rlsLiveTarget = process.env.RLS_LIVE_EVIDENCE_TARGET ?? process.env.SECURITY_AUDIT_RLS_LIVE_TARGET;
const evidenceReferences = evidenceReferenceEnvNames.map((name) => process.env[name]?.trim());

const failures = [];
requireValue(outputPath, "SECURITY_AUDIT_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireHttpsUrl(appUrl, "SECURITY_AUDIT_APP_URL veya APP_URL", failures);
requireHttpsUrl(apiUrl, "SECURITY_AUDIT_API_URL veya API_URL", failures);
requireHttpsUrl(headersUrl, "SECURITY_AUDIT_HEADERS_URL", failures);
requireEvidenceTarget(rlsLiveTarget, "RLS_LIVE_EVIDENCE_TARGET veya SECURITY_AUDIT_RLS_LIVE_TARGET", failures);
for (const flag of verificationFlags) requireTrue(process.env[flag], flag, failures);
for (const [index, reference] of evidenceReferences.entries()) {
  requireEvidenceReference(reference, evidenceReferenceEnvNames[index], failures);
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

runCommand("pnpm prod:env:check");
runCommand("pnpm web:token-storage:check");
runCommand(`RLS_LIVE_EVIDENCE_TARGET=${quoteShell(rlsLiveTarget)} pnpm rls:live:check`);

const healthStatus = await fetchStatus(new URL("/health", ensureTrailingSlash(apiUrl)));
const readinessStatus = await fetchStatus(new URL("/health/ready", ensureTrailingSlash(apiUrl)));
const headers = await fetchHeaders(headersUrl);
const missingHeaders = requiredSecurityHeaders.filter((header) => !headers.has(header.toLowerCase()));
if (missingHeaders.length > 0) {
  fail([`HTTPS/security header eksik: ${missingHeaders.join(", ")}.`]);
}

const report = {
  result: "PASS",
  environment,
  checkedAt: new Date().toISOString(),
  prodEnvCheckOk: true,
  httpsOk: true,
  rlsLiveCheckOk: true,
  noCriticalFindings: true,
  healthStatus,
  readinessStatus,
  securityHeadersVerified: requiredSecurityHeaders,
  authControlsVerified: requiredAuthControls,
  dataControlsVerified: requiredDataControls,
  evidenceReferences,
  findings: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);
runCheck(outputFile);
console.log(`Güvenlik denetimi kanıtı yazıldı: ${outputFile}`);

async function fetchStatus(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (response.status < 200 || response.status > 299) {
    fail([`${url.href} 2xx dönmeli; HTTP ${response.status}.`]);
  }
  return response.status;
}

async function fetchHeaders(urlValue) {
  const response = await fetch(urlValue, { redirect: "follow" });
  if (response.status < 200 || response.status > 399) {
    fail([`${urlValue} security header kontrolü için 2xx/3xx dönmeli; HTTP ${response.status}.`]);
  }

  const headers = new Map();
  for (const [key, value] of response.headers.entries()) {
    if (value.trim() !== "") headers.set(key.toLowerCase(), value);
  }
  return headers;
}

function runCommand(command) {
  const result = spawnSync("sh", ["-lc", command], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail([`${command} başarısız oldu.`]);
  }
}

function runCheck(filePath) {
  const result = spawnSync("pnpm", ["security:audit:check"], {
    env: {
      ...process.env,
      SECURITY_AUDIT_TARGET: pathToFileURL(filePath).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(["pnpm security:audit:check başarısız oldu."]);
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
  }
}

function requireOneOf(value, label, expected, output) {
  if (!expected.includes(value)) {
    output.push(`${label} ${expected.join(" veya ")} olmalı.`);
  }
}

function requireTrue(value, label, output) {
  if (value !== "true") {
    output.push(`${label} true olmalı.`);
  }
}

function requireHttpsUrl(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    output.push(`${label} geçerli https URL olmalı.`);
    return;
  }

  if (url.protocol !== "https:") {
    output.push(`${label} https:// olmalı.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    output.push(`${label} userinfo, query veya fragment taşımamalı.`);
  }
  if (hasPlaceholderToken(url.hostname)) {
    output.push(`${label} gerçek host olmalı; placeholder/example/test/localhost içeremez.`);
  }
}

function requireEvidenceTarget(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    output.push(`${label} file:// veya https:// URL olmalı.`);
    return;
  }

  if (url.protocol !== "file:" && url.protocol !== "https:") {
    output.push(`${label} file:// veya https:// URL olmalı.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    output.push(`${label} userinfo, query veya fragment taşımamalı.`);
  }
  if (url.protocol === "https:" && hasPlaceholderToken(url.hostname)) {
    output.push(`${label} gerçek https host olmalı.`);
  }
  if (url.protocol === "file:" && (isLocalTempPath(url.pathname) || isLocalSmokePath(url.pathname))) {
    output.push(`${label} temp veya artifacts/local altında olmamalı.`);
  }
}

function requireEvidenceReference(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }

  if (hasPlaceholderToken(value)) {
    output.push(`${label} gerçek artifact/log/run referansı olmalı; placeholder/example/redacted/test içeremez.`);
  }
  if (hasSecretBearingReference(value)) {
    output.push(`${label} userinfo, query veya fragment taşımamalı.`);
  }
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return [
    "__set",
    "change-me",
    "replace-me",
    "placeholder",
    "redacted",
    "example",
    ".test",
    ".invalid",
    "localhost",
    "127.0.0.1",
    "todo",
    "tbd",
    "???",
  ].some((token) => normalized.includes(token));
}

function hasSecretBearingReference(value) {
  const normalized = value.trim();
  if (normalized.includes("?") || normalized.includes("#")) {
    return true;
  }

  const urlCandidate = normalized.toLowerCase().startsWith("url:") ? normalized.slice(4) : normalized;
  if (!/^(https|file|s3):\/\//i.test(urlCandidate)) {
    return false;
  }

  try {
    const url = new URL(urlCandidate);
    return Boolean(url.username || url.password || url.search || url.hash);
  } catch {
    return false;
  }
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["SECURITY_AUDIT_OUTPUT lokal temp path olmamalı."]);
  }
  if (isLocalSmokePath(filePath)) {
    fail(["SECURITY_AUDIT_OUTPUT artifacts/local altında olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath));

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["SECURITY_AUDIT_OUTPUT symlink olmayan file artifact olmalı."]);
    }
  }
}

function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      fail(["SECURITY_AUDIT_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function isLocalSmokePath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function quoteShell(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function fail(messages) {
  console.error("Güvenlik denetimi kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
