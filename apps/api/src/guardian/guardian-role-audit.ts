import type { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { type GuardianRoleEndWrite, type GuardianStudentCreateWrite, guardianRoleEndedReason } from "../school/guardian-student-store.js";
import type { StudentContactDeleteWrite } from "../student/student-contact-store.js";

type Audit = Pick<AuditLogService, "record"> | undefined;

/** KV-3c: the last link of a staff+guardian user ended GUARDIAN (GuardianStudentStore.delete rule). */
export async function recordGuardianRoleRemoved(
  auditLogs: Audit,
  context: RequestContext,
  tenantId: string,
  guardianId: string,
  write: Partial<GuardianRoleEndWrite>,
): Promise<void> {
  if (!write.guardianRoleRemovedUserId) return;
  await auditLogs?.record({
    tenantId,
    actorUserId: context.userId,
    entityType: "User",
    entityId: write.guardianRoleRemovedUserId,
    action: "user.guardian_role_removed",
    diff: { role: "GUARDIAN", guardianId, reason: guardianRoleEndedReason, otherRolesKept: true, sessionsRevoked: write.sessionsRevoked ?? 0 },
  });
}

/** KV-3c security review (R2): relinking made a GUARDIAN membership ended by the last-link rule ACTIVE again. */
export async function recordGuardianRoleRestored(
  auditLogs: Audit,
  context: RequestContext,
  tenantId: string,
  guardianId: string,
  write: Partial<Omit<GuardianStudentCreateWrite, "link">>,
): Promise<void> {
  if (!write.guardianRoleRestoredUserId) return;
  await auditLogs?.record({
    tenantId,
    actorUserId: context.userId,
    entityType: "User",
    entityId: write.guardianRoleRestoredUserId,
    action: "user.guardian_role_added",
    diff: { role: "GUARDIAN", guardianId, previousEndedReason: guardianRoleEndedReason, existingRolesKept: true, sessionsRevoked: write.sessionsRevoked ?? 0 },
  });
}

/** KV-3c security review (R4): a contact delete or purge removed the access link the contact flow created. */
export async function recordContactGuardianRemoval(
  auditLogs: Audit,
  context: RequestContext,
  tenantId: string,
  write: StudentContactDeleteWrite,
  source: "student_contact.deleted" | "kvkk.student_contact_pii_purged",
): Promise<void> {
  if (!write.guardianId || !write.guardianStudentRemoved) return;
  await auditLogs?.record({
    tenantId,
    actorUserId: context.userId,
    entityType: "GuardianStudent",
    entityId: `${write.guardianId}:${write.studentId}`,
    action: "guardian_student.unlinked",
    diff: { guardianId: write.guardianId, studentId: write.studentId, source },
  });
  await recordGuardianRoleRemoved(auditLogs, context, tenantId, write.guardianId, write);
}
