import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeLiveUiWorkerEvidence } from "./live-ui-worker-evidence.mjs";

const artifactRoot = "artifacts/live-ui-worker-evidence-contract";
const validResultEvidencePath = join(artifactRoot, "result", "live-ui-worker-result.json");
const failures = [];

await rm(artifactRoot, { force: true, recursive: true });
await mkdir(artifactRoot, { recursive: true });
const privateContractParent = resolve(process.cwd(), "..", "o-okul-private");
await mkdir(privateContractParent, { recursive: true });
const privateArtifactRoot = await mkdtemp(join(privateContractParent, "live-ui-worker-evidence-contract-"));
const validEvidencePath = join(privateArtifactRoot, "private", "valid-live-ui-worker.json");

try {
  await writeLiveUiWorkerEvidence(validEvidencePath, createProducerEvidence());
  const positive = runPreflight({
    NEXT_E2E_LIVE_UI_WORKER: "1",
    LIVE_UI_WORKER_EVIDENCE_PATH: validEvidencePath,
    LIVE_UI_WORKER_RESULT_EVIDENCE_FILE: validResultEvidencePath,
    STAGING_ENVIRONMENT: "staging",
  });
  if (positive.status !== 0) {
    failures.push(`positive preflight failed: ${positive.stderr || positive.stdout}`);
  }

  writeJson(validResultEvidencePath, createValidResultEvidence());
  const positiveResult = runResultCheck(validResultEvidencePath);
  if (positiveResult.status !== 0) {
    failures.push(`positive result check failed: ${positiveResult.stderr || positiveResult.stdout}`);
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
    "live UI-worker missing base URL negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      NEXT_E2E_BASE_URL: "",
      LIVE_UI_WORKER_EVIDENCE_PATH: validEvidencePath,
    },
    "NEXT_E2E_BASE_URL gerçek https staging/prod URL olmalı.",
  );

  runNegativeCheck(
    "live UI-worker local base URL negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      NEXT_E2E_BASE_URL: "http://localhost:3001",
      LIVE_UI_WORKER_EVIDENCE_PATH: validEvidencePath,
    },
    "NEXT_E2E_BASE_URL gerçek https staging/prod URL olmalı.",
  );

  runNegativeCheck(
    "live UI-worker missing skip web server negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      NEXT_E2E_SKIP_WEB_SERVER: "",
      LIVE_UI_WORKER_EVIDENCE_PATH: validEvidencePath,
    },
    "NEXT_E2E_SKIP_WEB_SERVER=1 olmalı.",
  );

  runNegativeCheck(
    "live UI-worker temp evidence path negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: "/tmp/live-ui-worker-evidence-negative.json",
    },
    "LIVE_UI_WORKER_EVIDENCE_PATH lokal temp path olmamalı.",
  );

  const publicEvidencePath = join(artifactRoot, "public-live-ui-worker.json");
  await expectProducerFailure(
    "live UI-worker producer public credential input path negative",
    publicEvidencePath,
    createProducerEvidence(),
    "private runtime input dizini altında olmalı.",
  );
  writeJson(publicEvidencePath, createValidEvidence());
  runNegativeCheck(
    "live UI-worker public credential input path negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: publicEvidencePath,
    },
    "LIVE_UI_WORKER_EVIDENCE_PATH private runtime input dizini altında olmalı.",
  );

  const repositoryPrivateEvidencePath = join(artifactRoot, "private", "repo-internal-live-ui-worker.json");
  await expectProducerFailure(
    "live UI-worker producer repository-private credential input path negative",
    repositoryPrivateEvidencePath,
    createProducerEvidence(),
    "repository çalışma ağacının dışında olmalı.",
  );
  writeJson(repositoryPrivateEvidencePath, createValidEvidence());
  runNegativeCheck(
    "live UI-worker repository-private credential input path negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: repositoryPrivateEvidencePath,
    },
    "LIVE_UI_WORKER_EVIDENCE_PATH repository çalışma ağacının dışında olmalı.",
  );

  const permissiveEvidencePath = join(privateArtifactRoot, "private", "permissive-live-ui-worker.json");
  await writeLiveUiWorkerEvidence(permissiveEvidencePath, createProducerEvidence());
  chmodSync(permissiveEvidencePath, 0o644);
  runNegativeCheck(
    "live UI-worker permissive credential input mode negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: permissiveEvidencePath,
    },
    "LIVE_UI_WORKER_EVIDENCE_PATH sadece owner read/write 0600 izniyle saklanmalı.",
  );

  runNegativeCheck(
    "live UI-worker temp result evidence path negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: validEvidencePath,
      LIVE_UI_WORKER_RESULT_EVIDENCE_FILE: "/tmp/live-ui-worker-result-negative.json",
      STAGING_ENVIRONMENT: "staging",
    },
    "LIVE_UI_WORKER_RESULT_EVIDENCE_FILE lokal temp path olmamalı.",
  );

  runNegativeCheck(
    "live UI-worker result environment negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: validEvidencePath,
      LIVE_UI_WORKER_RESULT_EVIDENCE_FILE: validResultEvidencePath,
    },
    "LIVE_UI_WORKER_RESULT_EVIDENCE_FILE için STAGING_ENVIRONMENT veya NODE_ENV staging/production olmalı.",
  );

  const symlinkRealPath = join(privateArtifactRoot, "private", "symlink-real.json");
  const symlinkPath = join(privateArtifactRoot, "private", "symlink-live-ui-worker.json");
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

  const symlinkResultRealPath = join(artifactRoot, "symlink-result-real.json");
  const symlinkResultPath = join(artifactRoot, "symlink-live-ui-worker-result.json");
  writeJson(symlinkResultRealPath, {
    result: "PASS",
  });
  symlinkSync(symlinkResultRealPath, symlinkResultPath);
  runNegativeCheck(
    "live UI-worker symlink result evidence file negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: validEvidencePath,
      LIVE_UI_WORKER_RESULT_EVIDENCE_FILE: symlinkResultPath,
      STAGING_ENVIRONMENT: "staging",
    },
    "LIVE_UI_WORKER_RESULT_EVIDENCE_FILE symlink olmayan file artifact olmalı.",
  );

  const realDirectory = join(privateArtifactRoot, "real-dir");
  const symlinkDirectory = join(privateArtifactRoot, "symlink-dir");
  const realNestedDirectory = join(realDirectory, "private", "nested");
  mkdirSync(realNestedDirectory, { recursive: true });
  writeJson(join(realNestedDirectory, "live-ui-worker.json"), createValidEvidence());
  writeJson(join(realNestedDirectory, "live-ui-worker-result.json"), createValidResultEvidence());
  symlinkSync(realDirectory, symlinkDirectory, "dir");
  runNegativeCheck(
    "live UI-worker symlink parent negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: join(symlinkDirectory, "private", "nested", "live-ui-worker.json"),
    },
    "LIVE_UI_WORKER_EVIDENCE_PATH parent dizini symlink olmayan dizin olmalı.",
  );

  runNegativeCheck(
    "live UI-worker symlink result evidence parent negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: validEvidencePath,
      LIVE_UI_WORKER_RESULT_EVIDENCE_FILE: join(symlinkDirectory, "private", "nested", "live-ui-worker-result.json"),
      STAGING_ENVIRONMENT: "staging",
    },
    "LIVE_UI_WORKER_RESULT_EVIDENCE_FILE parent dizini symlink olmayan dizin olmalı.",
  );

  const missingFieldPath = join(privateArtifactRoot, "private", "missing-field.json");
  const missingField = createProducerEvidence();
  delete missingField.firstStudentId;
  await writeLiveUiWorkerEvidence(missingFieldPath, missingField);
  runNegativeCheck(
    "live UI-worker missing required field negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: missingFieldPath,
    },
    "liveUiWorkerEvidence.firstStudentId alanı zorunlu.",
  );

  const stalePath = join(privateArtifactRoot, "private", "stale.json");
  const stale = createValidEvidence();
  stale.generatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  writeJson(stalePath, stale);
  runNegativeCheck(
    "live UI-worker stale generatedAt negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: stalePath,
    },
    "generatedAt 24 saat sınırından eski",
  );

  const placeholderPath = join(privateArtifactRoot, "private", "placeholder.json");
  const placeholder = createValidEvidence();
  placeholder.loginName = "report-admin@example.com";
  writeJson(placeholderPath, placeholder);
  runNegativeCheck(
    "live UI-worker placeholder login name negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: placeholderPath,
    },
    "loginName production kanıtı için örnek/placeholder/redacted değer olmamalı.",
  );

  const extraFieldPath = join(privateArtifactRoot, "private", "extra-field.json");
  const extraField = createProducerEvidence();
  extraField.studentPortal.unexpected = true;
  await writeLiveUiWorkerEvidence(extraFieldPath, extraField);
  runNegativeCheck(
    "live UI-worker extra field negative",
    {
      NEXT_E2E_LIVE_UI_WORKER: "1",
      LIVE_UI_WORKER_EVIDENCE_PATH: extraFieldPath,
    },
    "studentPortal.unexpected beklenmeyen alan.",
  );

  runResultNegativeCheck(
    "live UI-worker result temp target negative",
    "/tmp/live-ui-worker-result-target-negative.json",
    "LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET production kanıtı için lokal temp path olmamalı.",
  );

  runResultNegativeCheck(
    "live UI-worker result local artifact target negative",
    "artifacts/local/live-ui-worker-result-target-negative.json",
    "LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET production kanıtı için artifacts/local altında olmamalı.",
  );

  runResultNegativeCheck(
    "live UI-worker result symlink target negative",
    symlinkResultPath,
    "LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET symlink olmayan file:// artifact olmalı.",
  );

  runResultNegativeCheck(
    "live UI-worker result symlink parent target negative",
    join(symlinkDirectory, "private", "nested", "live-ui-worker-result.json"),
    "LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmalı.",
  );

  const resultMissingStatusPath = join(artifactRoot, "result-missing-status.json");
  const resultMissingStatus = createValidResultEvidence();
  delete resultMissingStatus.reportStatus;
  writeJson(resultMissingStatusPath, resultMissingStatus);
  runResultNegativeCheck(
    "live UI-worker result missing status negative",
    resultMissingStatusPath,
    "liveUiWorkerResultEvidence.reportStatus eksik.",
  );

  const resultStalePath = join(artifactRoot, "result-stale.json");
  const resultStale = createValidResultEvidence();
  resultStale.generatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  writeJson(resultStalePath, resultStale);
  runResultNegativeCheck(
    "live UI-worker result stale generatedAt negative",
    resultStalePath,
    "liveUiWorkerResultEvidence.generatedAt 24 saat sınırından eski",
  );

  const resultPlaceholderPath = join(artifactRoot, "result-placeholder.json");
  const resultPlaceholder = createValidResultEvidence();
  resultPlaceholder.examHash = "exam-redacted-example";
  writeJson(resultPlaceholderPath, resultPlaceholder);
  runResultNegativeCheck(
    "live UI-worker result placeholder negative",
    resultPlaceholderPath,
    "liveUiWorkerResultEvidence.examHash 64 karakter hex sha256 olmalı.",
  );

  const resultRawStudentPath = join(artifactRoot, "result-raw-student.json");
  const resultRawStudent = createValidResultEvidence();
  resultRawStudent.firstStudentId = "student-report-smoke-20260614-00001";
  writeJson(resultRawStudentPath, resultRawStudent);
  runResultNegativeCheck(
    "live UI-worker result raw student id negative",
    resultRawStudentPath,
    "liveUiWorkerResultEvidence.firstStudentId beklenmeyen alan.",
  );

  const resultIncompletePortalPath = join(artifactRoot, "result-incomplete-portal.json");
  const resultIncompletePortal = createValidResultEvidence();
  resultIncompletePortal.guardianPortalViewed = false;
  writeJson(resultIncompletePortalPath, resultIncompletePortal);
  runResultNegativeCheck(
    "live UI-worker result portal negative",
    resultIncompletePortalPath,
    "liveUiWorkerResultEvidence.guardianPortalViewed true olmalı.",
  );

  const resultUnexpectedFieldPath = join(artifactRoot, "result-extra-field.json");
  const resultUnexpectedField = createValidResultEvidence();
  resultUnexpectedField.password = "must-not-leak";
  writeJson(resultUnexpectedFieldPath, resultUnexpectedField);
  runResultNegativeCheck(
    "live UI-worker result extra field negative",
    resultUnexpectedFieldPath,
    "liveUiWorkerResultEvidence.password beklenmeyen alan.",
  );
} finally {
  await rm(artifactRoot, { force: true, recursive: true });
  await rm(privateArtifactRoot, { force: true, recursive: true });
  rmSync("/tmp/live-ui-worker-evidence-negative.json", { force: true });
  rmSync("/tmp/live-ui-worker-result-negative.json", { force: true });
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
      LIVE_UI_WORKER_RESULT_EVIDENCE_FILE: "",
      LIVE_UI_WORKER_RESULT_EVIDENCE_PATH: "",
      NEXT_E2E_BASE_URL: "https://staging.o-okul.com",
      NEXT_E2E_SKIP_WEB_SERVER: "1",
      STAGING_ENVIRONMENT: "",
      NODE_ENV: "",
      ...env,
    },
  });
}

