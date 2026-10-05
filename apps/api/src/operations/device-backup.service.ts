import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, PayloadTooLargeException, ServiceUnavailableException } from "@nestjs/common";
import pg from "pg";
import { bindDeviceRestorePlan, verifyDeviceRestorePlan } from "./device-backup-plan.js";
import type { DeviceDomainRows } from "./device-backup-domain-links.js";
import { readDeviceRestoreForeignKeys } from "./device-backup-references.js";
import { deviceBackupImpact } from "./device-backup-impact.js";
import { resetBytesHash, resetDigest, referencedResetObjectInventory, readResetObject, resetS3Client, resetS3Config, tenantResetColumns, tenantResetTableNames, withTenantDb, readTenantBackupSchema, type TenantResetSnapshot, type TenantResetTable, type Queryable } from "@o-okul/db";
import type { TenantDeviceBackupPreview } from "@o-okul/shared-types";
import { z } from "zod";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { waitForApiMutations } from "../context/tenant-mutation-activity.js";
import type { RequestContext } from "../context/request-context.js";
import { decryptTcIdentity } from "../student/tc-identity.js";
import { assertInstitutionAdmin } from "../tenant/tenant-fresh-reset.service.js";
import { deviceBackupPayloadLimit, deviceBackupSigningKeys, openDeviceBackup, sealDeviceBackup } from "./device-backup-archive.js";

