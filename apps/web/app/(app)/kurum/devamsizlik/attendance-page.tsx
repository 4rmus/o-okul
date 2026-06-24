"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcademicTermRecord, AttendanceRecord, ClassRecord, CourseRecord, StudentRecord } from "@o-okul/shared-types";
import {
  Button,
  CrudPage,
  EmptyState,
  Field,
  FormModal,
  Input,
  Select,
  StatusBadge,
  type DataTableColumn,
  useConfirmDialog,
} from "@o-okul/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import {
  attendanceFormSchema,
  firstFormError,
  type AttendanceFormPayload,
  type AttendanceFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const emptyForm: AttendanceFormState = {
  studentId: "",
  courseId: "",
  termId: "",
  date: "",
  status: "PRESENT",
};

export function AttendancePage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: attendanceSortOptions });
  const [classId, setClassId] = useState(() => searchParams.get("classId") ?? "");
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
  const [editingAttendance, setEditingAttendance] = useState<AttendanceRecord | null>(null);
  const [form, setForm] = useState<AttendanceFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
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
      description: "Yok ve geç kayıt",
      key: "attention",
      label: "Takip gerektiren",
      tone: attentionCount > 0 ? "warning" : "success",
      value: formatCount(attentionCount),
    },
    {
      description: "Var / izinli",
      key: "present",
      label: "Katılım durumu",
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
    {
      key: "actions",
      header: "İşlem",
      priority: "primary",
      render: (record) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(record)} aria-label={`${studentLabel(record.studentId, studentNames)} devamsızlığını düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(record)} aria-label={`${studentLabel(record.studentId, studentNames)} devamsızlığını sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
      sticky: "right",
    },
  ];

  function updateClassFilter(nextClassId: string) {
    setClassId(nextClassId);
    setListQuery({ ...listQuery, page: 1 });
    writeBrowserQueryParam("classId", nextClassId);
  }

  function openCreateForm() {
    setEditingAttendance(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(record: AttendanceRecord) {
    setEditingAttendance(record);
    setForm({
      studentId: record.studentId,
      courseId: record.courseId ?? "",
      termId: record.termId ?? "",
      date: record.date,
      status: record.status,
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingAttendance(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = attendanceFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedAttendance = editingAttendance
        ? await updateAttendance(auth.accessToken, editingAttendance.id, parsedForm.data)
        : await createAttendance(auth.accessToken, parsedForm.data);
      void savedAttendance;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Devamsızlık kaydedilemedi.");
    }
  }

  async function handleDelete(record: AttendanceRecord) {
    if (!auth) return;
    const label = studentLabel(record.studentId, studentNames);
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${label} devamsızlığı silinsin mi?`,
      title: "Devamsızlığı sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteAttendance(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Devamsızlık silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={attendanceQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={attendanceSortOptions}
              state={listQuery}
            />
            <Field className="next-filter-field" label="Sınıf">
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
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Devamsızlık ekle
            </Button>
          </>
        }
        aria-label="Devamsızlık yönetimi"
        columns={columns}
        description="Devamsızlığı öğrenci, sınıf, ders ve dönem bağlamıyla yönet."
        emptyState={
          <EmptyState
            title="Devamsızlık kaydı yok"
            description="İlk devamsızlık kaydını ekleyerek yoklama takibini başlat."
            hint="Kayıtlar öğrenci, ders ve dönem bağlantısıyla izlenir."
            primaryAction={{ label: "Devamsızlık ekle", onClick: openCreateForm }}
          />
        }
        emptyText="Devamsızlık kaydı yok"
        error={error || (attendanceQuery.isError ? "Devamsızlık kayıtları alınamadı." : referencesQuery.isError ? "Seçim listeleri alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        density="compact"
        loading={attendanceQuery.isPending || referencesQuery.isPending}
        rows={rows}
        summary={<OperationSummary ariaLabel="Devamsızlık operasyon özeti" badges={attendanceSummaryBadges} items={attendanceSummaryItems} />}
        tableCaption="Devamsızlık operasyon listesi"
        tableDescription="Öğrenci, sınıf, ders, dönem ve durum kırılımıyla yoklama takibi."
        title="Devamsızlık"
      />
      <AttendanceFormModal
        form={form}
        isEditing={Boolean(editingAttendance)}
        onCancel={closeForm}
        onChange={setForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        references={references}
      />
      {confirmationDialog}
    </>
  );
}

function AttendanceFormModal({
  form,
  isEditing,
  onCancel,
  onChange,
  onSubmit,
  open,
  references,
}: {
  form: AttendanceFormState;
  isEditing: boolean;
  onCancel(): void;
  onChange(update: (current: AttendanceFormState) => AttendanceFormState): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  open: boolean;
  references: AttendanceReferences;
}) {
  return (
    <FormModal
      description="Öğrenci, tarih ve durum zorunludur."
      onCancel={onCancel}
      onSubmit={onSubmit}
      open={open}
      submitLabel={isEditing ? "Kaydet" : "Ekle"}
      title={isEditing ? "Devamsızlık düzenle" : "Devamsızlık ekle"}
    >
      <Field label="Öğrenci">
        <Select value={form.studentId} onChange={(event) => onChange((current) => ({ ...current, studentId: event.target.value }))}>
          <option value="">Seçiniz</option>
          {references.students.map((record) => (
            <option key={record.id} value={record.id}>
              {record.firstName} {record.lastName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Ders">
        <Select value={form.courseId ?? ""} onChange={(event) => onChange((current) => ({ ...current, courseId: event.target.value }))}>
          <option value="">Seçiniz</option>
          {references.courses.map((record) => (
            <option key={record.id} value={record.id}>
              {formatCourseName(record.name)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Dönem">
        <Select value={form.termId ?? ""} onChange={(event) => onChange((current) => ({ ...current, termId: event.target.value }))}>
          <option value="">Seçiniz</option>
          {references.terms.map((record) => (
            <option key={record.id} value={record.id}>
              {record.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Tarih">
        <Input required type="date" value={form.date} onChange={(event) => onChange((current) => ({ ...current, date: event.target.value }))} />
      </Field>
      <Field label="Durum">
        <Select value={form.status} onChange={(event) => onChange((current) => ({ ...current, status: event.target.value as AttendanceRecord["status"] }))}>
          <option value="PRESENT">Var</option>
          <option value="ABSENT">Yok</option>
          <option value="LATE">Geç</option>
          <option value="EXCUSED">İzinli</option>
        </Select>
      </Field>
    </FormModal>
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

async function createAttendance(accessToken: string, input: AttendanceFormPayload) {
  return apiRequest<AttendanceRecord>(accessToken, `${apiBaseUrl}/attendance`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateAttendance(accessToken: string, id: string, input: AttendanceFormPayload) {
  return apiRequest<AttendanceRecord>(accessToken, `${apiBaseUrl}/attendance/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteAttendance(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/attendance/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("ATTENDANCE_DELETE_FAILED");
  }
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
