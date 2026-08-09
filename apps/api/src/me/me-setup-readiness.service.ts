import { ForbiddenException, Injectable } from "@nestjs/common";
import type { SetupReadinessResponse, SetupReadinessStepId } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { SchoolService } from "../school/school.service.js";
import { StudentService } from "../student/student.service.js";
import { TeacherService } from "../teacher/teacher.service.js";

const stepIds = [
  "campuses",
  "grade-levels",
  "classes",
  "courses",
  "teachers",
  "students",
  "learning-outcomes",
] as const satisfies readonly SetupReadinessStepId[];

@Injectable()
export class MeSetupReadinessService {
  constructor(
    private readonly school: SchoolService,
    private readonly students: StudentService,
    private readonly teachers: TeacherService,
  ) {}

  async get(context: RequestContext): Promise<SetupReadinessResponse> {
    assertTenantSetupScope(context);
    const records = await Promise.all([
      this.school.listCampuses(context),
      this.school.listGradeLevels(context),
      this.school.listClasses(context),
      this.school.listCourses(context),
      this.teachers.listTeachers(context),
      this.students.listForViewer(context),
      this.school.listLearningOutcomes(context),
    ]);

    return buildSetupReadiness(records.map((items) => items.length));
  }
}

function assertTenantSetupScope(context: RequestContext) {
  if (!context.roles.includes("OPERATIONS_STAFF")) return;
  if (!context.campusScope) throw new ForbiddenException("SETUP_SCOPE_MISSING");
  if (context.campusScope.scopeMode !== "TENANT") {
    throw new ForbiddenException("SETUP_TENANT_SCOPE_REQUIRED");
  }
}

export function buildSetupReadiness(counts: readonly number[]): SetupReadinessResponse {
  const steps = stepIds.map((id, index) => {
    const count = counts[index] ?? 0;
    return { id, count, isComplete: count > 0 };
  });
  const completedCount = steps.filter((step) => step.isComplete).length;
  return {
    completedCount,
    percent: Math.round((completedCount / steps.length) * 100),
    steps,
    totalCount: steps.length,
  };
}
