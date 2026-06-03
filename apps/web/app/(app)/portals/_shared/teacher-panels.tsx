"use client";

import type { ClassRecord, ScheduleLessonRecord, StudentRecord, TeacherRecord } from "@uzman-hocam/shared-types";

interface TeacherClassReportSummary {
  snapshotId: string;
  generatedAt?: string;
  classId: string | null;
  className: string | null;
  courseId?: string;
  resultCount: number;
  termId?: string;
  averages: {
    correct?: number;
    wrong?: number;
    blank?: number;
    net?: number;
    standardScore?: number;
  };
}

export function TeacherTodaySchedulePanel({
  classNames,
  courseNames,
  lessons,
  nextLesson,
  termNames,
}: {
  classNames: ReadonlyMap<string, string>;
  courseNames: ReadonlyMap<string, string>;
  lessons: ScheduleLessonRecord[];
  nextLesson?: ScheduleLessonRecord;
  termNames: ReadonlyMap<string, string>;
}) {
  return (
    <section className="next-list-panel" aria-label="Bugünkü dersler">
      <h2>Bugünkü Dersler</h2>
      {lessons.length > 0 ? (
        <table className="uh-data-table">
          <thead>
            <tr>
              <th>Ders</th>
              <th>Sınıf</th>
              <th>Branş</th>
              <th>Dönem</th>
              <th>Saat</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((lesson) => (
              <tr key={lesson.id}>
                <td>{lesson.title}</td>
                <td>{lesson.classId ? classNames.get(lesson.classId) ?? lesson.classId : "-"}</td>
                <td>{lesson.courseId ? courseNames.get(lesson.courseId) ?? lesson.courseId : "-"}</td>
                <td>{lesson.termId ? termNames.get(lesson.termId) ?? lesson.termId : "-"}</td>
                <td>{formatLessonTimeRange(lesson)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="next-status-note">Bugün planlı ders yok.</p>
      )}
      {nextLesson && !lessons.some((lesson) => lesson.id === nextLesson.id) ? (
        <p className="next-status-note">
          Sonraki ders: {nextLesson.title} · {formatDateTime(nextLesson.startsAt)}
        </p>
      ) : null}
    </section>
  );
}

export function TeacherProfileSummaryPanel({
  campusNames,
  classes,
  classNames,
  courseNames,
  gradeLevelNames,
  schedule,
  students,
  teacher,
  termNames,
}: {
  campusNames: ReadonlyMap<string, string>;
  classes: ReadonlyMap<string, ClassRecord>;
  classNames: ReadonlyMap<string, string>;
  courseNames: ReadonlyMap<string, string>;
  gradeLevelNames: ReadonlyMap<string, string>;
  schedule: ScheduleLessonRecord[];
  students: StudentRecord[];
  teacher?: TeacherRecord;
  termNames: ReadonlyMap<string, string>;
}) {
  const scopedClassIds = [
    ...students.map((student) => student.classId),
    ...schedule.map((lesson) => lesson.classId),
  ].filter((classId): classId is string => Boolean(classId));
  const classScope = formatUniqueLabels([
    ...scopedClassIds.map((classId) => classNames.get(classId) ?? classId),
  ]);
  const organizationScope = formatUniqueLabels(
    scopedClassIds.map((classId) => {
      const schoolClass = classes.get(classId);
      if (!schoolClass) return undefined;
      const organization = formatClassOrganization({
        campusName: schoolClass.campusId ? campusNames.get(schoolClass.campusId) : undefined,
        gradeLevelName: schoolClass.gradeLevelId ? gradeLevelNames.get(schoolClass.gradeLevelId) : undefined,
        section: schoolClass.section,
      });
      return organization === "-" ? undefined : organization;
    }),
  );
  const courseScope = formatUniqueLabels(schedule.map((lesson) => (lesson.courseId ? courseNames.get(lesson.courseId) ?? lesson.courseId : undefined)));
  const termScope = formatUniqueLabels(schedule.map((lesson) => (lesson.termId ? termNames.get(lesson.termId) ?? lesson.termId : undefined)));

  return (
    <section className="next-list-panel" aria-label="Öğretmen profil özeti">
      <h2>Profil Özeti</h2>
      <dl className="next-definition-list">
        <div>
          <dt>Ad soyad</dt>
          <dd>{teacher ? `${teacher.firstName} ${teacher.lastName}` : "-"}</dd>
        </div>
        <div>
          <dt>Branş</dt>
          <dd>{teacher?.branch ?? "-"}</dd>
        </div>
        <div>
          <dt>Dersler</dt>
          <dd>{courseScope}</dd>
        </div>
        <div>
          <dt>Dönemler</dt>
          <dd>{termScope}</dd>
        </div>
        <div>
          <dt>Sınıf kapsamı</dt>
          <dd>{classScope}</dd>
        </div>
        <div>
          <dt>Organizasyon</dt>
          <dd>{organizationScope}</dd>
        </div>
        <div>
          <dt>Sorumlu öğrenci</dt>
          <dd>{formatCount(students.length, "öğrenci")}</dd>
        </div>
        <div>
          <dt>Program</dt>
          <dd>{formatCount(schedule.length, "ders")}</dd>
        </div>
      </dl>
    </section>
  );
}

export function TeacherClassReportsPanel({
  courseNames,
  reports,
  termNames,
}: {
  courseNames: ReadonlyMap<string, string>;
  reports: TeacherClassReportSummary[];
  termNames: ReadonlyMap<string, string>;
}) {
  return (
    <section className="next-list-panel" aria-label="Öğretmen sınıf raporları">
      <h2>Sınıf Raporları</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Sınıf</th>
            <th>Bağlam</th>
            <th>Sonuç</th>
            <th>Net</th>
            <th>Standart puan</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => (
            <tr key={`${report.snapshotId}-${report.classId ?? "no-class"}`}>
              <td>{report.className ?? report.classId ?? "-"}</td>
              <td>{formatReportContext(report, courseNames, termNames)}</td>
              <td>{report.resultCount}</td>
              <td>{formatNumber(report.averages.net)}</td>
              <td>{formatNumber(report.averages.standardScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function formatCount(value: number, label: string) {
  return `${value.toLocaleString("tr-TR")} ${label}`;
}

function formatUniqueLabels(values: Array<string | undefined>) {
  const labels = Array.from(new Set(values.filter((value): value is string => Boolean(value))));
  return labels.length > 0 ? labels.join(", ") : "-";
}

function formatReportContext(
  context: { courseId?: string; termId?: string },
  courseNames?: ReadonlyMap<string, string>,
  termNames?: ReadonlyMap<string, string>,
) {
  const parts = [
    context.courseId ? courseNames?.get(context.courseId) ?? context.courseId : undefined,
    context.termId ? termNames?.get(context.termId) ?? context.termId : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatLessonTimeRange(lesson: ScheduleLessonRecord) {
  const formatter = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" });
  return `${formatter.format(new Date(lesson.startsAt))} - ${formatter.format(new Date(lesson.endsAt))}`;
}

function formatClassOrganization(record: { campusName?: string; gradeLevelName?: string; section?: string }) {
  const parts = [record.campusName, record.gradeLevelName, record.section ? `${record.section} şube` : undefined].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}
