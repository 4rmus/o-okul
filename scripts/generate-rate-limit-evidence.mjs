import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const outputPath = readOption("--output") ?? process.env.RATE_LIMIT_EVIDENCE_OUTPUT;
const smokeTarget = process.env.RATE_LIMIT_SMOKE_EVIDENCE_TARGET?.trim();

const failures = [];
requireValue(outputPath, "RATE_LIMIT_EVIDENCE_OUTPUT veya --output", failures);
requireValue(smokeTarget, "RATE_LIMIT_SMOKE_EVIDENCE_TARGET", failures);
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const smokeFile = resolveEvidenceFileTarget(smokeTarget, "RATE_LIMIT_SMOKE_EVIDENCE_TARGET");
runCheck(smokeFile);

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, readFileSync(smokeFile, "utf8"), "utf8");
validateOutputTarget(outputFile);
runCheck(outputFile);
console.log(`Rate limit Redis kanıtı yazıldı: ${outputFile}`);

function resolveEvidenceFileTarget(target, label) {
  let url;
  try {
    url = new URL(target);
  } catch {
    fail([`${label} file:// URL olmalı.`]);
  }

  if (url.protocol !== "file:") {
    fail([`${label} generator için file:// artifact olmalı.`]);
  }
  if (url.username || url.password || url.search || url.hash) {
    fail([`${label} userinfo, query veya fragment taşımamalı.`]);
  }

  const filePath = fileURLToPath(url);
  if (isLocalTempPath(filePath)) {
    fail([`${label} lokal temp path olmamalı.`]);
  }
  if (isLocalSmokePath(filePath)) {
    fail([`${label} artifacts/local altında olmamalı.`]);
  }
  assertParentPathAllowed(dirname(filePath), label);

  const stat = readFileStat(filePath, label);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail([`${label} symlink olmayan file artifact olmalı.`]);
  }

  return filePath;
}

function runCheck(filePath) {
  const result = spawnSync("pnpm", ["rate-limit:check"], {
    env: {
      ...process.env,
      RATE_LIMIT_EVIDENCE_TARGET: pathToFileURL(filePath).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(["pnpm rate-limit:check başarısız oldu."]);
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

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["RATE_LIMIT_EVIDENCE_OUTPUT lokal temp path olmamalı."]);
  }
  if (isLocalSmokePath(filePath)) {
    fail(["RATE_LIMIT_EVIDENCE_OUTPUT artifacts/local altında olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath), "RATE_LIMIT_EVIDENCE_OUTPUT");

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["RATE_LIMIT_EVIDENCE_OUTPUT symlink olmayan file artifact olmalı."]);
    }
  }
}

function assertParentPathAllowed(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      fail([`${label} parent dizini symlink olmayan dizin olmalı.`]);
    }
  }
}

function readFileStat(filePath, label) {
  try {
    return lstatSync(filePath);
  } catch {
    fail([`${label} okunabilir file artifact olmalı.`]);
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

function fail(messages) {
  console.error("Rate limit Redis kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
