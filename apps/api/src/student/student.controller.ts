import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { z } from "zod";
import { FeatureRolloutService } from "../feature-rollout/feature-rollout.service.js";
import { applyListQuery } from "../listing/list-query.js";
import { optionalDateString, optionalTrimmedString, optionalUppercaseString, requiredTrimmedString, requiredUppercaseString, zodBody, zodQuery } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { GuardianService } from "../guardian/guardian.service.js";
import { toGuardianResponse } from "../guardian/guardian-response.js";
import { TeacherService } from "../teacher/teacher.service.js";
import {
  StudentImportService,
} from "./student-import.service.js";
import {
  StudentService,
  type StudentBulkEnrollmentInput,
  type StudentBulkEnrollmentResult,
  type StudentCreateInput,
  type StudentEnrollmentActionInput,
  type StudentProfileInput,
  type StudentRecord,
} from "./student.service.js";
import { SchoolService } from "../school/school.service.js";
import type {
  GuardianRecord,
  GuardianStudentRecord,
  PublicStudentProfileRecord,
  PublicStudentRecord,
  StudentEnrollmentRecord,
  StudentExportResult,
  StudentImportDryRunResult,
  StudentImportRequest,
  StudentImportResult,
  StudentProfileUpdateRequest,
  StudentPortalAccessRecord,
  StudentPortalAccessUpdateRequest,
  StudentPortalAccessUpdateResult,
  StudentPortalInvitationIssueResponse,
  StudentTenantUpdateRequest,
  StudentUpdateRequest,
  TeacherAssignmentRecord,
} from "@o-okul/shared-types";

const studentStatusSchema = z.enum(["ACTIVE", "PASSIVE", "GRADUATED", "TRANSFERRED"]);
const optionalStudentStatusQuerySchema = z.preprocess((value) => value === "" ? undefined : value, studentStatusSchema.optional());
const optionalGuardianLinkedQuerySchema = z.preprocess((value) => value === "" ? undefined : value, z.enum(["true", "false"]).optional());
const optionalStudentEnrollmentStartsAtSchema = z.preprocess((value) => value === "" ? undefined : value, optionalDateString("STUDENT_ENROLLMENT_STARTS_AT_INVALID"));
const studentListQuerySchema = z.object({
  classId: optionalTrimmedString,
  guardianLinked: optionalGuardianLinkedQuerySchema,
  ids: optionalTrimmedString,
  level: optionalTrimmedString,
  limit: optionalTrimmedString,
  page: optionalTrimmedString,
  q: optionalTrimmedString,
  responsibleTeacherId: optionalTrimmedString,
  sort: optionalTrimmedString,
  status: optionalStudentStatusQuerySchema,
});
type StudentListQuery = z.infer<typeof studentListQuerySchema>;
const studentPortalAccessQuerySchema = z.object({
  cursor: optionalTrimmedString,
  direction: z.preprocess((value) => value === undefined || value === "" ? "next" : value, z.enum(["next", "previous"])),
  limit: z.preprocess((value) => value === undefined || value === "" ? 20 : Number(value), z.number().int().min(1).max(50)),
  q: optionalTrimmedString,
}).strict().refine((query) => query.direction !== "previous" || Boolean(query.cursor), {
  message: "STUDENT_PORTAL_CURSOR_REQUIRED",
  path: ["cursor"],
});
type StudentPortalAccessQuery = z.infer<typeof studentPortalAccessQuerySchema>;
const studentPortalAccessUpdateBodySchema = z.object({
  expectedVersion: z.number().int().min(1),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
}).strict() satisfies z.ZodType<StudentPortalAccessUpdateRequest>;
const studentGuardianProvisionBodySchema = z.object({
  canOpenSupportTickets: z.boolean().optional(),
  canReceiveAnnouncements: z.boolean().optional(),
  canReceiveSms: z.boolean().optional(),
  canViewFinance: z.boolean().optional(),
  email: optionalTrimmedString,
  firstName: optionalUppercaseString,
  lastName: optionalUppercaseString,
  nationalId: optionalTrimmedString,
  phone: optionalTrimmedString,
}).strict();
const studentCreateBodySchema = z.object({
  classId: optionalTrimmedString,
  firstName: requiredUppercaseString,
  guardian: studentGuardianProvisionBodySchema.optional(),
  lastName: requiredUppercaseString,
  nationalId: optionalTrimmedString,
  phone: optionalTrimmedString,
  email: optionalTrimmedString,
  responsibleTeacherId: optionalTrimmedString,
  status: studentStatusSchema.optional(),
  studentNo: optionalTrimmedString,
  tenantId: optionalTrimmedString,
}).strict();
const studentUpdateBodySchema = z.object({
  classId: optionalTrimmedString,
  firstName: requiredUppercaseString.optional(),
  lastName: requiredUppercaseString.optional(),
  responsibleTeacherId: optionalTrimmedString,
  status: studentStatusSchema.optional(),
}).strict() satisfies z.ZodType<StudentUpdateRequest>;
const studentProfileBodySchema = z.object({
  email: optionalTrimmedString,
  nationalId: optionalTrimmedString,
  phone: optionalTrimmedString,
  photoKey: optionalTrimmedString,
}).strict() satisfies z.ZodType<StudentProfileUpdateRequest>;
const studentEnrollmentActionBodySchema = z.object({
  academicYearId: optionalTrimmedString,
  classId: optionalTrimmedString,
  startsAt: optionalStudentEnrollmentStartsAtSchema,
  termId: optionalTrimmedString,
}).strict();
const studentBulkEnrollmentBodySchema = studentEnrollmentActionBodySchema.extend({
  classIdBySourceClassId: z.record(z.string(), z.string()).optional(),
  studentIds: z.array(requiredTrimmedString).optional(),
  useAutomaticClassMapping: z.boolean().optional(),
}).strict();
const studentImportBodySchema = z.object({
  fileBase64: requiredTrimmedString,
}).strict() satisfies z.ZodType<StudentImportRequest>;
const studentTenantUpdateBodySchema = z.object({
  tenantId: requiredTrimmedString,
}).strict() satisfies z.ZodType<StudentTenantUpdateRequest>;

