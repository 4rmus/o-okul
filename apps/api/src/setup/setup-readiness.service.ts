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
      courses,
      teachers,
      students,
    ] = await Promise.all([
      this.tenants.findCurrent(context),
      this.school.listCampuses(context),
      this.school.listAcademicYears(context),
      this.school.listAcademicTerms(context),
      this.school.listGradeLevels(context),
      this.school.listClasses(context),
      this.school.listCourses(context),
      this.teachers.listTeachers(context),
      this.students.list(context),
    ]);

    const steps: SetupReadinessStep[] = [
      step("institution", tenant.name.trim().length > 0 ? 1 : 0),
      step("campus", campuses.length),
      step("academic-year", academicYears.filter((record) => record.isActive).length),
      step("academic-term", academicTerms.filter((record) => record.isActive).length),
      step("grade-level", gradeLevels.length),
      step("class", classes.length),
      step("course", courses.length),
      step("teacher", teachers.length),
      step("student", students.length),
    ];
    const completedCount = steps.filter((item) => item.ready).length;

    return {
      status: completedCount === steps.length ? "READY" : "ACTION_REQUIRED",
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

function step(key: SetupReadinessKey, count: number): SetupReadinessStep {
  return { key, count, ready: count > 0 };
}
