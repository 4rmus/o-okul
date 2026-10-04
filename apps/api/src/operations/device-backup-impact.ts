import type { TenantDeviceBackupPreview } from "@o-okul/shared-types";
import type { DeviceBackupPayload } from "./device-backup.service.js";

import { deviceRestoreReferences, type DeviceRestoreForeignKey } from "./device-backup-references.js";

import { deviceDomainLinks, type DeviceDomainRows } from "./device-backup-domain-links.js";

const finance = new Set(["PaymentPlan", "PaymentInstallment", "PaymentTransaction"]);
const consent = new Set(["WhatsAppConsent", "WhatsAppConsentEvent", "StudentContact", "GuardianStudent"]);
const support = new Set(["SupportTicket", "SupportTicketAttachment", "SupportTicketComment"]);
const delivery = new Set(["Announcement", "AnnouncementReceipt", "AnnouncementDeliveryReport", "SmsBatchDeliveryReport"]);
// Published school grades are history (ADR-0011): restore keeps the current rows, the DB refuses rewrites.
const grades = new Set(["GradeAssessment", "GradeEntry"]);
const replaceTables = new Set(["Employee","DevelopmentCriterion","DevelopmentAssessment","DevelopmentScore","Class","GradeLevel","Alan","Campus","Course","GradeLevelCourse","AcademicYear","AcademicTerm","Student","StudentEnrollment","Teacher","TeacherAssignment","Guardian","Attendance","TeacherNote","ScheduleLesson","StudySession","StudySessionStudent","HomeworkMaterial","HomeworkMaterialFile","HomeworkMaterialAssignment","Homework","Exam","ParserConfig","OpticalFormTemplate","ExamParticipant","RawImport","AnswerKey","ExamBookletVariant","LearningOutcome","ParsedAnswer","ExamResult","ImportQuarantine","ReportSnapshot","MessageTemplate"]);
const identities = new Set(["Tenant", "User"]);
const profileTables = new Set(["Student", "Teacher", "Guardian", "Employee"]);

export function deviceRestoreTablePolicy(table: string): "PRESERVE" | "REPLACE" | undefined {
  if (finance.has(table) || consent.has(table) || support.has(table) || delivery.has(table) || grades.has(table) || identities.has(table)) return "PRESERVE";
  return replaceTables.has(table) ? "REPLACE" : undefined;
}

