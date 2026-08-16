import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const target = process.env.RUNTIME_PARITY_EVIDENCE_TARGET;
const expectedServices = ["web", "api", "worker", "queue-board"];
const expectedPaths = ["/health", "/health/ready"];
const failures = [];
if (!target) fail(["RUNTIME_PARITY_EVIDENCE_TARGET boş bırakılamaz."]);

let url;
try { url = new URL(target); } catch { fail(["RUNTIME_PARITY_EVIDENCE_TARGET file:// URL olmalı."]); }
if (url.protocol !== "file:" || url.username || url.password || url.search || url.hash) fail(["RUNTIME_PARITY_EVIDENCE_TARGET secret taşımayan file:// URL olmalı."]);
const filePath = fileURLToPath(url);
if (isTempPath(filePath)) fail(["RUNTIME_PARITY_EVIDENCE_TARGET lokal temp path olmamalı."]);
await assertPlainParent(dirname(filePath));
const stat = await lstat(filePath).catch(() => undefined);
if (!stat || stat.isSymbolicLink() || !stat.isFile()) fail(["RUNTIME_PARITY_EVIDENCE_TARGET plain file olmalı."]);
let report;
try { report = JSON.parse(await readFile(filePath, "utf8")); } catch { fail(["Runtime parity kanıtı geçerli JSON olmalı."]); }

exactKeys(report, ["result", "environment", "checkedAt", "repository", "sourceSha", "releaseImageTag", "verifierRunUrl", "services", "publicHealth"], "runtimeParity", failures);
if (report?.result !== "PASS" || report?.environment !== "staging") failures.push("runtimeParity result PASS ve environment staging olmalı.");
if (!validDate(report?.checkedAt) || Date.parse(report.checkedAt) > Date.now() + 5 * 60 * 1000) failures.push("runtimeParity.checkedAt geçerli ve gelecekte olmayan tarih olmalı.");
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(report?.repository ?? "")) failures.push("runtimeParity.repository owner/repo biçiminde olmalı.");
if (!/^[a-f0-9]{40}$/.test(report?.sourceSha ?? "") || report?.releaseImageTag !== report?.sourceSha) failures.push("runtimeParity sourceSha/releaseImageTag exact SHA olmalı.");
const expectedRunUrl = githubRunUrl(report?.verifierRunUrl, report?.repository);
if (!expectedRunUrl) failures.push("runtimeParity.verifierRunUrl repository ile eşleşen GitHub Actions run URL olmalı.");

if (!Array.isArray(report?.services) || report.services.length !== expectedServices.length) failures.push("runtimeParity.services tam dört servis içermeli.");
for (const service of expectedServices) {
  const matches = (report?.services ?? []).filter((item) => item?.service === service);
  if (matches.length !== 1) { failures.push(`runtimeParity.services ${service} tam bir kez bulunmalı.`); continue; }
  const item = matches[0];
  exactKeys(item, ["service", "image", "state", "health"], `runtimeParity.services.${service}`, failures);
  if (item.image !== `ghcr.io/${report.repository}/${service}:${report.sourceSha}`) failures.push(`runtimeParity.services.${service}.image exact source SHA olmalı.`);
  if (item.state !== "running") failures.push(`runtimeParity.services.${service}.state running olmalı.`);
  if (!["healthy", "none"].includes(item.health)) failures.push(`runtimeParity.services.${service}.health healthy veya none olmalı.`);
}

if (!Array.isArray(report?.publicHealth) || report.publicHealth.length !== expectedPaths.length) failures.push("runtimeParity.publicHealth tam iki endpoint içermeli.");
for (const path of expectedPaths) {
  const expectedUrl = `https://o-okul.com${path}`;
  const matches = (report?.publicHealth ?? []).filter((item) => item?.url === expectedUrl);
  if (matches.length !== 1) { failures.push(`runtimeParity.publicHealth ${path} tam bir kez bulunmalı.`); continue; }
  exactKeys(matches[0], ["url", "statusCode"], `runtimeParity.publicHealth.${path}`, failures);
  if (matches[0].statusCode !== 200) failures.push(`runtimeParity.publicHealth.${path}.statusCode 200 olmalı.`);
}

for (const [label, actual, expected] of [
  ["sourceSha", report?.sourceSha, process.env.RUNTIME_PARITY_EXPECTED_SOURCE_SHA],
  ["repository", report?.repository, process.env.RUNTIME_PARITY_EXPECTED_REPOSITORY],
  ["verifierRunUrl", report?.verifierRunUrl, process.env.RUNTIME_PARITY_EXPECTED_VERIFIER_RUN_URL],
]) {
  if (expected && actual !== expected) failures.push(`runtimeParity.${label} beklenen değerle eşleşmeli.`);
}
if (failures.length > 0) fail(failures);
console.log(`Runtime parity kanıt kontrolü geçti: ${report.sourceSha}`);

function exactKeys(value, expected, label, output) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { output.push(`${label} nesnesi zorunlu.`); return; }
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) output.push(`${label} exact alan setini taşımalı.`);
}
function githubRunUrl(value, repository) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "github.com" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      && parsed.pathname.match(/^\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/?$/u)?.[1] === repository;
  } catch { return false; }
}
function validDate(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function isTempPath(value) { const path = resolve(value).replaceAll("\\", "/"); return path === "/tmp" || path.startsWith("/tmp/") || path === "/var/tmp" || path.startsWith("/var/tmp/") || path === "/private/tmp" || path.startsWith("/private/tmp/"); }
async function assertPlainParent(parent) {
  const root = parse(parent).root;
  let current = root;
  for (const segment of parent.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, segment);
    const stat = await lstat(current).catch(() => undefined);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail(["RUNTIME_PARITY_EVIDENCE_TARGET parent dizini plain dizin olmalı."]);
  }
}
function fail(messages) { console.error("Runtime parity kanıt kontrolü başarısız:"); for (const message of messages) console.error(`- ${message}`); process.exit(1); }
