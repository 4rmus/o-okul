import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const artifactsTarget =
  readOption("--artifacts-dir") ?? process.env.STAGING_RELEASE_ARTIFACTS_TARGET ?? "artifacts/staging";
const gapReportFile =
  readOption("--gap-report-file") ?? process.env.STAGING_RELEASE_GAP_REPORT_FILE ?? "artifacts/local/staging-release-gap-report.json";

const startedAt = new Date();
const result = spawnSync(
  process.execPath,
  ["scripts/check-staging-release-artifacts.mjs", "--artifacts-dir", artifactsTarget, "--gap-report-file", gapReportFile],
  {
    encoding: "utf8",
    env: process.env,
  },
);

if (result.status === 0) {
  console.log(`Staging release artifact bundle PASS: ${artifactsTarget}`);
  process.exit(0);
}

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
if (!existsSync(resolve(gapReportFile))) {
  console.error(output.trim());
  console.error(`Staging release gap özeti üretilemedi; gap raporu yok: ${gapReportFile}`);
  process.exit(result.status ?? 1);
}
if (!output.includes("Staging release gap raporu yazıldı:")) {
  console.error(output.trim());
  console.error(`Staging release gap özeti taze gap raporu yazım onayı alamadı: ${gapReportFile}`);
  process.exit(result.status ?? 1);
}

const report = readGapReport(gapReportFile);
validateFreshGapReport(report, startedAt, gapReportFile);
printSummary(report, gapReportFile);
process.exit(result.status ?? 1);

function printSummary(report, reportFile) {
  console.log("Staging release artifact gap özeti");
  console.log(`- result: ${report.result}`);
  console.log(`- overallStatus: ${report.overallStatus}`);
  console.log(`- artifactsTarget: ${report.artifactsTarget ?? artifactsTarget}`);
  console.log(`- gapReportFile: ${formatPath(reportFile)}`);
  console.log(`- foundReleaseSummaryCount: ${report.foundReleaseSummaryCount}`);
  console.log(`- missingRequiredFiles: ${report.missingRequiredFiles?.length ?? 0}`);
  console.log(`- unexpectedFiles: ${report.unexpectedFiles?.length ?? 0}`);
  console.log(`- invalidFiles: ${report.invalidFiles?.length ?? 0}`);
  console.log(`- mismatchFailures: ${report.mismatchFailures?.length ?? 0}`);
  console.log(`- blockedChecks: ${report.blockedChecks?.length ?? 0}`);
  console.log(`- openClosureItems: ${report.openClosureItemCount ?? report.openClosureItems?.length ?? 0}`);

  for (const item of report.missingRequiredFiles ?? []) {
    console.log("");
    console.log(`* ${item.path}`);
    console.log(`  command: ${item.remediation?.command ?? "n/a"}`);
    console.log(`  ownerAgent: ${item.remediation?.ownerAgent ?? "n/a"}`);
    console.log(`  phase: ${item.remediation?.phase ?? "n/a"}`);
    console.log(`  evidenceGate: ${item.remediation?.evidenceGate ?? "n/a"}`);
    console.log(`  nextActionKind: ${item.remediation?.nextActionKind ?? "n/a"}`);
    console.log(`  prerequisite: ${item.remediation?.prerequisite ?? "n/a"}`);
    console.log(`  blocker: ${item.remediation?.blocker ?? item.reason ?? "n/a"}`);
  }

  const summaryBlocker = (report.blockedChecks ?? []).find(
    (item) => item.path === "release-summary-*.json" || item.kind === "release_summary",
  );
  if (summaryBlocker) {
    console.log("");
    console.log("* release-summary-*.json");
    console.log(`  command: ${summaryBlocker.remediation?.command ?? "n/a"}`);
    console.log(`  ownerAgent: ${summaryBlocker.remediation?.ownerAgent ?? "n/a"}`);
    console.log(`  phase: ${summaryBlocker.remediation?.phase ?? "n/a"}`);
    console.log(`  evidenceGate: ${summaryBlocker.remediation?.evidenceGate ?? "n/a"}`);
    console.log(`  nextActionKind: ${summaryBlocker.remediation?.nextActionKind ?? "n/a"}`);
    console.log(`  prerequisite: ${summaryBlocker.remediation?.prerequisite ?? "n/a"}`);
    console.log(`  blocker: ${summaryBlocker.remediation?.blocker ?? summaryBlocker.message}`);
  }

  if ((report.openClosureItems?.length ?? 0) > 0) {
    console.log("");
    console.log("Açık kapanış kalemleri");
    for (const item of report.openClosureItems) {
      console.log(`* ${item.path}`);
      console.log(`  ownerAgent: ${item.remediation?.ownerAgent ?? "n/a"}`);
      console.log(`  evidenceGate: ${item.remediation?.evidenceGate ?? item.requiredArtifact?.check ?? item.requiredArtifact?.script ?? "n/a"}`);
      console.log(`  reason: ${item.reason ?? "n/a"}`);
    }
  }

  if ((report.unexpectedFiles?.length ?? 0) > 0) {
    console.log("");
    console.log("Beklenmeyen bundle girdileri");
    for (const item of report.unexpectedFiles) {
      console.log(`* ${item.path}`);
      console.log(`  reason: ${item.reason ?? "bundle contains an unexpected artifact"}`);
    }
  }

  if ((report.invalidFiles?.length ?? 0) > 0 || (report.mismatchFailures?.length ?? 0) > 0) {
    console.log("");
    console.log("Geçersiz veya uyuşmayan artifact girdileri");
    for (const item of [...(report.invalidFiles ?? []), ...(report.mismatchFailures ?? [])]) {
      console.log(`* ${item.path ?? item.kind ?? "artifact"}`);
      console.log(`  reason: ${item.reason ?? item.message}`);
    }
  }
}

function readGapReport(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`Staging release gap raporu okunamadi: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function validateFreshGapReport(report, startedAtDate, path) {
  const generatedAt = new Date(report?.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) {
    console.error(`Staging release gap raporu generatedAt geçerli tarih değil: ${path}`);
    process.exit(1);
  }
  if (generatedAt < startedAtDate) {
    console.error(`Staging release gap raporu bu komut koşusundan eski: ${path}`);
    process.exit(1);
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${name} için değer gerekli.`);
    process.exit(1);
  }
  return value;
}

function formatPath(path) {
  const absolutePath = resolve(path);
  const relativePath = absolutePath.startsWith(resolve(".") + "/")
    ? absolutePath.slice(resolve(".").length + 1)
    : absolutePath;
  return relativePath || dirname(absolutePath);
}
