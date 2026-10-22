-- DEC-20261021-01: a SYSTEM_ADMIN reset of a tenant OWNER/ADMIN MFA leaves a one-time re-enrollment code behind.
-- Only a keyed hash (HMAC-SHA256, key derived from ADMIN_MFA_RECOVERY_HASH_KEY) and its expiry are stored; both
-- columns stay NULL for every other path (new-account first enrollment, self-service disable, the runbook's DB
-- recovery of a system admin), so those paths keep their behaviour. Nullable columns without a default: metadata-only
-- ADD COLUMN; the CHECK scan of "User" is short (NULL on every existing row).
ALTER TABLE "User"
  ADD COLUMN "totpReenrollmentCodeHash" TEXT,
  ADD COLUMN "totpReenrollmentExpiresAt" TIMESTAMPTZ(6);

ALTER TABLE "User" ADD CONSTRAINT "User_totp_reenrollment_pair_check" CHECK (
  ("totpReenrollmentCodeHash" IS NULL) = ("totpReenrollmentExpiresAt" IS NULL)
);
-- A pending re-enrollment only exists while TOTP is off; enabling TOTP clears it in the same statement.
ALTER TABLE "User" ADD CONSTRAINT "User_totp_reenrollment_disabled_check" CHECK (
  "totpReenrollmentCodeHash" IS NULL OR ("totpSecretEncrypted" IS NULL AND "totpEnabledAt" IS NULL)
);

-- Reset / re-enrollment notices to the account's registered e-mail reuse the encrypted secret-delivery outbox.
-- They carry no secret and are always system-scoped (platform action): tenantId stays NULL, so tenant reset,
-- device backup/restore and their worker policies never see them; the payload is redacted on delivery or expiry.
ALTER TABLE "SecretDeliveryOutbox" DROP CONSTRAINT "SecretDeliveryOutbox_purpose_check";
ALTER TABLE "SecretDeliveryOutbox" ADD CONSTRAINT "SecretDeliveryOutbox_purpose_check"
  CHECK ("purpose" IN ('PASSWORD_RESET', 'IDENTITY_INVITATION', 'MFA_SECURITY_NOTICE'));
ALTER TABLE "SecretDeliveryOutbox" ADD CONSTRAINT "SecretDeliveryOutbox_mfa_notice_scope_check" CHECK (
  "purpose" <> 'MFA_SECURITY_NOTICE' OR ("sourceScope" = 'SYSTEM' AND "tenantId" IS NULL AND "tenantLifecycleVersion" IS NULL)
);
