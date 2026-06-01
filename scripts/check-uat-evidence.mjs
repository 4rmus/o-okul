import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.UAT_EVIDENCE_TARGET;

if (!target) {
  fail(["UAT_EVIDENCE_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["UAT_EVIDENCE_TARGET file://, http:// veya https:// URL olmalı."]);
}

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`UAT kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readFile(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`UAT raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["UAT_EVIDENCE_TARGET yalnız file://, http:// veya https:// destekler."]);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["UAT raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireString(report, failures, "tester");
  requireString(report, failures, "releaseCandidate");
  requireString(report, failures, "rollbackImageTag");
  requireString(report, failures, "restoreBackupReference");

  requireList(report, failures, "flowsVerified", [
    "tenant admin login",
    "teacher workflow",
    "guardian workflow",
    "raw import smoke",
    "report generation smoke",
    "sms batch smoke",
    "privacy purge",
  ]);
  requireList(report, failures, "commandsPassed", [
    "pnpm run ci",
    "pnpm prod:env:check",
    "pnpm db:rls:check:live",
    "pnpm raw-import:smoke",
    "pnpm report-generation:smoke",
    "pnpm queue:smoke",
    "pnpm sms:smoke",
    "pnpm traefik:https:smoke",
  ]);

  if (Array.isArray(report.defects) && report.defects.length > 0) {
    failures.push("defects boş olmalı.");
  }

  return failures;
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

function requireString(report, failures, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${key} boş olmayan metin olmalı.`);
  }
}

function requireList(report, failures, key, expectedValues) {
  const value = report[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} alan listesi zorunlu.`);
    return;
  }

  for (const expected of expectedValues) {
    if (!value.includes(expected)) {
      failures.push(`${key} eksik: ${expected}`);
    }
  }
}

function fail(failures) {
  console.error("UAT kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
