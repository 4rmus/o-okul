import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requiredServicesVerified = ["api", "worker", "postgres", "redis", "object-storage"];

const env = { ...process.env, ...readEnvFileOption() };
const outputPath = readOption("--output") ?? env.DEPLOYMENT_REGION_OUTPUT;
const environment = readOption("--environment") ?? env.STAGING_ENVIRONMENT ?? env.NODE_ENV ?? "staging";

const provider = env.DEPLOYMENT_REGION_PROVIDER?.trim();
const region = env.DEPLOYMENT_REGION_REGION?.trim();
const datacenterCountryCode = env.DEPLOYMENT_REGION_DATACENTER_COUNTRY_CODE?.trim();
const dataResidencyVerified = env.DEPLOYMENT_REGION_DATA_RESIDENCY_VERIFIED;
const evidenceReference = env.DEPLOYMENT_REGION_EVIDENCE_REFERENCE?.trim();
const servicesVerified = parseServices(env.DEPLOYMENT_REGION_SERVICES_VERIFIED);

const failures = [];
requireValue(outputPath, "DEPLOYMENT_REGION_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireEvidenceValue(provider, "DEPLOYMENT_REGION_PROVIDER", failures);
requireEvidenceValue(region, "DEPLOYMENT_REGION_REGION", failures);
requireEqual(datacenterCountryCode, "DEPLOYMENT_REGION_DATACENTER_COUNTRY_CODE", "TR", failures);
requireTrue(dataResidencyVerified, "DEPLOYMENT_REGION_DATA_RESIDENCY_VERIFIED", failures);
requireEvidenceValue(evidenceReference, "DEPLOYMENT_REGION_EVIDENCE_REFERENCE", failures);
requireNoSecretBearingReference(evidenceReference, "DEPLOYMENT_REGION_EVIDENCE_REFERENCE", failures);
requireNoPublicIpLookupOnlyReference(evidenceReference, "DEPLOYMENT_REGION_EVIDENCE_REFERENCE", failures);
requireExactServiceSet(servicesVerified, failures);
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const report = {
  result: "PASS",
  environment,
  checkedAt: new Date().toISOString(),
  provider,
  region,
  datacenterCountryCode,
  dataResidencyVerified: true,
  evidenceReference,
  servicesVerified: requiredServicesVerified,
  gaps: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);
runCheck(outputFile);
console.log(`Deployment region kanıtı yazıldı: ${outputFile}`);

function runCheck(filePath) {
  const result = spawnSync("pnpm", ["deployment:region:check"], {
    env: {
      ...process.env,
      DEPLOYMENT_REGION_TARGET: pathToFileURL(filePath).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(["pnpm deployment:region:check başarısız oldu."]);
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

function readEnvFileOption() {
  const file = readOption("--env-file");
  if (!file) return {};

  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return values;
}

function parseServices(rawValue) {
  if (typeof rawValue !== "string") return [];
  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function requireEqual(value, label, expected, output) {
  if (value !== expected) {
    output.push(`${label} ${expected} olmalı.`);
  }
}

function requireTrue(value, label, output) {
  if (value !== "true") {
    output.push(`${label} true olmalı.`);
  }
}

function requireEvidenceValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }

  if (hasPlaceholderToken(value)) {
    output.push(`${label} gerçek sağlayıcı/kanıt değeri olmalı; placeholder/example/redacted/test içeremez.`);
  }
}

function requireNoSecretBearingReference(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") return;

  if (hasSecretBearingReference(value)) {
    output.push(`${label} userinfo, query veya fragment taşımamalı.`);
  }
}

function requireNoPublicIpLookupOnlyReference(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") return;

  if (hasPublicIpLookupReference(value)) {
    output.push(`${label} provider console, sözleşme veya kalıcı first-party artifact olmalı; public IP lookup tek başına yeterli değil.`);
  }
}

function requireExactServiceSet(services, output) {
  if (services.length === 0) {
    output.push("DEPLOYMENT_REGION_SERVICES_VERIFIED boş bırakılamaz.");
    return;
  }

  const seen = new Set();
  const expected = new Set(requiredServicesVerified);
  for (const service of services) {
    if (seen.has(service)) {
      output.push(`DEPLOYMENT_REGION_SERVICES_VERIFIED tekrarlı servis içeriyor: ${service}`);
    }
    seen.add(service);
    if (!expected.has(service)) {
      output.push(`DEPLOYMENT_REGION_SERVICES_VERIFIED beklenmeyen servis içeriyor: ${service}`);
    }
  }

  for (const service of requiredServicesVerified) {
    if (!seen.has(service)) {
      output.push(`DEPLOYMENT_REGION_SERVICES_VERIFIED eksik: ${service}`);
    }
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

function hasPublicIpLookupReference(value) {
  const normalized = value.trim();
  const urlCandidate = normalized.toLowerCase().startsWith("url:") ? normalized.slice(4) : normalized;
  if (!/^(https|file|s3):\/\//i.test(urlCandidate)) {
    return false;
  }

  try {
    const hostname = new URL(urlCandidate).hostname.toLowerCase();
    return [
      "api.ipify.org",
      "ifconfig.me",
      "icanhazip.com",
      "ipinfo.io",
      "ip-api.com",
      "ipapi.co",
      "iplocation.net",
      "whatismyipaddress.com",
    ].some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["DEPLOYMENT_REGION_OUTPUT lokal temp path olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath));

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["DEPLOYMENT_REGION_OUTPUT symlink olmayan file artifact olmalı."]);
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
      fail(["DEPLOYMENT_REGION_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
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

function fail(messages) {
  console.error("Deployment region kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
