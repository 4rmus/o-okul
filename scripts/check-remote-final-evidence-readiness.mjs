import { spawnSync } from "node:child_process";

const host = process.env.REMOTE_EVIDENCE_HOST ?? "uzman-hocam-server";
const root = process.env.REMOTE_EVIDENCE_ROOT ?? "/root/o-okul";
const apiHealthUrl = process.env.REMOTE_EVIDENCE_API_HEALTH_URL ?? "http://127.0.0.1:3100/health";
const webHealthUrl = process.env.REMOTE_EVIDENCE_WEB_HEALTH_URL ?? "http://127.0.0.1:3001";
const connectTimeout = process.env.REMOTE_EVIDENCE_CONNECT_TIMEOUT_SECONDS ?? "10";
const requiredTargetEnv = [
  "PRODUCTION_EVIDENCE_SUMMARY_TARGET",
  "LIVE_STATUS_EVIDENCE_TARGET",
  "PILOT_EVIDENCE_TARGET",
  "GO_LIVE_EVIDENCE_TARGET",
];
const forbiddenExampleEvidenceEnv = [
  "PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE",
  "LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE",
  "RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE",
  "IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE",
  "FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE",
  "UPLOAD_AV_ALLOW_EXAMPLE_EVIDENCE",
  "OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE",
  "EXTERNAL_MONITORING_ALLOW_EXAMPLE_EVIDENCE",
  "ADMIN_MFA_ALLOW_EXAMPLE_EVIDENCE",
  "DEPLOYMENT_REGION_ALLOW_EXAMPLE_EVIDENCE",
  "DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE",
  "GITHUB_CI_ALLOW_EXAMPLE_EVIDENCE",
  "SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE",
  "UAT_ALLOW_EXAMPLE_EVIDENCE",
  "LIVE_EXAM_CYCLE_ALLOW_EXAMPLE_EVIDENCE",
  "ISEM_OPTICAL_PIPELINE_ALLOW_EXAMPLE_EVIDENCE",
  "LIVE_UI_WORKER_RESULT_ALLOW_EXAMPLE_EVIDENCE",
  "INLINE_UPLOAD_CONTENT_MIGRATION_ALLOW_EXAMPLE_EVIDENCE",
  "AUDIT_NULL_TENANT_ALLOW_EXAMPLE_EVIDENCE",
  "RATE_LIMIT_ALLOW_EXAMPLE_EVIDENCE",
  "RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE",
  "PILOT_ALLOW_EXAMPLE_EVIDENCE",
  "GO_LIVE_ALLOW_EXAMPLE_EVIDENCE",
];

const failures = [];
const rootCommand = `cd ${shellQuote(root)}`;
const targetEnv = collectTargetEnv();
requireNoExampleEvidenceFlags();

if (failures.length > 0) {
  fail(failures);
}

const sshProbe = runRemote("SSH bağlantısı", "printf remote-ok");
if (sshProbe.status !== 0 || sshProbe.stdout.trim() !== "remote-ok") {
  fail([formatRemoteFailure("SSH bağlantısı kurulamadı", sshProbe)]);
}

requireRemotePass("Remote proje dizini", `test -d ${shellQuote(root)}`, `${root} remote proje dizini bulunmalı.`);
requireRemotePass("Remote package.json", `${rootCommand} && test -f package.json`, "Remote package.json okunabilir olmalı.");
requireRemotePass("Remote API health", `curl -fsS ${shellQuote(apiHealthUrl)} | grep -F '"status":"ok"'`);
requireRemotePass("Remote web health", `curl -fsSI ${shellQuote(webHealthUrl)} | head -n 1 | grep -E 'HTTP/[0-9.]+ (200|30[1278])'`);
requireRemotePass(
  "Remote final evidence checker",
  `${rootCommand} && test -f scripts/check-final-external-evidence.mjs`,
  "scripts/check-final-external-evidence.mjs remote repo içinde bulunmalı.",
);
requireRemotePass(
  "Remote prod:external-evidence script",
  `${rootCommand} && grep -F '"prod:external-evidence:check": "node scripts/check-final-external-evidence.mjs"' package.json`,
  "Remote package.json prod:external-evidence:check script'ini final checker'a bağlamalı.",
);
requireRemoteFinalFileTargets(targetEnv);

if (failures.length > 0) {
  fail(failures);
}

const remoteEvidenceEnvPrefix = toEnvPrefix(targetEnv);
const liveStatus = runRemote("Remote live status", `${rootCommand} && ${remoteEvidenceEnvPrefix} node scripts/check-live-status-evidence.mjs`);
if (liveStatus.status !== 0) {
  failures.push(formatRemoteFailure("Remote live:status:check başarısız", liveStatus));
} else if (!liveStatus.stdout.includes("Live status evidence kontrolü geçti: 18/18 dış kanıt PASS.")) {
  failures.push("Remote live:status:check 18/18 dış kanıt PASS üretmeli; target'sız veya eski gate seti final kanıt değildir.");
}

