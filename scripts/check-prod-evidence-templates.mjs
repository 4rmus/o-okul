import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const templateChecks = [
  [
    "Restore drill template",
    "RESTORE_DRILL_TARGET",
    "docs/evidence-templates/restore-drill.example.json",
    "scripts/check-restore-drill-evidence.mjs",
  ],
  [
    "KVKK inventory template",
    "KVKK_INVENTORY_TARGET",
    "docs/evidence-templates/kvkk-inventory.example.json",
    "scripts/check-kvkk-inventory-evidence.mjs",
  ],
  [
    "Identity migration template",
    "IDENTITY_MIGRATION_TARGET",
    "docs/evidence-templates/identity-migration.example.json",
    "scripts/check-identity-migration-evidence.mjs",
  ],
  [
    "Financial retention template",
    "FINANCIAL_RETENTION_TARGET",
    "docs/evidence-templates/financial-retention.example.json",
    "scripts/check-financial-retention-evidence.mjs",
  ],
  [
    "Upload AV template",
    "UPLOAD_AV_TARGET",
    "docs/evidence-templates/upload-av.example.json",
    "scripts/check-upload-av-evidence.mjs",
  ],
  [
    "Observability UAT template",
    "OBSERVABILITY_UAT_TARGET",
    "docs/evidence-templates/observability-uat.example.json",
    "scripts/check-observability-uat-evidence.mjs",
  ],
  [
    "Deployment region template",
    "DEPLOYMENT_REGION_TARGET",
    "docs/evidence-templates/deployment-region.example.json",
    "scripts/check-deployment-region-evidence.mjs",
  ],
  [
    "Security audit template",
    "SECURITY_AUDIT_TARGET",
    "docs/evidence-templates/security-audit.example.json",
    "scripts/check-security-audit-evidence.mjs",
  ],
  ["UAT template", "UAT_EVIDENCE_TARGET", "docs/evidence-templates/uat.example.json", "scripts/check-uat-evidence.mjs"],
];

for (const [label, envKey, templatePath, script] of templateChecks) {
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      [envKey]: pathToFileURL(templatePath).href,
    },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`Production evidence template kontrolü başarısız: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log("Production evidence template kontrolü geçti.");
