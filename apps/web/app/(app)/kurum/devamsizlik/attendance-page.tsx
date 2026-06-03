"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcademicTermRecord, AttendanceRecord, ClassRecord, CourseRecord, StudentRecord } from "@uzman-hocam/shared-types";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  attendanceFormSchema,
  firstFormError,
  type AttendanceFormPayload,
  type AttendanceFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: AttendanceFormState = {
  studentId: "",
  courseId: "",
  termId: "",
  date: "",
  status: "PRESENT",
};

export function AttendancePage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const [classId, setClassId] = useState("");
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
  const courseNames = useMemo(() => new Map(references.courses.map((record) => [record.id, record.name])), [references.courses]);
  const termNames = useMemo(() => new Map(references.terms.map((record) => [record.id, record.name])), [references.terms]);

  const columns: Array<DataTableColumn<AttendanceRecord>> = [
    { key: "studentId", header: "Öğrenci", render: (record) => studentNames.get(record.studentId) ?? record.studentId },
    { key: "classId", header: "Sınıf", render: (record) => classLabel(record.studentId, references.students, classNames) },
    { key: "courseId", header: "Ders", render: (record) => optionalLabel(record.courseId, courseNames) },
    { key: "termId", header: "Dönem", render: (record) => optionalLabel(record.termId, termNames) },
    { key: "date", header: "Tarih", render: (record) => record.date },
    { key: "status", header: "Durum", render: (record) => attendanceStatusLabel(record.status) },
    {
      key: "actions",
      header: "İşlem",
      render: (record) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(record)} aria-label={`${studentNames.get(record.studentId) ?? record.studentId} devamsızlığını düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(record)} aria-label={`${studentNames.get(record.studentId) ?? record.studentId} devamsızlığını sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

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
    if (!window.confirm(`${studentNames.get(record.studentId) ?? record.studentId} devamsızlığı silinsin mi?`)) return;

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
            <label className="next-filter-field">
              Sınıf
              <select
                value={classId}
                onChange={(event) => {
                  setClassId(event.target.value);
                  setListQuery((current) => ({ ...current, page: 1 }));
                }}
              >
                <option value="">Tümü</option>
                {references.classes.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.name}
                  </option>
                ))}
              </select>
            </label>
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Devamsızlık ekle
            </Button>
          </>
        }
        aria-label="Devamsızlık yönetimi"
        columns={columns}
        description="Devamsızlığı öğrenci, sınıf, ders ve dönem bağlamıyla yönet."
        emptyText="Devamsızlık kaydı yok"
        error={error || (attendanceQuery.isError ? "Devamsızlık kayıtları alınamadı." : referencesQuery.isError ? "Seçim listeleri alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        loading={attendanceQuery.isPending || referencesQuery.isPending}
        rows={rows}
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
      <label>
        Öğrenci
        <select value={form.studentId} onChange={(event) => onChange((current) => ({ ...current, studentId: event.target.value }))}>
          <option value="">Seçiniz</option>
          {references.students.map((record) => (
            <option key={record.id} value={record.id}>
              {record.firstName} {record.lastName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Ders
        <select value={form.courseId ?? ""} onChange={(event) => onChange((current) => ({ ...current, courseId: event.target.value }))}>
          <option value="">Seçiniz</option>
          {references.courses.map((record) => (
            <option key={record.id} value={record.id}>
              {record.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Dönem
        <select value={form.termId ?? ""} onChange={(event) => onChange((current) => ({ ...current, termId: event.target.value }))}>
          <option value="">Seçiniz</option>
          {references.terms.map((record) => (
            <option key={record.id} value={record.id}>
              {record.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tarih
        <Input required type="date" value={form.date} onChange={(event) => onChange((current) => ({ ...current, date: event.target.value }))} />
      </label>
      <label>
        Durum
        <select value={form.status} onChange={(event) => onChange((current) => ({ ...current, status: event.target.value as AttendanceRecord["status"] }))}>
          <option value="PRESENT">Var</option>
          <option value="ABSENT">Yok</option>
          <option value="LATE">Geç</option>
          <option value="EXCUSED">İzinli</option>
        </select>
      </label>
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
  return classNames.get(student.classId) ?? student.classId;
}

function optionalLabel(id: string | undefined, labels: Map<string, string>) {
  if (!id) return "-";
  return labels.get(id) ?? id;
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