@Controller("students")
@UseGuards(RolesGuard)
export class StudentController {
  constructor(
    private readonly students: StudentService,
    private readonly imports: StudentImportService,
    private readonly school: SchoolService,
    private readonly guardianService: GuardianService,
    private readonly teacherService: TeacherService,
    private readonly featureRollouts: FeatureRolloutService,
  ) {}

  @Get()
  @RequireCapability("student:list")
  async list(@Query(zodQuery(studentListQuerySchema)) query: StudentListQuery): Promise<PublicStudentRecord[]> {
    const context = getRequestContext();
    const rollouts = await this.featureRollouts.resolve(context);
    if (rollouts.enabledFeatureKeys.includes("web.student-registry-v2")) {
      return this.students.listRegistryPageForViewer(context, {
        page: positiveListInt(query.page, 1, "LIST_PAGE_INVALID"),
        limit: positiveListInt(query.limit, 20, "LIST_LIMIT_INVALID"),
        q: query.q,
        sort: query.sort,
        ids: parseStudentIds(query.ids),
        classId: query.classId,
        level: query.level,
        responsibleTeacherId: query.responsibleTeacherId,
        status: query.status,
        hasContact: query.guardianLinked === undefined ? undefined : query.guardianLinked === "true",
      });
    }
    const records = await this.filterStudents(await this.students.listForViewer(getRequestContext()), query);
    return applyListQuery(records, query, studentListFields);
  }

  @Get("export")
  @RequireCapability("student:list")
  export(): Promise<StudentExportResult> {
    return this.imports.export(getRequestContext());
  }

  @Get("portal-access")
  @RequireCapability("user:manage")
  listPortalAccess(
    @Query(zodQuery(studentPortalAccessQuerySchema)) query: StudentPortalAccessQuery,
  ): Promise<StudentPortalAccessRecord[]> {
    return this.students.listPortalAccess(getRequestContext(), query);
  }

