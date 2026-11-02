import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { GradeAssessmentRecord, TeacherAuthoringScope, TeacherTodaySummary } from "@o-okul/shared-types";
import { AnnouncementService } from "../announcement/announcement.service.js";
import type { RequestContext } from "../context/request-context.js";
import { GradebookService } from "../gradebook/gradebook.service.js";
import { HomeworkService } from "../homework/homework.service.js";
import { ScheduleService } from "../program/schedule.service.js";
import { SchoolService } from "../school/school.service.js";
import { StudentService } from "../student/student.service.js";
import { TeacherService } from "../teacher/teacher.service.js";
import { MeReportIndexService } from "./me-report-index.service.js";
import { type TeacherTodayInboxCounts, type TeacherTodayStore, teacherTodayStoreToken } from "./me-teacher-today.store.js";

const pendingHomeworkLimit = 5;

// Öğretmen "bugün" özeti: portal çağrıları tek read model'de birleşir (ADR-0007). Alt servisler tenant ve
// öğretmen kapsamını kendileri yeniden doğrular; burada ayrıca TEACHER özne bağlamı istenir.
// T3 gelen kutusu (yoklama, teslim, not taslağı, duyuru) ek okumadır: kaynağı okunamayan alan düşer, özet düşmez.
@Injectable()
export class MeTeacherTodayService {
  constructor(
    private readonly teachers: TeacherService,
    private readonly schedules: ScheduleService,
    private readonly homework: HomeworkService,
    private readonly reportIndex: MeReportIndexService,
    private readonly school: SchoolService,
    private readonly gradebook: GradebookService,
    private readonly announcements: AnnouncementService,
    private readonly students: StudentService,
    @Inject(teacherTodayStoreToken) private readonly store: TeacherTodayStore,
  ) {}

  async get(context: RequestContext, now = new Date()): Promise<TeacherTodaySummary> {
    if (!context.tenantId || context.subjectType !== "TEACHER" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }
    const tenantId = context.tenantId;
    const [teacher, lessons, homework, reports, classes, assessments, authoringScopes, announcements, students] = await Promise.all([
      this.teachers.findCurrentTeacher(context),
      this.schedules.listCurrentTeacherLessons(context),
      this.homework.list(context),
      // Rapor dizini hatası özeti düşürmez (eski portal yükleyicisindeki apiRequestOrNull davranışı);
      // dersler ve ödevler gösterilir, son rapor "yok" olarak döner.
      this.reportIndex.listForTeacher(context).catch(() => []),
      this.school.listClasses(context).catch(() => undefined),
      this.gradebook.listAssessments(context, {}).catch(() => undefined),
      this.gradebook.listTeacherAuthoringScopes(context).catch(() => undefined),
      this.announcements.listCurrentTeacher(context).catch(() => undefined),
      // HomeworkService.listSubmissions shows only students the teacher may see (StudentService.list).
      this.students.list(context).catch(() => undefined),
    ]);
    const today = istanbulDate(now);
    const todayClassIds = [...new Set(lessons.filter((lesson) => istanbulDate(new Date(lesson.startsAt)) === today).map((lesson) => lesson.classId))];
    const inbox = await this.store
      .loadInbox({
        tenantId,
        date: today,
        classIds: todayClassIds,
        // A homework closed at the homework level no longer waits for submission checks.
        homeworkIds: homework.filter((item) => !item.checkedAt).map((item) => item.id),
        ...(students ? { studentIds: students.map((student) => student.id) } : {}),
        ...(assessments && authoringScopes
          ? { assessmentIds: assessments.filter((assessment) => isAuthorable(assessment, authoringScopes)).map((assessment) => assessment.id) }
          : {}),
      })
      .catch(() => undefined);
    return buildTeacherTodaySummary({
      homework,
      lessons,
      now,
      reports,
      teacher,
      inbox,
      classNames: classes
        ? new Map(classes.filter((record) => todayClassIds.includes(record.id)).map((record) => [record.id, record.name]))
        : undefined,
      unreadAnnouncementCount: announcements?.filter((announcement) => !announcement.readAt).length,
    });
  }
}

export function buildTeacherTodaySummary(input: {
  homework: Array<{ id: string; classId: string; title: string; dueAt?: string; checkedAt?: string }>;
  lessons: Array<{ id: string; classId: string; courseId?: string; title: string; startsAt: string; endsAt: string }>;
  now: Date;
  reports: Array<{ examId: string; title: string; startsAt?: string; latestGeneratedAt: string }>;
  teacher: { firstName: string; lastName: string };
  inbox?: TeacherTodayInboxCounts;
  classNames?: ReadonlyMap<string, string>;
  unreadAnnouncementCount?: number;
}): TeacherTodaySummary {
  const today = istanbulDate(input.now);
  const pending = input.homework
    .filter((item) => !item.checkedAt)
    .sort((left, right) => (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999"));
  const latest = input.reports[0];
  const attendanceClassIds = input.inbox ? new Set(input.inbox.attendanceClassIds) : undefined;
  return {
    generatedAt: input.now.toISOString(),
    date: today,
    teacherName: `${input.teacher.firstName} ${input.teacher.lastName}`.trim(),
    todayLessons: input.lessons
      .filter((lesson) => istanbulDate(new Date(lesson.startsAt)) === today)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
      .map(({ classId, courseId, endsAt, id, startsAt, title }) => {
        const className = input.classNames?.get(classId);
        return {
          classId,
          ...(className ? { className } : {}),
          ...(courseId ? { courseId } : {}),
          endsAt,
          id,
          startsAt,
          title,
          ...(attendanceClassIds ? { attendanceTaken: attendanceClassIds.has(classId) } : {}),
        };
      }),
    pendingHomework: pending
      .slice(0, pendingHomeworkLimit)
      .map(({ classId, dueAt, id, title }) => ({ classId, ...(dueAt ? { dueAt } : {}), id, title })),
    pendingHomeworkCount: pending.length,
    latestReport: latest
      ? { examId: latest.examId, latestGeneratedAt: latest.latestGeneratedAt, title: latest.title, ...(latest.startsAt ? { startsAt: latest.startsAt } : {}) }
      : null,
    ...(input.inbox?.pendingSubmissionCount !== undefined ? { pendingSubmissionCount: input.inbox.pendingSubmissionCount } : {}),
    ...(input.inbox?.unpublishedGradeDraftCount !== undefined ? { unpublishedGradeDraftCount: input.inbox.unpublishedGradeDraftCount } : {}),
    ...(input.unreadAnnouncementCount !== undefined ? { unreadAnnouncementCount: input.unreadAnnouncementCount } : {}),
  };
}

// Drafts wait on whoever may publish them: the same rule as GradebookService.assertCanAuthor (a CLASS_TEACHER or
// BRANCH_TEACHER assignment naming the class, compatible course and term), not the wider read scope.
function isAuthorable(assessment: GradeAssessmentRecord, scopes: readonly TeacherAuthoringScope[]): boolean {
  return scopes.some((scope) =>
    scope.classId === assessment.classId &&
    (!scope.courseId || scope.courseId === assessment.courseId) &&
    (!scope.termId || scope.termId === assessment.termId),
  );
}

function istanbulDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
