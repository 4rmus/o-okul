import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { TenantQueryable } from "../db/tenant-query.js";
import { encryptStudentContactValue } from "../student/student-contact-pii.js";
import { createTenantHandoverExport, tenantDataExportTableNames, tenantHandoverExportTableNames } from "./tenant-data-export-store.js";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const inline = Buffer.from("inline homework sheet");
const stored = Buffer.from("stored support attachment");
const raw = Buffer.from("raw optical file");
const photo = Buffer.from("student photo");

function fixture(overrides: { files?: Record<string, unknown[]> } = {}) {
  const files: Record<string, unknown[]> = {
    HomeworkMaterialFile: [{ id: "hf-1", fileName: "sheet.pdf", contentType: "application/pdf", byteSize: inline.length, sha256: sha(inline), contentBase64: inline.toString("base64"), objectKey: null }],
    SupportTicketAttachment: [{ id: "sa-1", fileName: "shot.png", contentType: "image/png", byteSize: stored.length, sha256: sha(stored), contentBase64: null, objectKey: "support-ticket-attachments/tenant-a/t-1/x/source" }],
    RawImport: [{ id: "ri-1", fileName: "optik.txt", contentType: null, byteSize: null, sha256: sha(raw), contentBase64: null, objectKey: "raw-imports/tenant-a/e/v1/x/source" }],
    Student: [{ id: "st-1", fileName: "photo.jpg", contentType: null, byteSize: null, sha256: null, contentBase64: null, objectKey: "students/st-1/photo.jpg" }],
    ...overrides.files,
  };
  const objects: Record<string, Buffer> = { "support-ticket-attachments/tenant-a/t-1/x/source": stored, "raw-imports/tenant-a/e/v1/x/source": raw, "students/st-1/photo.jpg": photo };
  const query = vi.fn(async (sql: string, _values: unknown[] = []) => {
    if (sql.includes("jsonb_agg")) {
      const table = /FROM "(\w+)"/.exec(sql)?.[1];
      if (table === "StudentContact") return { rows: [{ rows: [{ id: "sc-1", firstName: "Veli", phoneEncrypted: encryptStudentContactValue("5550000001"), emailEncrypted: null }] }] };
      if (table === "AuditLog") return { rows: [{ rows: [{ id: "audit-1", action: "student.created" }] }] };
      if (table === "WhatsAppConsent") return { rows: [{ rows: [{ id: "wc-1", purpose: "ANNOUNCEMENT" }] }] };
      return { rows: [{ rows: [] }] };
    }
    const fileTable = /^SELECT "id", .* FROM "(\w+)" WHERE/s.exec(sql)?.[1];
    return { rows: fileTable ? files[fileTable] ?? [] : [] };
  });
  const readObject = vi.fn(async (key: string) => { const bytes = objects[key]; if (!bytes) throw new Error("NoSuchKey"); return bytes; });
  return { pool: { query } as unknown as TenantQueryable, query, readObject, objects };
}