// Every new tenant model needs an explicit device-export classification.
const deviceBackupCatalog = {
  TenantMutationActivity: "EXCLUDED", TenantFreshResetOperation: "EXCLUDED", Tenant: "DATA", LicenseTerm: "EXCLUDED",
  LicenseUsage: "EXCLUDED", AuditLog: "EXCLUDED", BackupRestoreJob: "EXCLUDED", PlatformAccount: "EXCLUDED",
  PlatformIdempotencyKey: "EXCLUDED", PlatformSession: "EXCLUDED", User: "DATA", TenantMembership: "EXCLUDED",
  Employee: "DATA", PaymentPlan: "DATA", PaymentInstallment: "DATA", PaymentTransaction: "DATA",
  SupportTicket: "DATA", SupportTicketAttachment: "DATA", SupportTicketComment: "DATA", WhatsAppConsent: "DATA",
  WhatsAppConsentEvent: "DATA", DevelopmentCriterion: "DATA", DevelopmentAssessment: "DATA", DevelopmentScore: "DATA",
  GradeAssessment: "DATA", GradeEntry: "DATA",
  NotificationDeviceToken: "EXCLUDED", MembershipCampusScope: "EXCLUDED", AuthSession: "EXCLUDED", IdempotencyKey: "EXCLUDED",
  IdentityInvitation: "EXCLUDED", ConsumedRefreshToken: "EXCLUDED", PasswordResetToken: "EXCLUDED", SecretDeliveryOutbox: "EXCLUDED",
  Class: "DATA", GradeLevel: "DATA", Alan: "DATA", Campus: "DATA",
  Course: "DATA", GradeLevelCourse: "DATA", AcademicYear: "DATA", AcademicTerm: "DATA",
  Student: "DATA", StudentEnrollment: "DATA", Teacher: "DATA", StudentContact: "DATA",
  TeacherAssignment: "DATA", Guardian: "DATA", GuardianStudent: "DATA", Attendance: "DATA",
  TeacherNote: "DATA", ScheduleLesson: "DATA", StudySession: "DATA", StudySessionStudent: "DATA",
  HomeworkMaterial: "DATA", HomeworkMaterialFile: "DATA", HomeworkMaterialAssignment: "DATA", Homework: "DATA",
  HomeworkSubmission: "DATA",
  Exam: "DATA", ParserConfig: "DATA", OpticalFormTemplate: "DATA", ExamParticipant: "DATA",
  RawImport: "DATA", AnswerKey: "DATA", ExamBookletVariant: "DATA", LearningOutcome: "DATA",
  ParsedAnswer: "DATA", ExamResult: "DATA", ImportQuarantine: "DATA", ReportSnapshot: "DATA",
  Announcement: "DATA", AnnouncementReceipt: "DATA", AnnouncementDeliveryReport: "DATA", MessageTemplate: "DATA",
  SmsBatchDeliveryReport: "DATA",
} as const satisfies Record<TenantResetTable, "DATA" | "EXCLUDED">;
export const deviceBackupTables = (Object.keys(deviceBackupCatalog) as TenantResetTable[]).sort().filter(name => deviceBackupCatalog[name] === "DATA");
const userFields = new Set(["id", "tenantId", "name", "email", "emailNormalized", "loginName", "loginNameNormalized", "createdAt", "updatedAt", "nationalIdEncrypted", "nationalIdHash"]);
const tenantFields = new Set(["id", "name", "slug", "institutionType", "contactEmail", "logoUrl", "createdAt", "updatedAt"]);
const payloadSchema = z.object({ format: z.literal("tenant-device-backup-v1"), tenantId: z.string().min(1), schemaDigest: z.string().regex(/^[a-f0-9]{64}$/), tables: z.record(z.string(), z.array(z.object({ row: z.string(), nationalId: z.string().regex(/^[0-9]{11}$/).nullable().optional() }).strict())), files: z.array(z.object({ key: z.string().min(1).max(2048), sha256: z.string().regex(/^[a-f0-9]{64}$/), contentBase64: z.string() }).strict()).max(2000) }).strict();
export type DeviceBackupPayload = z.infer<typeof payloadSchema>;
export async function assertSourceActor(db: Queryable, context: RequestContext) {
  const result = await db.query<{ valid: boolean }>(`SELECT true AS valid FROM "AuthSession" s JOIN "User" u ON u."id"=s."userId" AND u."tenantId"=s."tenantId" JOIN "TenantMembership" m ON m."id"=s."membershipId" AND m."tenantId"=s."tenantId" AND m."userId"=s."userId" JOIN "Tenant" t ON t."id"=s."tenantId" WHERE s."tenantId"=$1 AND s."id"=$2 AND s."userId"=$3 AND s."membershipId"=$4 AND s."membershipVersion"=$5 AND s."status"='ACTIVE' AND s."expiresAt">now() AND s."activePersona"='STAFF' AND s."roles" && ARRAY['TENANT_OWNER','TENANT_ADMIN']::text[] AND u."accountStatus"='ACTIVE' AND u."membershipVersion"=s."membershipVersion" AND m."version"=s."membershipVersion" AND m."status"='ACTIVE' AND m."staffRole" IN ('TENANT_OWNER','TENANT_ADMIN') AND m."scopeMode"='TENANT' AND m."startsAt"<=now() AND (m."endsAt" IS NULL OR m."endsAt">now()) AND t."status"='ACTIVE'`, [context.tenantId, context.sessionId, context.userId, context.membershipId, context.membershipVersion]);
  if (result.rows[0]?.valid !== true) throw new ForbiddenException("DEVICE_BACKUP_ACTOR_CHANGED");
}
export async function projectDeviceBackup(tenantId: string, schemaDigest: string, db: Queryable, maxBytes = deviceBackupPayloadLimit / 2): Promise<DeviceBackupPayload> {
  const tables: DeviceBackupPayload["tables"] = {};
  let totalBytes = 0;
  for (const name of deviceBackupTables) {
    const size = await db.query<{ bytes: string }>(`SELECT coalesce(sum(octet_length(to_jsonb(t)::text)),0)::text AS bytes FROM "${name}" t WHERE t."${name === "Tenant" ? "id" : "tenantId"}"=$1`, [tenantId]);
    totalBytes += Number(size.rows[0]?.bytes ?? NaN);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) throw new Error("RESET_SNAPSHOT_SIZE_LIMIT");
    const columns = tenantResetColumns[name];
    const omitted = columns.filter(key => key === "nationalIdEncrypted" || key === "nationalIdHash" || (name === "User" && !userFields.has(key)) || (name === "Tenant" && !tenantFields.has(key)));
    const hasNationalId = columns.includes("nationalIdEncrypted");
    // PostgreSQL serializes rows before transport so NUMERIC and nested JSON values remain lossless.
    const result = await db.query<{ row: string; encrypted: string | null }>(`SELECT (to_jsonb(t) - $2::text[])::text AS row, ${hasNationalId ? 't."nationalIdEncrypted"' : 'NULL::text'} AS encrypted FROM "${name}" t WHERE t."${name === "Tenant" ? "id" : "tenantId"}" = $1 ORDER BY t."id" COLLATE "C"`, [tenantId, omitted]);
    tables[name] = result.rows.map(value => ({ row: value.row, ...(hasNationalId ? { nationalId: value.encrypted === null ? null : decryptTcIdentity(value.encrypted) } : {}) }));
  }
  return { format: "tenant-device-backup-v1", tenantId, schemaDigest, tables, files: [] };
}
function objectSnapshot(payload: DeviceBackupPayload): Pick<TenantResetSnapshot, "tenantId" | "tables"> {
  const tables = Object.fromEntries(tenantResetTableNames.map(name => [name, ["Student","RawImport","HomeworkMaterialFile","SupportTicketAttachment"].includes(name) ? decodedRows(payload,name) : []])) as TenantResetSnapshot["tables"];
  return { tenantId: payload.tenantId, tables };
}
function decodedRows(payload: DeviceBackupPayload, table: string): Array<Record<string, unknown>> {
  return payload.tables[table]!.map(value => JSON.parse(value.row) as Record<string, unknown>);
}
export function validateDeviceBackupPayload(value: unknown, tenantId: string): DeviceBackupPayload {
  const payload = payloadSchema.parse(value);
  if (payload.tenantId !== tenantId || resetDigest(Object.keys(payload.tables).sort()) !== resetDigest([...deviceBackupTables].sort())) throw new Error("DEVICE_BACKUP_CONTENT_INVALID");
  for (const name of deviceBackupTables) {
    const allowed = new Set(name === "User" ? userFields : name === "Tenant" ? tenantFields : tenantResetColumns[name]);
    allowed.delete("nationalIdEncrypted"); allowed.delete("nationalIdHash");
    const ids = new Set<string>();
    for (const entry of payload.tables[name]!) {
      const row = JSON.parse(entry.row) as Record<string, unknown>;
      if (!row || Array.isArray(row) || typeof row !== "object" || resetDigest(Object.keys(row).sort()) !== resetDigest([...allowed].sort()) || Object.hasOwn(entry, "nationalId") !== tenantResetColumns[name].includes("nationalIdEncrypted") || typeof row.id !== "string" || ids.has(row.id)) throw new Error("DEVICE_BACKUP_CONTENT_INVALID");
      if (name === "Tenant" ? row.id !== tenantId : row.tenantId !== tenantId) throw new Error("DEVICE_BACKUP_TENANT_MISMATCH");
      ids.add(row.id);
    }
  }
  if (payload.tables.Tenant?.length !== 1) throw new Error("DEVICE_BACKUP_CONTENT_INVALID");
  const expected = new Map<string, string | undefined>();
  for (const [table, field, prefix] of [["Student","photoKey","students"],["RawImport","s3Key","raw-imports"],["HomeworkMaterialFile","storageKey","homework-material-files"],["SupportTicketAttachment","storageKey","support-ticket-attachments"]]) {
    for (const row of decodedRows(payload, table!)) {
      if (row[field!] == null) continue;
      const key = row[field!] as string;
      if (typeof key !== "string" || /[\x00-\x1f]|(?:^|\/)\.\.(?:\/|$)/.test(key) || !key.startsWith(`${prefix}/${table === "Student" ? row.id : encodeURIComponent(tenantId)}/`)) throw new Error("DEVICE_BACKUP_OBJECT_INVALID");
      if (expected.has(key) && expected.get(key) !== row.sha256) throw new Error("DEVICE_BACKUP_OBJECT_INVALID");
      expected.set(key, typeof row.sha256 === "string" ? row.sha256 : undefined);
    }
  }
  for (const name of ["HomeworkMaterialFile", "SupportTicketAttachment"]) for (const row of decodedRows(payload, name)) {
    if (row.contentBase64 == null) continue;
    if (typeof row.contentBase64 !== "string" || row.storageKey != null) throw new Error("DEVICE_BACKUP_OBJECT_INVALID");
    const bytes = Buffer.from(row.contentBase64, "base64");
    if (bytes.toString("base64") !== row.contentBase64 || resetBytesHash(bytes) !== row.sha256) throw new Error("DEVICE_BACKUP_OBJECT_INVALID");
  }
  if (payload.files.length !== expected.size) throw new Error("DEVICE_BACKUP_OBJECT_INVALID");
  for (const file of payload.files) {
    const bytes = Buffer.from(file.contentBase64, "base64");
    if (bytes.toString("base64") !== file.contentBase64 || !expected.has(file.key) || resetBytesHash(bytes) !== file.sha256 || (expected.get(file.key) && expected.get(file.key) !== file.sha256)) throw new Error("DEVICE_BACKUP_OBJECT_INVALID");
    expected.delete(file.key);
  }
  return payload;
}

