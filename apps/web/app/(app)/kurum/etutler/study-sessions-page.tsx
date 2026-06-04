"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcademicTermRecord, ClassRecord, CourseRecord, StudentRecord, StudySessionRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  firstFormError,
  studySessionFormSchema,
  type StudySessionFormPayload,
  type StudySessionFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: StudySessionFormState = {
  classId: "",
  teacherId: "",
  courseId: "",
  termId: "",
  studentIds: [],
  title: "",
  capacity: 1,
  startsAt: "",
  endsAt: "",
};

export function StudySessionsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const queryKey = ["next-study-sessions", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-study-sessions", auth?.session.tenantId ?? "anonymous"];
  const sessionsQuery = useQuery({
    queryKey,
    queryFn: () => loadSessions(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const referenceQuery = useQuery({
    queryKey: ["next-study-session-refs", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingSession, setEditingSession] = useState<StudySessionRecord | null>(null);
  const [form, setForm] = useState<StudySessionFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = sessionsQuery.data?.data ?? [];
  const references = referenceQuery.data ?? emptyReferences;
  const classNames = useMemo(() => new Map(references.classes.map((record) => [record.id, record.name])), [references.classes]);
  const courseNames = useMemo(() => new Map(references.courses.map((record) => [record.id, record.name])), [references.courses]);
  const termNames = useMemo(() => new Map(references.terms.map((record) => [record.id, record.name])), [references.terms]);
  const teacherNames = useMemo(
    () => new Map(references.teachers.map((record) => [record.id, `${record.firstName} ${record.lastName}`])),
    [references.teachers],
  );
  const studentNames = useMemo(
    () => new Map(references.students.map((record) => [record.id, `${record.firstName} ${record.lastName}`])),
    [references.students],
  );

  const columns: Array<DataTableColumn<StudySessionRecord>> = [
    { key: "title", header: "Etüt", render: (record) => record.title },
    { key: "classId", header: "Sınıf", render: (record) => classNames.get(record.classId) ?? record.classId },
    { key: "courseId", header: "Branş", render: (record) => courseLabel(record.courseId, courseNames) },
    { key: "termId", header: "Dönem", render: (record) => termLabel(record.termId, termNames) },
    { key: "teacherId", header: "Öğretmen", render: (record) => teacherNames.get(record.teacherId) ?? record.teacherId },
    { key: "studentIds", header: "Öğrenci", render: (record) => studentLabel(record.studentIds, studentNames) },
    { key: "capacity", header: "Kapasite", render: (record) => `${record.studentIds.length}/${record.capacity}` },
    { key: "startsAt", header: "Başlangıç", render: (record) => formatDateTime(record.startsAt) },
    {
      key: "actions",
      header: "İşlem",
      render: (record) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(record)} aria-label={`${record.title} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(record)} aria-label={`${record.title} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingSession(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(record: StudySessionRecord) {
    setEditingSession(record);
    setForm({
      classId: record.classId,
      teacherId: record.teacherId,
      courseId: record.courseId ?? "",
      termId: record.termId ?? "",
      studentIds: record.studentIds,
      title: record.title,
      capacity: record.capacity,
      startsAt: toDateTimeInput(record.startsAt),
      endsAt: toDateTimeInput(record.endsAt),
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingSession(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = studySessionFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const payload = toStudySessionPayload(parsedForm.data);
      const savedSession = editingSession
        ? await updateSession(auth.accessToken, editingSession.id, payload)
        : await createSession(auth.accessToken, payload);
      void savedSession;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch (submitError) {
      setError(apiErrorMessage(submitError, "Etüt kaydedilemedi."));
    }
  }

  async function handleDelete(record: StudySessionRecord) {
    if (!auth) return;
    if (!window.confirm(`${record.title} silinsin mi?`)) return;

    setError("");
    try {
      await deleteSession(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch (deleteError) {
      setError(apiErrorMessage(deleteError, "Etüt silinemedi."));
    }
  }

  function handleStudentIdsChange(select: HTMLSelectElement) {
    const studentIds = selectedValues(select);
    setForm((current) => ({ ...current, studentIds }));
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={sessionsQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={studySessionSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Etüt ekle
            </Button>
          </>
        }
        aria-label="Etüt yönetimi"
        columns={columns}
        description="Kurum etütlerini sınıf, öğretmen, ders ve öğrenci bağlantısıyla yönet."
        emptyState={
          <EmptyState
            title="Etüt planı boş"
            description="Öğrenciler için ilk etüt oturumunu oluşturarak başla."
            hint="Etüt oluşturmak için sınıf, öğretmen, ders ve öğrenci kayıtları gerekir."
            primaryAction={{ label: "Etüt ekle", onClick: openCreateForm }}
          />
        }
        emptyText="Etüt kaydı yok"
        error={
          error ||
          (sessionsQuery.isError
            ? apiErrorMessage(sessionsQuery.error, "Etütler alınamadı.")
            : referenceQuery.isError
              ? apiErrorMessage(referenceQuery.error, "Seçim listeleri alınamadı.")
              : undefined)
        }
        getRowKey={(record) => record.id}
        loading={sessionsQuery.isPending || referenceQuery.isPending}
        rows={rows}
        title="Etütler"
      />
      <FormModal
        description="Sınıf, öğretmen, öğrenci, başlık, kapasite ve saat aralığı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingSession ? "Kaydet" : "Ekle"}
        title={editingSession ? "Etüt düzenle" : "Etüt ekle"}
      >
        <label>
          Sınıf
          <select value={form.classId} onChange={(event) => setForm((current) => ({ ...current, classId: event.target.value }))}>
            <option value="">Seçiniz</option>
            {references.classes.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Öğretmen
          <select value={form.teacherId} onChange={(event) => setForm((current) => ({ ...current, teacherId: event.target.value }))}>
            <option value="">Seçiniz</option>
            {references.teachers.map((record) => (
              <option key={record.id} value={record.id}>
                {record.firstName} {record.lastName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Branş
          <select value={form.courseId ?? ""} onChange={(event) => setForm((current) => ({ ...current, courseId: event.target.value }))}>
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
          <select value={form.termId ?? ""} onChange={(event) => setForm((current) => ({ ...current, termId: event.target.value }))}>
            <option value="">Seçiniz</option>
            {references.terms.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Öğrenciler
          <select multiple value={form.studentIds} onChange={(event) => handleStudentIdsChange(event.currentTarget)}>
            {references.students.map((record) => (
              <option key={record.id} value={record.id}>
                {record.firstName} {record.lastName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Etüt başlığı
          <Input required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label>
          Kapasite
          <Input required type="number" min={1} value={String(form.capacity ?? "")} onChange={(event) => setForm((current) => ({ ...current, capacity: Number(event.target.value) }))} />
        </label>
        <label>
          Başlangıç
          <Input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} />
        </label>
        <label>
          Bitiş
          <Input required type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} />
        </label>
      </FormModal>
    </>
  );
}

const emptyReferences = { classes: [], courses: [], students: [], teachers: [], terms: [] } satisfies {
  classes: ClassRecord[];
  courses: CourseRecord[];
  students: StudentRecord[];
  teachers: TeacherRecord[];
  terms: AcademicTermRecord[];
};

const studySessionSortOptions = [
  { label: "Başlangıç eski-yeni", value: "startsAt" },
  { label: "Başlangıç yeni-eski", value: "-startsAt" },
  { label: "Etüt A-Z", value: "title" },
  { label: "Etüt Z-A", value: "-title" },
];

async function loadSessions(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<StudySessionRecord>(accessToken, buildListUrl(`${apiBaseUrl}/study-sessions`, listQuery));
}

async function loadReferences(accessToken: string) {
  const [classes, courses, students, teachers, terms] = await Promise.all([
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`),
    apiRequest<StudentRecord[]>(accessToken, `${apiBaseUrl}/students`),
    apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`),
    apiRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return { classes, courses, students, teachers, terms };
}

async function createSession(accessToken: string, input: StudySessionRecordPayload) {
  return apiRequest<StudySessionRecord>(accessToken, `${apiBaseUrl}/study-sessions`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateSession(accessToken: string, id: string, input: StudySessionRecordPayload) {
  return apiRequest<StudySessionRecord>(accessToken, `${apiBaseUrl}/study-sessions/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteSession(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/study-sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("STUDY_SESSION_DELETE_FAILED");
  }
}

type StudySessionRecordPayload = Omit<StudySessionFormPayload, "courseId" | "termId" | "startsAt" | "endsAt"> & {
  courseId?: string;
  termId?: string;
  startsAt: string;
  endsAt: string;
};

function toStudySessionPayload(input: StudySessionFormPayload): StudySessionRecordPayload {
  return {
    ...input,
    courseId: input.courseId || undefined,
    termId: input.termId || undefined,
    startsAt: toIsoDateTime(input.startsAt),
    endsAt: toIsoDateTime(input.endsAt),
  };
}

function selectedValues(select: HTMLSelectElement): string[] {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function courseLabel(courseId: string | undefined, courseNames: Map<string, string>): string {
  return courseId ? courseNames.get(courseId) ?? courseId : "-";
}

function termLabel(termId: string | undefined, termNames: Map<string, string>): string {
  return termId ? termNames.get(termId) ?? termId : "-";
}

function studentLabel(studentIds: string[], studentNames: Map<string, string>): string {
  return studentIds.map((studentId) => studentNames.get(studentId) ?? studentId).join(", ");
}

function toDateTimeInput(value: string): string {
  return value.slice(0, 16);
}

function toIsoDateTime(value: string): string {
  return value.length === 16 ? `${value}:00.000Z` : new Date(value).toISOString();
}

function formatDateTime(value: string): string {
  return value.slice(0, 16).replace("T", " ");
}
