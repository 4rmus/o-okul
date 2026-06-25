import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const envFromFile = readEnvFile(readArgValue("--env-file"));
const target = readArgValue("--target") ?? process.env.UI_UX_REDESIGN_EVIDENCE_TARGET ?? envFromFile.UI_UX_REDESIGN_EVIDENCE_TARGET;
const output = readArgValue("--output") ?? process.env.UI_UX_REDESIGN_EVIDENCE_OUTPUT;

if (!target) fail(["UI_UX_REDESIGN_EVIDENCE_TARGET veya --target zorunlu."]);
if (!output) fail(["UI_UX_REDESIGN_EVIDENCE_OUTPUT veya --output zorunlu."]);

const outputPath = resolve(output);
await assertOutputPathAllowed(outputPath);

runChecker(target, "source");

const targetUrl = toUrl(target);
const payloadText = await readTarget(targetUrl);
const payload = parseJson(payloadText);
const normalizedPayload = `${JSON.stringify(payload, null, 2)}\n`;

if (targetUrl.protocol === "file:" && resolve(fileURLToPath(targetUrl)) === outputPath) {
  console.log(`UI/UX redesign kanıtı zaten bundle hedefinde: ${outputPath}`);
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  if (existsSync(outputPath)) {
    const stat = await lstat(outputPath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail(["UI_UX_REDESIGN_EVIDENCE_OUTPUT symlink olmayan file artifact olmalı."]);
  }
  await writeFile(outputPath, normalizedPayload, "utf8");
  console.log(`UI/UX redesign kanıtı bundle'a yazıldı: ${outputPath}`);
}

runChecker(pathToFileURL(outputPath).href, "output");

function readArgValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) fail([`${name} için değer gerekli.`]);
  return value;
}

function readEnvFile(file) {
  if (!file) return {};

  if (!existsSync(file)) fail([`--env-file okunabilir olmalı: ${file}`]);
  const contents = readFileSync(file, "utf8");

  const values = {};
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) fail([`${file}:${index + 1} KEY=VALUE biçiminde olmalı.`]);
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).replace(/^["']|["']$/g, "");
    if (!/^[A-Z0-9_]+$/.test(key)) fail([`${file}:${index + 1} geçersiz env anahtarı: ${key}`]);
    values[key] = value;
  }
  return values;
}

function runChecker(targetValue, label) {
  const env = { ...process.env };
  if (process.env.UI_UX_REDESIGN_ALLOW_EXAMPLE_EVIDENCE === "1") {
    env.UI_UX_REDESIGN_ALLOW_EXAMPLE_EVIDENCE = "1";
  } else {
    delete env.UI_UX_REDESIGN_ALLOW_EXAMPLE_EVIDENCE;
  }
  const result = spawnSync(process.execPath, ["scripts/check-ui-ux-redesign-evidence.mjs", targetValue], {
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`UI/UX redesign ${label} kanıt kontrolü başarısız.`);
    process.exit(result.status ?? 1);
  }
}

function toUrl(value) {
  try {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? new URL(value) : pathToFileURL(resolve(value));
  } catch {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
  }
}

async function readTarget(url) {
  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) fail([`UI/UX redesign kanıtı okunamadı: HTTP ${response.status}`]);
    return response.text();
  }

  if (url.protocol !== "file:") fail(["UI_UX_REDESIGN_EVIDENCE_TARGET yalnız file:// veya https:// destekler."]);
  return readFile(fileURLToPath(url), "utf8");
}

async function assertOutputPathAllowed(filePath) {
  if (isLocalTempPath(filePath) || isLocalArtifactPath(filePath)) {
    fail(["UI_UX_REDESIGN_EVIDENCE_OUTPUT temp veya artifacts/local altında olmamalı."]);
  }
  await assertParentPathAllowed(dirname(filePath), "UI_UX_REDESIGN_EVIDENCE_OUTPUT parent dizini");
}

async function assertParentPathAllowed(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail([`${label} symlink olmayan dizin olmalı.`]);
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized === "/tmp" || normalized.startsWith("/tmp/") || normalized === "/var/tmp" || normalized.startsWith("/var/tmp/") || normalized === "/private/tmp" || normalized.startsWith("/private/tmp/");
}

function isLocalArtifactPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["UI/UX redesign kanıtı geçerli JSON olmalı."]);
  }
}

function fail(messages) {
  console.error("UI/UX redesign kanıt toplama başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