export async function readDeviceDomainRows(db: Queryable, tenantId: string): Promise<DeviceDomainRows> {
  // Bound each metadata read; secrets and recipient payloads never enter this planner.
  const sessions = (await db.query<DeviceDomainRows["sessions"][number]>(`SELECT /* device_restore_domain */ "userId","subjectType","subjectId",roles FROM "AuthSession" WHERE "tenantId"=$1 AND status='ACTIVE' AND "expiresAt">now() ORDER BY id LIMIT 2001`,[tenantId])).rows;
  const invitations = (await db.query<DeviceDomainRows["invitations"][number]>(`SELECT /* device_restore_domain */ id,"subjectType","subjectId",(status='PENDING' AND "expiresAt">now()) AS pending FROM "IdentityInvitation" WHERE "tenantId"=$1 ORDER BY id LIMIT 2001`,[tenantId])).rows;
  const resets = (await db.query<DeviceDomainRows["resets"][number]>(`SELECT /* device_restore_domain */ p.id,p."userId" FROM "PasswordResetToken" p JOIN "User" u ON u.id=p."userId" WHERE u."tenantId"=$1 ORDER BY p.id LIMIT 2001`,[tenantId])).rows;
  const outbox = (await db.query<DeviceDomainRows["outbox"][number]>(`SELECT /* device_restore_domain */ o.purpose,o."sourceId",o."sourceScope",o."tenantLifecycleVersion",t."lifecycleVersion" AS "currentVersion",o.status,o.attempts FROM "SecretDeliveryOutbox" o JOIN "Tenant" t ON t.id=o."tenantId" WHERE o."tenantId"=$1 ORDER BY o.id LIMIT 2001`,[tenantId])).rows;
  const truncated = Object.entries({AuthSession:sessions,IdentityInvitation:invitations,PasswordResetToken:resets,SecretDeliveryOutbox:outbox}).filter(([,rows])=>rows.length>2000).map(([name])=>name);
  return {sessions:sessions.slice(0,2000),invitations:invitations.slice(0,2000),resets:resets.slice(0,2000),outbox:outbox.slice(0,2000),truncated};
}