/** Counts only: no row identifiers, contact details, national IDs or money values leave this planner. */
export function deviceBackupImpact(archive: DeviceBackupPayload, current: DeviceBackupPayload, activeStudentLimit: number | null, foreignKeys?: readonly DeviceRestoreForeignKey[], domainRows?: DeviceDomainRows): NonNullable<TenantDeviceBackupPreview["impact"]> {
  if (archive.tenantId !== current.tenantId || archive.schemaDigest !== current.schemaDigest || JSON.stringify(Object.keys(archive.tables).sort()) !== JSON.stringify(Object.keys(current.tables).sort())) throw new Error("DEVICE_RESTORE_COMPARISON_MISMATCH");
  const blockers = new Set<string>(["DEVICE_RESTORE_WORK_QUIESCENCE_UNVERIFIED", "DEVICE_RESTORE_FILES_UNVERIFIED"]);
  const tables: NonNullable<TenantDeviceBackupPreview["impact"]>["tables"] = {};
  let additions = 0, changes = 0, removals = 0, retainedHistory = 0;
  for (const [table, entries] of Object.entries(archive.tables)) {
    const old = new Map(current.tables[table]!.map(e => [JSON.parse(e.row).id as string,e]));
    const next = new Map(entries.map(e => [JSON.parse(e.row).id as string,e]));
    const policy = deviceRestoreTablePolicy(table);
    if (!policy) blockers.add("DEVICE_RESTORE_POLICY_UNCLASSIFIED");
    const preserve = policy !== "REPLACE";
    let added = 0, changed = 0, removed = 0, unchanged = 0;
    for (const [id, entry] of next) { const prior = old.get(id); if (!prior) added++; else if (prior.row !== entry.row || prior.nationalId !== entry.nationalId) changed++; else unchanged++; }
    for (const id of old.keys()) if (!next.has(id)) removed++;
    tables[table] = { policy: preserve ? "PRESERVE" : "REPLACE", added, changed, removed, unchanged };
    if (!preserve) { additions += added; changes += changed; removals += removed; }
    if (finance.has(table) || consent.has(table) || support.has(table) || delivery.has(table) || grades.has(table)) retainedHistory += old.size;
    if (added + changed + removed && finance.has(table)) blockers.add("DEVICE_RESTORE_FINANCE_DIFFERENCE");
    if (added + changed + removed && consent.has(table)) blockers.add("DEVICE_RESTORE_CONSENT_DIFFERENCE");
    if (added + changed + removed && support.has(table)) blockers.add("DEVICE_RESTORE_SUPPORT_DIFFERENCE");
    if (added + changed + removed && delivery.has(table)) blockers.add("DEVICE_RESTORE_DELIVERY_HISTORY_DIFFERENCE");
    if (table === "User" && added + changed + removed) blockers.add("DEVICE_RESTORE_IDENTITY_RECONCILIATION_REQUIRED");
    if (profileTables.has(table)) for (const id of new Set([...old.keys(),...next.keys()])) {
      const before = old.get(id), after = next.get(id);
      const previous = before ? JSON.parse(before.row).userId : null, proposed = after ? JSON.parse(after.row).userId : null;
      if ((previous ?? null) !== (proposed ?? null)) blockers.add("DEVICE_RESTORE_ACCOUNT_LINK_CHANGE");
    }
  }
  const references = foreignKeys === undefined ? undefined : deviceRestoreReferences(archive,current,tables,foreignKeys);
  if (references?.conflicts.length) blockers.add("DEVICE_RESTORE_REFERENCE_CONFLICT");
  if (references?.unverified.length) blockers.add("DEVICE_RESTORE_FOREIGN_KEYS_UNVERIFIED");
  if (retainedHistory && additions + changes + removals) blockers.add(references && !references.unverified.length ? "DEVICE_RESTORE_DOMAIN_REFERENCES_UNVERIFIED" : "DEVICE_RESTORE_PROTECTED_DEPENDENCIES_UNVERIFIED");
  const domainLinks = domainRows ? deviceDomainLinks(archive,current,tables,domainRows) : undefined;
  if (domainLinks?.conflicts.length) blockers.add("DEVICE_RESTORE_DOMAIN_LINK_CONFLICT");
  if (domainLinks?.unverified.length) blockers.add("DEVICE_RESTORE_DOMAIN_LINK_UNVERIFIED");
  if (domainLinks?.pendingDeliveries) blockers.add("DEVICE_RESTORE_DELIVERIES_UNRESOLVED");
  const enrollments = new Map<string,number>();
  for (const e of archive.tables.StudentEnrollment ?? []) { const r = JSON.parse(e.row); if (r.status === "ACTIVE" && r.endsAt == null) enrollments.set(r.studentId,(enrollments.get(r.studentId) ?? 0)+1); }
  if ([...enrollments.values()].some(n=>n>1)) blockers.add("DEVICE_RESTORE_ENROLLMENT_CONFLICT");
  const activeStudents = (archive.tables.Student ?? []).filter(e=>{const r=JSON.parse(e.row);return r.status === "ACTIVE" && r.deletedAt == null && enrollments.get(r.id) === 1;}).length;
  const limit = Number.isSafeInteger(activeStudentLimit) && activeStudentLimit! > 0 ? activeStudentLimit : null;
  if (limit === null) blockers.add("DEVICE_RESTORE_CURRENT_LICENSE_UNVERIFIED");
  else if (activeStudents > limit) blockers.add("DEVICE_RESTORE_STUDENT_LIMIT_EXCEEDED");
  return { additions, changes, removals, tables, references, domainLinks, activeStudents, activeStudentLimit: limit, preserved: ["FINANCE", "CONSENT", "SUPPORT", "DELIVERY_HISTORY", "IDENTITY", "LICENSE", "AUDIT", "SESSIONS"], blockers: [...blockers].sort(), canApply: false };
}
