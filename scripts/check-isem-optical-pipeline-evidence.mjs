import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const target = process.env.ISEM_OPTICAL_PIPELINE_TARGET;
const allowExampleEvidence = process.env.ISEM_OPTICAL_PIPELINE_ALLOW_EXAMPLE_EVIDENCE === "1";

if (!target) {
  fail(["ISEM_OPTICAL_PIPELINE_TARGET bos birakilamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["ISEM_OPTICAL_PIPELINE_TARGET file:// veya https:// URL olmali."]);
}

requireAllowedEvidenceTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateSmokeEvidencePayload(report, {
  expectedCheck: "isem_optical_pipeline_smoke",
  allowedEnvironments: ["staging", "production"],
  label: "isemOpticalPipelineEvidence",
  allowExampleEvidence,
});

if (failures.length > 0) {
  fail(failures);
}

console.log(`iSEM optik pipeline kanit kontrolu gecti: ${report.environment} ${report.counts?.examResultCount} sonuc.`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`iSEM optik pipeline raporu okunamadi: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["ISEM_OPTICAL_PIPELINE_TARGET yalniz file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["ISEM_OPTICAL_PIPELINE_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["ISEM_OPTICAL_PIPELINE_TARGET symlink olmayan file:// artifact olmali."]);
  }

  await assertParentPathAllowed(dirname(filePath));

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
      fail(["ISEM_OPTICAL_PIPELINE_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["ISEM_OPTICAL_PIPELINE_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["ISEM_OPTICAL_PIPELINE_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["ISEM_OPTICAL_PIPELINE_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["ISEM_OPTICAL_PIPELINE_TARGET production kaniti icin lokal temp path olmamali."]);
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
  return path === "/tmp" || path.startsWith("/tmp/") || path === "/var/tmp" || path.startsWith("/var/tmp/");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["iSEM optik pipeline raporu gecerli JSON olmali."]);
  }
}

function fail(failures) {
  console.error("iSEM optik pipeline kanit kontrolu basarisiz:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
