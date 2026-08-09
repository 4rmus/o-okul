import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  almanacFoundationRequiredFiles,
  almanacFoundationSourceFiles,
  almanacFoundationSourceRoots,
  assertAlmanacFoundationSourceContract,
  almanacFoundationSourceDigest,
  almanacFoundationSourceDirty,
} from "./almanac-foundation-digest.mjs";

const path = "docs/measurement-baselines/gate-b-local-synthetic.json";
const artifact = JSON.parse(readFileSync(path, "utf8"));
const failures = [];
const expectedTasks = ["optical_workbench_ready", "report_workspace_ready", "student_portal_ready"];
const metrics = ["durationMs", "fcpMs", "lcpMs", "cls", "ttfbMs"];

for (const requiredFile of almanacFoundationRequiredFiles) {
  let rejected = false;
  try {
    assertAlmanacFoundationSourceContract(almanacFoundationSourceFiles.filter((file) => file !== requiredFile));
  } catch {
    rejected = true;
  }
  if (!rejected) failures.push("required source input çıkarımı reddedilmedi: " + requiredFile);
}
for (const requiredRoot of almanacFoundationSourceRoots) {
  let rejected = false;
  try {
    assertAlmanacFoundationSourceContract(
      almanacFoundationSourceFiles,
      almanacFoundationSourceRoots.filter((root) => root !== requiredRoot),
    );
  } catch {
    rejected = true;
  }
  if (!rejected) failures.push("required dirty source root çıkarımı reddedilmedi: " + requiredRoot);
}

const playwrightConfigSource = readFileSync("apps/web/playwright.next.config.ts", "utf8");
const runtimeConfigFailures = validateMeasurementRuntimeConfig(playwrightConfigSource);
failures.push(...runtimeConfigFailures);
for (const invalidConfigSource of [
  playwrightConfigSource.replace("rm -rf .next && pnpm next:build", "if [ ! -f .next/BUILD_ID ]; then pnpm next:build; fi"),
  playwrightConfigSource.replace("measurementMode ? false", "measurementMode ? true"),
  playwrightConfigSource.replace('measurementMode ? `http://localhost:${port}`', 'measurementMode ? "http://localhost:3001"'),
]) {
  if (validateMeasurementRuntimeConfig(invalidConfigSource).length === 0) {
    failures.push("unsafe measurement runtime config negative fixture kabul edildi");
  }
}

if (artifact.schemaVersion !== 2) failures.push("schemaVersion 2 olmalı");
if (artifact.result !== "BASELINE_RECORDED") failures.push("result BASELINE_RECORDED olmalı");
if (artifact.evidenceLevel !== "LOCAL_SYNTHETIC") failures.push("evidenceLevel LOCAL_SYNTHETIC olmalı");
if (artifact.externalStatus !== "EXTERNAL_NOT_RUN") failures.push("externalStatus EXTERNAL_NOT_RUN olmalı");
const currentBaseCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
if (artifact.baseCommitSha !== currentBaseCommitSha) failures.push("baseCommitSha güncel HEAD ile eşleşmiyor");
if (artifact.sourceWorktreeDirty !== almanacFoundationSourceDirty()) failures.push("sourceWorktreeDirty güncel kaynak durumuyla eşleşmiyor");
if (artifact.sourceTreeSha256 !== almanacFoundationSourceDigest()) failures.push("sourceTreeSha256 güncel kaynakla eşleşmiyor");
if (Number.isNaN(Date.parse(artifact.generatedAt))) failures.push("generatedAt geçersiz");
const measurementRun = artifact.measurementRun ?? {};
if (!runIdPattern.test(measurementRun.runId ?? "")) failures.push("measurementRun.runId geçersiz");
if (
  Number.isNaN(Date.parse(measurementRun.startedAt))
  || Number.isNaN(Date.parse(measurementRun.completedAt))
  || Date.parse(measurementRun.startedAt) > Date.parse(measurementRun.completedAt)
  || measurementRun.completedAt !== artifact.generatedAt
) {
  failures.push("measurementRun zaman aralığı geçersiz");
}

const environment = artifact.environment ?? {};
if (
  environment.browser !== "chromium"
  || typeof environment.browserVersion !== "string"
  || environment.browserVersion === "unknown"
  || environment.mockedApi !== true
  || environment.nextBuild !== "FRESH"
  || typeof environment.nodeVersion !== "string"
  || !/^v\d+\./.test(environment.nodeVersion)
  || !["arm64", "x64"].includes(environment.osArch)
  || environment.retries !== 0
  || environment.sampleCount !== 5
  || environment.serverPort !== 43119
  || environment.serverReuse !== false
  || environment.workers !== 1
  || environment.viewport?.width !== 1440
  || environment.viewport?.height !== 900
) {
  failures.push("measurement environment sözleşmesi geçersiz");
}

const tasks = Array.isArray(artifact.tasks) ? artifact.tasks : [];
if (JSON.stringify(tasks.map((task) => task.taskId).sort()) !== JSON.stringify(expectedTasks)) {
  failures.push("zorunlu task seti eksik veya fazla");
}
for (const task of tasks) {
  if (task.mockedApi !== true || task.errorCount !== 0 || !Array.isArray(task.samples) || task.samples.length !== 5) {
    failures.push(task.taskId + ": sample/error sözleşmesi geçersiz");
    continue;
  }
  for (const sample of task.samples) {
    for (const metric of metrics) {
      if (typeof sample[metric] !== "number" || !Number.isFinite(sample[metric]) || sample[metric] < 0) {
        failures.push(task.taskId + ": " + metric + " sample geçersiz");
      }
    }
    if (!(sample.durationMs > 0)) failures.push(task.taskId + ": durationMs pozitif olmalı");
  }
  for (const metric of metrics) {
    const values = task.samples.map((sample) => sample[metric]).sort((left, right) => left - right);
    const expectedP50 = round(percentile(values, 0.5));
    const expectedP95 = round(percentile(values, 0.95));
    if (task.summary?.[metric]?.p50 !== expectedP50 || task.summary?.[metric]?.p95 !== expectedP95) {
      failures.push(task.taskId + ": " + metric + " percentile yeniden hesaplanamıyor");
    }
  }
  for (const impact of ["critical", "serious", "moderate", "minor"]) {
    if (!Number.isInteger(task.axeImpacts?.[impact]) || task.axeImpacts[impact] < 0) {
      failures.push(task.taskId + ": axe " + impact + " geçersiz");
    }
  }
}

if (JSON.stringify(artifact).match(/example|placeholder|staging|production/i)) {
  failures.push("baseline placeholder veya dış ortam iddiası içeriyor");
}

if (failures.length > 0) {
  console.error("Gate B measurement baseline kontrolü başarısız:");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}
console.log("Gate B measurement baseline kontrolü geçti: 3 görev, görev başına 5 örnek.");

function percentile(values, ratio) {
  return values[Math.max(0, Math.ceil(values.length * ratio) - 1)];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function validateMeasurementRuntimeConfig(source) {
  const output = [];
  if (!source.includes('const port = measurementMode ? "43119"')) output.push("measurement dedicated port eksik");
  if (!source.includes('measurementMode ? `http://localhost:${port}`')) output.push("measurement local baseURL zorlaması eksik");
  if (!source.includes("useWebServer = measurementMode ||")) output.push("measurement web server zorlaması eksik");
  if (!source.includes("rm -rf .next && pnpm next:build")) output.push("measurement temiz Next build zorlaması eksik");
  if (!source.includes("reuseExistingServer: measurementMode ? false")) output.push("measurement server reuse kapatılmamış");
  return output;
}
