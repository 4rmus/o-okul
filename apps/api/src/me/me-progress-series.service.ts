import { Injectable } from "@nestjs/common";
import type { GuardianExamSeriesPoint, GuardianSchoolGradeItem } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { GradebookService } from "../gradebook/gradebook.service.js";
import { ReportGenerationService } from "../report/report-generation.service.js";
import { SchoolService } from "../school/school.service.js";

export interface ProgressSeries {
  examSeries: GuardianExamSeriesPoint[];
  schoolGrades: GuardianSchoolGradeItem[];
}

/**
 * KV-4 series shared by the guardian overview and the student 'Gelişimim' overview: optical Başarı % (0-100) points and
 * published school grades (highest published version, each on its own scale). The two series are never merged.
 * The caller must already have authorised studentId (guardian link gate or the signed-in student's own id).
 */
@Injectable()
export class MeProgressSeriesService {
  constructor(
    private readonly reports: ReportGenerationService,
    private readonly gradebook: GradebookService,
    private readonly school: SchoolService,
  ) {}

  async get(context: RequestContext, studentId: string): Promise<ProgressSeries> {
    const [progress, grades, courses] = await Promise.all([
      // ponytail: scope "all" ignores examId; the report service only requires it to be non-empty.
      this.reports.getStudentProgress(context, "all", studentId, { scope: "all" }),
      this.gradebook.listPublishedForStudent(context, studentId),
      this.school.listCourses(context),
    ]);
    const courseNames = new Map(courses.map((course) => [course.id, course.name]));
    return {
      examSeries: progress.points.map((point) => ({
        snapshotId: point.snapshotId,
        ...(point.generatedAt ? { generatedAt: point.generatedAt } : {}),
        ...pickNumbers(point.total, ["successRate", "net", "questionCount", "correct", "wrong", "blank"]),
      })),
      schoolGrades: grades.map((grade) => {
        const courseName = courseNames.get(grade.courseId);
        return courseName ? { ...grade, courseName } : grade;
      }),
    };
  }
}

function pickNumbers<T extends object, K extends keyof T & string>(source: T, keys: readonly K[]): Partial<Record<K, number>> {
  const picked: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) picked[key] = value;
  }
  return picked;
}