export async function readDevicePlanControls(db:Queryable,tenantId:string) {
  const fields:Record<string,string[]>={
    Tenant:["id","status","lifecycleVersion","resetRequest","plan","licenseStartsAt","licenseEndsAt","seatLimit"],
    User:["id","accountStatus","membershipVersion","passwordChangedAt","totpEnabledAt"],
    TenantMembership:["id","userId","role","staffRole","hasTeacherPersona","hasStudentPersona","scopeMode","version","status","startsAt","endsAt"],
    MembershipCampusScope:["id","membershipId","campusId"],
    LicenseTerm:["id","planCode","startsAt","endsAt","activeStudentLimit","cancelledAt"],
    AuthSession:["id","userId","membershipId","membershipVersion","activePersona","roles","subjectType","subjectId","status","expiresAt"],
  };
  const result:Record<string,string[]>={};
  for(const [table,columns]of Object.entries(fields)){
    const rows=(await db.query<{row:string}>(`SELECT /* device_restore_plan */ to_jsonb(meta)::text AS row FROM (SELECT ${columns.map(c=>'"'+c+'"').join(',')} FROM "${table}" WHERE "${table==='Tenant'?'id':'tenantId'}"=$1 ${table==='AuthSession'?"AND status='ACTIVE' AND \"expiresAt\">now()":""} ORDER BY id LIMIT 2001) meta`,[tenantId])).rows;
    if(rows.length>2000)return null;result[table]=rows.map(r=>r.row);
  }
  return result;
}

export async function readDeviceRestoreSourceDigest(db:Queryable,tenantId:string){
  await db.query("SET LOCAL TIME ZONE 'UTC'");
  const schema=await readTenantBackupSchema(db),projection=await projectDeviceBackup(tenantId,schema,db),controls=await readDevicePlanControls(db,tenantId);
  if(!controls)throw new ConflictException("DEVICE_RESTORE_SOURCE_UNVERIFIED");
  return resetDigest({schema,tables:projection.tables,controls});
}

