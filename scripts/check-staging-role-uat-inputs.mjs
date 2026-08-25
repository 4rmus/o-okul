import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workflowPath = ".github/workflows/staging-role-uat.yml";
const requiredExternalCommands = [
  "pnpm db:rls:check:live",
  "pnpm raw-import:smoke",
  "pnpm report-generation:smoke",
  "pnpm live:exam-cycle:check",
  "pnpm queue:smoke",
  "pnpm live:onboarding:smoke",
  "pnpm live:ui-worker:smoke",
  "pnpm sms:smoke",
  "pnpm notification:smoke",
  "pnpm traefik:https:smoke",
];
const expectedScenarios = new Map([
  ["UAT-SYS-01", "SYSTEM_ADMIN"],
  ["UAT-SYS-02", "SYSTEM_ADMIN"],
  ["UAT-SYS-03", "SYSTEM_ADMIN"],
  ["UAT-SYS-04", "SYSTEM_ADMIN"],
  ["UAT-KURUM-01", "TENANT_ADMIN"],
  ["UAT-KURUM-02", "TENANT_ADMIN"],
  ["UAT-KURUM-03", "TENANT_ADMIN"],
  ["UAT-KURUM-04", "TENANT_ADMIN"],
  ["UAT-KURUM-05", "TENANT_ADMIN"],
  ["UAT-KURUM-06", "TENANT_ADMIN"],
  ["UAT-KURUM-07", "TENANT_ADMIN"],
  ["UAT-KURUM-08", "TENANT_ADMIN"],
  ["UAT-TEACHER-01", "TEACHER"],
  ["UAT-TEACHER-02", "TEACHER"],
  ["UAT-TEACHER-03", "TEACHER"],
  ["UAT-STUDENT-01", "STUDENT"],
  ["UAT-STUDENT-02", "STUDENT"],
  ["UAT-STUDENT-03", "STUDENT"],
  ["UAT-GUARDIAN-01", "GUARDIAN"],
  ["UAT-GUARDIAN-02", "GUARDIAN"],
  ["UAT-GUARDIAN-03", "GUARDIAN"],
]);
const externalScenarioIds = new Set([
  "UAT-SYS-01",
  "UAT-SYS-02",
  "UAT-SYS-04",
  "UAT-KURUM-01",
  "UAT-KURUM-03",
  "UAT-KURUM-05",
  "UAT-KURUM-06",
  "UAT-KURUM-08",
]);

if (process.argv.includes("--contract")) {
  runContract();
  process.exit(0);
}

const context = {
  sourceSha: process.env.STAGING_ROLE_UAT_SOURCE_SHA?.trim(),
  cutoverAt: process.env.STAGING_ROLE_UAT_CUTOVER_AT?.trim(),
  githubCiRunUrl: process.env.STAGING_ROLE_UAT_GITHUB_CI_RUN_URL?.trim(),
  verifierRunUrl: process.env.STAGING_ROLE_UAT_VERIFIER_RUN_URL?.trim(),
};
const metadataTarget = process.env.STAGING_ROLE_UAT_METADATA_TARGET;
const commandsTarget = process.env.STAGING_ROLE_UAT_COMMANDS_TARGET;
const scenariosTarget = process.env.STAGING_ROLE_UAT_SCENARIOS_TARGET;
const commandsOutput = process.env.STAGING_ROLE_UAT_BOUND_COMMANDS_OUTPUT;
const failures = validateContext(context);

for (const [value, label] of [
  [metadataTarget, "STAGING_ROLE_UAT_METADATA_TARGET"],
  [commandsTarget, "STAGING_ROLE_UAT_COMMANDS_TARGET"],
  [scenariosTarget, "STAGING_ROLE_UAT_SCENARIOS_TARGET"],
  [commandsOutput, "STAGING_ROLE_UAT_BOUND_COMMANDS_OUTPUT"],
]) {
  if (!value) failures.push(label + " zorunlu.");
}
if (failures.length > 0) fail(failures);

const metadata = readJsonTarget(metadataTarget, "STAGING_ROLE_UAT_METADATA_TARGET");
const commandEvidence = readJsonTarget(commandsTarget, "STAGING_ROLE_UAT_COMMANDS_TARGET");
const scenarioEvidence = readJsonTarget(scenariosTarget, "STAGING_ROLE_UAT_SCENARIOS_TARGET");
failIfAny(validatePayloads({ metadata, commandEvidence, scenarioEvidence }, context));

