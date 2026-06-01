import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = process.env.IDENTITY_MIGRATION_TARGET;

if (!target) {
  fail(["IDENTITY_MIGRATION_TARGET boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["IDENTITY_MIGRATION_TARGET file://, http:// veya https:// URL olmalı."]);
}

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Kimlik göç kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readFile(fileURLToPath(url), "utf8"));
  }

  if (url.protocol === "http:" || url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Kimlik göç raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["IDENTITY_MIGRATION_TARGET yalnız file://, http:// veya https:// destekler."]);
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Kimlik göç raporu geçerli JSON olmalı."]);
  }
}

function validateReport(report) {
  const failures = [];

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDecision(report.migrationDecision, failures);
  requireSubjects(report.subjects, failures);
  requireInvitations(report.invitationFlow, failures);
  requireVerified(report.verifications, failures, [
    "identity_link_audit_ready",
    "tenant_memberships_created",
    "wrong_role_access_rejected",
    "cross_tenant_activation_rejected",
  ]);

  if (Array.isArray(report.gaps) && report.gaps.length > 0) {
    failures.push("gaps boş olmalı.");
  }

  return failures;
}

function requireDecision(decision, failures) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    failures.push("migrationDecision nesnesi zorunlu.");
    return;
  }

  requireString(decision, failures, "migrationDecision.approvedBy", "approvedBy");
  requireString(decision, failures, "migrationDecision.approvalReference", "approvalReference");
  requireOneOf(decision, failures, "activationMode", ["invite", "admin_link", "hybrid"]);
}

function requireSubjects(subjects, failures) {
  if (!Array.isArray(subjects)) {
    failures.push("subjects alan listesi zorunlu.");
    return;
  }

  for (const role of ["STUDENT", "GUARDIAN", "TEACHER"]) {
    const subject = subjects.find((entry) => entry?.role === role);
    if (!subject) {
      failures.push(`subjects eksik: ${role}`);
      continue;
    }

    for (const key of ["sourceRecords", "linkedUsers", "tenantMembershipsCreated"]) {
      if (!Number.isInteger(subject[key]) || subject[key] < 0) {
        failures.push(`subjects.${role}.${key} sıfır veya daha büyük tam sayı olmalı.`);
      }
    }

    if (subject.sourceRecords !== subject.linkedUsers) {
      failures.push(`subjects.${role}.linkedUsers sourceRecords ile eşit olmalı.`);
    }
    if (subject.sourceRecords !== subject.tenantMembershipsCreated) {
      failures.push(`subjects.${role}.tenantMembershipsCreated sourceRecords ile eşit olmalı.`);
    }
  }
}

function requireInvitations(flow, failures) {
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
    failures.push("invitationFlow nesnesi zorunlu.");
    return;
  }

  for (const key of ["created", "accepted", "expiredOrRevoked"]) {
    if (!Number.isInteger(flow[key]) || flow[key] < 0) {
      failures.push(`invitationFlow.${key} sıfır veya daha büyük tam sayı olmalı.`);
    }
  }
  if (flow.accepted > flow.created) {
    failures.push("invitationFlow.accepted created değerinden büyük olamaz.");
  }
}

function requireVerified(values, failures, expectedValues) {
  if (!Array.isArray(values)) {
    failures.push("verifications alan listesi zorunlu.");
    return;
  }

  for (const expected of expectedValues) {
    if (!values.includes(expected)) {
      failures.push(`verifications eksik: ${expected}`);
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
  console.error("Kimlik göç kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
