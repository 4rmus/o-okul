import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requiredTargetEnv = [
  "PRODUCTION_EVIDENCE_SUMMARY_TARGET",
  "LIVE_STATUS_EVIDENCE_TARGET",
  "PILOT_EVIDENCE_TARGET",
  "GO_LIVE_EVIDENCE_TARGET",
];
const forbiddenExampleEvidenceEnv = [
  "PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE",
  "LIVE_STATUS_ALLOW_EXAMPLE_EVIDENCE",
  "PILOT_ALLOW_EXAMPLE_EVIDENCE",
  "GO_LIVE_ALLOW_EXAMPLE_EVIDENCE",
];
const finalReadinessPath = "docs/phase-6-production-readiness.md";
const finalChecks = [
  {
    label: "Production evidence summary",
    script: "scripts/check-production-evidence-summary.mjs",
  },
  {
    label: "Live status full PASS",
    script: "scripts/check-live-status-evidence.mjs",
    assertOutput: hasFullPassLiveStatus,
    outputFailure:
      "LIVE_STATUS_EVIDENCE_TARGET tam dış kanıt PASS üretmeli; target'sız veya kısmi Canlı Durum final kanıt sayılmaz.",
  },
  {
    label: "Pilot evidence",
    script: "scripts/check-pilot-evidence.mjs",
  },
  {
    label: "Go-live evidence",
    script: "scripts/check-go-live-evidence.mjs",
  },
];

const missingTargets = requiredTargetEnv.filter((key) => !process.env[key]);
if (missingTargets.length > 0) {
  fail(missingTargets.map((key) => `${key} zorunlu.`));
}

const enabledExampleFlags = forbiddenExampleEvidenceEnv.filter((key) => process.env[key] === "1");
if (enabledExampleFlags.length > 0) {
  fail(enabledExampleFlags.map((key) => `${key}=1 final dış kanıt kapısında kullanılamaz.`));
}

if (process.env.LIVE_STATUS_READINESS_PATH && process.env.LIVE_STATUS_READINESS_PATH !== finalReadinessPath) {
  fail([`LIVE_STATUS_READINESS_PATH final dış kanıt kapısında ${finalReadinessPath} olmalı.`]);
}

const targetUrls = validateTargetUrls();
await requireLinkedTargetConsistency(targetUrls);

for (const check of finalChecks) {
  const result = spawnSync(process.execPath, [check.script], {
    env: process.env,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    fail([`${check.label} kontrolü başarısız.`], result.status ?? 1);
  }

  if (check.assertOutput && !check.assertOutput(output)) {
    fail([check.outputFailure]);
  }
}

console.log("Final external evidence kontrolü geçti: production summary, tam Canlı Durum, pilot ve go-live hedefleri doğrulandı.");

function hasFullPassLiveStatus(output) {
  const match = output.match(/Live status evidence kontrolü geçti: (\d+)\/(\d+) dış kanıt PASS\./);
  return Boolean(match && match[1] === match[2]);
}

function validateTargetUrls() {
  const failures = [];
  const urls = {};
  for (const key of requiredTargetEnv) {
    const url = toEvidenceTargetUrl(process.env[key], key, failures);
    if (url) urls[key] = url;
  }
  if (failures.length > 0) fail(failures);
  return urls;
}

function toEvidenceTargetUrl(value, label, failures) {
  try {
    const url = new URL(value);
    if (!["file:", "https:"].includes(url.protocol)) {
      failures.push(`${label} file:// veya https:// URL olmalı.`);
      return undefined;
    }
    if (hasSecretBearingUrlParts(url)) {
      failures.push(`${label} final dış kanıt target URL userinfo, query veya fragment içeremez.`);
      return undefined;
    }
    if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
      failures.push(`${label} final dış kanıt için gerçek https host olmalı.`);
      return undefined;
    }
    if (url.protocol === "file:") {
      validateFileTargetUrl(url, label, failures);
    }
    return url;
  } catch {
    failures.push(`${label} file:// veya https:// URL olmalı.`);
    return undefined;
  }
}

