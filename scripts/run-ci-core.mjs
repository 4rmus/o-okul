#!/usr/bin/env node
// Runs the `ci` script chain from package.json without the Playwright-backed web
// checks. CI uses it for pull requests that change no UI-affecting files; pushes to
// main and UI pull requests still run the full `pnpm run ci` (2026-10-13).
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PLAYWRIGHT_CHECKS = new Set([
  "karne:visual-contract:check",
  "web:a11y:check",
  "web:auth-contract:check",
  "web:backup-restore-panel:check",
  "web:ux-contract:check",
  "ui-ux-redesign:visual-qa",
]);

const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
const chain = scripts.ci
  .split("&&")
  .map((part) => part.trim())
  .map((part) => part.replace(/^pnpm (run )?/, ""));

const missing = [...PLAYWRIGHT_CHECKS].filter((name) => !chain.includes(name));
if (missing.length > 0) {
  console.error(`run-ci-core: skip listesi scripts.ci ile uyumsuz: ${missing.join(", ")}`);
  process.exit(1);
}

const selected = chain.filter((name) => !PLAYWRIGHT_CHECKS.has(name));
if (process.argv.includes("--list")) {
  console.log(selected.join("\n"));
  process.exit(0);
}

for (const name of selected) {
  console.log(`\n> pnpm ${name}`);
  const result = spawnSync("pnpm", [name], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`run-ci-core: ${name} basarisiz (exit ${result.status ?? "signal"})`);
    process.exit(result.status ?? 1);
  }
}
console.log(`\nrun-ci-core: ${selected.length} komut gecti, ${PLAYWRIGHT_CHECKS.size} Playwright kontrolu atlandi.`);
