import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const privateInputRoot = resolve(process.cwd(), "..", `.o-okul-live-onboarding-contract-${process.pid}`);
const validEvidencePath = join(privateInputRoot, "valid-live-onboarding.json");
const repositoryArtifactPath = "artifacts/live-onboarding-evidence-contract.json";
const failures = [];

await rm(privateInputRoot, { force: true, recursive: true });
await mkdir(privateInputRoot, { recursive: true, mode: 0o700 });

try {
  writeJson(validEvidencePath, createValidEvidence());
  const positive = runPreflight({
    NEXT_E2E_LIVE_ONBOARDING: "1",
    LIVE_ONBOARDING_EVIDENCE_PATH: validEvidencePath,
  });
  if (positive.status !== 0) {
    failures.push(`positive preflight failed: ${positive.stderr || positive.stdout}`);
  }

  runNegativeCheck(
    "live onboarding missing enabled negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "",
      LIVE_ONBOARDING_EVIDENCE_PATH: validEvidencePath,
    },
    "NEXT_E2E_LIVE_ONBOARDING=1 olmalı.",
  );

  runNegativeCheck(
    "live onboarding missing email evidence endpoint negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: validEvidencePath,
      LIVE_ONBOARDING_EMAIL_EVIDENCE_ENDPOINT: "",
    },
    "LIVE_ONBOARDING_EMAIL_EVIDENCE_ENDPOINT gerçek https URL olmalı.",
  );

  runNegativeCheck(
    "live onboarding missing email evidence bearer negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: validEvidencePath,
      LIVE_ONBOARDING_EMAIL_EVIDENCE_BEARER_TOKEN: "",
    },
    "LIVE_ONBOARDING_EMAIL_EVIDENCE_BEARER_TOKEN en az 16 karakter olmalı.",
  );

  runNegativeCheck(
    "live onboarding temp evidence path negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: "/tmp/live-onboarding-evidence-negative.json",
    },
    "LIVE_ONBOARDING_EVIDENCE_PATH lokal temp path olmamalı.",
  );

  writeJson(repositoryArtifactPath, createValidEvidence());
  runNegativeCheck(
    "live onboarding repository artifact path negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: repositoryArtifactPath,
    },
    "LIVE_ONBOARDING_EVIDENCE_PATH repo, artifacts veya evidence mount dışında private dosya olmalı.",
  );

  const symlinkRealPath = join(privateInputRoot, "symlink-real.json");
  const symlinkPath = join(privateInputRoot, "symlink-live-onboarding.json");
  writeJson(symlinkRealPath, createValidEvidence());
  symlinkSync(symlinkRealPath, symlinkPath);
  runNegativeCheck(
    "live onboarding symlink evidence file negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: symlinkPath,
    },
    "LIVE_ONBOARDING_EVIDENCE_PATH symlink olmayan normal dosya olmalı.",
  );

  const realDirectory = join(privateInputRoot, "real-dir");
  const symlinkDirectory = join(privateInputRoot, "symlink-dir");
  const realNestedDirectory = join(realDirectory, "nested");
  mkdirSync(realNestedDirectory, { recursive: true });
  writeJson(join(realNestedDirectory, "live-onboarding.json"), createValidEvidence());
  symlinkSync(realDirectory, symlinkDirectory, "dir");
  runNegativeCheck(
    "live onboarding symlink parent negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: join(symlinkDirectory, "nested", "live-onboarding.json"),
    },
    "LIVE_ONBOARDING_EVIDENCE_PATH parent dizini symlink olmayan dizin olmalı.",
  );

  const missingFieldPath = join(privateInputRoot, "missing-field.json");
  const missingField = createValidEvidence();
  delete missingField.firstAdmin.password;
  writeJson(missingFieldPath, missingField);
  runNegativeCheck(
    "live onboarding missing required field negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: missingFieldPath,
    },
    "firstAdmin.password alanı zorunlu.",
  );

  const stalePath = join(privateInputRoot, "stale.json");
  const stale = createValidEvidence();
  stale.generatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  writeJson(stalePath, stale);
  runNegativeCheck(
    "live onboarding stale generatedAt negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: stalePath,
    },
    "generatedAt 24 saat sınırından eski",
  );

  const placeholderPath = join(privateInputRoot, "placeholder.json");
  const placeholder = createValidEvidence();
  placeholder.firstAdmin.email = "tenant-admin@example.com";
  writeJson(placeholderPath, placeholder);
  runNegativeCheck(
    "live onboarding placeholder email negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: placeholderPath,
    },
    "firstAdmin.email production kanıtı için örnek/placeholder/redacted değer olmamalı.",
  );

  const extraFieldPath = join(privateInputRoot, "extra-field.json");
  const extraField = createValidEvidence();
  extraField.tenant.unexpected = true;
  writeJson(extraFieldPath, extraField);
  runNegativeCheck(
    "live onboarding extra field negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: extraFieldPath,
    },
    "tenant.unexpected beklenmeyen alan.",
  );
} finally {
  await rm(privateInputRoot, { force: true, recursive: true });
  rmSync(repositoryArtifactPath, { force: true });
  rmSync("/tmp/live-onboarding-evidence-negative.json", { force: true });
}

if (failures.length > 0) {
  console.error("Live onboarding evidence contract kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Live onboarding evidence contract kontrolü geçti.");

function runPreflight(env) {
  return spawnSync(process.execPath, ["scripts/check-live-onboarding-evidence-env.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      LIVE_ONBOARDING_ALLOW_EXAMPLE_EVIDENCE: "",
      NEXT_E2E_LIVE_ONBOARDING: "",
      LIVE_ONBOARDING_EVIDENCE_PATH: "",
      LIVE_ONBOARDING_EMAIL_EVIDENCE_ENDPOINT: "https://mail-evidence.staging.o-okul.test/messages/latest",
      LIVE_ONBOARDING_EMAIL_EVIDENCE_BEARER_TOKEN: "live-onboarding-test-bearer-token",
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
  chmodSync(path, 0o600);
  if (!existsSync(path)) {
    failures.push(`${path} yazılamadı.`);
  } else {
    JSON.parse(readFileSync(path, "utf8"));
  }
}

function createValidEvidence() {
  return {
    appendRunId: true,
    firstAdmin: {
      email: "tenant.admin@staging.o-okul.com",
      name: "Canli UAT Admin",
      nationalId: "10000000450",
      password: "Str0ngAdmin!2026",
    },
    generatedAt: new Date(Date.now() - 60_000).toISOString(),
    onboarding: {
      contactEmail: "kurulum@staging.o-okul.com",
      importOwner: "Canli UAT",
      institutionName: "UAT Kurumu",
    },
    systemAdmin: {
      email: "system.admin@staging.o-okul.com",
      loginName: "system.admin@staging.o-okul.com",
      password: "Str0ngSystem!2026",
    },
    tenant: {
      name: "UAT Kurumu",
      plan: "TRIAL",
      seatLimit: 25,
      slug: "uat-kurumu",
    },
  };
}
