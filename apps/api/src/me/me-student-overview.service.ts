import { Injectable } from "@nestjs/common";
import type { StudentSelfOverview } from "@o-okul/shared-types";
import { AttendanceService } from "../attendance/attendance.service.js";
import type { RequestContext } from "../context/request-context.js";
import { HomeworkService } from "../homework/homework.service.js";
import { StudentService } from "../student/student.service.js";
import { MeProgressSeriesService } from "./me-progress-series.service.js";

/**
 * Student 'Gelişimim': the signed-in student's own series and counts. The student id always comes from the session
 * (findCurrentStudent); there is no path parameter, so another student's data cannot be requested. Every field is
 * copied explicitly (allow-list); guardians, finance, contacts and teacher notes are never read here.
 */
@Injectable()
export class MeStudentOverviewService {
  constructor(
    private readonly students: StudentService,
    private readonly attendance: AttendanceService,
    private readonly homework: HomeworkService,
    private readonly progressSeries: MeProgressSeriesService,
  ) {}

  async get(context: RequestContext): Promise<StudentSelfOverview> {
    const student = await this.students.findCurrentStudent(context);
    const [attendance, classHomework, materialAssignments, series] = await Promise.all([
      this.attendance.summarizeCurrentStudent(context),
      this.homework.listCurrentStudentHomework(context),
      this.homework.listCurrentStudentMaterialAssignments(context),
      this.progressSeries.get(context, student.id),
    ]);

    return {
      attendance: {
        total: attendance.total,
        present: attendance.present,
        absent: attendance.absent,
        late: attendance.late,
        excused: attendance.excused,
      },
      homework: {
        openClassHomeworkCount: classHomework.filter((record) => record.submission.status === "NOT_SUBMITTED").length,
        materialAssignmentCount: materialAssignments.length,
      },
      examSeries: series.examSeries,
      schoolGrades: series.schoolGrades,
    };
  }
}
