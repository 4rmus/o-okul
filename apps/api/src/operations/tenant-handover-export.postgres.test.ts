import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { encryptStudentContactValue } from "../student/student-contact-pii.js";
import { encryptTcIdentity } from "../student/tc-identity.js";
import { createTenantHandoverExport, tenantHandoverExportTableNames } from "./tenant-data-export-store.js";

const appUrl = process.env.DEVICE_BACKUP_POSTGRES_TEST_URL;
const adminUrl = process.env.DEVICE_BACKUP_POSTGRES_ADMIN_URL;
if (process.env.DEVICE_BACKUP_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("DEVICE_BACKUP_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(["/o_okul_reset_drill", "/o_okul_device_backup_test"].includes(url.pathname) || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const phoneHash = (tenant: string) => sha(Buffer.from(`phone:${tenant}`));
const run = appUrl && adminUrl ? describe : describe.skip;

// Product owner decision (2026-10-10): the purge handover holds everything the purge destroys.
run("license-expiry purge handover export on PostgreSQL (app role, RLS)", () => {
  const admin = new pg.Pool({ connectionString: adminUrl }), app = new pg.Pool({ connectionString: appUrl });
  const [a, b] = ["a", "b"].map((suffix) => `handover-${randomUUID()}-${suffix}`) as [string, string];
  const inline = Buffer.from("inline homework sheet"), stored = Buffer.from("stored support attachment"), photo = Buffer.from("student photo");
  const objects: Record<string, Buffer> = {};
  beforeAll(async () => {
    const db = await admin.connect();
    try {
      await db.query("BEGIN");
      for (const tenant of [a, b]) {
        // The consent-event trigger is SECURITY DEFINER under forced RLS; it reads the projection in the tenant scope.
        await db.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
        await db.query(`INSERT INTO "Tenant" ("id","name","slug","status","updatedAt") VALUES ($1,'Handover fixture',$1,'ACTIVE',now())`, [tenant]);
        await db.query(`INSERT INTO "Student" ("id","tenantId","firstName","lastName","studentNo","nationalIdEncrypted","nationalIdHash","photoKey","updatedAt") VALUES ($1,$2,'Ada','Yilmaz','1',$3,$4,$5,now())`,
          [`${tenant}-student`, tenant, encryptTcIdentity("10000000146"), `NATIONAL_ID_HASH_${tenant}`, `students/${tenant}-student/photo.jpg`]);
        objects[`students/${tenant}-student/photo.jpg`] = photo;
        await db.query(`INSERT INTO "StudentContact" ("id","tenantId","studentId","firstName","lastName","relationType","phoneEncrypted","phoneHash","canReceiveSms","consentSource","consentRecordedAt") VALUES ($1,$2,$3,'Veli','Yilmaz','MOTHER',$4,$5,true,'FORM',now())`,
          [`${tenant}-contact`, tenant, `${tenant}-student`, encryptStudentContactValue("5550000001"), phoneHash(tenant)]);
        await db.query(`INSERT INTO "WhatsAppConsent" ("id","tenantId","phoneHash","purpose","noticeVersion","source","recordedAt") VALUES ($1,$2,$3,'UTILITY_ANNOUNCEMENT','v1','x',now())`, [`${tenant}-consent`, tenant, phoneHash(tenant)]);
        await db.query(`INSERT INTO "WhatsAppConsentEvent" ("id","tenantId","whatsappConsentId","studentContactId","purpose","sequence","eventType","noticeVersion","source","commandKeyHash","requestHash") VALUES ($1,$2,$3,$4,'UTILITY_ANNOUNCEMENT',1,'GRANTED','v1','TENANT_ADMIN_DOCUMENTED',$5,$5)`,
          [`${tenant}-consent-event`, tenant, `${tenant}-consent`, `${tenant}-contact`, sha(Buffer.from(`command:${tenant}`))]);
        await db.query(`INSERT INTO "AuditLog" ("id","tenantId","entityType","entityId","action") VALUES ($1,$2,'Student',$3,'student.created')`, [`${tenant}-audit`, tenant, `${tenant}-student`]);
        await db.query(`INSERT INTO "HomeworkMaterial" ("id","tenantId","title","updatedAt") VALUES ($1,$2,'Sheet',now())`, [`${tenant}-material`, tenant]);
        await db.query(`INSERT INTO "HomeworkMaterialFile" ("id","tenantId","materialId","fileName","contentType","byteSize","sha256","contentBase64","updatedAt") VALUES ($1,$2,$3,'sheet.pdf','application/pdf',$4,$5,$6,now())`,
          [`${tenant}-hfile`, tenant, `${tenant}-material`, inline.length, sha(inline), inline.toString("base64")]);
        await db.query(`INSERT INTO "SupportTicket" ("id","tenantId","subject","message","updatedAt") VALUES ($1,$2,'Help','Message',now())`, [`${tenant}-ticket`, tenant]);
        const key = `support-ticket-attachments/${tenant}/${tenant}-ticket/${sha(stored)}/source`;
        objects[key] = stored;
        await db.query(`INSERT INTO "SupportTicketAttachment" ("id","tenantId","ticketId","fileName","contentType","byteSize","sha256","storageKey","updatedAt") VALUES ($1,$2,$3,'shot.png','image/png',$4,$5,$6,now())`,
          [`${tenant}-attachment`, tenant, `${tenant}-ticket`, stored.length, sha(stored), key]);
      }
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
  });
  // AuditLog is append-only; fixtures use random tenant ids in a disposable database.
  afterAll(async () => { await Promise.all([app.end(), admin.end()]); });

  it("exports consent tables, only this tenant's AuditLog and verified file bytes; every handover table is readable", async () => {
    const payload = await createTenantHandoverExport(app, a, "system-user", "e".repeat(32), async (key) => { const bytes = objects[key]; if (!bytes) throw new Error("NoSuchKey"); return bytes; });
    expect(Object.keys(payload.tables)).toHaveLength(tenantHandoverExportTableNames.length);
    expect(payload.tables.auditLogs).toEqual([expect.objectContaining({ id: `${a}-audit`, action: "student.created" })]);
    expect(payload.tables.studentContacts).toEqual([expect.objectContaining({ id: `${a}-contact`, phone: "5550000001", email: null, canReceiveSms: true })]);
    expect(payload.tables.whatsAppConsents).toEqual([expect.objectContaining({ id: `${a}-consent`, canReceiveWhatsapp: true })]);
    expect(payload.tables.whatsAppConsentEvents).toEqual([expect.objectContaining({ id: `${a}-consent-event`, studentContactId: `${a}-contact`, eventType: "GRANTED" })]);
    expect(payload.files.map(({ table, rowId, sha256, byteSize }) => ({ table, rowId, sha256, byteSize }))).toEqual([
      { table: "HomeworkMaterialFile", rowId: `${a}-hfile`, sha256: sha(inline), byteSize: inline.length },
      { table: "SupportTicketAttachment", rowId: `${a}-attachment`, sha256: sha(stored), byteSize: stored.length },
      { table: "Student", rowId: `${a}-student`, sha256: sha(photo), byteSize: photo.length },
    ]);
    const text = JSON.stringify(payload.tables);
    expect(text).not.toContain(b);
    for (const secret of [phoneHash(a), sha(Buffer.from(`command:${a}`)), `NATIONAL_ID_HASH_${a}`]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/"phoneEncrypted"|"nationalIdEncrypted"|"contentBase64"|"storageKey"|"photoKey"|"commandKeyHash"/);
  });

  it("fails when a stored object no longer matches its recorded hash", async () => {
    const key = Object.keys(objects).find((value) => value.includes(`${a}-ticket`))!;
    await expect(createTenantHandoverExport(app, a, "system-user", "e".repeat(32), async (k) => (k === key ? Buffer.from("tampered") : objects[k]!))).rejects.toThrow("TENANT_PURGE_EXPORT_FILE_HASH_MISMATCH");
  });
});
