import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { validateSmokeEvidenceOutputTarget } from "./smoke-evidence.mjs";

const output = process.env.DEPLOYMENT_CUTOVER_EVIDENCE_FILE;
const runId = process.env.GITHUB_RUN_ID;
const repository = process.env.GITHUB_REPOSITORY;
const sourceSha = process.env.DEPLOYMENT_CUTOVER_SOURCE_SHA;
const releaseImageTag = process.env.DEPLOYMENT_CUTOVER_RELEASE_IMAGE_TAG;
const imagePrefix = process.env.DEPLOYMENT_CUTOVER_IMAGE_PREFIX;
const cutoverAt = process.env.DEPLOYMENT_CUTOVER_AT ?? new Date().toISOString();

if (!output || !runId || !repository || !sourceSha || !releaseImageTag || !imagePrefix) fail("Deployment cutover artifact için zorunlu metadata eksik.");
if (!/^\d+$/.test(runId) || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/i.test(sourceSha) || !isTag(releaseImageTag) || !/^ghcr\.io\/[a-z0-9._/-]+$/i.test(imagePrefix) || Number.isNaN(Date.parse(cutoverAt))) {
  fail("Deployment cutover metadata biçimi geçersiz.");
}

await validateSmokeEvidenceOutputTarget(output);
const serviceImages = Object.fromEntries(["web", "api", "worker", "queue-board"].map((service) => [service, `${imagePrefix}/${service}:${releaseImageTag}`]));
const evidence = {
  schemaVersion: 1,
  result: "PASS",
  check: "staging_deployment_cutover",
  environment: "staging",
  generatedAt: new Date().toISOString(),
  deployRunId: runId,
  repository,
  sourceSha: sourceSha.toLowerCase(),
  releaseImageTag,
  cutoverAt: new Date(cutoverAt).toISOString(),
  serviceImages,
};
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(resolve(output), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Deployment cutover artifact üretildi: ${evidence.releaseImageTag}`);

function isTag(value) {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(value);
}

function fail(message) {
  console.error(`Deployment cutover artifact başarısız: ${message}`);
  process.exit(1);
}