const outputPath = resolve(commandsOutput);
validateOutputPath(outputPath, "STAGING_ROLE_UAT_BOUND_COMMANDS_OUTPUT");
const externalCommands = new Map(commandEvidence.commands.map((item) => [item.command, item]));
const commands = [
  { command: "pnpm run ci", status: "PASS", evidence: "run:" + context.githubCiRunUrl },
  { command: "pnpm prod:env:check", status: "PASS", evidence: "run:" + context.verifierRunUrl },
  ...requiredExternalCommands.map((command) => externalCommands.get(command)),
];
writeFileSync(outputPath, JSON.stringify({ commands }, null, 2) + "\n", { mode: 0o600 });
console.log("Staging role UAT girdileri doğrulandı: " + commands.length + " komut, " + expectedScenarios.size + " senaryo.");

function validatePayloads(payloads, validationContext, now = Date.now()) {
  const output = validateContext(validationContext);
  if (output.length > 0) return output;

  const { metadata, commandEvidence, scenarioEvidence } = payloads;
  validateEnvelope(metadata, ["sourceSha", "generatedAt", "tester", "restoreBackupReference", "githubCiRunUrl"], "metadata", validationContext, now, output);
  validateEnvelope(commandEvidence, ["sourceSha", "generatedAt", "commands"], "commands", validationContext, now, output);
  validateEnvelope(scenarioEvidence, ["sourceSha", "generatedAt", "journeyScenariosVerified"], "scenarios", validationContext, now, output);

  if (metadata?.githubCiRunUrl !== validationContext.githubCiRunUrl) {
    output.push("metadata.githubCiRunUrl exact GitHub CI run URL ile eşleşmeli.");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/u.test(metadata?.tester ?? "") || hasPlaceholder(metadata?.tester)) {
    output.push("metadata.tester gerçek, PII içermeyen koşu sahibi etiketi olmalı.");
  }
  validateRestoreReference(metadata?.restoreBackupReference, output);
  validateCommands(commandEvidence?.commands, validationContext, output);
  validateScenarios(scenarioEvidence?.journeyScenariosVerified, validationContext, output);
  return output;
}

function validateContext(value) {
  const output = [];
  if (!/^[a-f0-9]{40}$/iu.test(value.sourceSha ?? "")) output.push("STAGING_ROLE_UAT_SOURCE_SHA 40 karakter hex SHA olmalı.");
  if (!isIsoDate(value.cutoverAt)) output.push("STAGING_ROLE_UAT_CUTOVER_AT geçerli tarih olmalı.");
  validateGithubRunUrl(value.githubCiRunUrl, "STAGING_ROLE_UAT_GITHUB_CI_RUN_URL", output);
  validateGithubRunUrl(value.verifierRunUrl, "STAGING_ROLE_UAT_VERIFIER_RUN_URL", output);
  return output;
}

function validateEnvelope(value, keys, label, contextValue, now, output) {
  requireExactKeys(value, keys, label, output);
  if (value?.sourceSha?.toLowerCase() !== contextValue.sourceSha.toLowerCase()) {
    output.push(label + ".sourceSha cutover SHA ile eşleşmeli.");
  }
  const timestamp = Date.parse(value?.generatedAt ?? "");
  const cutoverTimestamp = Date.parse(contextValue.cutoverAt);
  if (!Number.isFinite(timestamp)) {
    output.push(label + ".generatedAt geçerli tarih olmalı.");
  } else {
    if (timestamp < cutoverTimestamp) output.push(label + ".generatedAt cutoverAt öncesinde olamaz.");
    if (timestamp > now + 5 * 60 * 1000) output.push(label + ".generatedAt gelecekte olamaz.");
    if (now - timestamp > 24 * 60 * 60 * 1000) output.push(label + ".generatedAt 24 saatten eski olamaz.");
  }
}

function validateCommands(commands, contextValue, output) {
  if (!Array.isArray(commands) || commands.length !== requiredExternalCommands.length) {
    output.push("commands tam " + requiredExternalCommands.length + " dış UAT komutu içermeli.");
    return;
  }
  const seen = new Set();
  for (const item of commands) {
    requireExactKeys(item, ["command", "status", "evidence"], "commands." + (item?.command ?? "unknown"), output);
    if (seen.has(item?.command)) output.push("commands tekrarlı komut içeriyor: " + item?.command);
    seen.add(item?.command);
    if (!requiredExternalCommands.includes(item?.command)) output.push("commands beklenmeyen komut içeriyor: " + item?.command);
    if (item?.status !== "PASS") output.push(item?.command + " status PASS olmalı.");
    validateDurableReference(item?.evidence, item?.command + " evidence", output);
    if (item?.evidence === "run:" + contextValue.githubCiRunUrl) {
      output.push(item?.command + " canlı kanıtı yalnız CI run'ına bağlanamaz.");
    }
  }
  for (const command of requiredExternalCommands) {
    if (!seen.has(command)) output.push("commands eksik: " + command);
  }
}

