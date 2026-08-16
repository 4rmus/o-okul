import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

const outputPath = process.env.OBSERVABILITY_ALERT_DRILL_OUTPUT;
const releaseCandidate = process.env.OBSERVABILITY_ALERT_DRILL_RELEASE_CANDIDATE?.trim()?.toLowerCase();
const evidenceReference = process.env.OBSERVABILITY_ALERT_DRILL_EVIDENCE_REFERENCE?.trim();
const runId = process.env.GITHUB_RUN_ID?.trim();
const prometheusUrl = "http://127.0.0.1:9090";
const alertmanagerUrl = "http://127.0.0.1:9093";
const marker = `gate-e-observability-${runId}`;
const failures = [];

if (typeof outputPath !== "string" || outputPath.trim() === "") failures.push("OBSERVABILITY_ALERT_DRILL_OUTPUT boş bırakılamaz.");
if (!/^[a-f0-9]{40}$/.test(releaseCandidate ?? "")) failures.push("OBSERVABILITY_ALERT_DRILL_RELEASE_CANDIDATE exact 40 karakter SHA olmalı.");
if (!isGitHubRunReference(evidenceReference)) failures.push("OBSERVABILITY_ALERT_DRILL_EVIDENCE_REFERENCE GitHub Actions run referansı olmalı.");
if (!/^\d+$/.test(runId ?? "")) failures.push("GITHUB_RUN_ID sayısal olmalı.");
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);
const compose = [
  "compose", "--env-file", ".env", "--env-file", ".env.release",
  "-f", "docker-compose.yml", "-f", "docker-compose.release.yml",
  "-f", "docker-compose.traefik.yml", "-f", "docker-compose.observability.yml",
];
const prometheusId = docker([...compose, "ps", "-q", "prometheus"]);
if (!prometheusId) fail(["Prometheus container bulunamadı."]);
if (docker(["inspect", "-f", "{{.State.Status}}", prometheusId]) !== "running") fail(["Prometheus running olmalı."]);

await requirePublicHealth();
await requireReady(`${prometheusUrl}/-/ready`, "Prometheus");
await requireReady(`${alertmanagerUrl}/-/ready`, "Alertmanager");
if (await hasApiDownAlert()) fail(["Drill öncesi OOkulApiDown alert zaten aktif."]);
const baseline = await notificationCounters();
let hostsRestored = false;
let firingAt;
let firingDeliveredAt;
let firingCounters;
let resolvedAt;
let resolvedDeliveredAt;

try {
  const existing = docker(["exec", "-u", "0", prometheusId, "sh", "-lc", `grep -F '${marker}' /etc/hosts || true`]);
  if (existing) throw new Error("Drill marker Prometheus /etc/hosts içinde zaten var.");
  docker(["exec", "-u", "0", prometheusId, "sh", "-lc", `printf '\n127.0.0.1 api # ${marker}\n' >> /etc/hosts`]);
  await requirePublicHealth();
  await waitFor(async () => (await queryScalar('up{job="o-okul-api"}')) === 0, 90_000, "Prometheus API scrape down gözlemi");
  await waitFor(async () => await hasApiDownAlert(), 210_000, "OOkulApiDown firing");
  firingAt = new Date().toISOString();
  await waitFor(async () => (await notificationCounters()).success > baseline.success, 90_000, "firing webhook delivery");
  firingDeliveredAt = new Date().toISOString();
  firingCounters = await notificationCounters();
} catch (error) {
  await restoreHosts().catch(() => undefined);
  throw error;
}

try {
  await restoreHosts();
  hostsRestored = true;
} catch (error) {
  await restoreHosts().catch(() => undefined);
  throw error;
}
await waitFor(async () => (await queryScalar('up{job="o-okul-api"}')) === 1, 90_000, "Prometheus API scrape recovery");
await waitFor(async () => !(await hasApiDownAlert()), 90_000, "OOkulApiDown resolve");
resolvedAt = new Date().toISOString();
await waitFor(async () => (await notificationCounters()).success > firingCounters.success, 390_000, "resolved webhook delivery");
resolvedDeliveredAt = new Date().toISOString();
const finalCounters = await notificationCounters();
await requirePublicHealth();
if (!hostsRestored || finalCounters.failed !== baseline.failed) fail(["Alertmanager failed notification sayacı drill sırasında artmamalı."]);

