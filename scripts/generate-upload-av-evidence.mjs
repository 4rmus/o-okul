import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outputPath = readOption("--output") ?? process.env.UPLOAD_AV_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const decisionMode = process.env.UPLOAD_AV_SCANNER_DECISION_MODE?.trim();
const approvedBy = process.env.UPLOAD_AV_APPROVED_BY?.trim();
const approvalReference = process.env.UPLOAD_AV_APPROVAL_REFERENCE?.trim();
const scannerName = process.env.UPLOAD_AV_SCANNER_NAME?.trim();
const configuredSignatureVersion = process.env.UPLOAD_AV_SIGNATURE_VERSION?.trim();
const failClosed = process.env.UPLOAD_AV_FAIL_CLOSED;
const cleanFileConfirmed = process.env.UPLOAD_AV_CLEAN_FILE_ACCEPTED;
const eicarConfirmed = process.env.UPLOAD_AV_EICAR_REJECTED;
const unavailableConfirmed = process.env.UPLOAD_AV_SCANNER_UNAVAILABLE_REJECTED;
const scannerMode = process.env.UPLOAD_AV_SCANNER?.trim();
const clamAvHost = process.env.CLAMAV_HOST?.trim();
const clamAvPort = readPositiveInteger(process.env.CLAMAV_PORT, 3310, "CLAMAV_PORT");
const clamAvTimeoutMs = readPositiveInteger(process.env.CLAMAV_TIMEOUT_MS, 5000, "CLAMAV_TIMEOUT_MS");
const unavailableHost = process.env.UPLOAD_AV_UNAVAILABLE_TEST_HOST?.trim();
const unavailablePort = readPositiveInteger(
  process.env.UPLOAD_AV_UNAVAILABLE_TEST_PORT,
  undefined,
  "UPLOAD_AV_UNAVAILABLE_TEST_PORT",
);

const failures = [];
requireValue(outputPath, "UPLOAD_AV_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireOneOf(decisionMode, "UPLOAD_AV_SCANNER_DECISION_MODE", ["local", "provider"], failures);
requireEqual(scannerMode, "UPLOAD_AV_SCANNER", "clamav", failures);
requireEvidenceValue(approvedBy, "UPLOAD_AV_APPROVED_BY", failures);
requireEvidenceValue(approvalReference, "UPLOAD_AV_APPROVAL_REFERENCE", failures);
requireEvidenceValue(scannerName, "UPLOAD_AV_SCANNER_NAME", failures);
requireOptionalEvidenceValue(configuredSignatureVersion, "UPLOAD_AV_SIGNATURE_VERSION", failures);
requireValue(clamAvHost, "CLAMAV_HOST", failures);
requireTrue(failClosed, "UPLOAD_AV_FAIL_CLOSED", failures);
requireTrue(cleanFileConfirmed, "UPLOAD_AV_CLEAN_FILE_ACCEPTED", failures);
requireTrue(eicarConfirmed, "UPLOAD_AV_EICAR_REJECTED", failures);
requireTrue(unavailableConfirmed, "UPLOAD_AV_SCANNER_UNAVAILABLE_REJECTED", failures);
requireValue(unavailableHost, "UPLOAD_AV_UNAVAILABLE_TEST_HOST", failures);
if (clamAvPort === undefined) {
  failures.push("CLAMAV_PORT pozitif tam sayı olmalı.");
}
if (unavailablePort === undefined) {
  failures.push("UPLOAD_AV_UNAVAILABLE_TEST_PORT pozitif tam sayı olmalı.");
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const signatureVersion = configuredSignatureVersion || await readClamAvVersion(clamAvHost, clamAvPort, clamAvTimeoutMs);
if (hasPlaceholderToken(signatureVersion)) {
  fail(["UPLOAD_AV_SIGNATURE_VERSION gerçek scanner imza/version değeri olmalı."]);
}

await requireScanOk({
  body: Buffer.from("uzman-hocam clean upload av smoke\n", "utf8"),
  host: clamAvHost,
  port: clamAvPort,
  timeoutMs: clamAvTimeoutMs,
  expected: "clean",
});
await requireScanOk({
  body: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", "utf8"),
  host: clamAvHost,
  port: clamAvPort,
  timeoutMs: clamAvTimeoutMs,
  expected: "malware",
});
await requireUnavailable({
  host: unavailableHost,
  port: unavailablePort,
  timeoutMs: clamAvTimeoutMs,
});

runCommand("pnpm --filter @uzman-hocam/api exec vitest run src/upload/upload-av-scanner.test.ts src/homework/homework.e2e.test.ts src/support-ticket/support-ticket.service.test.ts");

const report = {
  result: "PASS",
  environment,
  checkedAt: new Date().toISOString(),
  scannerDecision: {
    mode: decisionMode,
    approvedBy,
    approvalReference,
    scannerName,
    signatureVersion,
    failClosed: true,
  },
  uploadSurfaces: ["homework_material_file", "support_ticket_attachment"],
  scanResults: {
    cleanFileAccepted: true,
    eicarRejected: true,
    scannerUnavailableRejected: true,
  },
  gaps: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);
runCheck(outputFile);
console.log(`Upload AV kanıtı yazıldı: ${outputFile}`);

function scanWithClamAv({ body, host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = "";
    let settled = false;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const failScan = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.write("zINSTREAM\0");
      const length = Buffer.alloc(4);
      length.writeUInt32BE(body.length, 0);
      socket.write(length);
      socket.write(body);
      socket.write(Buffer.alloc(4));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.once("timeout", () => failScan(new Error("UPLOAD_AV_SCANNER_UNAVAILABLE")));
    socket.once("error", () => failScan(new Error("UPLOAD_AV_SCANNER_UNAVAILABLE")));
    socket.once("end", () => {
      if (response.includes("FOUND")) {
        settle("malware");
        return;
      }
      if (/\bOK\b/.test(response)) {
        settle("clean");
        return;
      }
      failScan(new Error(`UPLOAD_AV_SCANNER_UNEXPECTED_RESPONSE: ${response.trim()}`));
    });
  });
}

async function readClamAvVersion(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let response = "";
    let settled = false;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const failVersion = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => socket.write("VERSION\n"));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.once("timeout", () => failVersion(new Error("UPLOAD_AV_SCANNER_UNAVAILABLE")));
    socket.once("error", () => failVersion(new Error("UPLOAD_AV_SCANNER_UNAVAILABLE")));
    socket.once("end", () => {
      const version = response.trim();
      if (!version) {
        failVersion(new Error("UPLOAD_AV_SIGNATURE_VERSION boş döndü."));
        return;
      }
      settle(version);
    });
  }).catch((error) => fail([`ClamAV version okunamadı: ${error.message}`]));
}