function validateFileTargetUrl(url, label, failures) {
  const filePath = fileURLToPath(url);
  if (isLocalTempPath(filePath)) {
    failures.push(`${label} final dış kanıt için lokal temp path olmamalı.`);
    return;
  }
    if (isLocalSmokeArtifactPath(filePath)) {
      failures.push(`${label} final dış kanıt için artifacts/local altında olmamalı.`);
      return;
    }
    if (isExampleEvidenceTemplatePath(filePath)) {
      failures.push(`${label} final dış kanıt için docs/evidence-templates fixture hedefi olmamalı.`);
      return;
    }
    if (!isParentPathAllowed(dirname(filePath))) {
      failures.push(`${label} parent dizini symlink olmayan dizin olmalı.`);
    return;
  }

  try {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      failures.push(`${label} symlink olmayan file artifact olmalı.`);
    }
  } catch {
    failures.push(`${label} okunabilir file artifact olmalı.`);
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

function hasSecretBearingUrlParts(url) {
  return url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "";
}

function isLocalTempPath(path) {
  const normalized = path.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function isLocalSmokeArtifactPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function isExampleEvidenceTemplatePath(path) {
  return path.replaceAll("\\", "/").includes("/docs/evidence-templates/");
}

function isParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

async function requireLinkedTargetConsistency(targetUrls) {
  const failures = [];
  const goLive = await readJsonTarget(targetUrls.GO_LIVE_EVIDENCE_TARGET, "GO_LIVE_EVIDENCE_TARGET");
  const liveStatus = await readJsonTarget(targetUrls.LIVE_STATUS_EVIDENCE_TARGET, "LIVE_STATUS_EVIDENCE_TARGET");

  requireResolvedTargetHref(
    goLive?.productionEvidenceSummary?.summaryTarget,
    targetUrls.GO_LIVE_EVIDENCE_TARGET,
    targetUrls.PRODUCTION_EVIDENCE_SUMMARY_TARGET,
    "goLive.productionEvidenceSummary.summaryTarget",
    failures,
  );
  requireResolvedTargetHref(
    goLive?.pilot?.pilotEvidenceReference,
    targetUrls.GO_LIVE_EVIDENCE_TARGET,
    targetUrls.PILOT_EVIDENCE_TARGET,
    "goLive.pilot.pilotEvidenceReference",
    failures,
  );
  requireResolvedTargetHref(
    goLive?.liveStatusEvidence?.evidenceTarget,
    targetUrls.GO_LIVE_EVIDENCE_TARGET,
    targetUrls.LIVE_STATUS_EVIDENCE_TARGET,
    "goLive.liveStatusEvidence.evidenceTarget",
    failures,
  );
  requireResolvedTargetHref(
    liveStatus?.productionEvidenceSummaryTarget,
    targetUrls.LIVE_STATUS_EVIDENCE_TARGET,
    targetUrls.PRODUCTION_EVIDENCE_SUMMARY_TARGET,
    "liveStatusEvidence.productionEvidenceSummaryTarget",
    failures,
  );
  requireResolvedTargetHref(
    liveStatus?.pilotEvidenceTarget,
    targetUrls.LIVE_STATUS_EVIDENCE_TARGET,
    targetUrls.PILOT_EVIDENCE_TARGET,
    "liveStatusEvidence.pilotEvidenceTarget",
    failures,
  );
  requireResolvedTargetHref(
    liveStatus?.goLiveEvidenceTarget,
    targetUrls.LIVE_STATUS_EVIDENCE_TARGET,
    targetUrls.GO_LIVE_EVIDENCE_TARGET,
    "liveStatusEvidence.goLiveEvidenceTarget",
    failures,
  );

  if (failures.length > 0) fail(failures);
}

async function readJsonTarget(url, label) {
  let raw;
  if (url.protocol === "file:") {
    raw = readFileSync(url, "utf8");
  } else {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`${label} okunamadı: HTTP ${response.status}`]);
    }
    raw = await response.text();
  }

  try {
    return JSON.parse(raw);
  } catch {
    fail([`${label} geçerli JSON olmalı.`]);
  }
}

function requireResolvedTargetHref(value, baseUrl, expectedUrl, label, failures) {
  if (typeof value !== "string" || value.trim() === "") {
    failures.push(`${label} zorunlu.`);
    return;
  }

  let resolved;
  try {
    resolved = new URL(value, baseUrl);
  } catch {
    failures.push(`${label} file:// veya https:// URL olmalı.`);
    return;
  }

  if (resolved.href !== expectedUrl.href) {
    failures.push(`${label} final target env ile aynı artifact hedefine bağlanmalı.`);
  }
}

function fail(failures, exitCode = 1) {
  console.error("Final external evidence kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(exitCode);
}