  @Get(":id")
  @RequireCapability("student:read")
  findOne(@Param("id") id: string): Promise<PublicStudentRecord> {
    return this.students.findOneForViewer(getRequestContext(), id);
  }

  @Get(":id/profile")
  @RequireCapability("student:read")
  profile(@Param("id") id: string): Promise<PublicStudentProfileRecord> {
    return this.students.findProfileForViewer(getRequestContext(), id);
  }

  @Get(":id/enrollments")
  @RequireCapability("student:read")
  enrollments(@Param("id") id: string): Promise<StudentEnrollmentRecord[]> {
    return this.students.listEnrollments(getRequestContext(), id);
  }

  @Get(":id/guardians")
  @RequireCapability("student:read")
  async guardians(@Param("id") id: string): Promise<GuardianRecord[]> {
    const context = getRequestContext();
    await this.students.findOneForViewer(context, id);
    return (await this.guardianService.listStudentGuardians(context, id)).map((record) => toGuardianResponse(record, context));
  }

  @Get(":id/guardian-links")
  @RequireCapability("student:read")
  async guardianLinks(@Param("id") id: string): Promise<GuardianStudentRecord[]> {
    await this.students.findOneForViewer(getRequestContext(), id);
    return this.guardianService.listStudentGuardianLinks(getRequestContext(), id);
  }

  @Get(":id/teacher-assignments")
  @RequireCapability("student:read")
  async teacherAssignments(@Param("id") id: string): Promise<TeacherAssignmentRecord[]> {
    await this.students.findOneForViewer(getRequestContext(), id);
    return this.teacherService.listStudentTeacherAssignments(getRequestContext(), id);
  }

