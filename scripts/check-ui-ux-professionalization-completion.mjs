import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ledgerPath = readArg("--ledger") ?? "docs/ui-ux-professionalization-completion.json";
const contractOnly = process.argv.includes("--contract-only");
const localProofOnly = process.argv.includes("--local-proof-only");
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const failures = [];
const expectedIds = Array.from({ length: 7 }, (_, index) => `PR-${index}`);
const deliveryStatuses = new Set(["COMPLETE", "PARTIAL", "NOT_STARTED"]);
const liveStatuses = new Set(["NOT_REQUIRED", "PENDING_EXTERNAL_EVIDENCE", "PROVEN"]);
const ciCommands = new Set((packageJson.scripts?.ci ?? "").split("&&").map((command) => command.trim()));

if (ledger.schemaVersion !== 2) failures.push("schemaVersion 2 olmalı.");
if (!existsSync(ledger.contract)) failures.push(`Sözleşme bulunamadı: ${ledger.contract}`);
requireExternalProof(ledger.externalProof);
requireStatusSemantics(ledger.statusSemantics);
requireText(ledger.evidenceScope, "evidenceScope");
if (!Array.isArray(ledger.slices)) failures.push("slices liste olmalı.");

const slices = Array.isArray(ledger.slices) ? ledger.slices : [];
const ids = slices.map((slice) => slice.id);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
  failures.push(`Dilim sırası ${expectedIds.join(", ")} olmalı; gelen: ${ids.join(", ")}`);
}

for (const slice of slices) {
  requireText(slice.title, `${slice.id}.title`);
  if (!deliveryStatuses.has(slice.deliveryStatus)) failures.push(`${slice.id}.deliveryStatus geçersiz: ${slice.deliveryStatus}`);
  requireOpenItems(slice);
  requireList(slice.requirements, `${slice.id}.requirements`);
  requireList(slice.implementationPaths, `${slice.id}.implementationPaths`);
  requireList(slice.verificationCommands, `${slice.id}.verificationCommands`);
  if (slice.localStatus !== "PROVEN") failures.push(`${slice.id}.localStatus yapısal kanıt bağında PROVEN olmalı.`);
  if (!liveStatuses.has(slice.liveStatus)) failures.push(`${slice.id}.liveStatus geçersiz: ${slice.liveStatus}`);

  for (const path of slice.implementationPaths ?? []) {
    if (!existsSync(path)) failures.push(`${slice.id} uygulama yolu bulunamadı: ${path}`);
  }
  for (const command of slice.verificationCommands ?? []) {
    if (!ciCommands.has(command)) {
      failures.push(`${slice.id} doğrulama komutu pnpm run ci içinde değil: ${command}`);
    }
  }
  requireRequirementEvidence(slice);
}

if (failures.length > 0) fail(failures);

if (contractOnly) {
  console.log(`UI/UX teslim kaydı sözleşmesi doğrulandı: ${slices.length} dilim ve yapısal kanıt bağı.`);
  process.exit(0);
}

const exampleFlags = Object.entries(process.env)
  .filter(([key, value]) => key.endsWith("_ALLOW_EXAMPLE_EVIDENCE") && value === "1")
  .map(([key]) => key);
if (exampleFlags.length > 0) {
  fail(exampleFlags.map((key) => `${key}=1 gerçek tamamlanma kanıtında kullanılamaz.`));
}

const sourceSha = process.env.UI_UX_PROFESSIONALIZATION_SOURCE_SHA?.trim();
if (!/^[a-f0-9]{40}$/i.test(sourceSha ?? "")) {
  fail(["UI_UX_PROFESSIONALIZATION_SOURCE_SHA 40 karakter commit SHA olmalı."]);
}
if (!process.env.GITHUB_CI_EVIDENCE_TARGET) {
  fail(["PROVEN yerel durumları için GITHUB_CI_EVIDENCE_TARGET zorunlu."]);
}

const githubCiSnapshot = readStableFileTarget(process.env.GITHUB_CI_EVIDENCE_TARGET);
requireActionsArtifactPath(githubCiSnapshot.path, "artifacts/staging/reports/github-ci.json");
runChecker("scripts/check-github-ci-evidence.mjs");
assertUnchanged(githubCiSnapshot);
const githubCi = JSON.parse(githubCiSnapshot.contents);
if (githubCi.commitSha?.toLowerCase() !== sourceSha.toLowerCase()) {
  fail(["GitHub CI commitSha ile UI_UX_PROFESSIONALIZATION_SOURCE_SHA eşleşmeli."]);
}

if (!localProofOnly && slices.some((slice) => slice.liveStatus === "PROVEN")) {
  if (process.env.UI_UX_PROFESSIONALIZATION_FULL_EVIDENCE !== "1") {
    fail(["PROVEN canlı durumları yalnız tam staging evidence zinciri sonrasında doğrulanabilir."]);
  }
  if (!process.env.UI_UX_REDESIGN_EVIDENCE_TARGET) {
    fail(["PROVEN canlı durumları için UI_UX_REDESIGN_EVIDENCE_TARGET zorunlu."]);
  }
  const liveSnapshot = readStableFileTarget(process.env.UI_UX_REDESIGN_EVIDENCE_TARGET);
  requireActionsArtifactPath(liveSnapshot.path, "artifacts/staging/reports/ui-ux-redesign.json");
  runChecker("scripts/check-ui-ux-redesign-evidence.mjs");
  assertUnchanged(liveSnapshot);
  const liveEvidence = JSON.parse(liveSnapshot.contents);
  if (liveEvidence.sourceCommitSha?.toLowerCase() !== sourceSha.toLowerCase()) {
    fail(["UI/UX canlı kanıt sourceCommitSha ile beklenen kaynak SHA eşleşmeli."]);
  }
}