const remoteFinal = runRemote(
  "Remote final external evidence",
  `${rootCommand} && ${remoteEvidenceEnvPrefix} node scripts/check-final-external-evidence.mjs`,
);
if (remoteFinal.status !== 0) {
  failures.push(formatRemoteFailure("Remote prod:external-evidence:check başarısız", remoteFinal));
}

if (failures.length > 0) {
  fail(failures);
}

console.log(`Remote final evidence readiness geçti: ${host}:${root}`);

function collectTargetEnv() {
  const output = {};
  const missing = [];
  const invalid = [];

  for (const key of requiredTargetEnv) {
    const raw = process.env[`REMOTE_${key}`] ?? process.env[key];
    if (!raw) {
      missing.push(key);
      continue;
    }
    const normalized = normalizeTarget(raw);
    const failure = validateTargetUrl(normalized, key);
    if (failure) {
      invalid.push(failure);
      continue;
    }
    output[key] = normalized;
  }

  if (missing.length > 0) {
    failures.push(...missing.map((key) => `${key} remote final kanıt kapısı için zorunlu.`));
  }
  if (invalid.length > 0) {
    failures.push(...invalid);
  }

  return missing.length === 0 && invalid.length === 0 ? output : undefined;
}

function requireNoExampleEvidenceFlags() {
  const enabledFlags = forbiddenExampleEvidenceEnv.filter((key) => process.env[key] === "1");
  if (enabledFlags.length === 0) return;

  failures.push(...enabledFlags.map((key) => `${key}=1 prod:remote-evidence:check kapısında kullanılamaz.`));
}

function normalizeTarget(value) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return `file://${value}`;
  return value;
}

function validateTargetUrl(value, label) {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:" && url.protocol !== "https:") {
      return `${label} file:// veya https:// URL olmalı.`;
    }
    if (url.username || url.password || url.search || url.hash) {
      return `${label} remote final kanıt target URL userinfo, query veya fragment içeremez.`;
    }
    if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
      return `${label} remote final kanıt için gerçek https host olmalı.`;
    }
    if (url.protocol === "file:") {
      if (url.hostname && url.hostname !== "localhost") {
        return `${label} remote final kanıt file:// URL remote host taşımamalı.`;
      }
      const pathname = decodeURIComponent(url.pathname);
      if (isRemoteTempPath(pathname)) {
        return `${label} remote final kanıt için remote temp path olmamalı.`;
      }
      if (isRemoteLocalSmokeArtifactPath(pathname)) {
        return `${label} remote final kanıt için artifacts/local altında olmamalı.`;
      }
      if (isRemoteExampleEvidenceTemplatePath(pathname)) {
        return `${label} remote final kanıt için docs/evidence-templates fixture hedefi olmamalı.`;
      }
    }
    return undefined;
  } catch {
    return `${label} file:// veya https:// URL olmalı.`;
  }
}

function isPlaceholderEvidenceTargetHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".test") ||
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized.includes("example") ||
    normalized.includes("__set") ||
    normalized.includes("placeholder") ||
    normalized.includes("redacted")
  );
}

function isRemoteTempPath(pathname) {
  const normalized = pathname.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function isRemoteLocalSmokeArtifactPath(pathname) {
  const normalized = pathname.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function isRemoteExampleEvidenceTemplatePath(pathname) {
  return pathname.replaceAll("\\", "/").includes("/docs/evidence-templates/");
}

function requireRemotePass(label, command, failureMessage) {
  const result = runRemote(label, command);
  if (result.status !== 0) {
    failures.push(failureMessage ?? formatRemoteFailure(`${label} kontrolü başarısız`, result));
  }
}

function requireRemoteFinalFileTargets(values) {
  for (const [key, value] of Object.entries(values)) {
    const url = new URL(value);
    if (url.protocol !== "file:") continue;

    const pathname = decodeURIComponent(url.pathname);
    const result = runRemote(`Remote final artifact ${key}`, `test -f ${shellQuote(pathname)}`);
    if (result.status !== 0) {
      failures.push(`${key} remote final artifact bulunamadı: ${pathname}`);
    }
  }
}

function runRemote(label, command) {
  const result = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", `ConnectTimeout=${connectTimeout}`, host, command],
    { encoding: "utf8" },
  );

  return {
    label,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function toEnvPrefix(values) {
  return [
    "env",
    ...forbiddenExampleEvidenceEnv.flatMap((key) => ["-u", key]),
    ...Object.entries(values).map(([key, value]) => `${key}=${shellQuote(value)}`),
  ].join(" ");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function formatRemoteFailure(label, result) {
  const details = [trimForMessage(result.stdout), trimForMessage(result.stderr), result.error?.message].filter(Boolean).join(" | ");
  return details ? `${label}: ${details}` : label;
}

function trimForMessage(value) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 300 ? `${normalized.slice(0, 300)}...` : normalized;
}

function fail(items) {
  console.error("Remote final evidence readiness başarısız:");
  for (const item of items) console.error(`- ${item}`);
  process.exit(1);
}