function validateScenarios(scenarios, contextValue, output) {
  if (!Array.isArray(scenarios) || scenarios.length !== expectedScenarios.size) {
    output.push("journeyScenariosVerified tam " + expectedScenarios.size + " senaryo içermeli.");
    return;
  }
  const ciReference = "run:" + contextValue.githubCiRunUrl;
  const seen = new Set();
  for (const scenario of scenarios) {
    const id = scenario?.id ?? "unknown";
    requireExactKeys(scenario, ["id", "persona", "status", "evidence"], "scenarios." + id, output);
    if (seen.has(id)) output.push("journeyScenariosVerified tekrarlı senaryo içeriyor: " + id);
    seen.add(id);
    const persona = expectedScenarios.get(id);
    if (!persona) output.push("journeyScenariosVerified beklenmeyen senaryo içeriyor: " + id);
    if (persona && scenario?.persona !== persona) output.push(id + " persona " + persona + " olmalı.");
    if (scenario?.status !== "PASS") output.push(id + " status PASS olmalı.");
    if (!Array.isArray(scenario?.evidence) || scenario.evidence.length === 0) {
      output.push(id + ".evidence boş olmayan liste olmalı.");
      continue;
    }
    for (const [index, reference] of scenario.evidence.entries()) {
      validateDurableReference(reference, id + ".evidence." + index, output);
    }
    if (!scenario.evidence.includes(ciReference)) output.push(id + ".evidence exact CI run bağını içermeli.");
    if (externalScenarioIds.has(id) && !scenario.evidence.some((reference) => reference !== ciReference)) {
      output.push(id + ".evidence CI dışında staging kanıtı içermeli.");
    }
  }
  for (const id of expectedScenarios.keys()) {
    if (!seen.has(id)) output.push("journeyScenariosVerified eksik: " + id);
  }
}

function validateDurableReference(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(label + " boş bırakılamaz.");
    return;
  }
  if (hasPlaceholder(value) || /[\r\n]/u.test(value) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)) {
    output.push(label + " placeholder veya PII içeremez.");
    return;
  }
  const normalized = value.startsWith("run:") || value.startsWith("url:") ? value.slice(4) : value;
  let url;
  try {
    url = new URL(normalized);
  } catch {
    output.push(label + " run/url/https/s3 kalıcı referansı olmalı.");
    return;
  }
  if (!["https:", "s3:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    output.push(label + " secret taşımayan https veya s3 referansı olmalı.");
  }
  if (value.startsWith("run:") && (url.protocol !== "https:" || url.hostname !== "github.com" || !/^\/[^/]+\/[^/]+\/actions\/runs\/\d+\/?$/u.test(url.pathname))) {
    output.push(label + " geçerli GitHub Actions run URL'si olmalı.");
  }
}

function validateRestoreReference(value, output) {
  if (typeof value !== "string" || value.trim() === "" || hasPlaceholder(value) || /[?#\r\n]/u.test(value)
    || !/^(?:s3|file):\/\/|^(?:artifact|run|url):|^docker-compose-postgres-dump:/u.test(value)) {
    output.push("metadata.restoreBackupReference gerçek ve secret taşımayan referans olmalı.");
  }
}

function validateGithubRunUrl(value, label, output) {
  let url;
  try {
    url = new URL(value ?? "");
  } catch {
    output.push(label + " GitHub Actions run URL'si olmalı.");
    return;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash
    || !/^\/[^/]+\/[^/]+\/actions\/runs\/\d+\/?$/u.test(url.pathname)) {
    output.push(label + " secret taşımayan GitHub Actions run URL'si olmalı.");
  }
}

function readJsonTarget(target, label) {
  let url;
  try {
    url = new URL(target);
  } catch {
    fail([label + " file:// URL olmalı."]);
  }
  if (url.protocol !== "file:" || url.username || url.password || url.search || url.hash) {
    fail([label + " secret taşımayan file:// URL olmalı."]);
  }
  const filePath = fileURLToPath(url);
  validateInputPath(filePath, label);
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    fail([label + " geçerli JSON olmalı."]);
  }
}

