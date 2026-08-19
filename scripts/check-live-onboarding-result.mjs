import { existsSync, lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const target = process.env.LIVE_ONBOARDING_RESULT_TARGET;
const expectedSourceSha = process.env.LIVE_ONBOARDING_RESULT_EXPECTED_SOURCE_SHA?.trim()?.toLowerCase();
const expectedRepository = process.env.LIVE_ONBOARDING_RESULT_EXPECTED_REPOSITORY?.trim();
const expectedVerifierRunUrl = process.env.LIVE_ONBOARDING_RESULT_EXPECTED_VERIFIER_RUN_URL?.trim();
const allowExampleEvidence = process.env.LIVE_ONBOARDING_RESULT_ALLOW_EXAMPLE_EVIDENCE === "1";
const failures = [];

if (!target) failures.push("LIVE_ONBOARDING_RESULT_TARGET zorunlu.");
const path = target ? resolveTarget(target) : undefined;
if (path && (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) failures.push("Live onboarding result symlink olmayan dosya olmalı.");
let value;
if (path && failures.length === 0) {
  try { value = JSON.parse(readFileSync(path, "utf8")); } catch { failures.push("Live onboarding result geçerli JSON olmalı."); }
}
if (value) validate(value, failures);
if (failures.length > 0) fail(failures);
console.log(`Live onboarding result kontrolü geçti: ${value.sourceSha}`);

function validate(report, output) {
  exactKeys(report, ["result", "environment", "startedAt", "checkedAt", "sourceSha", "repository", "verifierRunUrl", "command", "scenarios", "providerDelivery", "cleanup", "gaps"], "report", output);
  if (report.result !== "PASS" || report.environment !== "staging") output.push("Live onboarding result PASS/staging olmalı.");
  if (!validDate(report.startedAt) || !validDate(report.checkedAt) || Date.parse(report.startedAt) > Date.parse(report.checkedAt)) output.push("Live onboarding startedAt/checkedAt sıralı geçerli tarihler olmalı.");
  if (!allowExampleEvidence && Date.parse(report.checkedAt) > Date.now() + 5 * 60 * 1000) output.push("Live onboarding checkedAt gelecekte olamaz.");
  if (!/^[a-f0-9]{40}$/.test(report.sourceSha ?? "")) output.push("Live onboarding sourceSha exact 40 karakter SHA olmalı.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(report.repository ?? "")) output.push("Live onboarding repository owner/repo biçiminde olmalı.");
  if (report.command !== "pnpm live:onboarding:smoke") output.push("Live onboarding command exact smoke komutu olmalı.");
  const expectedScenarios = [
    { id: "UAT-SYS-02", status: "PASS" },
    { id: "UAT-KURUM-01", status: "PASS" },
    { id: "UAT-KURUM-03", status: "PASS" },
  ];
  if (JSON.stringify(report.scenarios) !== JSON.stringify(expectedScenarios)) output.push("Live onboarding exact SYS-02/KURUM-01/KURUM-03 PASS senaryolarını taşımalı.");
  exactKeys(report.providerDelivery, ["channel", "result", "evidenceEndpoint"], "providerDelivery", output);
  if (report.providerDelivery?.channel !== "EMAIL" || report.providerDelivery?.result !== "PASS" || report.providerDelivery?.evidenceEndpoint !== "https://notify.staging.o-okul.com/messages/latest") {
    output.push("Live onboarding aktivasyon e-postası staging evidence endpoint üzerinden doğrulanmış olmalı.");
  }
  exactKeys(report.cleanup, ["result", "tenantsDeleted", "authSessionsRemaining"], "cleanup", output);
  if (report.cleanup?.result !== "PASS" || report.cleanup?.tenantsDeleted !== 1 || report.cleanup?.authSessionsRemaining !== 0) output.push("Live onboarding sentetik tenant/AuthSession temizliği tam olmalı.");
  if (!Array.isArray(report.gaps) || report.gaps.length !== 0) output.push("Live onboarding gaps boş olmalı.");
  requireRunUrl(report.verifierRunUrl, report.repository, output);
  if (expectedSourceSha && report.sourceSha !== expectedSourceSha) output.push("Live onboarding sourceSha beklenen SHA ile eşleşmeli.");
  if (expectedRepository && report.repository !== expectedRepository) output.push("Live onboarding repository beklenen repo ile eşleşmeli.");
  if (expectedVerifierRunUrl && report.verifierRunUrl !== expectedVerifierRunUrl) output.push("Live onboarding verifier run URL beklenen run ile eşleşmeli.");
}

function exactKeys(value, expected, label, output) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { output.push(`${label} nesnesi zorunlu.`); return; }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) output.push(`${label} exact alan setini taşımalı.`);
}

function requireRunUrl(value, repository, output) {
  let url;
  try { url = new URL(value); } catch { output.push("Live onboarding verifierRunUrl geçerli olmalı."); return; }
  const runRepository = url.pathname.match(/^\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/?$/u)?.[1];
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash || runRepository !== repository) output.push("Live onboarding verifierRunUrl secret taşımayan repository Actions run URL olmalı.");
}

function resolveTarget(value) {
  if (value.startsWith("file://")) return fileURLToPath(new URL(value));
  return resolve(value);
}

function validDate(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function fail(messages) { console.error("Live onboarding result kontrolü başarısız:"); for (const message of messages) console.error(`- ${message}`); process.exit(1); }
