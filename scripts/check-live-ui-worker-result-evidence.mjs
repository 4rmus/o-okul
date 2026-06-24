import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const target = process.env.LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET ?? process.argv[2];
const allowExampleEvidence = process.env.LIVE_UI_WORKER_RESULT_ALLOW_EXAMPLE_EVIDENCE === "1";

if (!target) {
  fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET veya dosya argümanı boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? new URL(target) : pathToFileURL(resolve(target));
} catch {
  fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateSmokeEvidencePayload(report, {
  expectedCheck: "live_ui_worker_report_smoke",
  allowedEnvironments: ["staging", "production"],
  label: "liveUiWorkerResultEvidence",
  allowExampleEvidence,
});

if (failures.length > 0) {
  fail(failures);
}

console.log(`Live UI-worker result kanıt kontrolü geçti: ${report.environment}.`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Live UI-worker result kanıtı okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  await assertParentPathAllowed(dirname(filePath));

  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET okunabilir file:// artifact olmalı."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET symlink olmayan file:// artifact olmalı."]);
  }

  return readFile(filePath, "utf8");
}

async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);

    let stat;
    try {
      stat = await lstat(current);
    } catch {
      fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET parent dizini okunabilir olmalı."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET production kanıtı için gerçek https host olmalı."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET production kanıtı için lokal temp path olmamalı."]);
  }

  if (url.protocol === "file:" && isLocalSmokeEvidenceTargetUrl(url)) {
    fail(["LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET production kanıtı için artifacts/local altında olmamalı."]);
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
    normalized.includes("placeholder")
  );
}

function isLocalTempEvidenceTargetUrl(url) {
  const path = fileURLToPath(url).replace(/\/+$/g, "") || "/";
  return (
    path === "/tmp" ||
    path.startsWith("/tmp/") ||
    path === "/var/tmp" ||
    path.startsWith("/var/tmp/") ||
    path === "/private/tmp" ||
    path.startsWith("/private/tmp/")
  );
}

function isLocalSmokeEvidenceTargetUrl(url) {
  const path = fileURLToPath(url).replace(/\/+$/g, "") || "/";
  return path.includes("/artifacts/local/");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Live UI-worker result kanıtı geçerli JSON olmalı."]);
  }
}

function fail(failures) {
  console.error("Live UI-worker result kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
