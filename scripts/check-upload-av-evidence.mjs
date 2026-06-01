import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.UPLOAD_AV_TARGET;

if (!target) {
  fail(["UPLOAD_AV_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["UPLOAD_AV_TARGET file://, http:// veya https:// URL olmalı."]);
}

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Upload AV kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readFile(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Upload AV raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["UPLOAD_AV_TARGET yalnız file://, http:// veya https:// destekler."]);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Upload AV raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireScannerDecision(report.scannerDecision, failures);
  requireSurfaces(report.uploadSurfaces, failures);
  requireScanResults(report.scanResults, failures);

  if (Array.isArray(report.gaps) && report.gaps.length > 0) {
    failures.push("gaps boş olmalı.");
  }

  return failures;
}

function requireScannerDecision(decision, failures) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    failures.push("scannerDecision nesnesi zorunlu.");
    return;
  }

  requireOneOf(decision, failures, "mode", ["provider", "local"]);
  requireString(decision, failures, "scannerDecision.approvedBy", "approvedBy");
  requireString(decision, failures, "scannerDecision.approvalReference", "approvalReference");
  requireString(decision, failures, "scannerDecision.scannerName", "scannerName");
  requireString(decision, failures, "scannerDecision.signatureVersion", "signatureVersion");
  if (decision.failClosed !== true) {
    failures.push("scannerDecision.failClosed true olmalı.");
  }
}

function requireSurfaces(surfaces, failures) {
  if (!Array.isArray(surfaces)) {
    failures.push("uploadSurfaces alan listesi zorunlu.");
    return;
  }

  for (const surface of ["homework_material_file", "support_ticket_attachment"]) {
    if (!surfaces.includes(surface)) {
      failures.push(`uploadSurfaces eksik: ${surface}`);
    }
  }
}

function requireScanResults(results, failures) {
  if (!results || typeof results !== "object" || Array.isArray(results)) {
    failures.push("scanResults nesnesi zorunlu.");
    return;
  }

  for (const key of ["cleanFileAccepted", "eicarRejected", "scannerUnavailableRejected"]) {
    if (results[key] !== true) {
      failures.push(`scanResults.${key} true olmalı.`);
    }
  }
}

function requireEqual(report, failures, key, expected) {
  if (report[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
  }
}

function requireOneOf(report, failures, key, expectedValues) {
  if (!expectedValues.includes(report[key])) {
    failures.push(`${key} ${expectedValues.join(" veya ")} olmalı.`);
  }
}

function requireDate(report, failures, key) {
  const value = report[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} geçerli tarih olmalı.`);
  }
}

function requireString(scope, failures, label, key) {
  if (typeof scope[key] !== "string" || scope[key].trim() === "") {
    failures.push(`${label} boş olmayan metin olmalı.`);
  }
}

function fail(failures) {
  console.error("Upload AV kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