console.log(
  localProofOnly
    ? `UI/UX yalnız yerel kanıt bağları doğrulandı: ${slices.length} dilim, kaynak ${sourceSha}.`
    : `UI/UX teslim kaydı kanıt bağları doğrulandı: ${slices.length} dilim, kaynak ${sourceSha}.`,
);

function requireStatusSemantics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push("statusSemantics nesnesi zorunlu.");
    return;
  }
  const expectedKeys = ["deliveryStatus", "liveStatus", "localStatus"];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    failures.push("statusSemantics deliveryStatus, localStatus ve liveStatus alanlarını taşımalı.");
    return;
  }
  for (const key of expectedKeys) requireText(value[key], `statusSemantics.${key}`);
}

function requireOpenItems(slice) {
  if (!Array.isArray(slice.openItems) || slice.openItems.some((item) => typeof item !== "string" || !item.trim())) {
    failures.push(`${slice.id}.openItems metin listesi olmalı.`);
    return;
  }
  if (slice.deliveryStatus === "COMPLETE" && slice.openItems.length > 0) {
    failures.push(`${slice.id} COMPLETE iken openItems boş olmalı.`);
  }
  if (slice.deliveryStatus !== "COMPLETE" && slice.openItems.length === 0) {
    failures.push(`${slice.id} ${slice.deliveryStatus} iken en az bir açık madde taşımalı.`);
  }
}

function requireExternalProof(value) {
  const expected = {
    type: "github-ci",
    command: "pnpm run ci",
    workflow: ".github/workflows/ci.yml",
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push("externalProof nesnesi zorunlu.");
    return;
  }
  if (JSON.stringify(value) !== JSON.stringify(expected)) {
    failures.push("externalProof github-ci, pnpm run ci ve .github/workflows/ci.yml değerlerine bağlanmalı.");
  }
}

function requireRequirementEvidence(slice) {
  const evidence = slice.requirementEvidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    failures.push(`${slice.id}.requirementEvidence nesnesi zorunlu.`);
    return;
  }

  const requirementKeys = [...(slice.requirements ?? [])].sort();
  const evidenceKeys = Object.keys(evidence).sort();
  if (JSON.stringify(requirementKeys) !== JSON.stringify(evidenceKeys)) {
    failures.push(`${slice.id}.requirementEvidence anahtarları requirements ile birebir eşleşmeli.`);
    return;
  }

  for (const requirement of slice.requirements) {
    const item = evidence[requirement];
    if (JSON.stringify(Object.keys(item ?? {}).sort()) !== JSON.stringify(["commands", "paths"])) {
      failures.push(`${slice.id}.${requirement} kanıtı yalnız commands ve paths alanlarını taşımalı.`);
    }
    requireList(item?.paths, `${slice.id}.${requirement}.paths`);
    requireList(item?.commands, `${slice.id}.${requirement}.commands`);
    for (const path of item?.paths ?? []) {
      if (!existsSync(path) || !lstatSync(path).isFile()) {
        failures.push(`${slice.id}.${requirement} kanıt dosyası bulunamadı: ${path}`);
      }
    }
    for (const command of item?.commands ?? []) {
      if (!slice.verificationCommands?.includes(command)) {
        failures.push(`${slice.id}.${requirement} komutu verificationCommands içinde değil: ${command}`);
      }
    }
    if (
      slice.id === "PR-6" &&
      requirement === "Mobil ve erişilebilirlik sözleşmesi" &&
      item?.paths?.includes("apps/web/e2e-next/ui-visual-qa-next.spec.ts") &&
      !item?.commands?.includes("pnpm ui-ux-redesign:visual-qa")
    ) {
      failures.push(`${slice.id}.${requirement} tam görsel spec kanıtı pnpm ui-ux-redesign:visual-qa komutuna bağlanmalı.`);
    }
  }
}

function runChecker(script) {
  const result = spawnSync(process.execPath, [script], { env: process.env, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `${script} başarısız.\n`);
    process.exit(result.status ?? 1);
  }
}

function readStableFileTarget(target) {
  const url = new URL(target);
  if (url.protocol !== "file:") fail(["Tamamlanma SHA binding kanıt hedefi file:// artifact olmalı."]);
  const path = fileURLToPath(url);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(["Tamamlanma SHA binding kanıtı symlink olmayan dosya olmalı."]);
  const contents = readFileSync(path, "utf8");
  return { contents, hash: sha256(contents), path };
}

function assertUnchanged(snapshot) {
  const stat = lstatSync(snapshot.path);
  const contents = readFileSync(snapshot.path, "utf8");
  if (stat.isSymbolicLink() || !stat.isFile() || sha256(contents) !== snapshot.hash) {
    fail(["Tamamlanma kanıt artifact'i doğrulama sırasında değişmemeli."]);
  }
}

function requireActionsArtifactPath(path, expectedRelativePath) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace) fail(["GITHUB_ACTIONS=true iken GITHUB_WORKSPACE zorunlu."]);
  const expectedPath = fileURLToPath(new URL(expectedRelativePath, `${pathToDirectoryUrl(workspace)}`));
  if (path !== expectedPath) {
    fail([`GitHub Actions tamamlanma kanıtı yalnız ${expectedRelativePath} yolundan okunmalı.`]);
  }
}

function pathToDirectoryUrl(path) {
  return new URL(`file://${path.endsWith("/") ? path : `${path}/`}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) failures.push(`${field} boş olamaz.`);
}

function requireList(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    failures.push(`${field} boş olmayan metin listesi olmalı.`);
  }
}

function fail(messages) {
  console.error("UI/UX tamamlanma kaydı kontrolü başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
