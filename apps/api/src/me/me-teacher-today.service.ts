import { ForbiddenException, Injectable } from "@nestjs/common";
import type { TeacherTodaySummary } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { HomeworkService } from "../homework/homework.service.js";
import { ScheduleService } from "../program/schedule.service.js";
import { TeacherService } from "../teacher/teacher.service.js";
import { MeReportIndexService } from "./me-report-index.service.js";

const pendingHomeworkLimit = 5;

// Öğretmen "bugün" özeti: 4 portal çağrısı tek read model'de birleşir (ADR-0007). Alt servisler tenant ve
// öğretmen kapsamını kendileri yeniden doğrular; burada ayrıca TEACHER özne bağlamı istenir.
@Injectable()
export class MeTeacherTodayService {
  constructor(
    private readonly teachers: TeacherService,
    private readonly schedules: ScheduleService,
    private readonly homework: HomeworkService,
    private readonly reportIndex: MeReportIndexService,
  ) {}

  async get(context: RequestContext, now = new Date()): Promise<TeacherTodaySummary> {
    if (!context.tenantId || context.subjectType !== "TEACHER" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }
    const [teacher, lessons, homework, reports] = await Promise.all([
      this.teachers.findCurrentTeacher(context),
      this.schedules.listCurrentTeacherLessons(context),
      this.homework.list(context),
      // Rapor dizini hatası özeti düşürmez (eski portal yükleyicisindeki apiRequestOrNull davranışı);
      // dersler ve ödevler gösterilir, son rapor "yok" olarak döner.
      this.reportIndex.listForTeacher(context).catch(() => []),
    ]);
    return buildTeacherTodaySummary({ homework, lessons, now, reports, teacher });
  }
}

export function buildTeacherTodaySummary(input: {
  homework: Array<{ id: string; classId: string; title: string; dueAt?: string; checkedAt?: string }>;
  lessons: Array<{ id: string; classId: string; courseId?: string; title: string; startsAt: string; endsAt: string }>;
  now: Date;
  reports: Array<{ examId: string; title: string; startsAt?: string; latestGeneratedAt: string }>;
  teacher: { firstName: string; lastName: string };
}): TeacherTodaySummary {
  const today = istanbulDate(input.now);
  const pending = input.homework
    .filter((item) => !item.checkedAt)
    .sort((left, right) => (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999"));
  const latest = input.reports[0];
  return {
    generatedAt: input.now.toISOString(),
    date: today,
    teacherName: `${input.teacher.firstName} ${input.teacher.lastName}`.trim(),
    todayLessons: input.lessons
      .filter((lesson) => istanbulDate(new Date(lesson.startsAt)) === today)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
      .map(({ classId, courseId, endsAt, id, startsAt, title }) => ({ classId, ...(courseId ? { courseId } : {}), endsAt, id, startsAt, title })),
    pendingHomework: pending
      .slice(0, pendingHomeworkLimit)
      .map(({ classId, dueAt, id, title }) => ({ classId, ...(dueAt ? { dueAt } : {}), id, title })),
    pendingHomeworkCount: pending.length,
    latestReport: latest
      ? { examId: latest.examId, latestGeneratedAt: latest.latestGeneratedAt, title: latest.title, ...(latest.startsAt ? { startsAt: latest.startsAt } : {}) }
      : null,
  };
}

function istanbulDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