async function requireScanOk(input) {
  const result = await scanWithClamAv(input).catch((error) => fail([`ClamAV scan başarısız: ${error.message}`]));
  if (result !== input.expected) {
    fail([`ClamAV scan sonucu ${input.expected} olmalıydı; gelen: ${result}`]);
  }
}

async function requireUnavailable(input) {
  await scanWithClamAv({
    body: Buffer.from("uzman-hocam unavailable scanner smoke\n", "utf8"),
    host: input.host,
    port: input.port,
    timeoutMs: input.timeoutMs,
  })
    .then((result) => fail([`UPLOAD_AV_UNAVAILABLE_TEST hedefi erişilemez olmalıydı; scan sonucu: ${result}`]))
    .catch((error) => {
      if (error.message !== "UPLOAD_AV_SCANNER_UNAVAILABLE") {
        fail([`UPLOAD_AV_UNAVAILABLE_TEST beklenmeyen hata verdi: ${error.message}`]);
      }
    });
}

function runCommand(command) {
  const testEnv = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
    "NODE_ENV",
    "ADMIN_MFA_MODE",
    "PERSISTENCE_DRIVER",
    "IDEMPOTENCY_STORE",
  ]) {
    delete testEnv[key];
  }

  const result = spawnSync("sh", ["-lc", command], {
    env: testEnv,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail([`${command} başarısız oldu.`]);
  }
}

function runCheck(filePath) {
  const result = spawnSync("pnpm", ["upload-av:check"], {
    env: {
      ...process.env,
      UPLOAD_AV_TARGET: pathToFileURL(filePath).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(["pnpm upload-av:check başarısız oldu."]);
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

function readPositiveInteger(value, fallback, label) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
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
    output.push(`${label} gerçek scanner/kanıt değeri olmalı; placeholder/example/redacted/test içeremez.`);
  }
}

function requireOptionalEvidenceValue(value, label, output) {
  if (value === undefined || value === "") return;
  requireEvidenceValue(value, label, output);
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
    "disabled",
    "todo",
    "tbd",
    "???",
  ].some((token) => normalized.includes(token));
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["UPLOAD_AV_OUTPUT lokal temp path olmamalı."]);
  }
  if (isLocalSmokePath(filePath)) {
    fail(["UPLOAD_AV_OUTPUT artifacts/local altında olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath));

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["UPLOAD_AV_OUTPUT symlink olmayan file artifact olmalı."]);
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
      fail(["UPLOAD_AV_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
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

function fail(messages) {
  console.error("Upload AV kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
