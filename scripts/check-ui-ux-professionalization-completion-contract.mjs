import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const source = JSON.parse(readFileSync("docs/ui-ux-professionalization-completion.json", "utf8"));
const tempDir = mkdtempSync(join(tmpdir(), "ui-ux-completion-contract-"));
const artifactDir = resolve("artifacts/ui-ux-completion-contract");

try {
  expectFailure("missing requirement evidence", (ledger) => {
    delete ledger.slices[0].requirementEvidence[ledger.slices[0].requirements[0]];
  }, "requirementEvidence anahtarları requirements ile birebir eşleşmeli");
  expectFailure("missing evidence file", (ledger) => {
    ledger.slices[0].requirementEvidence[ledger.slices[0].requirements[0]].paths = ["missing-evidence.ts"];
  }, "kanıt dosyası bulunamadı");
  expectFailure("command outside slice", (ledger) => {
    ledger.slices[0].requirementEvidence[ledger.slices[0].requirements[0]].commands = ["pnpm test"];
  }, "komutu verificationCommands içinde değil");
  expectFailure("non proven local status", (ledger) => {
    ledger.slices[0].localStatus = "IN_PROGRESS";
  }, "localStatus tamamlanma ledger'ında PROVEN olmalı");

  mkdirSync(artifactDir, { recursive: true });
  const report = JSON.parse(readFileSync("docs/evidence-templates/github-ci.example.json", "utf8"));
  report.repository = "4rmus/o-okul";
  report.workflow.runUrl = `https://github.com/4rmus/o-okul/actions/runs/${report.workflow.runId}`;
  report.jobs[0].logUrl = `${report.workflow.runUrl}/job/9876543210`;
  report.evidenceReferences = [report.workflow.runUrl, "artifacts/staging/reports/github-ci.json"];
  const artifactPath = join(artifactDir, "github-ci.json");
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  const target = pathToFileURL(artifactPath).href;
  expectSuccess([], {
    GITHUB_CI_EVIDENCE_TARGET: target,
    UI_UX_PROFESSIONALIZATION_SOURCE_SHA: "1111111111111111111111111111111111111111",
  });
  expectFailureRun([], {
    GITHUB_CI_EVIDENCE_TARGET: target,
    UI_UX_PROFESSIONALIZATION_SOURCE_SHA: "2222222222222222222222222222222222222222",
  }, "commitSha ile UI_UX_PROFESSIONALIZATION_SOURCE_SHA eşleşmeli");
  expectFailureRun([], {
    GITHUB_CI_ALLOW_EXAMPLE_EVIDENCE: "1",
    GITHUB_CI_EVIDENCE_TARGET: target,
    UI_UX_PROFESSIONALIZATION_SOURCE_SHA: "1111111111111111111111111111111111111111",
  }, "gerçek tamamlanma kanıtında kullanılamaz");

  const liveLedger = structuredClone(source);
  liveLedger.slices[1].liveStatus = "PROVEN";
  const liveLedgerPath = join(tempDir, "live-proven.json");
  writeFileSync(liveLedgerPath, `${JSON.stringify(liveLedger, null, 2)}\n`);
  const liveArgs = ["--ledger", liveLedgerPath];
  const proofEnv = {
    GITHUB_CI_EVIDENCE_TARGET: target,
    UI_UX_PROFESSIONALIZATION_SOURCE_SHA: "1111111111111111111111111111111111111111",
  };
  expectSuccess(["--local-proof-only", ...liveArgs], proofEnv);
  expectFailureRun(liveArgs, proofEnv, "yalnız tam staging evidence zinciri sonrasında");
  expectFailureRun(liveArgs, {
    ...proofEnv,
    UI_UX_PROFESSIONALIZATION_FULL_EVIDENCE: "1",
  }, "UI_UX_REDESIGN_EVIDENCE_TARGET zorunlu");

  const liveReport = JSON.parse(readFileSync("docs/evidence-templates/ui-ux-redesign.example.json", "utf8"));
  liveReport.sourceCommitSha = "2222222222222222222222222222222222222222";
  liveReport.releaseCandidate = "ghcr.io/4rmus/o-okul/api:2222222222222222222222222222222222222222";
  replaceArtifactReferences(liveReport);
  const liveArtifactPath = join(artifactDir, "ui-ux-redesign.json");
  writeFileSync(liveArtifactPath, `${JSON.stringify(liveReport, null, 2)}\n`);
  expectFailureRun(liveArgs, {
    ...proofEnv,
    UI_UX_PROFESSIONALIZATION_FULL_EVIDENCE: "1",
    UI_UX_REDESIGN_EVIDENCE_TARGET: pathToFileURL(liveArtifactPath).href,
  }, "sourceCommitSha ile beklenen kaynak SHA eşleşmeli");
} finally {
  rmSync(tempDir, { force: true, recursive: true });
  rmSync(artifactDir, { force: true, recursive: true });
}

console.log("UI/UX tamamlanma kanıt sözleşmesi negatif ve SHA binding senaryolarıyla doğrulandı.");

function expectFailure(label, mutate, expected) {
  const ledger = structuredClone(source);
  mutate(ledger);
  const path = join(tempDir, `${label.replaceAll(" ", "-")}.json`);
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
  expectFailureRun(["--contract-only", "--ledger", path], {}, expected);
}

function expectSuccess(args, extraEnv) {
  const result = run(args, extraEnv);
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Beklenen PASS alınamadı.");
}

function expectFailureRun(args, extraEnv, expected) {
  const result = run(args, extraEnv);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0 || !output.includes(expected)) {
    throw new Error(`Beklenen hata alınamadı: ${expected}\n${output}`);
  }
}

function run(args, extraEnv) {
  return spawnSync(process.execPath, ["scripts/check-ui-ux-professionalization-completion.mjs", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
}

function replaceArtifactReferences(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "evidenceReferences" && Array.isArray(child)) {
      value[key] = child.map((_, index) => `run:https://github.com/4rmus/o-okul/actions/runs/${123456789 + index}`);
      continue;
    }
    replaceArtifactReferences(child);
  }
}
