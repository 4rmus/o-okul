import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import type {
  AttendanceRecord,
  HomeworkRecord,
  PortalReportIndexItem,
  ScheduleLessonRecord,
  SupportTicketRecord,
  TeacherDailyBriefActionId,
  TeacherDailyBriefResponse,
} from "@o-okul/shared-types";
import { AttendanceService } from "../attendance/attendance.service.js";
import type { RequestContext } from "../context/request-context.js";
import { HomeworkService } from "../homework/homework.service.js";
import { ScheduleService } from "../program/schedule.service.js";
import { StudentService } from "../student/student.service.js";
import { SupportTicketService } from "../support-ticket/support-ticket.service.js";
import { MeReportIndexService } from "./me-report-index.service.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class MeTeacherDailyBriefService {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly homework: HomeworkService,
    private readonly reportIndex: MeReportIndexService,
    private readonly schedules: ScheduleService,
    private readonly students: StudentService,
    private readonly supportTickets: SupportTicketService,
  ) {}

  async get(context: RequestContext, dateInput?: string): Promise<TeacherDailyBriefResponse> {
    assertTeacherContext(context);
    const date = parseDate(dateInput);
    const [lessons, students, attendance, homework, supportTickets, reports] = await Promise.all([
      this.schedules.listCurrentTeacherLessons(context),
      this.students.listForViewer(context),
      this.attendance.list(context, { date }),
      this.homework.list(context),
      this.supportTickets.listCurrentTeacher(context),
      this.reportIndex.listForTeacher(context),
    ]);

    return buildTeacherDailyBrief(date, {
      attendance,
      homework,
      lessons,
      reports,
      studentCount: students.length,
      supportTickets,
    });
  }
}

export function buildTeacherDailyBrief(
  date: string,
  input: {
    attendance: AttendanceRecord[];
    homework: HomeworkRecord[];
    lessons: ScheduleLessonRecord[];
    reports: PortalReportIndexItem[];
    studentCount: number;
    supportTickets: SupportTicketRecord[];
  },
  now = new Date(),
): TeacherDailyBriefResponse {
  const todayLessons = input.lessons
    .filter((lesson) => lesson.startsAt.slice(0, 10) === date)
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
  const attendanceClassIds = new Set(
    input.attendance.flatMap((record) => record.classId ? [record.classId] : []),
  );
  const pendingAttendanceClassIds = new Set(
    todayLessons.flatMap((lesson) => lesson.classId && !attendanceClassIds.has(lesson.classId) ? [lesson.classId] : []),
  );
  const uncheckedHomeworkCount = input.homework.filter((record) => !record.checkedAt).length;
  const openSupportTicketCount = input.supportTickets.filter((record) =>
    record.status === "OPEN" || record.status === "IN_PROGRESS"
  ).length;
  const actions = prioritizeActions({
    latestReadyReport: input.reports[0],
    openSupportTicketCount,
    pendingAttendanceClassCount: pendingAttendanceClassIds.size,
    uncheckedHomeworkCount,
  });
  const nextLesson = date === now.toISOString().slice(0, 10)
    ? todayLessons.find((lesson) => Date.parse(lesson.endsAt) > now.getTime())
    : todayLessons[0];

  return {
    date,
    todayLessonCount: todayLessons.length,
    assignedStudentCount: input.studentCount,
    pendingAttendanceClassCount: pendingAttendanceClassIds.size,
    uncheckedHomeworkCount,
    openSupportTicketCount,
    ...(nextLesson ? {
      nextLesson: {
        title: nextLesson.title,
        startsAt: nextLesson.startsAt,
        endsAt: nextLesson.endsAt,
      },
    } : {}),
    ...(input.reports[0] ? { latestReadyReport: input.reports[0] } : {}),
    actions,
  };
}

function prioritizeActions(input: {
  latestReadyReport?: PortalReportIndexItem;
  openSupportTicketCount: number;
  pendingAttendanceClassCount: number;
  uncheckedHomeworkCount: number;
}): Array<{ id: TeacherDailyBriefActionId; count: number }> {
  const actions: Array<{ id: TeacherDailyBriefActionId; count: number }> = [];
  if (input.pendingAttendanceClassCount > 0) actions.push({ id: "attendance", count: input.pendingAttendanceClassCount });
  if (input.uncheckedHomeworkCount > 0) actions.push({ id: "homework", count: input.uncheckedHomeworkCount });
  if (input.openSupportTicketCount > 0) actions.push({ id: "support", count: input.openSupportTicketCount });
  if (input.latestReadyReport) actions.push({ id: "report", count: 1 });
  return actions.slice(0, 3);
}

function assertTeacherContext(context: RequestContext): void {
  if (context.subjectType !== "TEACHER" || !context.subjectId || !context.tenantId || context.bypassRls) {
    throw new ForbiddenException("TEACHER_SUBJECT_CONTEXT_REQUIRED");
  }
}

function parseDate(input?: string): string {
  const date = input?.trim() || new Date().toISOString().slice(0, 10);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!datePattern.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new BadRequestException("DAILY_BRIEF_DATE_INVALID");
  }
  return date;
}
