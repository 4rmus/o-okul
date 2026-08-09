import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type {
  AnnouncementRecord,
  AttendanceSummaryRecord,
  HomeworkMaterialAssignmentRecord,
  PortalReportIndexItem,
  StudentDailyBriefActionId,
  StudentDailyBriefResponse,
  SupportTicketRecord,
} from "@o-okul/shared-types";
import { AnnouncementService } from "../announcement/announcement.service.js";
import { AttendanceService } from "../attendance/attendance.service.js";
import type { RequestContext } from "../context/request-context.js";
import { HomeworkService } from "../homework/homework.service.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { SupportTicketService } from "../support-ticket/support-ticket.service.js";
import { MeReportIndexService } from "./me-report-index.service.js";

@Injectable()
export class MeStudentDailyBriefService {
  constructor(
    private readonly announcements: AnnouncementService,
    private readonly attendance: AttendanceService,
    private readonly homework: HomeworkService,
    private readonly reportIndex: MeReportIndexService,
    @Inject(studentStoreToken) private readonly students: StudentStore,
    private readonly supportTickets: SupportTicketService,
  ) {}

  async get(context: RequestContext): Promise<StudentDailyBriefResponse> {
    assertStudentContext(context);
    const viewerContext = await this.resolveViewerContext(context);
    const [announcements, attendance, homework, reports, supportTickets] = await Promise.all([
      this.announcements.listCurrentStudent(viewerContext),
      this.attendance.summarizeCurrentStudent(viewerContext),
      this.homework.listCurrentStudentMaterialAssignments(viewerContext),
      this.reportIndex.listForStudent(viewerContext, viewerContext.subjectId),
      this.supportTickets.listCurrentStudent(viewerContext),
    ]);

    return buildStudentDailyBrief({ announcements, attendance, homework, reports, supportTickets });
  }

  private async resolveViewerContext(
    context: RequestContext & { subjectId: string; subjectType: "STUDENT"; tenantId: string },
  ): Promise<typeof context> {
    if (!context.rolePreview) return context;

    const student = await this.students.findById(context.subjectId);
    if (!student?.userId || student.tenantId !== context.tenantId) {
      throw new ForbiddenException("STUDENT_PREVIEW_ACCOUNT_REQUIRED");
    }
    return { ...context, userId: student.userId };
  }
}

export function buildStudentDailyBrief(
  input: {
    announcements: AnnouncementRecord[];
    attendance: AttendanceSummaryRecord;
    homework: HomeworkMaterialAssignmentRecord[];
    reports: PortalReportIndexItem[];
    supportTickets: SupportTicketRecord[];
  },
  now = new Date(),
): StudentDailyBriefResponse {
  const unreadAnnouncementCount = input.announcements.filter((record) => !record.readAt).length;
  const homeworkAssignmentCount = input.homework.length;
  const attendanceAlertCount = input.attendance.absent + input.attendance.late;
  const openSupportTicketCount = input.supportTickets.filter((record) =>
    record.status === "OPEN" || record.status === "IN_PROGRESS"
  ).length;
  const latestReadyReport = input.reports[0];

  return {
    date: now.toISOString().slice(0, 10),
    unreadAnnouncementCount,
    homeworkAssignmentCount,
    attendanceRecordCount: input.attendance.total,
    absenceCount: input.attendance.absent,
    lateCount: input.attendance.late,
    openSupportTicketCount,
    ...(latestReadyReport ? { latestReadyReport } : {}),
    actions: prioritizeActions({
      attendanceAlertCount,
      homeworkAssignmentCount,
      latestReadyReport,
      openSupportTicketCount,
      unreadAnnouncementCount,
    }),
  };
}

function prioritizeActions(input: {
  attendanceAlertCount: number;
  homeworkAssignmentCount: number;
  latestReadyReport?: PortalReportIndexItem;
  openSupportTicketCount: number;
  unreadAnnouncementCount: number;
}): Array<{ id: StudentDailyBriefActionId; count: number }> {
  const actions: Array<{ id: StudentDailyBriefActionId; count: number }> = [];
  if (input.unreadAnnouncementCount > 0) actions.push({ id: "announcement", count: input.unreadAnnouncementCount });
  if (input.homeworkAssignmentCount > 0) actions.push({ id: "homework", count: input.homeworkAssignmentCount });
  if (input.latestReadyReport) actions.push({ id: "report", count: 1 });
  if (input.attendanceAlertCount > 0) actions.push({ id: "attendance", count: input.attendanceAlertCount });
  if (input.openSupportTicketCount > 0) actions.push({ id: "support", count: input.openSupportTicketCount });
  return actions.slice(0, 3);
}

function assertStudentContext(
  context: RequestContext,
): asserts context is RequestContext & { subjectId: string; subjectType: "STUDENT"; tenantId: string } {
  if (context.subjectType !== "STUDENT" || !context.subjectId || !context.tenantId || context.bypassRls) {
    throw new ForbiddenException("STUDENT_SUBJECT_CONTEXT_REQUIRED");
  }
}