function runResultCheck(target) {
  return spawnSync(process.execPath, ["scripts/check-live-ui-worker-result-evidence.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      LIVE_UI_WORKER_RESULT_ALLOW_EXAMPLE_EVIDENCE: "",
      LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET: target.startsWith("/tmp/") ? target : pathToFileURL(resolve(target)).href,
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

function runResultNegativeCheck(label, target, expectedMessage) {
  const result = runResultCheck(target);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0) {
    failures.push(`${label}: komut başarısız olmalıydı.`);
  }
  if (!output.includes(expectedMessage)) {
    failures.push(`${label}: beklenen hata yok: ${expectedMessage}`);
  }
}

async function expectProducerFailure(label, target, payload, expectedMessage) {
  try {
    await writeLiveUiWorkerEvidence(target, payload);
    failures.push(`${label}: producer başarısız olmalıydı.`);
  } catch (error) {
    if (!String(error).includes(expectedMessage)) {
      failures.push(`${label}: beklenen hata yok: ${expectedMessage}`);
    }
  }
}

function writeJson(path, value, mode = path.split(/[\\/]+/).includes("private") ? 0o600 : 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  chmodSync(path, mode);
  if (!existsSync(path)) {
    failures.push(`${path} yazılamadı.`);
  } else {
    JSON.parse(readFileSync(path, "utf8"));
  }
}

function createValidEvidence() {
  return {
    examId: "exam-report-smoke-20260614",
    firstStudentId: "student-report-smoke-20260614-00001",
    generatedAt: new Date(Date.now() - 60_000).toISOString(),
    guardianPortal: {
      loginName: "guardian.portal@staging.o-okul.com",
      password: "Str0ngGuardian!2026",
    },
    loginName: "report.admin@staging.o-okul.com",
    password: "Str0ngReport!2026",
    studentPortal: {
      loginName: "student.portal@staging.o-okul.com",
      password: "Str0ngStudent!2026",
    },
    tenantSlug: "staging-school",
  };
}

function createProducerEvidence() {
  const evidence = createValidEvidence();
  delete evidence.generatedAt;
  return evidence;
}

function createValidResultEvidence() {
  return {
    result: "PASS",
    check: "live_ui_worker_report_smoke",
    generatedAt: new Date(Date.now() - 60_000).toISOString(),
    environment: "staging",
    checkedAt: new Date(Date.now() - 60_000).toISOString(),
    examHash: "1111111111111111111111111111111111111111111111111111111111111111",
    firstStudentHash: "2222222222222222222222222222222222222222222222222222222222222222",
    reportStatus: "READY",
    downloadedArtifacts: ["xlsx", "pdf"],
    karnePdfDownloaded: true,
    excelDownloaded: true,
    studentPortalViewed: true,
    guardianPortalViewed: true,
    commandsPassed: ["pnpm live:ui-worker:smoke"],
    gaps: [],
  };
}
