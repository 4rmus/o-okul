import { readFileSync } from "node:fs";

const files = {
  packageJson: readFileSync("package.json", "utf8"),
  prisma: readFileSync("packages/db/prisma/schema.prisma", "utf8"),
  supportStorage: readFileSync("apps/api/src/support-ticket/support-ticket-attachment-storage.ts", "utf8"),
  homeworkStorage: readFileSync("apps/api/src/homework/homework-material-file-storage.ts", "utf8"),
  rawImportUpload: readFileSync("apps/api/src/exam/raw-import-upload.service.ts", "utf8"),
  supportService: readFileSync("apps/api/src/support-ticket/support-ticket.service.ts", "utf8"),
  homeworkService: readFileSync("apps/api/src/homework/homework.service.ts", "utf8"),
  inlineMigration: readFileSync("scripts/migrate-inline-upload-content-to-s3-live.mjs", "utf8"),
  orphanAudit: readFileSync("scripts/audit-inline-upload-orphan-s3-live.mjs", "utf8"),
  productionReadiness: readFileSync("docs/phase-6-production-readiness.md", "utf8"),
  opsRunbook: readFileSync("docs/phase-6-ops-runbook.md", "utf8"),
};

const failures = [];

requireTokens("package.json", files.packageJson, [
  "\"upload-retention:check\": \"node scripts/check-upload-retention-contract.mjs\"",
  "pnpm upload-retention:check",
]);

requireModelTokens("HomeworkMaterialFile", [
  "deletedAt   DateTime?",
  "@@index([tenantId, materialId, deletedAt])",
  "@@index([tenantId, sha256])",
]);
requireModelTokens("SupportTicketAttachment", [
  "deletedAt   DateTime?",
  "@@index([tenantId, ticketId, deletedAt])",
  "@@index([tenantId, sha256])",
]);
requireModelTokens("RawImport", [
  "deletedAt           DateTime?",
  "@@index([tenantId, deletedAt])",
  "@@index([tenantId, sha256])",
]);

requireTokens("apps/api/src/support-ticket/support-ticket-attachment-storage.ts", files.supportStorage, [
  "function createSupportAttachmentStorageKey",
  "\"support-ticket-attachments\"",
  "input.tenantId",
  "input.ticketId",
  "input.sha256",
  "\"source\"",
  "encodeURIComponent",
]);
requireNoTokens("apps/api/src/support-ticket/support-ticket-attachment-storage.ts", files.supportStorage, [
  "[\"support-ticket-attachments\", input.sha256].join(\"/\")",
]);

requireTokens("apps/api/src/homework/homework-material-file-storage.ts", files.homeworkStorage, [
  "function createHomeworkMaterialFileStorageKey",
  "\"homework-material-files\"",
  "input.tenantId",
  "input.materialId",
  "input.sha256",
  "\"source\"",
  "encodeURIComponent",
]);
requireNoTokens("apps/api/src/homework/homework-material-file-storage.ts", files.homeworkStorage, [
  "[\"homework-material-files\", input.sha256].join(\"/\")",
]);

requireTokens("apps/api/src/exam/raw-import-upload.service.ts", files.rawImportUpload, [
  "createRawImportS3Key",
  "\"raw-imports\"",
  "input.tenantId",
  "input.examId",
  "input.parserConfigVersion",
  "input.sha256",
  "\"source\"",
  "encodeURIComponent",
]);

requireTokens("apps/api/src/support-ticket/support-ticket.service.ts", files.supportService, [
  ".filter(",
  "(attachment) => !attachment.deletedAt",
  "if (!attachment || attachment.deletedAt || attachment.ticketId !== ticket.id)",
]);
requireTokens("apps/api/src/homework/homework.service.ts", files.homeworkService, [
  ".filter((file) => !file.deletedAt)",
  "if (!file || file.deletedAt || file.materialId !== material.id)",
]);

requireTokens("scripts/migrate-inline-upload-content-to-s3-live.mjs", files.inlineMigration, [
  "parentColumn",
  "row[subject.parentColumn]",
  "row.tenantId",
  "row.sha256",
  "\"source\"",
  "encodeURIComponent",
]);
requireNoTokens("scripts/migrate-inline-upload-content-to-s3-live.mjs", files.inlineMigration, [
  "[subject.prefix, row.sha256].join(\"/\")",
]);

requireTokens("scripts/audit-inline-upload-orphan-s3-live.mjs", files.orphanAudit, [
  "isTenantScopedStorageKey",
  "[^/]+/[^/]+/[a-f0-9]{64}/source",
  "legacyDbStorageKeyRows",
]);
requireNoTokens("scripts/audit-inline-upload-orphan-s3-live.mjs", files.orphanAudit, [
  "isHashOnlyStorageKey",
  "[a-f0-9]{64}$",
]);

for (const [label, content] of [
  ["docs/phase-6-production-readiness.md", files.productionReadiness],
  ["docs/phase-6-ops-runbook.md", files.opsRunbook],
]) {
  requireTokens(label, content, [
    "upload-retention:check",
    "support-ticket-attachments/<tenantId>/<ticketId>/<sha256>/source",
    "homework-material-files/<tenantId>/<materialId>/<sha256>/source",
    "raw-imports/<tenantId>/<examId>/<parserConfigVersion>/<sha256>/source",
  ]);
}

if (failures.length > 0) {
  console.error("Upload retention contract kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Upload retention contract kontrolü geçti.");

function requireModelTokens(modelName, expectedTokens) {
  const block = readPrismaModel(modelName);
  if (!block) {
    failures.push(`schema.prisma model ${modelName} bulunamadı.`);
    return;
  }
  requireTokens(`schema.prisma model ${modelName}`, block, expectedTokens);
}

function readPrismaModel(modelName) {
  const start = files.prisma.indexOf(`model ${modelName} {`);
  if (start === -1) return undefined;
  const nextModel = files.prisma.indexOf("\nmodel ", start + 1);
  return files.prisma.slice(start, nextModel === -1 ? files.prisma.length : nextModel);
}

function requireTokens(label, content, tokens) {
  for (const token of tokens) {
    if (!content.includes(token)) {
      failures.push(`${label} eksik token: ${token}`);
    }
  }
}

function requireNoTokens(label, content, tokens) {
  for (const token of tokens) {
    if (content.includes(token)) {
      failures.push(`${label} yasak token içeriyor: ${token}`);
    }
  }
}
