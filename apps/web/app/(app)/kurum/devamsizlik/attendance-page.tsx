"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AcademicTermRecord,
  AttendanceDailyRosterResponse,
  AttendanceDailyRosterStudent,
  AttendanceDailyUpsertRequest,
  AttendanceDailyUpsertResponse,
  AttendanceRecord,
  AttendanceStatus,
  ClassRecord,
  CourseRecord,
  StudentRecord,
} from "@o-okul/shared-types";
import {
  Button,
  CrudPage,
  DataTable,
  EmptyState,
  Field,
  Input,
  Panel,
  Select,
  StatusBadge,
  type DataTableColumn,
} from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

export function AttendancePage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: attendanceSortOptions });
  const [classId, setClassId] = useState(() => searchParams.get("classId") ?? "");
  const [attendanceDate, setAttendanceDate] = useState(todayInputValue);
  const queryKey = ["next-attendance", auth?.session.tenantId ?? "anonymous", listQuery, classId];
  const listQueryKey = ["next-attendance", auth?.session.tenantId ?? "anonymous"];
  const attendanceQuery = useQuery({
    queryKey,
    queryFn: () => loadAttendance(auth?.accessToken ?? "", listQuery, classId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const referencesQuery = useQuery({
    queryKey: ["next-attendance-refs", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const dailyQueryKey = ["next-daily-attendance", auth?.session.tenantId ?? "anonymous", classId, attendanceDate];
  const dailyQuery = useQuery({
    queryKey: dailyQueryKey,
    queryFn: () => loadDailyAttendance(auth?.accessToken ?? "", classId, attendanceDate),
    enabled: Boolean(auth && classId && attendanceDate),
    refetchOnWindowFocus: false,
  });
  const [dailyStatuses, setDailyStatuses] = useState<Record<string, AttendanceStatus | "">>({});
  const [dailyError, setDailyError] = useState("");
  const [isDailySaving, setIsDailySaving] = useState(false);
  const rows = attendanceQuery.data?.data ?? [];
  const references = referencesQuery.data ?? emptyReferences;
  const studentNames = useMemo(
    () => new Map(references.students.map((record) => [record.id, `${record.firstName} ${record.lastName}`])),
    [references.students],
  );
  const classNames = useMemo(() => new Map(references.classes.map((record) => [record.id, record.name])), [references.classes]);
  const courseNames = useMemo(() => new Map(references.courses.map((record) => [record.id, formatCourseName(record.name)])), [references.courses]);
  const termNames = useMemo(() => new Map(references.terms.map((record) => [record.id, record.name])), [references.terms]);
  const presentCount = rows.filter((record) => record.status === "PRESENT").length;
  const absentCount = rows.filter((record) => record.status === "ABSENT").length;
  const lateCount = rows.filter((record) => record.status === "LATE").length;
  const excusedCount = rows.filter((record) => record.status === "EXCUSED").length;
  const attentionCount = absentCount + lateCount;
  const selectedClassName = classId ? classNames.get(classId) ?? "Seçili sınıf" : "Tüm sınıflar";
  const attendanceSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Yoklama toplamı",
      value: formatCount(attendanceQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "Açık sayfadaki yok ve geç kayıt",
      key: "attention",
      label: "Bu sayfada takip",
      tone: attentionCount > 0 ? "warning" : "success",
      value: formatCount(attentionCount),
    },
    {
      description: "Açık sayfadaki var / izinli",
      key: "present",
      label: "Bu sayfada katılım",
      tone: presentCount > 0 ? "success" : "default",
      value: `${formatCount(presentCount)} / ${formatCount(excusedCount)}`,
    },
    {
      description: "Sınıf, ders, dönem referansı",
      key: "references",
      label: "Bağlam",
      value: `${references.classes.length}/${references.courses.length}/${references.terms.length}`,
    },
  ];
  const attendanceSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "class",
      label: `Sınıf: ${selectedClassName}`,
      tone: classId ? "info" : "neutral",
    },
    {
      key: "sort",
      label: `Sıralama: ${formatAttendanceSort(listQuery.sort)}`,
      tone: "neutral",
    },
  ];
  const dailyStudents = dailyQuery.data?.students ?? [];
  const dailyRecords = dailyQuery.data?.records ?? [];
  const dailyAggregate = dailyQuery.data?.aggregate;
  const dailyRosterComplete = dailyStudents.length > 0 && dailyStudents.every((student) => Boolean(dailyStatuses[student.id]));

  useEffect(() => {
    if (!dailyQuery.data) {
      setDailyStatuses({});
      return;
    }
    const statusByStudentId = new Map(dailyQuery.data.records.map((record) => [record.studentId, record.status]));
    setDailyStatuses(Object.fromEntries(dailyQuery.data.students.map((student) => [student.id, statusByStudentId.get(student.id) ?? ""])));
  }, [dailyQuery.data]);

  const dailyColumns: Array<DataTableColumn<AttendanceDailyRosterStudent>> = [
    {
      key: "student",
      header: "Öğrenci",
      mobilePriority: "primary",
      priority: "primary",
      sticky: "left",
      render: (student) => `${student.firstName} ${student.lastName}`,
    },
    {
      key: "studentNo",
      header: "No",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (student) => student.studentNo ?? "-",
    },
    {
      key: "status",
      header: "Durum",
      mobilePriority: "primary",
      priority: "primary",
      render: (student) => (
        <Select
          aria-label={`${student.firstName} ${student.lastName} yoklama durumu`}
          value={dailyStatuses[student.id] ?? ""}
          onChange={(event) => setDailyStatuses((current) => ({ ...current, [student.id]: event.target.value as AttendanceStatus }))}
        >
          <option value="">Seçiniz</option>
          <option value="PRESENT">Var</option>
          <option value="ABSENT">Yok</option>
          <option value="LATE">Geç</option>
          <option value="EXCUSED">İzinli</option>
        </Select>
      ),
    },
  ];

  const columns: Array<DataTableColumn<AttendanceRecord>> = [
    { key: "studentId", header: "Öğrenci", priority: "primary", render: (record) => studentLabel(record.studentId, studentNames), sticky: "left" },
    { key: "classId", header: "Sınıf", priority: "secondary", render: (record) => classLabel(record.studentId, references.students, classNames) },
    { key: "courseId", header: "Ders", priority: "secondary", render: (record) => optionalLabel(record.courseId, courseNames, "Ders bilgisi yok") },
    { key: "termId", header: "Dönem", priority: "optional", render: (record) => optionalLabel(record.termId, termNames, "Dönem bilgisi yok") },
    { key: "date", header: "Tarih", priority: "secondary", render: (record) => record.date },
    {
      key: "status",
      header: "Durum",
      priority: "primary",
      render: (record) => <StatusBadge tone={attendanceStatusTone(record.status)}>{attendanceStatusLabel(record.status)}</StatusBadge>,
    },
  ];

  function updateClassFilter(nextClassId: string) {
    setClassId(nextClassId);
    setListQuery({ ...listQuery, page: 1 });
    writeBrowserQueryParam("classId", nextClassId);
  }

  function markAllPresent() {
    setDailyStatuses(Object.fromEntries(dailyStudents.map((student) => [student.id, "PRESENT"] as const)));
  }

  async function saveDailyAttendance() {
    if (!auth || !classId || !attendanceDate || !dailyRosterComplete) return;
    setDailyError("");
    setIsDailySaving(true);
    try {
      await upsertDailyAttendance(auth.accessToken, {
        classId,
        date: attendanceDate,
        entries: dailyStudents.map((student) => ({ studentId: student.id, status: dailyStatuses[student.id] as AttendanceStatus })),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dailyQueryKey }),
        queryClient.invalidateQueries({ queryKey: listQueryKey }),
      ]);
    } catch {
      setDailyError("Günlük yoklama kaydedilemedi.");
    } finally {
      setIsDailySaving(false);
    }
  }

  return (
    <>
      <Panel
        aria-label="Günlük sınıf yoklaması"
        description="Sınıf ve tarihi seç, öğrenci durumlarını tek işlemle atomik olarak kaydet."
        title="Günlük sınıf yoklaması"
      >
        <div className="next-list-controls" aria-label="Günlük yoklama kontrolleri">
          <Field label="Yoklama sınıfı">
            <Select value={classId} onChange={(event) => updateClassFilter(event.target.value)}>
              <option value="">Sınıf seçiniz</option>
              {references.classes.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
            </Select>
          </Field>
          <Field label="Yoklama tarihi">
            <Input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} />
          </Field>
          {dailyRecords.length === 0 && dailyStudents.length > 0 ? (
            <Button type="button" variant="secondary" onClick={markAllPresent}>Tümünü Var</Button>
          ) : null}
          <Button disabled={!dailyRosterComplete || isDailySaving} type="button" onClick={() => void saveDailyAttendance()}>
            {isDailySaving ? "Kaydediliyor" : "Yoklamayı kaydet"}
          </Button>
        </div>
        {dailyError ? <p className="uh-crud-page__error" role="alert">{dailyError}</p> : null}
        {!classId ? (
          <EmptyState title="Sınıf seçin" description="Günlük yoklama listesi seçtiğiniz sınıfa göre hazırlanır." />
        ) : (
          <>
            <DailyAttendanceSummary aggregate={dailyAggregate} />
            <DataTable
              caption="Günlük sınıf yoklama listesi"
              columns={dailyColumns}
              density="compact"
              description={`${attendanceDate} tarihli aktif sınıf öğrencileri ve yoklama durumları.`}
              emptyText="Seçili tarihte bu sınıfa kayıtlı öğrenci yok"
              error={dailyQuery.isError ? "Günlük yoklama listesi alınamadı." : undefined}
              getRowKey={(student) => student.id}
              loading={dailyQuery.isPending}
              rows={dailyStudents}
            />
          </>
        )}
      </Panel>
      <CrudPage
        actions={
          <ListControls
            meta={attendanceQuery.data?.meta}
            onChange={setListQuery}
            sortOptions={attendanceSortOptions}
            state={listQuery}
          >
            <Field className="next-filter-field" label="Geçmiş sınıf filtresi">
              <Select
                value={classId}
                onChange={(event) => {
                  updateClassFilter(event.target.value);
                }}
              >
                <option value="">Tümü</option>
                {references.classes.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.name}
                  </option>
                ))}
              </Select>
            </Field>
          </ListControls>
        }
        aria-label="Devamsızlık yönetimi"
        columns={columns}
        description="Geçmiş ve ders bağlı kayıtları görüntüle; günlük yoklamayı üstteki sınıf listesiyle kaydet."
        emptyState={
          <EmptyState
            title="Devamsızlık kaydı yok"
            description="Günlük sınıf yoklaması kaydedildiğinde geçmiş kayıtlar burada görünür."
            hint="Yeni kayıtlar yalnız üstteki tam sınıf listesi üzerinden oluşturulur."
          />
        }
        emptyText="Devamsızlık kaydı yok"
        error={attendanceQuery.isError ? "Devamsızlık kayıtları alınamadı." : referencesQuery.isError ? "Seçim listeleri alınamadı." : undefined}
        getRowKey={(record) => record.id}
        density="compact"
        loading={attendanceQuery.isPending || referencesQuery.isPending}
        rows={rows}
        summary={<OperationSummary ariaLabel="Devamsızlık operasyon özeti" badges={attendanceSummaryBadges} items={attendanceSummaryItems} />}
        tableCaption="Devamsızlık operasyon listesi"
        tableDescription="Öğrenci, sınıf, ders, dönem ve durum kırılımıyla yoklama takibi."
      />
    </>
  );
}

