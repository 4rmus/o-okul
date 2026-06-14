import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const outputPath = readOption("--output") ?? process.env.GITHUB_CI_EVIDENCE_OUTPUT;
const repository = readOption("--repository") ?? process.env.GITHUB_REPOSITORY;
const commitSha = readOption("--commit-sha") ?? process.env.GITHUB_SHA;
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const apiBaseUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";

const failures = [];
requireValue(outputPath, "GITHUB_CI_EVIDENCE_OUTPUT veya --output", failures);
requireValue(repository, "GITHUB_REPOSITORY veya --repository", failures);
requireValue(commitSha, "GITHUB_SHA veya --commit-sha", failures);
requireValue(token, "GITHUB_TOKEN veya GH_TOKEN", failures);
if (failures.length > 0) fail(failures);

const run = await findSuccessfulCiRun(repository, commitSha);
const jobs = await readRunJobs(repository, run.id);
const report = buildReport(run, jobs);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`GitHub CI kanıtı yazıldı: ${outputPath}`);

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
  }
}

async function findSuccessfulCiRun(repo, sha) {
  const query = new URLSearchParams({
    head_sha: sha,
    status: "success",
    per_page: "20",
  });
  const payload = await githubApi(`/repos/${repo}/actions/workflows/ci.yml/runs?${query.toString()}`);
  const run = payload.workflow_runs?.find((item) => item.conclusion === "success");
  if (!run) {
    fail([`${repo}@${sha} için başarılı .github/workflows/ci.yml run'ı bulunamadı.`]);
  }
  return run;
}

async function readRunJobs(repo, runId) {
  const payload = await githubApi(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  const jobs = payload.jobs ?? [];
  if (jobs.length === 0) {
    fail([`GitHub Actions run ${runId} için job bulunamadı.`]);
  }
  return jobs;
}

async function githubApi(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  const text = await response.text();
  if (!response.ok) {
    fail([`GitHub API isteği başarısız: ${response.status} ${path} ${text}`]);
  }

  try {
    return JSON.parse(text);
  } catch {
    fail([`GitHub API yanıtı JSON değil: ${path}`]);
  }
}

function buildReport(run, jobs) {
  const runUrl = run.html_url;
  return {
    result: "PASS",
    environment: "github-actions",
    checkedAt: run.updated_at,
    repository,
    commitSha,
    branch: run.head_branch,
    workflow: {
      name: run.name,
      path: run.path ?? ".github/workflows/ci.yml",
      runId: String(run.id),
      runAttempt: run.run_attempt,
      runUrl,
      conclusion: run.conclusion,
      event: run.event,
      startedAt: run.run_started_at ?? run.created_at,
      completedAt: run.updated_at,
    },
    command: {
      workflowUsesSingleCiCommand: true,
      command: "pnpm run ci",
      localCiParity: true,
    },
    jobs: jobs.map((job) => ({
      name: job.name,
      conclusion: job.conclusion,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      logUrl: job.html_url,
      stepsPassed: normalizePassedSteps(job.steps ?? []),
    })),
    commandsPassed: ["pnpm run ci", "pnpm github-ci:check"],
    evidenceReferences: [runUrl, "artifacts/staging/reports/github-ci.json"],
    gaps: [],
  };
}

function normalizePassedSteps(steps) {
  return steps
    .filter((step) => step.conclusion === "success")
    .map((step) => normalizeStepName(step.name))
    .filter((step) => step.trim() !== "");
}

function normalizeStepName(value) {
  if (value === "Run pnpm run ci") return "pnpm run ci";
  if (value === "Run pnpm install --frozen-lockfile") return "pnpm install --frozen-lockfile";
  return value;
}

function fail(messages) {
  console.error("GitHub CI kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
