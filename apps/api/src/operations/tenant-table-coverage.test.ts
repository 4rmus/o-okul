import { getTenantScopedTables } from "@o-okul/db";
import { describe, expect, it } from "vitest";
import { deviceRestoreTablePolicy } from "./device-backup-impact.js";
import { deviceBackupTables } from "./device-backup.service.js";
import { tenantDataExportTableNames } from "./tenant-data-export-store.js";

// Strategy plan condition 3: a new tenant table enters the KVKK export in the same PR, or is listed here with a reason.
const exportExceptions = {
  // Accounts, sessions and tokens: credentials and transient auth state, not institution-entered records.
  User: "AUTH", TenantMembership: "AUTH", MembershipCampusScope: "AUTH", AuthSession: "AUTH",
  IdempotencyKey: "AUTH", IdentityInvitation: "AUTH", NotificationDeviceToken: "AUTH",
  // Platform operation records owned by the provider, not the institution.
  LicenseTerm: "PLATFORM", LicenseUsage: "PLATFORM", AuditLog: "PLATFORM", BackupRestoreJob: "PLATFORM",
  TenantFreshResetOperation: "PLATFORM", TenantMutationActivity: "PLATFORM",
  // Configuration, reference structure and delivery bookkeeping without personal data.
  ParserConfig: "TECHNICAL", OpticalFormTemplate: "TECHNICAL", ExamBookletVariant: "TECHNICAL", Alan: "TECHNICAL",
  GradeLevelCourse: "TECHNICAL", LearningOutcome: "TECHNICAL", HomeworkMaterialFile: "TECHNICAL",
  AnnouncementDeliveryReport: "TECHNICAL", SmsBatchDeliveryReport: "TECHNICAL",
  // Personal data not exported yet. Open KVKK decision (strategy plan §4.5); do not add tables here to pass CI.
  Employee: "OPEN_KVKK_DECISION", StudentContact: "OPEN_KVKK_DECISION", WhatsAppConsent: "OPEN_KVKK_DECISION",
  WhatsAppConsentEvent: "OPEN_KVKK_DECISION", PaymentTransaction: "OPEN_KVKK_DECISION",
  DevelopmentCriterion: "OPEN_KVKK_DECISION", DevelopmentAssessment: "OPEN_KVKK_DECISION", DevelopmentScore: "OPEN_KVKK_DECISION",
  ScheduleLesson: "OPEN_KVKK_DECISION", StudySession: "OPEN_KVKK_DECISION", StudySessionStudent: "OPEN_KVKK_DECISION",
  Homework: "OPEN_KVKK_DECISION", RawImport: "OPEN_KVKK_DECISION", ParsedAnswer: "OPEN_KVKK_DECISION",
  ImportQuarantine: "OPEN_KVKK_DECISION", AnnouncementReceipt: "OPEN_KVKK_DECISION",
} as const satisfies Record<string, "AUTH" | "PLATFORM" | "TECHNICAL" | "OPEN_KVKK_DECISION">;

describe("tenant table coverage", () => {
  const scoped = getTenantScopedTables();
  const exported = new Set(tenantDataExportTableNames);

  it("every tenant table is in the KVKK export or has a recorded exception", () => {
    expect(scoped.filter((table) => !exported.has(table) && !(table in exportExceptions))).toEqual([]);
  });

  it("exceptions stay current: none is exported and none names a removed table", () => {
    expect(Object.keys(exportExceptions).filter((table) => exported.has(table) || !scoped.includes(table))).toEqual([]);
  });

  it("every device-backed-up table has a restore policy", () => {
    expect(deviceBackupTables.filter((table) => !deviceRestoreTablePolicy(table))).toEqual([]);
  });
});