describe("license-expiry purge handover export (product owner decision 2026-10-10)", () => {
  it("contains consent/contact tables, the tenant's AuditLog and every file with verified bytes", async () => {
    const f = fixture();
    const payload = await createTenantHandoverExport(f.pool, "tenant-a", "system-user", "e".repeat(32), f.readObject);
    expect(payload).toMatchObject({ formatVersion: "tenant-export-v1", scope: "license-expiry-purge-handover", rowLimitPerTable: null, warnings: [] });
    expect(payload.tables.whatsAppConsents).toEqual([{ id: "wc-1", purpose: "ANNOUNCEMENT" }]);
    expect(payload.tables).toHaveProperty("whatsAppConsentEvents");
    expect(payload.tables.auditLogs).toEqual([{ id: "audit-1", action: "student.created" }]);
    // Contact values are decrypted for the institution; ciphertext never leaves.
    expect(payload.tables.studentContacts).toEqual([{ id: "sc-1", firstName: "Veli", phone: "5550000001", email: null }]);
    expect(payload.files).toEqual([
      { table: "HomeworkMaterialFile", rowId: "hf-1", fileName: "sheet.pdf", contentType: "application/pdf", byteSize: inline.length, sha256: sha(inline), contentBase64: inline.toString("base64") },
      { table: "SupportTicketAttachment", rowId: "sa-1", fileName: "shot.png", contentType: "image/png", byteSize: stored.length, sha256: sha(stored), contentBase64: stored.toString("base64") },
      { table: "RawImport", rowId: "ri-1", fileName: "optik.txt", contentType: null, byteSize: raw.length, sha256: sha(raw), contentBase64: raw.toString("base64") },
      { table: "Student", rowId: "st-1", fileName: "photo.jpg", contentType: null, byteSize: photo.length, sha256: sha(photo), contentBase64: photo.toString("base64") },
    ]);
    expect(f.readObject.mock.calls.map(([key]) => key)).toEqual(["support-ticket-attachments/tenant-a/t-1/x/source", "raw-imports/tenant-a/e/v1/x/source", "students/st-1/photo.jpg"]);
    // Every read is tenant-filtered, unlimited and drops secrets, lookup hashes and object keys from rows.
    const reads = f.query.mock.calls.filter(([sql]) => sql.includes("jsonb_agg"));
    expect(reads).toHaveLength(tenantHandoverExportTableNames.length);
    for (const [sql, values] of reads) {
      expect(sql).toContain(`"tenantId" = current_setting('app.current_tenant_id', true)`);
      expect(values![0]).toBeNull();
      expect(values![1]).toEqual(expect.arrayContaining(["tenantId", "nationalIdEncrypted", "nationalIdHash", "phoneHash", "emailHash", "contentBase64", "storageKey", "s3Key", "photoKey"]));
    }
    const fileReads = f.query.mock.calls.filter(([sql]) => /^SELECT "id", /.test(sql));
    expect(fileReads).toHaveLength(4);
    for (const [sql] of fileReads) expect(sql).toContain(`"tenantId" = current_setting('app.current_tenant_id', true) AND "deletedAt" IS NULL`);
    expect(f.query).toHaveBeenCalledWith("SELECT set_config('app.current_tenant_id', $1, true)", ["tenant-a"]);
  });

  it.each([
    ["inline bytes whose hash differs", { HomeworkMaterialFile: [{ id: "hf-1", fileName: "a", contentType: "application/pdf", byteSize: inline.length, sha256: "0".repeat(64), contentBase64: inline.toString("base64"), objectKey: null }] }, "TENANT_PURGE_EXPORT_FILE_HASH_MISMATCH"],
    ["a stored object whose hash differs", { SupportTicketAttachment: [{ id: "sa-1", fileName: "a", contentType: "image/png", byteSize: stored.length, sha256: "0".repeat(64), contentBase64: null, objectKey: "support-ticket-attachments/tenant-a/t-1/x/source" }] }, "TENANT_PURGE_EXPORT_FILE_HASH_MISMATCH"],
    ["a size that differs from the record", { HomeworkMaterialFile: [{ id: "hf-1", fileName: "a", contentType: "application/pdf", byteSize: inline.length + 1, sha256: sha(inline), contentBase64: inline.toString("base64"), objectKey: null }] }, "TENANT_PURGE_EXPORT_FILE_HASH_MISMATCH"],
    ["a missing object", { SupportTicketAttachment: [{ id: "sa-1", fileName: "a", contentType: "image/png", byteSize: 1, sha256: "0".repeat(64), contentBase64: null, objectKey: "support-ticket-attachments/tenant-a/gone/source" }] }, "TENANT_PURGE_EXPORT_FILE_UNREADABLE"],
    ["a row without bytes or key", { HomeworkMaterialFile: [{ id: "hf-1", fileName: "a", contentType: "application/pdf", byteSize: 1, sha256: "0".repeat(64), contentBase64: null, objectKey: null }] }, "TENANT_PURGE_EXPORT_FILE_UNREADABLE"],
  ])("fails the whole export on %s", async (_name, files, code) => {
    const f = fixture({ files });
    await expect(createTenantHandoverExport(f.pool, "tenant-a", "system-user", "e".repeat(32), f.readObject)).rejects.toThrow(code);
  });

  it("keeps the institution's own export table list unchanged", () => {
    expect(tenantDataExportTableNames).toEqual(["Campus", "GradeLevel", "Class", "Course", "AcademicYear", "AcademicTerm", "Student", "StudentEnrollment", "Teacher", "TeacherAssignment", "Guardian", "GuardianStudent", "PaymentPlan", "PaymentInstallment", "Attendance", "TeacherNote", "GradeAssessment", "GradeEntry", "HomeworkMaterial", "HomeworkMaterialAssignment", "HomeworkSubmission", "Exam", "ExamParticipant", "AnswerKey", "ExamResult", "ReportSnapshot", "Announcement", "MessageTemplate", "SupportTicket", "SupportTicketAttachment", "SupportTicketComment"]);
  });
});