  @Post()
  @RequireCapability("student:manage")
  create(
    @Body(zodBody(studentCreateBodySchema)) body: StudentCreateInput,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<StudentRecord> {
    return this.students.create(getRequestContext(), body, idempotencyKey);
  }

  @Post("enrollments/bulk-renew")
  @RequireCapability("student:manage")
  bulkRenewEnrollments(
    @Body(zodBody(studentBulkEnrollmentBodySchema)) body: StudentBulkEnrollmentInput,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<StudentBulkEnrollmentResult> {
    return this.students.bulkRenewEnrollments(getRequestContext(), body, idempotencyKey);
  }

  @Post("imports/dry-run")
  @RequireCapability("student:manage")
  dryRunImport(@Body(zodBody(studentImportBodySchema)) body: StudentImportRequest): Promise<StudentImportDryRunResult> {
    return this.imports.dryRun(getRequestContext(), body);
  }

  @Post("imports")
  @RequireCapability("student:manage")
  import(
    @Body(zodBody(studentImportBodySchema)) body: StudentImportRequest,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<StudentImportResult> {
    return this.imports.import(getRequestContext(), body, idempotencyKey);
  }

  @Patch(":id")
  @RequireCapability("student:manage")
  update(@Param("id") id: string, @Body(zodBody(studentUpdateBodySchema)) body: StudentUpdateRequest): Promise<PublicStudentRecord> {
    return this.students.update(getRequestContext(), id, body);
  }

  @Patch(":id/profile")
  @RequireCapability("student:manage")
  updateProfile(@Param("id") id: string, @Body(zodBody(studentProfileBodySchema)) body: StudentProfileInput): Promise<PublicStudentProfileRecord> {
    return this.students.updateProfile(getRequestContext(), id, body);
  }

  @Patch(":id/portal-access")
  @RequireCapability("user:manage")
  updatePortalAccess(
    @Param("id") id: string,
    @Body(zodBody(studentPortalAccessUpdateBodySchema)) body: StudentPortalAccessUpdateRequest,
  ): Promise<StudentPortalAccessUpdateResult> {
    return this.students.updatePortalAccess(getRequestContext(), id, body);
  }

  @Post(":id/portal-invitations")
  @RequireCapability("user:manage")
  issuePortalInvitation(@Param("id") id: string): Promise<StudentPortalInvitationIssueResponse> {
    return this.students.issuePortalInvitation(getRequestContext(), id);
  }

  @Post(":id/enrollments/renew")
  @RequireCapability("student:manage")
  renewEnrollment(
    @Param("id") id: string,
    @Body(zodBody(studentEnrollmentActionBodySchema)) body: StudentEnrollmentActionInput,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<StudentEnrollmentRecord> {
    return this.students.renewEnrollment(getRequestContext(), id, body, idempotencyKey);
  }

  @Post(":id/enrollments/transfer")
  @RequireCapability("student:manage")
  transferEnrollment(
    @Param("id") id: string,
    @Body(zodBody(studentEnrollmentActionBodySchema)) body: StudentEnrollmentActionInput,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<StudentEnrollmentRecord | null> {
    return this.students.transferEnrollment(getRequestContext(), id, body, idempotencyKey);
  }

  @Post(":id/purge-pii")
  @RequireCapability("privacy:manage")
  purgePii(@Param("id") id: string): Promise<PublicStudentRecord> {
    return this.students.purgePii(getRequestContext(), id);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequireCapability("student:manage")
  async delete(@Param("id") id: string): Promise<void> {
    await this.students.delete(getRequestContext(), id);
  }

  @Patch(":id/tenant")
  @RequireCapability("tenant:manage")
  updateTenant(@Param("id") id: string, @Body(zodBody(studentTenantUpdateBodySchema)) body: StudentTenantUpdateRequest): Promise<PublicStudentRecord> {
    return this.students.updateTenant(getRequestContext(), id, body.tenantId);
  }

  private async filterStudents<TRecord extends PublicStudentRecord>(records: TRecord[], query: StudentListQuery): Promise<TRecord[]> {
    let filtered = records;
    if (query.ids) {
      const requestedIds = query.ids.split(",").map((id) => id.trim()).filter(Boolean);
      if (requestedIds.length === 0 || requestedIds.length > 200) throw new BadRequestException("STUDENT_IDS_INVALID");
      const ids = [...new Set(requestedIds)];
      const idSet = new Set(ids);
      filtered = filtered.filter((student) => idSet.has(student.id));
    }
    if (query.classId) {
      filtered = filtered.filter((student) => student.classId === query.classId);
    }
    if (query.responsibleTeacherId) {
      filtered = filtered.filter((student) => student.responsibleTeacherId === query.responsibleTeacherId);
    }
    if (query.status) {
      filtered = filtered.filter((student) => student.status === query.status);
    }
    if (query.level) {
      const classIds = new Set(
        (await this.school.listClasses(getRequestContext()))
          .filter((klass) => klass.gradeLevelId === query.level)
          .map((klass) => klass.id),
      );
      filtered = filtered.filter((student) => Boolean(student.classId && classIds.has(student.classId)));
    }
    if (query.guardianLinked !== undefined) {
      const expected = query.guardianLinked === "true";
      const linked = await Promise.all(
        filtered.map(async (student) => ({
          id: student.id,
          hasGuardian: (await this.guardianService.listStudentGuardianLinks(getRequestContext(), student.id)).length > 0,
        })),
      );
      const linkedById = new Map(linked.map((record) => [record.id, record.hasGuardian]));
      filtered = filtered.filter((student) => linkedById.get(student.id) === expected);
    }
    return filtered;
  }
}

const studentListFields = [
  { name: "studentNo", read: (record: PublicStudentRecord) => Number(record.studentNo) || undefined },
  { name: "firstName", read: (record: PublicStudentRecord) => record.firstName },
  { name: "lastName", read: (record: PublicStudentRecord) => record.lastName },
  { name: "classId", read: (record: PublicStudentRecord) => record.classId },
  { name: "responsibleTeacherId", read: (record: PublicStudentRecord) => record.responsibleTeacherId },
  { name: "status", read: (record: PublicStudentRecord) => record.status },
];

function parseStudentIds(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const ids = [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > 200) throw new BadRequestException("STUDENT_IDS_INVALID");
  return ids;
}

function positiveListInt(value: string | undefined, fallback: number, errorCode: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException(errorCode);
  return parsed;
}
