"use client";

import { type CSSProperties, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type {
  AttendanceRecord,
  CourseRecord,
  DevelopmentAssessmentRecord,
  HomeworkMaterialAssignmentRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportStudentProgress,
  StudentHomeworkRecord,
  StudentPublishedGradeItem,
  TeacherNoteRecord,
} from "@o-okul/shared-types";
import { Alert, Button, DataTable, Field, Panel, Select, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest, withQueryParams } from "../../../../src/api-client.js";
import { canAccessHref, hasCapabilityForRoles } from "../../_shared/access.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import { formatDateKey, istanbulDateKey } from "../../_shared/format.js";
import { AttendanceCalendarPanel } from "../../portals/_shared/attendance-calendar.js";
import { type AttendanceMonthKey, monthKeyOf, monthRange } from "../../portals/_shared/attendance-calendar-model.js";
import {
  buildStudentTimeline,
  shiftDateKey,
  studentTimelineKindLabels,
  studentTimelineKindOrder,
  type StudentTimelineEvent,
  type StudentTimelineEventKind,
} from "./student-timeline-model.js";

const timelinePeriods = [
  { days: 30, label: "Son 30 gün" },
  { days: 90, label: "Son 90 gün" },
  { days: 180, label: "Son 180 gün" },
  { days: 365, label: "Son 1 yıl" },
] as const;
const timelinePageSize = 25;
const detailTextStyle: CSSProperties = { color: "var(--color-text-muted)", display: "block", fontSize: "var(--text-sm)" };
const controlsStyle: CSSProperties = { alignItems: "end", display: "flex", flexWrap: "wrap", gap: "var(--space-xs)" };

interface TimelineSourceQuery {
  isError: boolean;
  isPending: boolean;
  fetchStatus: string;
  label: string;
  refetch(): unknown;
}

export interface StudentTimelinePanelProps {
  canViewFinance: boolean;
  materialAssignments: HomeworkMaterialAssignmentRecord[];
  overviewCourses: CourseRecord[];
  paymentPlans: PaymentPlanWithInstallmentsRecord[];
  progress: ReportStudentProgress | null;
  studentId: string;
  teacherNotes: TeacherNoteRecord[];
}

/**
 * DEC-20261102-08: personel için tek kronolojik olay listesi. Kaynaklar dönem başına sabit sayıda istekle okunur
 * (yoklama, yayınlanmış not, ödev, gelişim, ders adları); sınav, öğretmen notu, materyal ve finans olayları
 * sayfanın zaten yüklediği verilerden gelir. Her istek, rolün okuyabildiği kaynakla sınırlıdır.
 */
export function StudentTimelinePanel({
  canViewFinance,
  materialAssignments,
  overviewCourses,
  paymentPlans,
  progress,
  studentId,
  teacherNotes,
}: StudentTimelinePanelProps) {
  const { auth } = useAuth();
  const roles = auth?.session.roles ?? [];
  const persona = auth?.session.activePersona;
  const accessToken = auth?.accessToken ?? "";
  const tenantKey = auth?.session.tenantId ?? "anonymous";
  const [periodDays, setPeriodDays] = useState<number>(90);
  const [kindFilter, setKindFilter] = useState<StudentTimelineEventKind | "all">("all");
  const [visibleCount, setVisibleCount] = useState(timelinePageSize);
  const todayKey = istanbulDateKey();
  const fromKey = shiftDateKey(todayKey, -(periodDays - 1));
  const canReadAttendance = hasCapabilityForRoles(roles, "attendance:read-assigned");
  const canReadAcademic = hasCapabilityForRoles(roles, "academic:read");
  const canReadHomework = hasCapabilityForRoles(roles, "homework:read-assigned");
  const canReadCatalog = hasCapabilityForRoles(roles, "academic:read-catalog");
  const encodedStudentId = encodeURIComponent(studentId);

  const attendanceQuery = useQuery({
    queryKey: ["next-student-timeline-attendance", tenantKey, studentId, fromKey, todayKey],
    queryFn: () => apiRequest<AttendanceRecord[]>(accessToken, withQueryParams(`${apiBaseUrl}/attendance`, { dateFrom: fromKey, dateTo: todayKey, studentId })),
    enabled: Boolean(auth) && canReadAttendance,
    refetchOnWindowFocus: false,
  });
  const gradesQuery = useQuery({
    queryKey: ["next-student-timeline-grades", tenantKey, studentId],
    queryFn: () => apiRequest<StudentPublishedGradeItem[]>(accessToken, `${apiBaseUrl}/grade-assessments/students/${encodedStudentId}/published`),
    enabled: Boolean(auth) && canReadAcademic,
    refetchOnWindowFocus: false,
  });
  const homeworkQuery = useQuery({
    queryKey: ["next-student-timeline-homework", tenantKey, studentId],
    queryFn: () => apiRequest<StudentHomeworkRecord[]>(accessToken, `${apiBaseUrl}/homework/students/${encodedStudentId}`),
    enabled: Boolean(auth) && canReadHomework,
    refetchOnWindowFocus: false,
  });
  const developmentQuery = useQuery({
    queryKey: ["next-student-timeline-development", tenantKey, studentId],
    queryFn: () => apiRequest<DevelopmentAssessmentRecord[]>(accessToken, withQueryParams(`${apiBaseUrl}/development/assessments`, { studentId })),
    enabled: Boolean(auth) && canReadAcademic,
    refetchOnWindowFocus: false,
  });
  const coursesQuery = useQuery({
    queryKey: ["next-student-timeline-courses", tenantKey],
    queryFn: () => apiRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`),
    enabled: Boolean(auth) && canReadCatalog,
    refetchOnWindowFocus: false,
  });

  const sourceQueries: TimelineSourceQuery[] = [
    timelineSource(attendanceQuery, "Yoklama"),
    timelineSource(gradesQuery, "Okul notları"),
    timelineSource(homeworkQuery, "Ödevler"),
    timelineSource(developmentQuery, "Gelişim değerlendirmeleri"),
  ];
  const failedSources = sourceQueries.filter((query) => query.isError);
  const loading = sourceQueries.some((query) => query.isPending && query.fetchStatus !== "idle");

  const courseNameById = useMemo(() => {
    const entries = [...overviewCourses, ...(coursesQuery.data ?? [])].map((course) => [course.id, formatCourseName(course.name)] as const);
    return new Map(entries);
  }, [coursesQuery.data, overviewCourses]);

  const links = useMemo(() => {
    const can = (href: string) => canAccessHref(roles, href, persona);
    const studentHref = `/kurum/ogrenciler/${encodedStudentId}`;
    return {
      attendance: can("/kurum/devamsizlik")
        ? ({ classId }: { classId?: string }) => (classId ? withQueryParams("/kurum/devamsizlik", { classId }) : "/kurum/devamsizlik")
        : undefined,
      development: can("/kurum/gelisim-kriterleri") ? () => "/kurum/gelisim-kriterleri" : undefined,
      exam: () => `${studentHref}/sinavlar`,
      finance: canViewFinance && can("/kurum/finans") ? () => withQueryParams("/kurum/finans", { studentId }) : undefined,
      grade: can("/kurum/not-defteri") ? () => "/kurum/not-defteri" : undefined,
      homework: can("/kurum/materyaller") ? () => "/kurum/materyaller" : undefined,
      material: can("/kurum/materyaller") ? () => "/kurum/materyaller" : undefined,
      note: can("/kurum/notlar") ? ({ classId }: { classId?: string }) => (classId ? withQueryParams("/kurum/notlar", { classId }) : "/kurum/notlar") : undefined,
    };
  }, [canViewFinance, encodedStudentId, persona, roles, studentId]);

  const events = useMemo(() => buildStudentTimeline(
    {
      attendance: attendanceQuery.data ?? [],
      development: developmentQuery.data ?? [],
      examPoints: progress?.points ?? [],
      grades: gradesQuery.data ?? [],
      homework: homeworkQuery.data ?? [],
      materialAssignments,
      paymentPlans: canViewFinance ? paymentPlans : [],
      teacherNotes,
    },
    { canViewFinance, courseNameById, fromKey, links, todayKey },
  ), [
    attendanceQuery.data,
    canViewFinance,
    courseNameById,
    developmentQuery.data,
    fromKey,
    gradesQuery.data,
    homeworkQuery.data,
    links,
    materialAssignments,
    paymentPlans,
    progress?.points,
    teacherNotes,
    todayKey,
  ]);
  const availableKinds = studentTimelineKindOrder.filter((kind) => kind !== "finance" || canViewFinance);
  const filteredEvents = kindFilter === "all" ? events : events.filter((event) => event.kind === kindFilter);
  const visibleEvents = filteredEvents.slice(0, visibleCount);
  const remaining = filteredEvents.length - visibleEvents.length;

  return (
    <Panel
      aria-label="Öğrenci zaman çizelgesi"
      className="next-student-detail-panel next-student-detail-panel--wide"
      description="Yoklama, okul notu, sınav, ödev, öğretmen notu ve gelişim kayıtları en yeniden eskiye; her satır kaynak ekrana bağlanır."
      title="Zaman çizelgesi"
    >
      <div aria-label="Zaman çizelgesi süzgeçleri" role="group" style={controlsStyle}>
        <Field label="Dönem">
          <Select
            value={String(periodDays)}
            onChange={(event) => {
              setPeriodDays(Number(event.target.value));
              setVisibleCount(timelinePageSize);
            }}
          >
            {timelinePeriods.map((period) => (
              <option key={period.days} value={period.days}>{period.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Olay türü">
          <Select
            value={kindFilter}
            onChange={(event) => {
              setKindFilter(event.target.value as StudentTimelineEventKind | "all");
              setVisibleCount(timelinePageSize);
            }}
          >
            <option value="all">Tümü</option>
            {availableKinds.map((kind) => (
              <option key={kind} value={kind}>{studentTimelineKindLabels[kind]}</option>
            ))}
          </Select>
        </Field>
      </div>
      {failedSources.length > 0 ? (
        <Alert tone="warning">
          {`Şu kayıtlar alınamadı: ${failedSources.map((query) => query.label).join(", ")}. Diğer olaylar listelenir. `}
          <Button size="sm" type="button" variant="secondary" onClick={() => failedSources.forEach((query) => void query.refetch())}>
            Tekrar dene
          </Button>
        </Alert>
      ) : null}
      <DataTable
        caption="Zaman çizelgesi olayları"
        columns={timelineColumns}
        density="compact"
        description={loading ? "Yükleniyor…" : `${filteredEvents.length} olay · ${formatDateKey(fromKey)} – ${formatDateKey(todayKey)}`}
        emptyText="Seçilen dönemde olay yok."
        getRowKey={(event) => event.id}
        loading={loading}
        rows={visibleEvents}
      />
      {remaining > 0 ? (
        <Button size="sm" type="button" variant="secondary" onClick={() => setVisibleCount((count) => count + timelinePageSize)}>
          {`Daha fazla göster (${remaining} olay kaldı)`}
        </Button>
      ) : null}
    </Panel>
  );
}

function timelineSource(query: Omit<TimelineSourceQuery, "label">, label: string): TimelineSourceQuery {
  return { fetchStatus: query.fetchStatus, isError: query.isError, isPending: query.isPending, label, refetch: () => query.refetch() };
}

const timelineColumns: Array<DataTableColumn<StudentTimelineEvent>> = [
  {
    header: "Tarih",
    key: "date",
    mobilePriority: "primary",
    priority: "primary",
    render: (event) => formatDateKey(event.dateKey),
    sticky: "left",
  },
  {
    header: "Tür",
    key: "kind",
    mobilePriority: "secondary",
    priority: "primary",
    render: (event) => studentTimelineKindLabels[event.kind],
  },
  {
    header: "Olay",
    key: "event",
    mobilePriority: "primary",
    priority: "primary",
    render: (event) => (
      <>
        {event.title}
        {event.detail ? <span style={detailTextStyle}>{event.detail}</span> : null}
      </>
    ),
  },
  {
    header: "Durum",
    key: "status",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (event) => (event.status ? <StatusBadge tone={event.status.tone}>{event.status.label}</StatusBadge> : "-"),
  },
  {
    header: "Kaynak ekran",
    key: "link",
    mobilePriority: "secondary",
    priority: "optional",
    render: (event) => (event.link ? <Link href={event.link.href}>{event.link.label}</Link> : "-"),
  },
];

/**
 * Öğrenci 360 yoklama takvimi: ay başına tek istek (`/attendance?studentId&dateFrom&dateTo`); API kampüs ve öğretmen
 * kapsamını uygular. Takvimin metin karşılığı ayın kayıt tablosudur.
 */
export function StudentAttendanceCalendar({ className, studentId }: { className?: string; studentId: string }) {
  const { auth } = useAuth();
  const canReadAttendance = hasCapabilityForRoles(auth?.session.roles ?? [], "attendance:read-assigned");
  const [month, setMonth] = useState<AttendanceMonthKey>(() => monthKeyOf(istanbulDateKey()));
  const range = monthRange(month);
  const query = useQuery({
    queryKey: ["next-student-attendance-calendar", auth?.session.tenantId ?? "anonymous", studentId, month],
    queryFn: () => apiRequest<AttendanceRecord[]>(auth?.accessToken ?? "", withQueryParams(`${apiBaseUrl}/attendance`, { ...range, studentId })),
    enabled: Boolean(auth) && canReadAttendance,
    refetchOnWindowFocus: false,
  });
  if (!canReadAttendance) return null;
  const records = query.data ?? [];
  return (
    <AttendanceCalendarPanel
      className={className}
      description="Öğrencinin aylık yoklama görünümü; liste karşılığı takvimin altındadır."
      error={query.isError ? "Yoklama kayıtları alınamadı." : undefined}
      loading={query.isPending}
      month={month}
      records={records}
      showRecordTable
      onMonthChange={setMonth}
    />
  );
}
