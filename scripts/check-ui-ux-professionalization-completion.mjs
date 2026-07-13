import { existsSync, readFileSync } from "node:fs";

const ledgerPath = "docs/ui-ux-professionalization-completion.json";
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const failures = [];
const expectedIds = Array.from({ length: 7 }, (_, index) => `PR-${index}`);
const localStatuses = new Set(["IN_PROGRESS", "PROVEN"]);
const liveStatuses = new Set(["NOT_REQUIRED", "PENDING_EXTERNAL_EVIDENCE", "PROVEN"]);

if (ledger.schemaVersion !== 1) failures.push("schemaVersion 1 olmalı.");
if (!existsSync(ledger.contract)) failures.push(`Sözleşme bulunamadı: ${ledger.contract}`);
if (!Array.isArray(ledger.slices)) failures.push("slices liste olmalı.");

const slices = Array.isArray(ledger.slices) ? ledger.slices : [];
const ids = slices.map((slice) => slice.id);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) {
  failures.push(`Dilim sırası ${expectedIds.join(", ")} olmalı; gelen: ${ids.join(", ")}`);
}

for (const slice of slices) {
  requireText(slice.title, `${slice.id}.title`);
  requireList(slice.requirements, `${slice.id}.requirements`);
  requireList(slice.implementationPaths, `${slice.id}.implementationPaths`);
  requireList(slice.verificationCommands, `${slice.id}.verificationCommands`);
  if (!localStatuses.has(slice.localStatus)) failures.push(`${slice.id}.localStatus geçersiz: ${slice.localStatus}`);
  if (!liveStatuses.has(slice.liveStatus)) failures.push(`${slice.id}.liveStatus geçersiz: ${slice.liveStatus}`);

  for (const path of slice.implementationPaths ?? []) {
    if (!existsSync(path)) failures.push(`${slice.id} uygulama yolu bulunamadı: ${path}`);
  }
  for (const command of slice.verificationCommands ?? []) {
    const scriptName = command.match(/^pnpm (?!run\s)(?:--filter\s+\S+\s+)?([\w:-]+)/)?.[1];
    if (scriptName && !packageJson.scripts?.[scriptName] && !command.includes("--filter")) {
      failures.push(`${slice.id} package script bulunamadı: ${scriptName}`);
    }
  }
}

if (failures.length > 0) {
  console.error("UI/UX tamamlanma kaydı kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`UI/UX tamamlanma kaydı doğrulandı: ${slices.length} dilim, statik ve canlı kanıt durumları ayrık.`);

function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) failures.push(`${field} boş olamaz.`);
}

function requireList(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    failures.push(`${field} boş olmayan metin listesi olmalı.`);
  }
}
