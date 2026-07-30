import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { createPinnedLookup } from "./pinned-https-fetch.mjs";

const root = resolve("..", ".o-okul-ui-ux-redesign-generator-contract");
const artifactRoot = resolve("artifacts", "ui-ux-redesign", "generator-contract");
const envPath = join(root, "staging-evidence.env");
const outputPath = join(root, "reports", "ui-ux-redesign.json");
const githubCiPath = join(artifactRoot, "github-ci.json");
const secretLeakMarker = "uiUxSecretTokenThatMustNotLeak123456";

rmSync(root, { recursive: true, force: true });
rmSync(artifactRoot, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
createEvidenceArtifacts();
createGithubCiEvidence(githubCiPath, "1".repeat(40));
writeFileSync(envPath, buildValidEnvFile());

try {
  expectPinnedLookupContract();
  expectGeneratePass();
  expectMalformedPngFailure();
  expectCheckerFailure("invalid source commit", (report) => {
    report.sourceCommitSha = "not-a-commit";
  }, ["sourceCommitSha 40 karakter hex commit SHA olmalı."]);
  expectCheckerFailure("mutable release candidate", (report) => {
    report.releaseCandidate = "ghcr.io/4rmus/o-okul/api:staging-latest";
  }, ["releaseCandidate tag'i sourceCommitSha ile birebir eşleşmeli."]);
  expectCheckerFailure("github sha mismatch", (report) => {
    report.githubCi.commitSha = "2".repeat(40);
  }, ["githubCi.commitSha sourceCommitSha ile eşleşmeli."]);
  expectCheckerFailure("self expanded host allowlist", (report) => {
    report.allowedEvidenceHosts = ["attacker-controlled.example.net"];
  }, ["allowedEvidenceHosts güvenilir UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS ile birebir eşleşmeli."]);
  expectCheckerFailure("artifact digest mismatch", (report) => {
    report.artifacts[0].sha256 = "f".repeat(64);
  }, ["Artifact sha256 uyuşmuyor"]);
  expectCheckerFailure("viewport width mismatch", (report) => {
    const viewportArtifact = report.artifacts.find((artifact) => artifact.viewportWidth === 320);
    viewportArtifact.imageWidth = 375;
  }, ["imageWidth 320 olmalı."]);
  expectArtifactPiiFailure();
  expectRemoteReferenceFailure();
  expectProcessEnvOverride();
  expectFailure("missing phase references", removeLine("UI_UX_REDESIGN_PHASE_3_REFERENCES"), [
    "UI_UX_REDESIGN_PHASE_3_REFERENCES boş bırakılamaz.",
  ]);
  expectFailure("placeholder release candidate", replaceLine("UI_UX_REDESIGN_RELEASE_CANDIDATE", "ghcr.io/__SET_OWNER__/api:tag"), [
    "UI_UX_REDESIGN_RELEASE_CANDIDATE placeholder/redacted/example değer içermemeli.",
  ]);
  expectFailure("invalid source commit", replaceLine("UI_UX_REDESIGN_SOURCE_COMMIT_SHA", "not-a-commit"), [
    "UI_UX_REDESIGN_SOURCE_COMMIT_SHA 40 karakter hex commit SHA olmalı.",
  ]);
  expectFailure("mismatched release candidate", replaceLine("UI_UX_REDESIGN_RELEASE_CANDIDATE", `ghcr.io/4rmus/o-okul/api:${"2".repeat(40)}`), [
    "UI_UX_REDESIGN_RELEASE_CANDIDATE tag'i UI_UX_REDESIGN_SOURCE_COMMIT_SHA ile birebir eşleşmeli.",
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
  rmSync(artifactRoot, { recursive: true, force: true });
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
  if (report.schemaVersion !== 2 || report.artifacts?.length === 0) failContract("generator digest bağlı schema v2 artifact manifesti üretmeli.", result);
  if (report.githubCi?.commitSha !== "1".repeat(40)) failContract("generator exact GitHub CI SHA bağını üretmeli.", result);
  if (report.privacy?.rawPiiInArtifacts !== false) failContract("generator raw PII bayrağını false yazmalı.", result);
  if (report.openRisks?.length !== 0) failContract("generator açık risk bırakmamalı.", result);

  const checkResult = spawnSync(process.execPath, ["scripts/check-ui-ux-redesign-evidence.mjs", pathToFileURL(outputPath).href], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (checkResult.status !== 0) failContract("üretilen kanıt checker'dan geçmeli.", checkResult);
}

function expectPinnedLookupContract() {
  const pinnedAddress = { address: "203.0.113.10", family: 4 };
  const lookup = createPinnedLookup(pinnedAddress);
  lookup("evidence.invalid", { all: true }, (error, addresses) => {
    if (error || !Array.isArray(addresses) || addresses.length !== 1 || addresses[0].address !== pinnedAddress.address) {
      failContract("pinned HTTPS lookup options.all=true için adres listesi döndürmeli.");
    }
  });
  lookup("evidence.invalid", { all: false }, (error, address, family) => {
    if (error || address !== pinnedAddress.address || family !== pinnedAddress.family) {
      failContract("pinned HTTPS lookup tek-adres callback sözleşmesini korumalı.");
    }
  });
}

function expectMalformedPngFailure() {
  const artifactPath = join(artifactRoot, "dashboard-320.png");
  const original = readFileSync(artifactPath);
  try {
    writeFileSync(artifactPath, original.subarray(0, 24));
    const result = runGenerator(envPath, join(root, "reports", "malformed-png.json"));
    if (result.status === 0) failContract("eksik PNG artifact generator senaryosunu kırmalı.", result);
    assertMessages(result, "malformed PNG", ["PNG kanıtı geçersiz"]);
  } finally {
    writeFileSync(artifactPath, original);
  }
}

function expectProcessEnvOverride() {
  const overrideOutputPath = join(root, "reports", "ui-ux-redesign-process-override.json");
  const sourceCommitSha = "2".repeat(40);
  const releaseCandidate = `ghcr.io/4rmus/o-okul/api:${sourceCommitSha}`;
  const overrideGithubCiPath = join(artifactRoot, "github-ci-override.json");
  createGithubCiEvidence(overrideGithubCiPath, sourceCommitSha);
  const result = runGenerator(envPath, overrideOutputPath, {
    GITHUB_CI_EVIDENCE_TARGET: pathToFileURL(overrideGithubCiPath).href,
    UI_UX_REDESIGN_RELEASE_CANDIDATE: releaseCandidate,
    UI_UX_REDESIGN_SOURCE_COMMIT_SHA: sourceCommitSha,
  });
  if (result.status !== 0) failContract("process env release candidate env-file değerini ezebilmeli.", result);
  const report = JSON.parse(readFileSync(overrideOutputPath, "utf8"));
  if (report.releaseCandidate !== releaseCandidate) {
    failContract("generator güncel workflow release candidate değerini kullanmalı.", result);
  }
  if (report.sourceCommitSha !== sourceCommitSha) {
    failContract("generator güncel workflow source commit SHA değerini kullanmalı.", result);
  }
}

function expectCheckerFailure(label, mutateReport, expectedMessages) {
  const report = JSON.parse(readFileSync(outputPath, "utf8"));
  mutateReport(report);
  const failingOutputPath = join(root, "reports", `${label.replaceAll(" ", "-")}-checker.json`);
  writeFileSync(failingOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  const result = spawnSync(process.execPath, ["scripts/check-ui-ux-redesign-evidence.mjs", pathToFileURL(failingOutputPath).href], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status === 0) failContract(`${label} checker senaryosu kırılmalı.`, result);
  assertMessages(result, label, expectedMessages);
}

function expectRemoteReferenceFailure() {
  const report = JSON.parse(readFileSync(outputPath, "utf8"));
  report.stagingProductionEvidence.evidenceReferences[0] = "url:https://127.0.0.1:1/unreachable.json";
  const failingOutputPath = join(root, "reports", "unreachable-remote-reference.json");
  writeFileSync(failingOutputPath, `${JSON.stringify(report, null, 2)}\n`);
  const result = spawnSync(process.execPath, ["scripts/check-ui-ux-redesign-evidence.mjs", pathToFileURL(failingOutputPath).href], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, UI_UX_REDESIGN_VERIFY_REMOTE_REFERENCES: "1" },
  });
  if (result.status === 0) failContract("erişilemeyen uzak kanıt referansı checker senaryosunu kırmalı.", result);
  assertMessages(result, "unreachable remote reference", ["güvenli public HTTPS referansı olmalı"]);
}

function expectArtifactPiiFailure() {
  const artifactPath = join(artifactRoot, "summary.json");
  const original = readFileSync(artifactPath);
  try {
    writeFileSync(artifactPath, `${JSON.stringify({ result: "PASS", studentEmail: "ada.kaya@school.invalid" })}\n`);
    const result = spawnSync(process.execPath, ["scripts/check-ui-ux-redesign-evidence.mjs", pathToFileURL(outputPath).href], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    if (result.status === 0) failContract("artifact PII checker senaryosu kırılmalı.", result);
    assertMessages(result, "artifact PII", ["Artifact yasak PII alanı içeriyor"]);
  } finally {
    writeFileSync(artifactPath, original);
  }
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

function runGenerator(inputEnvPath, output, env = {}) {
  return spawnSync(
    process.execPath,
    ["scripts/generate-ui-ux-redesign-evidence.mjs", "--env-file", inputEnvPath, "--output", output],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, ...env },
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
  const artifact = (name) => `artifact:${relativeArtifactPath(name)}`;
  const viewportReferences = (surface) => [320, 375, 414, 768, 1024, 1440]
    .map((width) => artifact(`${surface}-${width}.png`))
    .join(",");
  const lines = [
    "STAGING_ENVIRONMENT=staging",
    "UI_UX_REDESIGN_CHECKED_AT=2026-06-25T12:00:00.000Z",
    `UI_UX_REDESIGN_RELEASE_CANDIDATE=ghcr.io/4rmus/o-okul/api:${"1".repeat(40)}`,
    `UI_UX_REDESIGN_SOURCE_COMMIT_SHA=${"1".repeat(40)}`,
    `GITHUB_CI_EVIDENCE_TARGET=${pathToFileURL(githubCiPath).href}`,
    `UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES=${artifact("summary.json")},run:https://github.com/4rmus/o-okul/actions/runs/987654321,${artifact("uat.json")}`,
    `UI_UX_REDESIGN_PHASE_0_REFERENCES=${artifact("phase-0.json")}`,
    `UI_UX_REDESIGN_PHASE_1_REFERENCES=${artifact("phase-1.json")}`,
    `UI_UX_REDESIGN_PHASE_2_REFERENCES=${artifact("phase-2.json")}`,
    `UI_UX_REDESIGN_PHASE_3_REFERENCES=${artifact("phase-3.json")}`,
    `UI_UX_REDESIGN_PHASE_4_REFERENCES=${artifact("phase-4.json")}`,
    `UI_UX_REDESIGN_PHASE_5_REFERENCES=${artifact("phase-5.json")}`,
    `UI_UX_REDESIGN_KURUM_DASHBOARD_REFERENCES=${viewportReferences("dashboard")}`,
    `UI_UX_REDESIGN_OPTIK_WORKSPACE_REFERENCES=${viewportReferences("optik")}`,
    `UI_UX_REDESIGN_RAPOR_WORKSPACE_REFERENCES=${viewportReferences("rapor")}`,
    `UI_UX_REDESIGN_PORTAL_SHELL_REFERENCES=${viewportReferences("portal")}`,
    "UI_UX_REDESIGN_PII_REVIEW=PASS",
    "UI_UX_REDESIGN_RAW_PII_IN_ARTIFACTS=false",
    "UI_UX_REDESIGN_SMS_RECIPIENT_PREVIEW_EXPORTED=false",
    "UI_UX_REDESIGN_GUARDIAN_FINANCE_LEAKAGE_CHECKED=true",
    "UI_UX_REDESIGN_APPROVAL_ROLE=release-owner",
    "UI_UX_REDESIGN_APPROVED_AT=2026-06-25T12:30:00.000Z",
  ];
  return `${lines.join("\n")}\n`;
}

function createEvidenceArtifacts() {
  mkdirSync(artifactRoot, { recursive: true });
  for (const name of ["summary", "uat", "phase-0", "phase-1", "phase-2", "phase-3", "phase-4", "phase-5"]) {
    writeFileSync(
      join(artifactRoot, `${name}.json`),
      `${JSON.stringify({ result: "PASS", sourceCommitSha: "1".repeat(40), checkedAt: "2026-06-25T12:00:00.000Z" })}\n`,
    );
  }
  for (const surface of ["dashboard", "optik", "rapor", "portal"]) {
    for (const width of [320, 375, 414, 768, 1024, 1440]) {
      writeFileSync(join(artifactRoot, `${surface}-${width}.png`), minimalPng(width, 900));
    }
  }
}

function minimalPng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanline = Buffer.alloc(width * 4 + 1);
  const pixels = Buffer.alloc(scanline.byteLength * height);
  for (let row = 0; row < height; row += 1) scanline.copy(pixels, row * scanline.byteLength);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.byteLength + 12);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.byteLength + 8);
  return chunk;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createGithubCiEvidence(filePath, commitSha) {
  const report = {
    result: "PASS",
    environment: "github-actions",
    checkedAt: "2026-06-25T12:00:00.000Z",
    repository: "4rmus/o-okul",
    commitSha,
    branch: "main",
    workflow: {
      name: "CI",
      path: ".github/workflows/ci.yml",
      runId: "987654321",
      runAttempt: 1,
      runUrl: "https://github.com/4rmus/o-okul/actions/runs/987654321",
      conclusion: "success",
      event: "push",
      startedAt: "2026-06-25T11:00:00.000Z",
      completedAt: "2026-06-25T12:00:00.000Z",
    },
    command: {
      workflowUsesSingleCiCommand: true,
      command: "pnpm run ci",
      localCiParity: true,
    },
    jobs: [
      {
        name: "ci",
        conclusion: "success",
        startedAt: "2026-06-25T11:00:00.000Z",
        completedAt: "2026-06-25T12:00:00.000Z",
        logUrl: "https://github.com/4rmus/o-okul/actions/runs/987654321/job/123456789",
        stepsPassed: ["pnpm install --frozen-lockfile", "pnpm run ci"],
      },
    ],
    commandsPassed: ["pnpm run ci", "pnpm github-ci:check"],
    evidenceReferences: [
      "https://github.com/4rmus/o-okul/actions/runs/987654321",
      relative(process.cwd(), filePath).replaceAll("\\", "/"),
    ],
    gaps: [],
  };
  writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

function relativeArtifactPath(name) {
  return relative(process.cwd(), join(artifactRoot, name)).replaceAll("\\", "/");
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
    "run:https://github.com/4rmus/o-okul/actions/runs/987654321",
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
