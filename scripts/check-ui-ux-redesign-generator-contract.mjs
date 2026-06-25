import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve("..", ".o-okul-ui-ux-redesign-generator-contract");
const envPath = join(root, "staging-evidence.env");
const outputPath = join(root, "reports", "ui-ux-redesign.json");
const secretLeakMarker = "uiUxSecretTokenThatMustNotLeak123456";

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
writeFileSync(envPath, buildValidEnvFile());

try {
  expectGeneratePass();
  expectFailure("missing phase references", removeLine("UI_UX_REDESIGN_PHASE_3_REFERENCES"), [
    "UI_UX_REDESIGN_PHASE_3_REFERENCES boş bırakılamaz.",
  ]);
  expectFailure("placeholder release candidate", replaceLine("UI_UX_REDESIGN_RELEASE_CANDIDATE", "ghcr.io/__SET_OWNER__/api:tag"), [
    "UI_UX_REDESIGN_RELEASE_CANDIDATE placeholder/redacted/example değer içermemeli.",
  ]);
  expectFailure("secret bearing reference", secretBearingReferenceEnv(), [
    "UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES userinfo, query veya fragment taşımamalı.",
  ]);
  expectOutputFailure("temp output", "/tmp/o-okul-ui-ux-redesign-generator-contract.json", [
    "UI_UX_REDESIGN_EVIDENCE_OUTPUT lokal temp path olmamalı.",
  ]);
  expectOutputFailure("local artifact output", "artifacts/local/ui-ux-redesign-generator-contract.json", [
    "UI_UX_REDESIGN_EVIDENCE_OUTPUT artifacts/local altında olmamalı.",
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("UI/UX redesign generator contract kontrolü geçti.");

function expectGeneratePass() {
  const result = runGenerator(envPath, outputPath);
  if (result.status !== 0) failContract("generator geçerli staging env ile PASS üretmeli.", result);

  const output = combinedOutput(result);
  if (!output.includes("UI/UX redesign kanıt kontrolü geçti: staging")) {
    failContract("generator çıktısını kendi checker'ı ile doğrulamalı.", result);
  }
  if (!output.includes(`UI/UX redesign kanıtı yazıldı: ${outputPath}`)) {
    failContract("generator beklenen output path'e yazmalı.", result);
  }
  assertNoSecretLeak(result, "pass");

  const report = JSON.parse(readFileSync(outputPath, "utf8"));
  if (report.result !== "PASS" || report.environment !== "staging") {
    failContract("generator PASS staging raporu üretmeli.", result);
  }
  if (report.phaseEvidence?.length !== 6) failContract("generator altı faz kanıtı üretmeli.", result);
  if (report.viewportCoverage?.length !== 4) failContract("generator dört viewport yüzeyi üretmeli.", result);
  if (report.privacy?.rawPiiInArtifacts !== false) failContract("generator raw PII bayrağını false yazmalı.", result);
  if (report.openRisks?.length !== 0) failContract("generator açık risk bırakmamalı.", result);

  const checkResult = spawnSync(process.execPath, ["scripts/check-ui-ux-redesign-evidence.mjs", pathToFileURL(outputPath).href], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (checkResult.status !== 0) failContract("üretilen kanıt checker'dan geçmeli.", checkResult);
}

function expectFailure(label, envContents, expectedMessages) {
  const failingEnvPath = join(root, `${label.replaceAll(" ", "-")}.env`);
  const failingOutputPath = join(root, "reports", `${label.replaceAll(" ", "-")}.json`);
  writeFileSync(failingEnvPath, envContents);
  const result = runGenerator(failingEnvPath, failingOutputPath);
  if (result.status === 0) failContract(`${label} senaryosu kırılmalı.`, result);
  assertMessages(result, label, expectedMessages);
  assertNoSecretLeak(result, label);
}

function expectOutputFailure(label, output, expectedMessages) {
  const result = runGenerator(envPath, output);
  if (result.status === 0) failContract(`${label} senaryosu kırılmalı.`, result);
  assertMessages(result, label, expectedMessages);
  assertNoSecretLeak(result, label);
}

function runGenerator(inputEnvPath, output) {
  return spawnSync(
    process.execPath,
    ["scripts/generate-ui-ux-redesign-evidence.mjs", "--env-file", inputEnvPath, "--output", output],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}

function assertMessages(result, label, expectedMessages) {
  const output = combinedOutput(result);
  for (const message of expectedMessages) {
    if (!output.includes(message)) failContract(`${label} beklenen hatayı üretmeli: ${message}`, result);
  }
}

function buildValidEnvFile() {
  const lines = [
    "STAGING_ENVIRONMENT=staging",
    "UI_UX_REDESIGN_CHECKED_AT=2026-06-25T12:00:00.000Z",
    "UI_UX_REDESIGN_RELEASE_CANDIDATE=ghcr.io/4rmus/uzman-hocam/api:ui-ux-contract-20260625",
    "UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/summary.json,run:https://github.com/4rmus/uzman-hocam/actions/runs/987654321,url:https://staging.o-okul.com/evidence/ui-ux-redesign/uat.json",
    "UI_UX_REDESIGN_PHASE_0_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/phase-0-a11y.json",
    "UI_UX_REDESIGN_PHASE_1_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/phase-1-shell.json",
    "UI_UX_REDESIGN_PHASE_2_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/phase-2-lists.json",
    "UI_UX_REDESIGN_PHASE_3_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/phase-3-reports.json",
    "UI_UX_REDESIGN_PHASE_4_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/phase-4-portals.json",
    "UI_UX_REDESIGN_PHASE_5_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/phase-5-release.json",
    "UI_UX_REDESIGN_KURUM_DASHBOARD_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/dashboard-375.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/dashboard-768.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/dashboard-1024.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/dashboard-1440.png",
    "UI_UX_REDESIGN_OPTIK_WORKSPACE_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/optik-375.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/optik-768.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/optik-1024.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/optik-1440.png",
    "UI_UX_REDESIGN_RAPOR_WORKSPACE_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/rapor-375.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/rapor-768.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/rapor-1024.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/rapor-1440.png",
    "UI_UX_REDESIGN_PORTAL_SHELL_REFERENCES=url:https://staging.o-okul.com/evidence/ui-ux-redesign/portal-375.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/portal-768.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/portal-1024.png,url:https://staging.o-okul.com/evidence/ui-ux-redesign/portal-1440.png",
    "UI_UX_REDESIGN_PII_REVIEW=PASS",
    "UI_UX_REDESIGN_RAW_PII_IN_ARTIFACTS=false",
    "UI_UX_REDESIGN_SMS_RECIPIENT_PREVIEW_EXPORTED=false",
    "UI_UX_REDESIGN_GUARDIAN_FINANCE_LEAKAGE_CHECKED=true",
    "UI_UX_REDESIGN_APPROVAL_ROLE=release-owner",
    "UI_UX_REDESIGN_APPROVED_AT=2026-06-25T12:30:00.000Z",
  ];
  return `${lines.join("\n")}\n`;
}

function removeLine(key) {
  return buildValidEnvFile()
    .split("\n")
    .filter((line) => !line.startsWith(`${key}=`))
    .join("\n");
}

function replaceLine(key, value) {
  return buildValidEnvFile()
    .split("\n")
    .map((line) => (line.startsWith(`${key}=`) ? `${key}=${value}` : line))
    .join("\n");
}

function secretBearingReferenceEnv() {
  const value = [
    `url:https://staging.o-okul.com/evidence/ui-ux-redesign/summary.json?token=${secretLeakMarker}`,
    "run:https://github.com/4rmus/uzman-hocam/actions/runs/987654321",
    "url:https://staging.o-okul.com/evidence/ui-ux-redesign/uat.json",
  ].join(",");
  return replaceLine("UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES", value);
}

function assertNoSecretLeak(result, label) {
  const output = combinedOutput(result);
  if (output.includes(secretLeakMarker)) {
    failContract(`${label} senaryosu secret değerini yazdırmamalı.`, result);
  }
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function failContract(message, result) {
  console.error("UI/UX redesign generator contract kontrolü başarısız:");
  console.error(`- ${message}`);
  if (result) console.error(combinedOutput(result));
  process.exit(1);
}
