import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  almanacFoundationSourceDigest,
  almanacFoundationSourceDirty,
} from "./almanac-foundation-digest.mjs";

const output = "docs/measurement-baselines/gate-b-local-synthetic.json";
const partsRoot = "artifacts/almanac-foundation/measurement-parts";
const taskIds = ["optical_workbench_ready", "report_workspace_ready", "student_portal_ready"];
const expectedPartFiles = [".run.json", ...taskIds.map((taskId) => taskId + ".json")].sort();
if (JSON.stringify(readdirSync(partsRoot).sort()) !== JSON.stringify(expectedPartFiles)) {
  throw new Error("ALMANAC_MEASUREMENT_PART_SET_INVALID");
}
const measurementRun = JSON.parse(readFileSync(partsRoot + "/.run.json", "utf8"));
const tasks = taskIds.map((taskId) => JSON.parse(readFileSync(partsRoot + "/" + taskId + ".json", "utf8")));
const currentBaseCommitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const currentSourceTreeSha256 = almanacFoundationSourceDigest();
const runIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

if (
  measurementRun.schemaVersion !== 1
  || !runIdPattern.test(measurementRun.runId ?? "")
  || Number.isNaN(Date.parse(measurementRun.startedAt))
  || measurementRun.baseCommitSha !== currentBaseCommitSha
  || measurementRun.sourceTreeSha256 !== currentSourceTreeSha256
) {
  throw new Error("ALMANAC_MEASUREMENT_RUN_STALE");
}

for (const task of tasks) {
  const measuredAt = Date.parse(task.measuredAt);
  if (
    task.samples?.length !== 5
    || task.errorCount !== 0
    || task.mockedApi !== true
    || task.serverPort !== 43119
    || task.runId !== measurementRun.runId
    || !Number.isFinite(measuredAt)
    || measuredAt < Date.parse(measurementRun.startedAt)
    || measuredAt > Date.now()
  ) {
    throw new Error("ALMANAC_MEASUREMENT_PART_INVALID:" + task.taskId);
  }
}

const completedAt = new Date().toISOString();
const artifact = {
  schemaVersion: 2,
  result: "BASELINE_RECORDED",
  evidenceLevel: "LOCAL_SYNTHETIC",
  externalStatus: "EXTERNAL_NOT_RUN",
  generatedAt: completedAt,
  baseCommitSha: currentBaseCommitSha,
  sourceWorktreeDirty: almanacFoundationSourceDirty(),
  sourceTreeSha256: currentSourceTreeSha256,
  measurementRun: {
    runId: measurementRun.runId,
    startedAt: measurementRun.startedAt,
    completedAt,
  },
  environment: {
    browser: "chromium",
    browserVersion: tasks[0].browserVersion,
    mockedApi: true,
    nextBuild: "FRESH",
    nodeVersion: process.version,
    os: tasks[0].os,
    osArch: process.arch,
    retries: 0,
    sampleCount: 5,
    serverPort: 43119,
    serverReuse: false,
    viewport: tasks[0].viewport,
    workers: 1,
  },
  tasks: tasks.map((task) => ({
    axeImpacts: task.axeImpacts,
    errorCount: task.errorCount,
    mockedApi: task.mockedApi,
    routeTemplate: task.routeTemplate,
    samples: task.samples.map(roundSample),
    summary: summarize(task.samples),
    taskId: task.taskId,
  })),
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(artifact, null, 2) + "\n");
console.log("Gate B local synthetic baseline yazıldı: " + output);

function summarize(samples) {
  return Object.fromEntries(["durationMs", "fcpMs", "lcpMs", "cls", "ttfbMs"].map((metric) => {
    const values = samples.map((sample) => sample[metric]).sort((left, right) => left - right);
    return [metric, {
      p50: round(percentile(values, 0.5)),
      p95: round(percentile(values, 0.95)),
    }];
  }));
}

function percentile(values, ratio) {
  return values[Math.max(0, Math.ceil(values.length * ratio) - 1)];
}

function roundSample(sample) {
  return Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, round(value)]));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