function validateInputPath(filePath, label) {
  const resolvedPath = resolve(filePath);
  if (isUnsafeLocalPath(resolvedPath)) fail([label + " temp veya artifacts/local altında olmamalı."]);
  assertParentPathAllowed(dirname(resolvedPath), label);
  if (!existsSync(resolvedPath)) fail([label + " okunabilir dosya olmalı."]);
  const stat = lstatSync(resolvedPath);
  if (!stat.isFile() || stat.isSymbolicLink()) fail([label + " symlink olmayan dosya olmalı."]);
}

function validateOutputPath(filePath, label) {
  if (isUnsafeLocalPath(filePath)) fail([label + " temp veya artifacts/local altında olmamalı."]);
  assertParentPathAllowed(dirname(filePath), label);
  if (existsSync(filePath)) {
    const stat = lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) fail([label + " symlink olmayan dosya olmalı."]);
  }
}

function assertParentPathAllowed(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/u).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail([label + " parent dizini symlink olmayan dizin olmalı."]);
  }
}

function isUnsafeLocalPath(filePath) {
  const normalized = resolve(filePath).replaceAll("\\", "/");
  return ["/tmp", "/var/tmp", "/private/tmp"].some((root) => normalized === root || normalized.startsWith(root + "/"))
    || normalized.includes("/artifacts/local/");
}

function requireExactKeys(value, expectedKeys, label, output) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    output.push(label + " nesnesi zorunlu.");
    return;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) output.push(label + " exact alan setini taşımalı: " + expectedKeys.join(", "));
}

function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function hasPlaceholder(value) {
  const normalized = String(value ?? "").toLowerCase();
  return ["__set", "change-me", "replace-me", "placeholder", "redacted", "example", ".test", ".invalid", "localhost", "127.0.0.1", "previous-pass", "backup-bucket", "qa-owner", "todo", "tbd"].some((token) => normalized.includes(token));
}

