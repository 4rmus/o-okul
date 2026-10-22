import { randomUUID } from "node:crypto";
import { encryptSecretDeliveryPayload, type SecretDeliveryPayload } from "@o-okul/db";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withBypassRlsQuery } from "../db/tenant-query.js";

/**
 * DEC-20261021-01: "bu işlemi siz yapmadıysanız" notices to the registered e-mail of a tenant OWNER/ADMIN when a
 * SYSTEM_ADMIN resets their MFA and when the re-enrollment completes. The notice reuses the encrypted
 * secret-delivery outbox the password-reset and invitation mails go through (the worker sends it), but carries no
 * code, link or secret. Rows are system-scoped (platform action: tenantId NULL), so tenant reset and device backup
 * never inventory them; the worker redacts the payload on delivery or expiry.
 */
export type MfaSecurityNoticeKind = "MFA_RESET_BY_SUPPORT" | "MFA_REENROLLED";

export interface MfaSecurityNoticeInput {
  kind: MfaSecurityNoticeKind;
  to: string;
  tenantName?: string;
}

export interface MfaSecurityNoticeStore {
  enqueue(input: MfaSecurityNoticeInput): Promise<void>;
}

export const mfaSecurityNoticeStoreToken = Symbol("MfaSecurityNoticeStore");

export const mfaSecurityNoticeTtlMs = 24 * 60 * 60 * 1000;

export function mfaSecurityNoticePayload(input: MfaSecurityNoticeInput): SecretDeliveryPayload {
  const institution = input.tenantName?.trim() ? ` (${input.tenantName.trim()})` : "";
  const notYou = "Bu işlemi siz yapmadıysanız veya destek hattından bu talepte bulunmadıysanız hemen kurumunuzun yetkilisine ve O-Okul desteğine bildirin.";
  if (input.kind === "MFA_RESET_BY_SUPPORT") {
    return {
      channel: "EMAIL",
      to: input.to,
      subject: "O-Okul: iki adımlı doğrulamanız sıfırlandı",
      body: [
        `O-Okul yönetici hesabınızın${institution} iki adımlı doğrulama (MFA) kaydı destek ekibi tarafından sıfırlandı ve açık oturumlarınız kapatıldı.`,
        "Yeniden kurmak için destek ekibinin kurumunuzun kayıtlı telefonunu arayarak size sözlü ilettiği tek kullanımlık kodu girmeniz gerekir; kod 24 saat geçerlidir.",
        notYou,
      ].join("\n\n"),
    };
  }
  return {
    channel: "EMAIL",
    to: input.to,
    subject: "O-Okul: iki adımlı doğrulamanız yeniden kuruldu",
    body: [
      `O-Okul yönetici hesabınız${institution} için yeni bir doğrulama uygulaması kaydedildi ve iki adımlı doğrulama yeniden açıldı.`,
      notYou,
    ].join("\n\n"),
  };
}

export class InMemoryMfaSecurityNoticeStore implements MfaSecurityNoticeStore {
  readonly notices: MfaSecurityNoticeInput[] = [];

  async enqueue(input: MfaSecurityNoticeInput): Promise<void> {
    encryptSecretDeliveryPayload(mfaSecurityNoticePayload(input));
    this.notices.push({ ...input });
  }
}

export class PostgresMfaSecurityNoticeStore implements MfaSecurityNoticeStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async enqueue(input: MfaSecurityNoticeInput): Promise<void> {
    const payloadEncrypted = encryptSecretDeliveryPayload(mfaSecurityNoticePayload(input));
    const expiresAt = new Date(Date.now() + mfaSecurityNoticeTtlMs).toISOString();
    await withBypassRlsQuery(this.pool, async (client) => {
      await client.query(
        `INSERT INTO "SecretDeliveryOutbox" (
           "id", "tenantId", "purpose", "sourceId", "payloadEncrypted", "status", "availableAt", "expiresAt", "updatedAt", "sourceScope", "tenantLifecycleVersion"
         ) VALUES ($1, NULL, 'MFA_SECURITY_NOTICE', $2, $3, 'PENDING', now(), $4, now(), 'SYSTEM', NULL)`,
        // sourceId is a random notice id: the row does not link back to the account or the tenant.
        [randomUUID(), randomUUID(), payloadEncrypted, expiresAt],
      );
    });
  }
}

export function createMfaSecurityNoticeStore(): MfaSecurityNoticeStore {
  return resolvePersistenceDriver(process.env.AUTH_USER_STORE) === "postgres"
    ? new PostgresMfaSecurityNoticeStore()
    : new InMemoryMfaSecurityNoticeStore();
}
