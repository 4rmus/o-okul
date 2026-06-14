import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const artifactRoot = join(packageRoot, "artifacts", "audit-log-partition-maintenance-contract");
const evidencePath = join(artifactRoot, "evidence.json");
const failures = [];

await rm(artifactRoot, { force: true, recursive: true });
await mkdir(artifactRoot, { recursive: true });

try {
  const result = runMaintenance({
    AUDIT_LOG_PARTITION_START_MONTH: "2026-06",
    AUDIT_LOG_PARTITION_MONTHS_AHEAD: "3",
    AUDIT_LOG_PARTITION_EVIDENCE_FILE: evidencePath,
    NODE_ENV: "test",
  });

  if (result.status !== 0) {
    failures.push(`maintenance dry-run failed: ${result.stderr || result.stdout}`);
  } else {
    validateEvidence(readEvidence(evidencePath));
  }

  runNegativeCheck(
    "audit log partition evidence temp path negative",
    {
      AUDIT_LOG_PARTITION_START_MONTH: "2026-06",
      AUDIT_LOG_PARTITION_EVIDENCE_FILE: "/tmp/audit-log-partition-evidence-negative.json",
    },
    "AUDIT_LOG_PARTITION_EVIDENCE_FILE lokal temp path olmamalı.",
  );

  const realFile = join(artifactRoot, "real-evidence.json");
  const symlinkFile = join(artifactRoot, "symlink-evidence.json");
  writeFileSync(realFile, "{}\n", "utf8");
  symlinkSync(realFile, symlinkFile);
  runNegativeCheck(
    "audit log partition evidence symlink file negative",
    {
      AUDIT_LOG_PARTITION_START_MONTH: "2026-06",
      AUDIT_LOG_PARTITION_EVIDENCE_FILE: symlinkFile,
    },
    "AUDIT_LOG_PARTITION_EVIDENCE_FILE symlink olmayan file artifact olmalı.",
  );

  const realDirectory = join(artifactRoot, "real-dir");
  const symlinkDirectory = join(artifactRoot, "symlink-dir");
  await mkdir(realDirectory);
  symlinkSync(realDirectory, symlinkDirectory, "dir");
  runNegativeCheck(
    "audit log partition evidence symlink parent negative",
    {
      AUDIT_LOG_PARTITION_START_MONTH: "2026-06",
      AUDIT_LOG_PARTITION_EVIDENCE_FILE: join(symlinkDirectory, "nested", "evidence.json"),
    },
    "AUDIT_LOG_PARTITION_EVIDENCE_FILE parent dizini symlink olmayan dizin olmalı.",
  );
} finally {
  await rm(artifactRoot, { force: true, recursive: true });
}

if (failures.length > 0) {
  console.error("AuditLog partition maintenance contract kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("AuditLog partition maintenance contract kontrolü geçti.");

function runMaintenance(env) {
  return spawnSync(process.execPath, ["scripts/maintain-audit-log-partitions.mjs"], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AUDIT_LOG_PARTITION_APPLY: "",
      AUDIT_LOG_PARTITION_MONTHS_AHEAD: "1",
      AUDIT_LOG_PARTITION_EVIDENCE_FILE: "",
      ...env,
    },
  });
}

function runNegativeCheck(label, env, expectedMessage) {
  const result = runMaintenance(env);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0) {
    failures.push(`${label}: komut başarısız olmalıydı.`);
  }
  if (!output.includes(expectedMessage)) {
    failures.push(`${label}: beklenen hata yok: ${expectedMessage}`);
  }
}

function readEvidence(path) {
  if (!existsSync(path)) {
    failures.push("dry-run evidence dosyası yazılmadı.");
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateEvidence(evidence) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    failures.push("evidence nesnesi zorunlu.");
    return;
  }

  const expectedKeys = [
    "result",
    "check",
    "environment",
    "generatedAt",
    "mode",
    "applied",
    "startMonth",
    "monthsPlanned",
    "partitions",
    "commandsPassed",
    "gaps",
  ];
  requireExactKeys(evidence, expectedKeys, "evidence");
  requireEqual(evidence, "result", "PASS");
  requireEqual(evidence, "check", "audit_log_partition_maintenance");
  requireEqual(evidence, "mode", "dry-run");
  requireEqual(evidence, "applied", false);
  requireEqual(evidence, "startMonth", "2026-06");
  requireEqual(evidence, "monthsPlanned", 3);
  requireEqual(evidence, "environment", "test");
  requireArray(evidence.commandsPassed, "commandsPassed");
  if (!evidence.commandsPassed?.includes("pnpm audit-log-partition:maintain")) {
    failures.push("commandsPassed bakım komutunu içermeli.");
  }
  requireArray(evidence.gaps, "gaps");
  if (evidence.gaps?.length !== 0) failures.push("gaps boş olmalı.");

  const expectedPartitions = [
    ["AuditLog_2026_06", "2026-06-01", "2026-07-01"],
    ["AuditLog_2026_07", "2026-07-01", "2026-08-01"],
    ["AuditLog_2026_08", "2026-08-01", "2026-09-01"],
  ];
  requireArray(evidence.partitions, "partitions");
  if (evidence.partitions?.length !== expectedPartitions.length) {
    failures.push(`partitions ${expectedPartitions.length} kayıt içermeli.`);
    return;
  }

  for (const [index, [name, from, to]] of expectedPartitions.entries()) {
    const partition = evidence.partitions[index];
    requireExactKeys(partition, ["name", "from", "to", "status"], `partitions.${index}`);
    requireEqual(partition, "name", name);
    requireEqual(partition, "from", from);
    requireEqual(partition, "to", to);
    requireEqual(partition, "status", "PLANNED");
  }
}

function requireExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return;
  }

  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !Object.hasOwn(value, key))) {
    failures.push(`${label} alan seti beklenenle eşleşmeli.`);
  }
}

function requireEqual(value, key, expected) {
  if (value?.[key] !== expected) {
    failures.push(`${key} ${String(expected)} olmalı.`);
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    failures.push(`${label} liste olmalı.`);
  }
}
