import { ForbiddenException, Injectable } from "@nestjs/common";
import type {
  SetupReadinessKey,
  SetupReadinessReadModel,
  SetupReadinessStep,
} from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { SchoolService } from "../school/school.service.js";
import { StudentService } from "../student/student.service.js";
import { TeacherService } from "../teacher/teacher.service.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";
import { TenantService } from "../tenant/tenant.service.js";

@Injectable()
export class SetupReadinessService {
  constructor(
    private readonly tenants: TenantService,
    private readonly school: SchoolService,
    private readonly teachers: TeacherService,
    private readonly students: StudentService,
  ) {}

  async read(context: RequestContext): Promise<SetupReadinessReadModel> {
    this.assertTenantWideContext(context);

    const [
      tenant,
      campuses,
      academicYears,
      academicTerms,
      gradeLevels,
      classes,
      teachers,
      students,
    ] = await Promise.all([
      this.tenants.findCurrent(context),
      this.school.listCampuses(context),
      this.school.listAcademicYears(context),
      this.school.listAcademicTerms(context),
      this.school.listGradeLevels(context),
      this.school.listClasses(context),
      this.teachers.listTeachers(context),
      this.students.list(context),
    ]);
    const gradeLevelCourses = (await Promise.all(
      gradeLevels.map((gradeLevel) => this.school.listGradeLevelCourses(context, gradeLevel.id)),
    )).flat();
    const campusIds = new Set(campuses.map((record) => record.id));
    const classGradeLevelIds = new Set(classes.flatMap((record) => record.gradeLevelId ? [record.gradeLevelId] : []));
    const linkedGradeLevelIds = new Set(gradeLevelCourses.map((record) => record.gradeLevelId));
    const classContextReady = classes.length > 0
      && classes.every((record) => record.campusId && campusIds.has(record.campusId) && record.gradeLevelId)
      && [...classGradeLevelIds].every((gradeLevelId) => linkedGradeLevelIds.has(gradeLevelId));
    const linkedClassCount = classContextReady ? classes.length : 0;
    const linkedCourseCount = classContextReady
      ? new Set(
        gradeLevelCourses
          .filter((record) => classGradeLevelIds.has(record.gradeLevelId))
          .map((record) => record.courseId),
      ).size
      : 0;

    const steps: SetupReadinessStep[] = [
      step("institution", tenant.name.trim().length > 0 ? 1 : 0, true),
      step("campus", campuses.length, true),
      step("academic-year", academicYears.filter((record) => record.isActive).length, true),
      step("academic-term", academicTerms.filter((record) => record.isActive).length, true),
      step("grade-level", gradeLevels.length, true),
      step("class", linkedClassCount, true),
      step("course", linkedCourseCount, true),
      step("teacher", teachers.length, false),
      step("student", students.length, false),
    ];
    const completedCount = steps.filter((item) => item.ready).length;

    return {
      status: steps.every((item) => !item.required || item.ready) ? "READY" : "ACTION_REQUIRED",
      completedCount,
      totalCount: steps.length,
      steps,
    };
  }

  private assertTenantWideContext(context: RequestContext): void {
    try {
      requireTenantWideStaffContext(context, "SETUP_TENANT_WIDE_SCOPE_REQUIRED");
    } catch (error) {
      throw new ForbiddenException(error instanceof Error ? error.message : "SETUP_TENANT_WIDE_SCOPE_REQUIRED");
    }
    if (context.bypassRls) {
      throw new ForbiddenException("SETUP_TENANT_CONTEXT_REQUIRED");
    }
  }
}

function step(key: SetupReadinessKey, count: number, required: boolean): SetupReadinessStep {
  return { key, count, ready: count > 0, required };
}
