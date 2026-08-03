import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const target = process.env.DEPLOYMENT_CUTOVER_EVIDENCE_TARGET ?? (process.env.DEPLOYMENT_CUTOVER_EVIDENCE_FILE ? pathToFileURL(resolve(process.env.DEPLOYMENT_CUTOVER_EVIDENCE_FILE)).href : undefined);
const allowExample = process.env.DEPLOYMENT_CUTOVER_ALLOW_EXAMPLE_EVIDENCE === "1";
const expectedRunId = process.env.DEPLOYMENT_CUTOVER_EXPECTED_RUN_ID;
const expectedRepository = process.env.DEPLOYMENT_CUTOVER_EXPECTED_REPOSITORY;
if (!target) fail(["DEPLOYMENT_CUTOVER_EVIDENCE_TARGET zorunlu."]);
let url;
try { url = new URL(target); } catch { fail(["DEPLOYMENT_CUTOVER_EVIDENCE_TARGET file:// URL olmalı."]); }
if (url.protocol !== "file:") fail(["DEPLOYMENT_CUTOVER_EVIDENCE_TARGET yalnız file:// URL olmalı."]);
const filePath = fileURLToPath(url);
if (["/tmp", "/var/tmp", "/private/tmp"].some((root) => filePath === root || filePath.startsWith(`${root}/`))) fail(["DEPLOYMENT_CUTOVER_EVIDENCE_TARGET lokal temp path olmamalı."]);
const stat = await lstat(filePath).catch(() => fail(["DEPLOYMENT_CUTOVER_EVIDENCE_TARGET okunabilir file artifact olmalı."]));
if (!stat.isFile() || stat.isSymbolicLink()) fail(["DEPLOYMENT_CUTOVER_EVIDENCE_TARGET symlink olmayan file:// artifact olmalı."]);
let value;
try { value = JSON.parse(await readFile(filePath, "utf8")); } catch { fail(["DEPLOYMENT_CUTOVER_EVIDENCE_TARGET geçerli JSON olmalı."]); }
const keys = ["schemaVersion", "result", "check", "environment", "generatedAt", "deployRunId", "repository", "sourceSha", "releaseImageTag", "cutoverAt", "serviceImages"];
const failures = [];
if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) failures.push("Cutover artifact alanları exact olmalı.");
if (value?.schemaVersion !== 1 || value?.result !== "PASS" || value?.check !== "staging_deployment_cutover" || value?.environment !== "staging") failures.push("Cutover artifact PASS staging sözleşmesi geçersiz.");
if (!/^\d+$/.test(value?.deployRunId ?? "") || !/^[\w.-]+\/[\w.-]+$/.test(value?.repository ?? "") || !/^[a-f0-9]{40}$/i.test(value?.sourceSha ?? "") || !isTag(value?.releaseImageTag)) failures.push("Cutover artifact kimlik/tag alanları geçersiz.");
if (expectedRunId && value?.deployRunId !== expectedRunId) failures.push("Cutover artifact deploy_run_id ile eşleşmeli.");
if (expectedRepository && value?.repository !== expectedRepository) failures.push("Cutover artifact repository ile eşleşmeli.");
for (const key of ["generatedAt", "cutoverAt"]) if (!isCanonicalIsoTimestamp(value?.[key])) failures.push(`${key} canonical ISO tarih olmalı.`);
if (isCanonicalIsoTimestamp(value?.generatedAt) && isCanonicalIsoTimestamp(value?.cutoverAt) && Date.parse(value.generatedAt) < Date.parse(value.cutoverAt)) failures.push("generatedAt cutoverAt değerinden önce olamaz.");
if (!allowExample && (Date.parse(value?.cutoverAt) > Date.now() + 5 * 60 * 1000 || Date.now() - Date.parse(value?.cutoverAt) > 24 * 60 * 60 * 1000)) failures.push("cutoverAt gelecekte veya 24 saatten eski olamaz.");
const expectedServices = ["api", "queue-board", "web", "worker"];
if (!value?.serviceImages || JSON.stringify(Object.keys(value.serviceImages).sort()) !== JSON.stringify(expectedServices)) failures.push("serviceImages dört canonical servis içermeli.");
for (const service of expectedServices) if (value?.serviceImages?.[service] !== `ghcr.io/${value?.repository}/${service}:${value?.releaseImageTag}`) failures.push(`serviceImages.${service} release tag ile eşleşmeli.`);
if (JSON.stringify(value).match(/sourceId|recipient|token|payload|https?:\/\//i)) failures.push("Cutover artifact source veya hassas payload taşıyamaz.");
if (failures.length) fail(failures);
console.log(`Deployment cutover evidence kontrolü geçti: ${value.releaseImageTag}`);
function isTag(value) { return typeof value === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(value); }
function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
function fail(messages) { console.error("Deployment cutover evidence kontrolü başarısız:"); for (const message of messages) console.error(`- ${message}`); process.exit(1); }
