import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const artifactRoot = "artifacts/live-onboarding-evidence-contract";
const validEvidencePath = join(artifactRoot, "valid-live-onboarding.json");
const failures = [];

await rm(artifactRoot, { force: true, recursive: true });
await mkdir(artifactRoot, { recursive: true });

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
    "live onboarding temp evidence path negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: "/tmp/live-onboarding-evidence-negative.json",
    },
    "LIVE_ONBOARDING_EVIDENCE_PATH lokal temp path olmamalı.",
  );

  const symlinkRealPath = join(artifactRoot, "symlink-real.json");
  const symlinkPath = join(artifactRoot, "symlink-live-onboarding.json");
  writeJson(symlinkRealPath, createValidEvidence());
  symlinkSync(symlinkRealPath, symlinkPath);
  runNegativeCheck(
    "live onboarding symlink evidence file negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: symlinkPath,
    },
    "LIVE_ONBOARDING_EVIDENCE_PATH symlink olmayan file artifact olmalı.",
  );

  const realDirectory = join(artifactRoot, "real-dir");
  const symlinkDirectory = join(artifactRoot, "symlink-dir");
  mkdirSync(realDirectory, { recursive: true });
  writeJson(join(realDirectory, "live-onboarding.json"), createValidEvidence());
  symlinkSync(realDirectory, symlinkDirectory, "dir");
  runNegativeCheck(
    "live onboarding symlink parent negative",
    {
      NEXT_E2E_LIVE_ONBOARDING: "1",
      LIVE_ONBOARDING_EVIDENCE_PATH: join(symlinkDirectory, "live-onboarding.json"),
    },
    "LIVE_ONBOARDING_EVIDENCE_PATH parent dizini symlink olmayan dizin olmalı.",
  );

  const missingFieldPath = join(artifactRoot, "missing-field.json");
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

  const placeholderPath = join(artifactRoot, "placeholder.json");
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

  const extraFieldPath = join(artifactRoot, "extra-field.json");
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
  await rm(artifactRoot, { force: true, recursive: true });
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
    appendRunId: true,
    firstAdmin: {
      email: "tenant.admin@staging.uzmanhocam.com",
      name: "Canli UAT Admin",
      password: "Str0ngAdmin!2026",
    },
    onboarding: {
      contactEmail: "kurulum@staging.uzmanhocam.com",
      importOwner: "Canli UAT",
      institutionName: "UAT Kurumu",
    },
    systemAdmin: {
      email: "system.admin@staging.uzmanhocam.com",
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
