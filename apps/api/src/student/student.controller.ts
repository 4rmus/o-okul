import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { applyListQuery, type ListQuery } from "../listing/list-query.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  StudentImportService,
  type StudentExportResult,
  type StudentImportDryRunResult,
  type StudentImportResult,
} from "./student-import.service.js";
import { StudentService, type StudentProfileInput, type StudentRecord } from "./student.service.js";
import { SchoolService } from "../school/school.service.js";
import type {
  GuardianRecord,
  GuardianStudentRecord,
  StudentStatus,
  StudentClassHistoryRecord,
  StudentProfileRecord,
  TeacherAssignmentRecord,
} from "@uzman-hocam/shared-types";

interface StudentListQuery extends ListQuery {
  classId?: string;
  level?: string;
  responsibleTeacherId?: string;
  status?: StudentStatus;
  guardianLinked?: string;
}

@Controller("students")
@UseGuards(RolesGuard)
export class StudentController {
  constructor(
    private readonly students: StudentService,
    private readonly imports: StudentImportService,
    private readonly school: SchoolService,
  ) {}

  @Get()
  @Roles("TEACHER")
  async list(@Query() query: StudentListQuery): Promise<StudentRecord[]> {
    const records = await this.filterStudents(await this.students.list(getRequestContext()), query);
    return applyListQuery(records, query, studentListFields);
  }

  @Get("export")
  @Roles("TEACHER")
  export(): Promise<StudentExportResult> {
    return this.imports.export(getRequestContext());
  }

  @Get(":id")
  @Roles("GUARDIAN")
  findOne(@Param("id") id: string): Promise<StudentRecord> {
    return this.students.findOneForViewer(getRequestContext(), id);
  }

  @Get(":id/profile")
  @Roles("GUARDIAN")
  profile(@Param("id") id: string): Promise<StudentProfileRecord> {
    return this.students.findProfileForViewer(getRequestContext(), id);
  }

  @Get(":id/class-history")
  @Roles("TEACHER")
  classHistory(@Param("id") id: string): Promise<StudentClassHistoryRecord[]> {
    return this.students.listClassHistory(getRequestContext(), id);
  }

  @Get(":id/guardians")
  @Roles("TEACHER")
  guardians(@Param("id") id: string): Promise<GuardianRecord[]> {
    return this.school.listStudentGuardians(getRequestContext(), id);
  }

  @Get(":id/guardian-links")
  @Roles("TEACHER")
  guardianLinks(@Param("id") id: string): Promise<GuardianStudentRecord[]> {
    return this.school.listStudentGuardianLinks(getRequestContext(), id);
  }

  @Get(":id/teacher-assignments")
  @Roles("TEACHER")
  teacherAssignments(@Param("id") id: string): Promise<TeacherAssignmentRecord[]> {
    return this.school.listStudentTeacherAssignments(getRequestContext(), id);
  }

  @Post()
  @Roles("TENANT_ADMIN")
  create(@Body() body: Partial<StudentRecord>): Promise<StudentRecord> {
    return this.students.create(getRequestContext(), body);
  }

  @Post("imports/dry-run")
  @Roles("TENANT_ADMIN")
  dryRunImport(@Body() body: { fileBase64?: string }): Promise<StudentImportDryRunResult> {
    return this.imports.dryRun(getRequestContext(), body);
  }

  @Post("imports")
  @Roles("TENANT_ADMIN")
  import(@Body() body: { fileBase64?: string }): Promise<StudentImportResult> {
    return this.imports.import(getRequestContext(), body);
  }

  @Patch(":id")
  @Roles("TENANT_ADMIN")
  update(@Param("id") id: string, @Body() body: Partial<StudentRecord>): Promise<StudentRecord> {
    return this.students.update(getRequestContext(), id, body);
  }

  @Patch(":id/profile")
  @Roles("TENANT_ADMIN")
  updateProfile(@Param("id") id: string, @Body() body: StudentProfileInput): Promise<StudentProfileRecord> {
    return this.students.updateProfile(getRequestContext(), id, body);
  }

  @Post(":id/purge-pii")
  @Roles("TENANT_ADMIN")
  purgePii(@Param("id") id: string): Promise<StudentRecord> {
    return this.students.purgePii(getRequestContext(), id);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("TENANT_ADMIN")
  async delete(@Param("id") id: string): Promise<void> {
    await this.students.delete(getRequestContext(), id);
  }

  @Patch(":id/tenant")
  @Roles("TENANT_ADMIN")
  updateTenant(@Param("id") id: string, @Body() body: Pick<StudentRecord, "tenantId">): Promise<StudentRecord> {
    return this.students.updateTenant(getRequestContext(), id, body.tenantId);
  }

  private async filterStudents(records: StudentRecord[], query: StudentListQuery): Promise<StudentRecord[]> {
    let filtered = records;
    if (query.classId) {
      filtered = filtered.filter((student) => student.classId === query.classId);
    }
    if (query.responsibleTeacherId) {
      filtered = filtered.filter((student) => student.responsibleTeacherId === query.responsibleTeacherId);
    }
    if (query.status) {
      if (!["ACTIVE", "PASSIVE"].includes(query.status)) {
        throw new BadRequestException("STUDENT_STATUS_INVALID");
      }
      filtered = filtered.filter((student) => student.status === query.status);
    }
    if (query.level) {
      const classIds = new Set(
        (await this.school.listClasses(getRequestContext()))
          .filter((klass) => klass.level === query.level)
          .map((klass) => klass.id),
      );
      filtered = filtered.filter((student) => Boolean(student.classId && classIds.has(student.classId)));
    }
    if (query.guardianLinked !== undefined && query.guardianLinked !== "") {
      if (query.guardianLinked !== "true" && query.guardianLinked !== "false") {
        throw new BadRequestException("STUDENT_GUARDIAN_LINKED_FILTER_INVALID");
      }
      const expected = query.guardianLinked === "true";
      const linked = await Promise.all(
        filtered.map(async (student) => ({
          id: student.id,
          hasGuardian: (await this.school.listStudentGuardianLinks(getRequestContext(), student.id)).length > 0,
        })),
      );
      const linkedById = new Map(linked.map((record) => [record.id, record.hasGuardian]));
      filtered = filtered.filter((student) => linkedById.get(student.id) === expected);
    }
    return filtered;
  }
}

const studentListFields = [
  { name: "firstName", read: (record: StudentRecord) => record.firstName },
  { name: "lastName", read: (record: StudentRecord) => record.lastName },
  { name: "classId", read: (record: StudentRecord) => record.classId },
  { name: "responsibleTeacherId", read: (record: StudentRecord) => record.responsibleTeacherId },
  { name: "status", read: (record: StudentRecord) => record.status },
];
