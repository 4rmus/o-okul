import { Injectable } from "@nestjs/common";
import type { GuardianStudentOverview, PaymentPlanWithInstallmentsRecord } from "@o-okul/shared-types";
import { AnnouncementService } from "../announcement/announcement.service.js";
import { AttendanceService } from "../attendance/attendance.service.js";
import type { RequestContext } from "../context/request-context.js";
import { GradebookService } from "../gradebook/gradebook.service.js";
import { GuardianService } from "../guardian/guardian.service.js";
import { HomeworkService } from "../homework/homework.service.js";
import { PaymentService } from "../payment/payment.service.js";
import { ReportGenerationService } from "../report/report-generation.service.js";
import { SchoolService } from "../school/school.service.js";
import { StudentService } from "../student/student.service.js";

const upcomingHomeworkLimit = 5;

/**
 * KV-4: one read model for a guardian's linked student. Every field is copied explicitly (allow-list);
 * teacher notes, StudentContact rows and other guardians are never read here.
 */
@Injectable()
export class MeGuardianOverviewService {
  constructor(
    private readonly guardians: GuardianService,
    private readonly students: StudentService,
    private readonly attendance: AttendanceService,
    private readonly homework: HomeworkService,
    private readonly announcements: AnnouncementService,
    private readonly payments: PaymentService,
    private readonly reports: ReportGenerationService,
    private readonly gradebook: GradebookService,
    private readonly school: SchoolService,
  ) {}

  async get(context: RequestContext, studentId: string): Promise<GuardianStudentOverview> {
    // Single link gate (same pattern as payment.service.ts listCurrentGuardianStudent): 404 unknown, 403 unlinked.
    const link = await this.guardians.findCurrentGuardianStudentLink(context, studentId);
    const [profile, attendance, assignments, announcements, plans, progress, grades, courses] = await Promise.all([
      this.students.findProfileForViewer(context, link.studentId),
      this.attendance.summarizeCurrentGuardianStudent(context, link.studentId),
      this.homework.listCurrentGuardianStudentMaterialAssignments(context, link.studentId),
      this.announcements.listCurrentGuardianStudent(context, link.studentId),
      link.canViewFinance ? this.payments.listCurrentGuardianStudent(context, link.studentId) : Promise.resolve(undefined),
      // ponytail: scope "all" ignores examId; the report service only requires it to be non-empty.
      this.reports.getStudentProgress(context, "all", link.studentId, { scope: "all" }),
      this.gradebook.listPublishedForStudent(context, link.studentId),
      this.school.listCourses(context),
    ]);
    const courseNames = new Map(courses.map((course) => [course.id, course.name]));
    const today = new Date().toISOString().slice(0, 10);

    return {
      student: {
        id: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        ...(profile.className ? { className: profile.className } : {}),
      },
      attendance: {
        total: attendance.total,
        present: attendance.present,
        absent: attendance.absent,
        late: attendance.late,
        excused: attendance.excused,
      },
      homework: {
        assignmentCount: assignments.length,
        upcoming: assignments
          .filter((assignment) => assignment.dueAt && assignment.dueAt.slice(0, 10) >= today)
          .sort((left, right) => left.dueAt!.localeCompare(right.dueAt!))
          .slice(0, upcomingHomeworkLimit)
          .map((assignment) => ({
            id: assignment.id,
            ...(assignment.materialTitle ? { title: assignment.materialTitle } : {}),
            ...(assignment.courseId ? { courseId: assignment.courseId } : {}),
            ...(assignment.dueAt ? { dueAt: assignment.dueAt } : {}),
          })),
      },
      announcements: { unreadCount: announcements.filter((announcement) => !announcement.readAt).length },
      ...(plans ? { finance: summarizeFinance(plans) } : {}),
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

function summarizeFinance(plans: PaymentPlanWithInstallmentsRecord[]): NonNullable<GuardianStudentOverview["finance"]> {
  const pending = plans.flatMap((plan) => plan.installments).filter((installment) => installment.status === "PENDING" && !installment.deletedAt);
  const overdue = pending.filter((installment) => installment.overdue);
  const nextDueDate = pending.filter((installment) => !installment.overdue).map((installment) => installment.dueDate).sort()[0];
  return {
    currency: plans[0]?.currency ?? "TRY",
    pendingAmount: pending.reduce((sum, installment) => sum + installment.amount, 0),
    overdueAmount: overdue.reduce((sum, installment) => sum + installment.amount, 0),
    overdueInstallmentCount: overdue.length,
    ...(nextDueDate ? { nextDueDate } : {}),
  };
}

function pickNumbers<T extends object, K extends keyof T & string>(source: T, keys: readonly K[]): Partial<Record<K, number>> {
  const picked: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) picked[key] = value;
  }
  return picked;
}
