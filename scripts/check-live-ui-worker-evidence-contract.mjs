import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const artifactRoot = "artifacts/live-ui-worker-evidence-contract";
const validEvidencePath = join(artifactRoot, "valid-live-ui-worker.json");
const failures = [];

await rm(artifactRoot, { force: true, recursive: true });
await mkdir(artifactRoot, { recursive: true });

try {
  writeJson(validEvidencePath, createValidEvidence());
  const positive = runPreflight({
    NEXT_E2E_LIVE_UI_WORKER: "1",
    LIVE_UI_WORKER_EVIDENCE_PATH: validEvidencePath,
  });
  if (positive.status !== 0) {
    failures.push(`positive preflight failed: ${positive.stderr || positive.stdout}`);
  }

  runNegativeCheck(
    "live UI-worker missing enabled negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "",
      LIVE_UI_WORKER_EVIDENCE_PATH: validEvidencePath,
    },
    "NEXT_E2E_LIVE_UI_WORKER=1 olmalı.",
  );

  runNegativeCheck(
    "live UI-worker temp evidence path negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: "/tmp/live-ui-worker-evidence-negative.json",
    },
    "LIVE_UI_WORKER_EVIDENCE_PATH lokal temp path olmamalı.",
  );

  const symlinkRealPath = join(artifactRoot, "symlink-real.json");
  const symlinkPath = join(artifactRoot, "symlink-live-ui-worker.json");
  writeJson(symlinkRealPath, createValidEvidence());
  symlinkSync(symlinkRealPath, symlinkPath);
  runNegativeCheck(
    "live UI-worker symlink evidence file negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: symlinkPath,
    },
    "LIVE_UI_WORKER_EVIDENCE_PATH symlink olmayan file artifact olmalı.",
  );

  const realDirectory = join(artifactRoot, "real-dir");
  const symlinkDirectory = join(artifactRoot, "symlink-dir");
  mkdirSync(realDirectory, { recursive: true });
  writeJson(join(realDirectory, "live-ui-worker.json"), createValidEvidence());
  symlinkSync(realDirectory, symlinkDirectory, "dir");
  runNegativeCheck(
    "live UI-worker symlink parent negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: join(symlinkDirectory, "live-ui-worker.json"),
    },
    "LIVE_UI_WORKER_EVIDENCE_PATH parent dizini symlink olmayan dizin olmalı.",
  );

  const missingFieldPath = join(artifactRoot, "missing-field.json");
  const missingField = createValidEvidence();
  delete missingField.firstStudentId;
  writeJson(missingFieldPath, missingField);
  runNegativeCheck(
    "live UI-worker missing required field negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: missingFieldPath,
    },
    "liveUiWorkerEvidence.firstStudentId alanı zorunlu.",
  );

  const placeholderPath = join(artifactRoot, "placeholder.json");
  const placeholder = createValidEvidence();
  placeholder.email = "report-admin@example.com";
  writeJson(placeholderPath, placeholder);
  runNegativeCheck(
    "live UI-worker placeholder email negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: placeholderPath,
    },
    "email production kanıtı için örnek/placeholder/redacted değer olmamalı.",
  );

  const extraFieldPath = join(artifactRoot, "extra-field.json");
  const extraField = createValidEvidence();
  extraField.studentPortal.unexpected = true;
  writeJson(extraFieldPath, extraField);
  runNegativeCheck(
    "live UI-worker extra field negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: extraFieldPath,
    },
    "studentPortal.unexpected beklenmeyen alan.",
  );
} finally {
  await rm(artifactRoot, { force: true, recursive: true });
  rmSync("/tmp/live-ui-worker-evidence-negative.json", { force: true });
}

if (failures.length > 0) {
  console.error("Live UI-worker evidence contract kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Live UI-worker evidence contract kontrolü geçti.");

function runPreflight(env) {
  return spawnSync(process.execPath, ["scripts/check-live-ui-worker-evidence-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      LIVE_UI_WORKER_ALLOW_EXAMPLE_EVIDENCE: "",
      NEXT_E2E_LIVE_UI_WORKER: "",
      LIVE_UI_WORKER_EVIDENCE_PATH: "",
      ...env,
    },
  });
}

function runNegativeCheck(label, env, expectedMessage) {
  const result = runPreflight(env);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0) {
    failures.push(`${label}: komut başarısız olmalıydı.`);
  }
  if (!output.includes(expectedMessage)) {
    failures.push(`${label}: beklenen hata yok: ${expectedMessage}`);
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (!existsSync(path)) {
    failures.push(`${path} yazılamadı.`);
  } else {
    JSON.parse(readFileSync(path, "utf8"));
  }
}

function createValidEvidence() {
  return {
    email: "report.admin@staging.uzmanhocam.com",
    examId: "exam-report-smoke-20260614",
    firstStudentId: "student-report-smoke-20260614-00001",
    guardianPortal: {
      email: "guardian.portal@staging.uzmanhocam.com",
      password: "Str0ngGuardian!2026",
    },
    password: "Str0ngReport!2026",
    studentPortal: {
      email: "student.portal@staging.uzmanhocam.com",
      password: "Str0ngStudent!2026",
    },
  };
}