const attendanceSortOptions = [
  { label: "Tarih yeni-eski", value: "-date" },
  { label: "Tarih eski-yeni", value: "date" },
  { label: "Durum A-Z", value: "status" },
  { label: "Durum Z-A", value: "-status" },
];

interface AttendanceReferences {
  classes: ClassRecord[];
  courses: CourseRecord[];
  students: StudentRecord[];
  terms: AcademicTermRecord[];
}

const emptyReferences: AttendanceReferences = {
  classes: [],
  courses: [],
  students: [],
  terms: [],
};

function DailyAttendanceSummary({ aggregate }: { aggregate?: AttendanceDailyRosterResponse["summary"] }) {
  if (!aggregate) return null;
  const items: OperationSummaryItem[] = [
    { key: "total", label: "İşaretlenen", value: formatCount(aggregate.total), description: "Durumu kaydedilmiş öğrenci" },
    { key: "present", label: "Var", value: formatCount(aggregate.present), tone: "success" },
    { key: "attention", label: "Yok / Geç", value: `${formatCount(aggregate.absent)} / ${formatCount(aggregate.late)}`, tone: aggregate.absent + aggregate.late > 0 ? "warning" : "success" },
    { key: "excused", label: "İzinli", value: formatCount(aggregate.excused) },
    { key: "unmarked", label: "İşaretlenmeyen", value: formatCount(aggregate.unmarked), tone: aggregate.unmarked > 0 ? "warning" : "success" },
  ];
  return <OperationSummary ariaLabel="Günlük yoklama özeti" items={items} />;
}

