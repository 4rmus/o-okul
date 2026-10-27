import { readFileSync } from "node:fs";
import { CI_PARTITION_SCRIPTS, CI_PARTITION_STEPS, splitScriptChain } from "./ci-partitions.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const scripts = packageJson.scripts ?? {};
const failures = [];

const ciCommands = splitScriptChain(scripts.ci);
if (ciCommands.length === 0) failures.push("package.json ci script zorunlu.");

const partitionCommands = [];
for (const name of CI_PARTITION_SCRIPTS) {
  const commands = splitScriptChain(scripts[name]);
  if (commands.length === 0) failures.push(`package.json ${name} script zorunlu.`);
  partitionCommands.push(...commands);
}

for (const command of [...ciCommands, ...partitionCommands]) {
  if (CI_PARTITION_STEPS.includes(command) || command === "pnpm run ci" || command === "pnpm ci") {
    failures.push(`ci zinciri ve parçaları birbirini çağırmamalı: ${command}`);
  }
}

for (const command of new Set(ciCommands)) {
  const count = ciCommands.filter((item) => item === command).length;
  if (count > 1) failures.push(`ci zincirinde tekrar eden komut: ${command}`);
}

for (const command of ciCommands) {
  const count = partitionCommands.filter((item) => item === command).length;
  if (count === 0) failures.push(`ci komutu hiçbir CI parçasında yok: ${command}`);
  if (count > 1) failures.push(`ci komutu birden fazla CI parçasında: ${command}`);
}
for (const command of partitionCommands) {
  if (!ciCommands.includes(command)) failures.push(`CI parçası ci zincirinde olmayan komut çalıştırıyor: ${command}`);
}

// Each partition runs as a named step so GitHub CI evidence can bind it (scripts/generate-github-ci-evidence.mjs).
for (const step of ["pnpm ci:static", "pnpm ci:unit"]) {
  if (!workflow.includes(`name: ${step}\n`)) failures.push(`.github/workflows/ci.yml adımı eksik: name: ${step}`);
}
if (!workflow.includes("name: pnpm ci:e2e:${{ matrix.partition }}\n")) {
  failures.push(".github/workflows/ci.yml e2e matrix adımı eksik: name: pnpm ci:e2e:${{ matrix.partition }}");
}
const e2eMatrix = workflow.match(/partition: \[([^\]]*)\]/);
const e2ePartitions = (e2eMatrix?.[1] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const expectedE2ePartitions = CI_PARTITION_SCRIPTS.filter((name) => name.startsWith("ci:e2e:")).map((name) => name.slice("ci:e2e:".length));
if (e2ePartitions.join(",") !== expectedE2ePartitions.join(",")) {
  failures.push(`.github/workflows/ci.yml e2e matrix partition listesi ${expectedE2ePartitions.join(", ")} olmalı.`);
}
if (/run: pnpm run ci\b/.test(workflow)) {
  failures.push(".github/workflows/ci.yml pnpm run ci zincirini tek job'da çalıştırmamalı; parçalar paralel koşar.");
}

if (failures.length > 0) {
  console.error("CI parça kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`CI parça kontrolü geçti: ${ciCommands.length} komut, ${CI_PARTITION_SCRIPTS.length} parça.`);