function runContract() {
  const workflow = readFileSync(workflowPath, "utf8");
  const failures = [];
  for (const token of [
    "name: Staging Role UAT",
    "workflow_dispatch:",
    "deploy_run_id:",
    "environment: staging",
    "github.ref == 'refs/heads/main'",
    "fetch-depth: 0",
    "Validate selected deployment run metadata",
    "staging-deployment-cutover-${{ inputs.deploy_run_id }}",
    "scripts/check-deployment-cutover-evidence.mjs",
    "Bind selected deployment run to current main",
    "runtime-affecting files changed since selected deployment cutover",
    "staging-github-ci-evidence-${{ env.CUTOVER_SOURCE_SHA }}",
    "pnpm github-ci:check",
    "sed -i 's/^ADMIN_MFA_MODE=.*/ADMIN_MFA_MODE=required/' .staging-evidence.env",
    "pnpm staging:evidence-env:check -- --mode full --env-file .staging-evidence.env",
    "/root/o-okul-private/uat/$CUTOVER_RELEASE_IMAGE_TAG",
    "metadata.json",
    "commands.json",
    "scenarios.json",
    "scripts/check-staging-role-uat-inputs.mjs",
    "pnpm uat:generate",
    "pnpm uat:check",
    "Recheck exact images before publishing UAT",
    "Publish exact-SHA UAT evidence",
    "staging-role-uat-${{ inputs.deploy_run_id }}-${{ github.run_id }}-${{ github.run_attempt }}",
    "Clean private runner inputs",
  ]) {
    if (!workflow.includes(token)) failures.push(workflowPath + " token eksik: " + token);
  }
  for (const forbidden of ["secret-delivery-outbox", "source-id", "prod:evidence:check", "docker compose up", "docker compose run", "full_evidence:"]) {
    if (workflow.includes(forbidden)) failures.push(workflowPath + " yasak kapsam içeriyor: " + forbidden);
  }
  requireOrder(workflow, [
    "Validate selected deployment run metadata",
    "scripts/check-deployment-cutover-evidence.mjs",
    "Bind selected deployment run to current main",
    "pnpm github-ci:check",
    "pnpm staging:evidence-env:check -- --mode full --env-file .staging-evidence.env",
    "Preflight exact images and release-scoped UAT inputs",
    "scripts/check-staging-role-uat-inputs.mjs",
    "pnpm uat:generate",
    "pnpm uat:check",
    "Recheck exact images before publishing UAT",
    "actions/upload-artifact@v4",
    "Publish exact-SHA UAT evidence",
    "Clean private runner inputs",
  ], failures);

  const now = Date.now();
  const sourceSha = "a".repeat(40);
  const cutoverAt = new Date(now - 60 * 60 * 1000).toISOString();
  const generatedAt = new Date(now - 5 * 60 * 1000).toISOString();
  const githubCiRunUrl = "https://github.com/4rmus/o-okul/actions/runs/32871302761";
  const verifierRunUrl = "https://github.com/4rmus/o-okul/actions/runs/32880000000";
  const ciReference = "run:" + githubCiRunUrl;
  const context = { sourceSha, cutoverAt, githubCiRunUrl, verifierRunUrl };
  const metadata = { sourceSha, generatedAt, tester: "release-owner-role-uat", restoreBackupReference: "docker-compose-postgres-dump:current.dump", githubCiRunUrl };
  const commandEvidence = {
    sourceSha,
    generatedAt,
    commands: requiredExternalCommands.map((command, index) => ({ command, status: "PASS", evidence: "url:https://o-okul.com/evidence/role-uat-command-" + index + ".json" })),
  };
  const scenarioEvidence = {
    sourceSha,
    generatedAt,
    journeyScenariosVerified: [...expectedScenarios].map(([id, persona]) => ({
      id,
      persona,
      status: "PASS",
      evidence: externalScenarioIds.has(id)
        ? [ciReference, "url:https://o-okul.com/evidence/role-uat-" + id.toLowerCase() + ".json"]
        : [ciReference],
    })),
  };
  const positive = { metadata, commandEvidence, scenarioEvidence };
  failures.push(...validatePayloads(positive, context, now).map((message) => "pozitif fixture: " + message));

  const wrongSha = structuredClone(positive);
  wrongSha.commandEvidence.sourceSha = "b".repeat(40);
  requireNegative(wrongSha, context, now, "commands.sourceSha cutover SHA ile eşleşmeli.", "wrong SHA", failures);
  const stale = structuredClone(positive);
  stale.scenarioEvidence.generatedAt = new Date(now - 25 * 60 * 60 * 1000).toISOString();
  requireNegative(stale, context, now, "scenarios.generatedAt cutoverAt öncesinde olamaz.", "stale evidence", failures);
  const piiKey = structuredClone(positive);
  piiKey.commandEvidence.commands[0].email = "person@school.invalid";
  requireNegative(piiKey, context, now, "exact alan setini taşımalı", "PII key", failures);
  const piiValue = structuredClone(positive);
  piiValue.commandEvidence.commands[0].evidence = "url:https://o-okul.com/evidence/person@school.com.json";
  requireNegative(piiValue, context, now, "placeholder veya PII içeremez.", "PII value", failures);
  const secretUrl = structuredClone(positive);
  secretUrl.commandEvidence.commands[0].evidence = "url:https://o-okul.com/evidence/rls.json?token=secret";
  requireNegative(secretUrl, context, now, "secret taşımayan https veya s3 referansı olmalı.", "secret URL", failures);
  const externalMissing = structuredClone(positive);
  externalMissing.scenarioEvidence.journeyScenariosVerified.find((item) => item.id === "UAT-SYS-02").evidence = [ciReference];
  requireNegative(externalMissing, context, now, "UAT-SYS-02.evidence CI dışında staging kanıtı içermeli.", "external evidence", failures);
  failIfAny(failures);
  console.log("Staging role UAT workflow/input contract kontrolü geçti.");
}

function requireNegative(payloads, context, now, expected, label, output) {
  const failures = validatePayloads(payloads, context, now);
  if (!failures.some((message) => message.includes(expected))) output.push(label + " negatifi beklenen hatayı üretmedi: " + expected);
}

function requireOrder(workflow, tokens, output) {
  let cursor = -1;
  for (const token of tokens) {
    const index = workflow.indexOf(token, cursor + 1);
    if (index === -1) {
      output.push(workflowPath + " adım sırası eksik/bozuk: " + token);
      return;
    }
    cursor = index;
  }
}

function failIfAny(failures) {
  if (failures.length > 0) fail(failures);
}

function fail(failures) {
  console.error("Staging role UAT girdi kontrolü başarısız:");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}