async function loadDailyAttendance(accessToken: string, classId: string, date: string) {
  const query = new URLSearchParams({ classId, date });
  const response = await apiRequest<AttendanceDailyRosterResponse>(accessToken, `${apiBaseUrl}/attendance/daily?${query.toString()}`);
  return { aggregate: response.summary, records: response.records, students: response.students };
}

async function upsertDailyAttendance(accessToken: string, input: AttendanceDailyUpsertRequest) {
  return apiRequest<AttendanceDailyUpsertResponse>(accessToken, `${apiBaseUrl}/attendance/daily`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

async function loadAttendance(accessToken: string, listQuery: ListQueryState, classId: string) {
  const url = new URL(buildListUrl(`${apiBaseUrl}/attendance`, listQuery));
  if (classId) url.searchParams.set("classId", classId);
  return apiListRequest<AttendanceRecord>(accessToken, url);
}

async function loadReferences(accessToken: string): Promise<AttendanceReferences> {
  const [classes, courses, students, terms] = await Promise.all([
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`),
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return {
    classes: classes.data,
    courses: courses.data,
    students: students.data,
    terms: terms.data,
  };
}

function classLabel(studentId: string, students: StudentRecord[], classNames: Map<string, string>) {
  const student = students.find((record) => record.id === studentId);
  if (!student?.classId) return "-";
  return classNames.get(student.classId) ?? "Sınıf bilgisi yok";
}

function studentLabel(studentId: string, studentNames: Map<string, string>) {
  return studentNames.get(studentId) ?? "Öğrenci eşleşmedi";
}

function optionalLabel(id: string | undefined, labels: Map<string, string>, fallback: string) {
  if (!id) return "-";
  return labels.get(id) ?? fallback;
}

function attendanceStatusLabel(status: AttendanceRecord["status"]) {
  const labels: Record<AttendanceRecord["status"], string> = {
    PRESENT: "Var",
    ABSENT: "Yok",
    LATE: "Geç",
    EXCUSED: "İzinli",
  };
  return labels[status];
}

function attendanceStatusTone(status: AttendanceRecord["status"]) {
  const tones: Record<AttendanceRecord["status"], "danger" | "info" | "success" | "warning"> = {
    PRESENT: "success",
    ABSENT: "danger",
    LATE: "warning",
    EXCUSED: "info",
  };
  return tones[status];
}

function formatAttendanceSort(sort: string) {
  return attendanceSortOptions.find((option) => option.value === sort)?.label ?? "Varsayılan";
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function todayInputValue() {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60_000;
  return new Date(today.getTime() - offset).toISOString().slice(0, 10);
}

function writeBrowserQueryParam(name: string, value: string) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set(name, value);
  } else {
    url.searchParams.delete(name);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
}