const report = {
  releaseCandidate,
  alertName: "OOkulApiDown",
  receiver: "authenticated-webhook",
  firingStatus: "DELIVERED",
  firingAt,
  firingDeliveredAt,
  resolvedStatus: "DELIVERED",
  resolvedAt,
  resolvedDeliveredAt,
  failedNotificationDelta: finalCounters.failed - baseline.failed,
  evidenceReference,
};
mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(`Observability alert drill kanıtı yazıldı: ${outputFile}`);

async function restoreHosts() {
  docker([
    "exec", "-u", "0", prometheusId, "sh", "-lc",
    `awk '!index($0, "${marker}")' /etc/hosts > /tmp/${marker}.hosts && cat /tmp/${marker}.hosts > /etc/hosts && rm -f /tmp/${marker}.hosts && ! grep -F '${marker}' /etc/hosts`,
  ]);
}

async function requirePublicHealth() {
  for (const path of ["/health", "/health/ready"]) {
    const response = await fetch(`https://o-okul.com${path}`, { redirect: "manual" });
    if (response.status !== 200) throw new Error(`Public ${path} drill boyunca HTTP 200 olmalı; gelen ${response.status}.`);
  }
}

async function requireReady(url, label) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label} ready endpoint 2xx dönmeli.`);
}

async function queryScalar(query) {
  const response = await fetch(`${prometheusUrl}/api/v1/query?query=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`Prometheus query HTTP ${response.status}.`);
  const payload = await response.json();
  const value = Number(payload?.data?.result?.[0]?.value?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

async function hasApiDownAlert() {
  const response = await fetch(`${prometheusUrl}/api/v1/alerts`);
  if (!response.ok) throw new Error(`Prometheus alerts HTTP ${response.status}.`);
  const payload = await response.json();
  return (payload?.data?.alerts ?? []).some((item) => item?.labels?.alertname === "OOkulApiDown" && item?.state === "firing");
}

async function notificationCounters() {
  const response = await fetch(`${alertmanagerUrl}/metrics`);
  if (!response.ok) throw new Error(`Alertmanager metrics HTTP ${response.status}.`);
  const metrics = await response.text();
  return {
    success: metricSum(metrics, "alertmanager_notifications_total", 'integration="webhook"'),
    failed: metricSum(metrics, "alertmanager_notifications_failed_total", 'integration="webhook"'),
  };
}

function metricSum(metrics, metric, requiredLabel) {
  let total = 0;
  let matched = false;
  for (const line of metrics.split("\n")) {
    if (!line.startsWith(`${metric}{`) || !line.includes(requiredLabel)) continue;
    const value = Number(line.trim().split(/\s+/u).at(-1));
    if (Number.isFinite(value)) { total += value; matched = true; }
  }
  if (!matched) throw new Error(`${metric}{${requiredLabel}} metric bulunamadı.`);
  return total;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  }
  throw new Error(`${label} zaman aşımına uğradı.`);
}

function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} başarısız: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function isGitHubRunReference(value) {
  if (typeof value !== "string" || !value.startsWith("run:")) return false;
  try {
    const url = new URL(value.slice(4));
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.search && !url.hash
      && /^\/[^/]+\/[^/]+\/actions\/runs\/\d+\/?$/u.test(url.pathname);
  } catch { return false; }
}

function validateOutputTarget(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized === "/tmp" || normalized.startsWith("/tmp/") || normalized === "/var/tmp" || normalized.startsWith("/var/tmp/") || normalized === "/private/tmp" || normalized.startsWith("/private/tmp/")) fail(["OBSERVABILITY_ALERT_DRILL_OUTPUT lokal temp path olmamalı."]);
  const root = parse(dirname(filePath)).root;
  let current = root;
  for (const segment of dirname(filePath).slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, segment);
    if (!existsSync(current)) break;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(["OBSERVABILITY_ALERT_DRILL_OUTPUT parent dizini plain dizin olmalı."]);
  }
  if (existsSync(filePath)) {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail(["OBSERVABILITY_ALERT_DRILL_OUTPUT plain file olmalı."]);
  }
}

function fail(messages) {
  console.error("Observability alert drill başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
