"use client";

import { DataTable, InfoGrid, InfoItem, Panel, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import type { ClassRecord, ScheduleLessonRecord, StudentRecord, TeacherRecord } from "@o-okul/shared-types";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";

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
    questionCount?: number;
    standardScore?: number;
    successRate?: number;
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
  const columns: Array<DataTableColumn<ScheduleLessonRecord>> = [
    {
      header: "Ders",
      key: "lesson",
      priority: "primary",
      render: (lesson) => lesson.title,
      sticky: "left",
    },
    {
      header: "Sınıf",
      key: "class",
      priority: "primary",
      render: (lesson) => (lesson.classId ? classNames.get(lesson.classId) ?? "Sınıf bilgisi yok" : "-"),
    },
    {
      header: "Branş",
      key: "course",
      priority: "secondary",
      render: (lesson) => (lesson.courseId ? courseNames.get(lesson.courseId) ?? "Ders bilgisi yok" : "-"),
    },
    {
      header: "Dönem",
      key: "term",
      priority: "optional",
      render: (lesson) => (lesson.termId ? termNames.get(lesson.termId) ?? "Dönem bilgisi yok" : "-"),
    },
    {
      header: "Saat",
      key: "time",
      priority: "primary",
      render: (lesson) => formatLessonTimeRange(lesson),
    },
  ];

  return (
    <Panel
      aria-label="Bugünkü dersler"
      description="Öğretmenin bugünkü ders, sınıf, branş ve saat akışı."
      title="Bugünkü Dersler"
    >
      <DataTable
        caption="Bugünkü dersler"
        columns={columns}
        description="Öğretmenin bugünkü ders, sınıf, branş ve saat akışı."
        emptyText="Bugün planlı ders yok."
        getRowKey={(lesson) => lesson.id}
        rows={lessons}
      />
      {nextLesson && !lessons.some((lesson) => lesson.id === nextLesson.id) ? (
        <p className="next-status-note">
          Sonraki ders: {nextLesson.title} · {formatDateTime(nextLesson.startsAt)}
        </p>
      ) : null}
    </Panel>
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
    ...scopedClassIds.map((classId) => classNames.get(classId) ?? "Sınıf bilgisi yok"),
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
  const courseScope = formatUniqueLabels(schedule.map((lesson) => (lesson.courseId ? courseNames.get(lesson.courseId) ?? "Ders bilgisi yok" : undefined)));
  const termScope = formatUniqueLabels(schedule.map((lesson) => (lesson.termId ? termNames.get(lesson.termId) ?? "Dönem bilgisi yok" : undefined)));

  return (
    <Panel
      aria-label="Öğretmen profil özeti"
      description="Öğretmenin ders, sınıf, dönem ve organizasyon kapsamı."
      title="Profil Özeti"
    >
      <InfoGrid className="next-teacher-portal-profile-info" aria-label="Öğretmen portal profil metrikleri" role="region">
        <InfoItem label="Ad soyad" value={teacher ? `${teacher.firstName} ${teacher.lastName}` : "-"} />
        <InfoItem label="Branş" value={teacher?.branch ?? "-"} />
        <InfoItem label="Dersler" value={courseScope} />
        <InfoItem label="Dönemler" value={termScope} />
        <InfoItem label="Sınıf kapsamı" value={classScope} />
        <InfoItem label="Organizasyon" value={organizationScope} />
        <InfoItem label="Sorumlu öğrenci" value={formatCount(students.length, "öğrenci")} />
        <InfoItem label="Program" value={formatCount(schedule.length, "ders")} />
      </InfoGrid>
    </Panel>
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
  const columns: Array<DataTableColumn<TeacherClassReportSummary>> = [
    {
      header: "Sınıf",
      key: "class",
      priority: "primary",
      render: (report) => report.className ?? (report.classId ? "Sınıf bilgisi yok" : "-"),
      sticky: "left",
    },
    {
      header: "Bağlam",
      key: "context",
      priority: "secondary",
      render: (report) => formatReportContext(report, courseNames, termNames),
    },
    {
      align: "right",
      header: "Sonuç",
      key: "resultCount",
      priority: "secondary",
      render: (report) => report.resultCount,
    },
    {
      align: "right",
      header: "Başarı %",
      key: "successRate",
      priority: "primary",
      render: (report) => formatPercentNumber(reportSuccessRate(report.averages)),
    },
    {
      align: "right",
      header: "Net",
      key: "net",
      priority: "primary",
      render: (report) => formatNumber(report.averages.net),
    },
    {
      align: "right",
      header: "Soru",
      key: "questionCount",
      priority: "primary",
      render: (report) => formatNumber(reportQuestionCount(report.averages)),
    },
  ];

  return (
    <Panel
      aria-label="Öğretmen sınıf raporları"
      description="Soru sayıları farklı raporları Başarı % ile karşılaştırın; Net ve Soru sonucu açıklar."
      title="Sınıf Raporları"
    >
      <DataTable
        caption="Öğretmen sınıf raporları"
        columns={columns}
        description="Soru sayıları farklı raporları Başarı % ile karşılaştırın; Net ve Soru sonucu açıklar."
        density="compact"
        emptyText="Hazır sınıf raporu yok."
        getRowKey={(report) => `${report.snapshotId}-${report.classId ?? "no-class"}`}
        rows={reports}
      />
    </Panel>
  );
}

export function TeacherFocusPanel({
  campusNames,
  courseName,
  gradeLevelNames,
  mode,
  net,
  openSupportTicketCount,
  questionCount,
  selectedClass,
  selectedStudent,
  successRate,
  termName,
}: {
  campusNames: ReadonlyMap<string, string>;
  courseName?: string;
  gradeLevelNames: ReadonlyMap<string, string>;
  mode: "read-only" | "write";
  net?: number;
  openSupportTicketCount: number;
  questionCount?: number;
  selectedClass?: ClassRecord;
  selectedStudent?: StudentRecord;
  successRate?: number;
  termName?: string;
}) {
  const studentName = selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "-";
  const className = selectedClass?.name ?? (selectedStudent?.classId ? "Sınıf bilgisi yok" : "-");
  const campusName = selectedClass?.campusId ? campusNames.get(selectedClass.campusId) ?? "Kampüs bilgisi yok" : "-";
  const gradeLevelName = selectedClass?.gradeLevelId ? gradeLevelNames.get(selectedClass.gradeLevelId) ?? "Seviye bilgisi yok" : "-";
  const modeLabel = mode === "read-only" ? "Yalnızca görüntüleme" : "İşlem yapılabilir";
  const supportTicketStatus = openSupportTicketCount > 0 ? `${openSupportTicketCount} açık` : "Açık talep yok";

  return (
    <Panel
      actions={<StatusBadge tone={mode === "read-only" ? "neutral" : "info"}>{modeLabel}</StatusBadge>}
      aria-label="Seçili sınıf ve öğrenci özeti"
      className="next-teacher-focus"
      description="Seçili sınıfın, öğrencinin ve günün özeti"
      title="Seçili Öğrenci"
    >
      <div className="next-teacher-focus__body">
        <div className="next-teacher-focus__identity">
          <span>Öğrenci</span>
          <strong>{studentName}</strong>
          <small>{className}</small>
        </div>
        <InfoGrid className="next-teacher-focus__grid" aria-label="Seçili sınıf ve öğrenci bilgileri" role="region">
          <InfoItem label="Kampüs" value={campusName} />
          <InfoItem label="Seviye" value={gradeLevelName} />
          <InfoItem label="Branş" value={courseName ?? "-"} />
          <InfoItem label="Dönem" value={termName ?? "-"} />
          <InfoItem label="Başarı %" value={formatPercentNumber(successRate)} />
          <InfoItem label="Soru" value={formatNumber(questionCount)} />
          <InfoItem label="Net" value={formatNumber(net)} />
          <InfoItem label="Destek" value={supportTicketStatus} />
        </InfoGrid>
      </div>
    </Panel>
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
    context.courseId ? courseNames?.get(context.courseId) ?? "Ders bilgisi yok" : undefined,
    context.termId ? termNames?.get(context.termId) ?? "Dönem bilgisi yok" : undefined,
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