@Injectable()
export class DeviceBackupService {
  private pool?: pg.Pool;
  private busy = false;
  status(context: RequestContext) {
    assertInstitutionAdmin(context);
    try { deviceBackupSigningKeys(); resetS3Config(); return { available: resolvePersistenceDriver(process.env.TENANT_STORE) === "postgres" && Boolean(process.env.DATABASE_URL), maxFileBytes: deviceBackupPayloadLimit + 4096, restoreAvailable: process.env.TENANT_DEVICE_RESTORE_ENABLED==="1" && process.env.TENANT_DEVICE_RESTORE_TENANT_ID===context.tenantId }; }
    catch { return { available: false, maxFileBytes: deviceBackupPayloadLimit + 4096, restoreAvailable:false }; }
  }
  async onApplicationShutdown() { await waitForApiMutations(); await this.pool?.end(); }
  private sourcePool() {
    if (resolvePersistenceDriver(process.env.TENANT_STORE) !== "postgres" || !process.env.DATABASE_URL) throw new ServiceUnavailableException("DEVICE_BACKUP_SOURCE_UNAVAILABLE");
    return this.pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2, statement_timeout: 30000, connectionTimeoutMillis: 5000 });
  }
  private async exclusive<T>(context: RequestContext, run: () => Promise<T>): Promise<T> {
    assertInstitutionAdmin(context);
    if (this.busy) throw new ServiceUnavailableException("DEVICE_BACKUP_BUSY");
    this.busy = true;
    try { return await run(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      const code = error instanceof Error ? error.message : "";
      if (["RESET_SNAPSHOT_SIZE_LIMIT", "RESET_OBJECT_SIZE_LIMIT"].includes(code)) throw new PayloadTooLargeException("DEVICE_BACKUP_TOO_LARGE");
      if (["DEVICE_BACKUP_SOURCE_CHANGED", "RESET_SOURCE_CHANGED"].includes(code)) throw new ConflictException("DEVICE_BACKUP_SOURCE_CHANGED");
      throw new ServiceUnavailableException("DEVICE_BACKUP_SOURCE_UNAVAILABLE");
    } finally { this.busy = false; }
  }
  private async readSource<T>(context: RequestContext, run: (db: Queryable, schema: string) => Promise<T>): Promise<T> {
    return withTenantDb(this.sourcePool(), { tenantId: context.tenantId, bypassRls: false, readOnly: true, repeatableRead: true }, async db => {
      await db.query("SET LOCAL TIME ZONE 'UTC'");
      await assertSourceActor(db, context);
      return run(db, await readTenantBackupSchema(db));
    });
  }
  async download(context: RequestContext, password: string): Promise<Buffer> {
    return this.exclusive(context, async () => {
      const keys = deviceBackupSigningKeys();
      const config = resetS3Config(), s3 = resetS3Client(config, { maxAttempts: 1, requestHandler: { connectionTimeout: 5000, requestTimeout: 15000, socketTimeout: 15000, throwOnRequestTimeout: true } });
      try {
        const payload = await this.readSource(context, async (db, schema) => {
          const projected = await projectDeviceBackup(context.tenantId!, schema, db);
          const objects = await referencedResetObjectInventory(objectSnapshot(projected), s3, config.bucket, { maxBytes: deviceBackupPayloadLimit / 2, maxObjects: 2000 });
          for (const object of objects) {
            const bytes = await readResetObject(s3, config.bucket, object);
            projected.files.push({ key: object.key, sha256: resetBytesHash(bytes), contentBase64: bytes.toString("base64") });
          }
          return projected;
        });
        // Refuse a package if the exported records or object bodies changed while collecting it.
        await this.readSource(context, async (db, schema) => {
          const current = await projectDeviceBackup(context.tenantId!, schema, db);
          if (resetDigest(current.tables) !== resetDigest(payload.tables) || schema !== payload.schemaDigest) throw new Error("DEVICE_BACKUP_SOURCE_CHANGED");
          const objects = await referencedResetObjectInventory(objectSnapshot(current), s3, config.bucket, { maxBytes: deviceBackupPayloadLimit / 2, maxObjects: 2000 });
          if (resetDigest(objects.map(o => [o.key,o.sha256])) !== resetDigest(payload.files.map(o => [o.key,o.sha256]))) throw new Error("DEVICE_BACKUP_SOURCE_CHANGED");
        });
        validateDeviceBackupPayload(payload, context.tenantId!);
        return await sealDeviceBackup(Buffer.from(JSON.stringify(payload)), context.tenantId!, password, keys.privateKey);
      } finally { s3.destroy(); }
    });
  }
  async preview(context: RequestContext, file: Buffer, password: string, planToken?: string): Promise<TenantDeviceBackupPreview> {
    return this.exclusive(context, async () => {
      const issuedAt = Date.now();
      if (planToken) verifyDeviceRestorePlan(planToken, context, file);
      const { header, payload: bytes } = await openDeviceBackup(file, context.tenantId!, password, deviceBackupSigningKeys().publicKeys);
      let payload: DeviceBackupPayload;
      try { payload = validateDeviceBackupPayload(JSON.parse(bytes.toString("utf8")), context.tenantId!); }
      catch { throw new BadRequestException("DEVICE_BACKUP_CONTENT_INVALID"); }
      finally { bytes.fill(0); }
      const current = await withTenantDb(this.sourcePool(), { tenantId: context.tenantId, bypassRls: false, readOnly: true, repeatableRead: true }, async db => {
        await db.query("SET LOCAL TIME ZONE 'UTC'");
        await assertSourceActor(db, context);
        const schema = await readTenantBackupSchema(db);
        if (schema !== payload.schemaDigest) { if (planToken) throw new ConflictException("DEVICE_RESTORE_PLAN_STALE"); return { schema, impact: undefined, plan: undefined }; }
        const projected = await projectDeviceBackup(context.tenantId!, schema, db);
        const terms = await db.query<{ activeStudentLimit: number; matches: boolean }>(`SELECT term."activeStudentLimit",
          (term."planCode"=tenant."plan" AND term."startsAt"=tenant."licenseStartsAt" AND term."endsAt"=tenant."licenseEndsAt" AND term."activeStudentLimit"=tenant."seatLimit") AS matches
          FROM "LicenseTerm" term JOIN "Tenant" tenant ON tenant.id=term."tenantId"
          WHERE term."tenantId"=$1 AND term."cancelledAt" IS NULL AND term."startsAt"<=now() AND now()<term."endsAt" ORDER BY term."startsAt" DESC LIMIT 2`, [context.tenantId]);
        const limit = terms.rows.length === 1 && terms.rows[0]?.matches === true ? terms.rows[0].activeStudentLimit : null;
        const foreignKeys=await readDeviceRestoreForeignKeys(db), domainRows=await readDeviceDomainRows(db,context.tenantId!);
        const impact=deviceBackupImpact(payload,projected,limit,foreignKeys,domainRows), controls=await readDevicePlanControls(db,context.tenantId!);
        if (!controls || domainRows.truncated.length) {
          if (planToken) throw new ConflictException("DEVICE_RESTORE_PLAN_SOURCE_UNVERIFIED");
          impact.blockers.push("DEVICE_RESTORE_PLAN_SOURCE_UNVERIFIED");
          return {schema,impact,plan:undefined};
        }
        const plan=bindDeviceRestorePlan(context,file,{schema,tables:projected.tables,terms:terms.rows,foreignKeys,domainRows,controls,impact},issuedAt,planToken);
        return {schema,impact,plan};
      });
      const compatible = current.schema === payload.schemaDigest;
      const inline = ["HomeworkMaterialFile", "SupportTicketAttachment"].flatMap(name => decodedRows(payload, name)).filter(row => typeof row.contentBase64 === "string");
      return { backupId: header.backupId, tenantId: header.tenantId, createdAt: header.createdAt, schemaCompatible: compatible, tableCounts: Object.fromEntries(Object.entries(payload.tables).map(([table,rows]) => [table,rows.length])), fileCount: payload.files.length + inline.length, fileBytes: [...payload.files, ...inline].reduce((sum,f) => sum + Buffer.byteLength(String(f.contentBase64),"base64"),0), integrityVerified: true, restoreVerified: false, canRestore: false, plan: current.plan, impact: current.impact, blockers: [...(compatible ? [] : ["DEVICE_BACKUP_SCHEMA_UNSUPPORTED"]), "DEVICE_BACKUP_RESTORE_NOT_VERIFIED", ...(current.impact?.blockers ?? [])] };
    });
  }
}
