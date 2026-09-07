// Internal operations entry point. Running this command writes ONLY to separately
// approved backup + empty disposable restore targets; it never performs a reset.
import { createAndVerifyTenantResetBackup } from "../apps/api/dist/tenant/tenant-reset-backup.js";
import { resetS3Config } from "../apps/api/dist/tenant/tenant-reset-objects.js";
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error("RESET_APPROVAL_CONTEXT_INVALID");
  return value;
};
try {
  if (process.env.TENANT_RESET_BACKUP_ACTION !== "BACKUP_AND_ISOLATED_RESTORE") throw new Error("RESET_APPROVAL_CONTEXT_INVALID");
  const result = await createAndVerifyTenantResetBackup({
    tenantId: required("TENANT_RESET_BACKUP_TENANT_ID"), operationId: required("TENANT_RESET_BACKUP_OPERATION_ID"),
    approvalReference: required("TENANT_RESET_BACKUP_APPROVAL_REFERENCE"), encryptionKey: Buffer.from(required("TENANT_RESET_BACKUP_KEY_BASE64"), "base64"),
    sourceDatabaseUrl: required("DATABASE_URL"), restoreDatabaseUrl: required("TENANT_RESET_RESTORE_DATABASE_URL"),
    sourceObjects: resetS3Config(), backupObjects: resetS3Config("TENANT_RESET_BACKUP_S3"), restoreObjects: resetS3Config("TENANT_RESET_RESTORE_S3"),
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof Error && /^RESET_[A-Z_]+$/.test(error.message) ? error.message : "RESET_BACKUP_VERIFICATION_FAILED");
  process.exitCode = 1;
}
