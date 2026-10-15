import { Inject, Injectable, Optional } from "@nestjs/common";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { authUserStoreToken, type AuthUser, type AuthUserStore } from "../auth/auth-user-store.js";
import { authSessionStoreToken, type SessionStore } from "../auth/session-store.js";
import type { RequestContext } from "../context/request-context.js";

export type LinkedAccountPurgeOutcome = "PURGED" | "KEPT_OTHER_IDENTITY" | "NONE";
export type LinkedAccountSubject = "GUARDIAN" | "TEACHER";

const staffRoles = ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF"];

// KVKK purge of the login account bound to a purged guardian or teacher record (DEC-20261016-01; replaces the
// self-service POST /privacy/me/purge-pii). The account is anonymised, disabled and signed out only when it carries
// no other identity: a teacher who is also staff, a student or a guardian keeps the account, otherwise purging one
// record would lock the person out of the others.
@Injectable()
export class AccountPiiPurgeService {
  constructor(
    @Inject(authUserStoreToken) private readonly users: AuthUserStore,
    @Inject(authSessionStoreToken) private readonly sessions: SessionStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async purgeLinkedAccount(context: RequestContext, userId: string | undefined, subject: LinkedAccountSubject): Promise<LinkedAccountPurgeOutcome> {
    if (!userId) return "NONE";
    const user = await this.users.findById(userId);
    if (!user || user.tenantId !== context.tenantId || user.purgedAt) return "NONE";
    if (hasOtherIdentity(user, subject)) return "KEPT_OTHER_IDENTITY";

    const hadEmail = (user.email ?? "").length > 0;
    const hadName = user.name.length > 0;
    const purged = await this.users.purgePii(user.id, {
      email: `purged-${user.id}@example.invalid`,
      name: "Anonim Kullanici",
      purgedAt: new Date().toISOString(),
    });
    if (!purged) return "NONE";
    await this.sessions.revokeByUser(user.id, { tenantId: user.tenantId, membershipVersion: purged.membershipVersion });
    await this.auditLogs?.record({
      tenantId: user.tenantId,
      actorUserId: context.userId,
      entityType: "Auth",
      entityId: user.id,
      action: "kvkk.user_pii_purged",
      diff: {
        fieldsPurged: ["email", "name"],
        before: { emailPresent: hadEmail, namePresent: hadName },
        triggerType: subject === "GUARDIAN" ? "GUARDIAN_PII_PURGE" : "TEACHER_PII_PURGE",
      },
    });
    return "PURGED";
  }
}

export function hasOtherIdentity(user: Pick<AuthUser, "roles" | "membership">, subject: LinkedAccountSubject): boolean {
  const membership = user.membership;
  const otherRoles = user.roles.filter((role) => role !== subject);
  if (otherRoles.some((role) => staffRoles.includes(role) || ["TEACHER", "STUDENT", "GUARDIAN", "SYSTEM_ADMIN"].includes(role))) return true;
  if (membership?.staffRole || membership?.hasStudentPersona) return true;
  return subject === "GUARDIAN" ? Boolean(membership?.hasTeacherPersona) : false;
}
