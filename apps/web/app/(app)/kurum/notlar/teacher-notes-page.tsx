"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcademicTermRecord, ClassRecord, CourseRecord, StudentRecord, TeacherNoteRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import {
  firstFormError,
  teacherNoteFormSchema,
  type TeacherNoteFormPayload,
  type TeacherNoteFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: TeacherNoteFormState = {
  studentId: "",
  teacherId: "",
  courseId: "",
  termId: "",
  visibility: "INTERNAL",
  body: "",
  developmentStatus: "",
};

export function TeacherNotesPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const [classId, setClassId] = useState("");
  const queryKey = ["next-teacher-notes", auth?.session.tenantId ?? "anonymous", listQuery, classId];
  const listQueryKey = ["next-teacher-notes", auth?.session.tenantId ?? "anonymous"];
  const notesQuery = useQuery({
    queryKey,
    queryFn: () => loadNotes(auth?.accessToken ?? "", listQuery, classId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const referencesQuery = useQuery({
    queryKey: ["next-teacher-note-refs", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingNote, setEditingNote] = useState<TeacherNoteRecord | null>(null);
  const [form, setForm] = useState<TeacherNoteFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = notesQuery.data?.data ?? [];
  const references = referencesQuery.data ?? emptyReferences;
  const studentNames = useMemo(
    () => new Map(references.students.map((record) => [record.id, `${record.firstName} ${record.lastName}`])),
    [references.students],
  );
  const teacherNames = useMemo(
    () => new Map(references.teachers.map((record) => [record.id, `${record.firstName} ${record.lastName}`])),
    [references.teachers],
  );
  const classNames = useMemo(() => new Map(references.classes.map((record) => [record.id, record.name])), [references.classes]);
  const courseNames = useMemo(() => new Map(references.courses.map((record) => [record.id, formatCourseName(record.name)])), [references.courses]);
  const termNames = useMemo(() => new Map(references.terms.map((record) => [record.id, record.name])), [references.terms]);

  const columns: Array<DataTableColumn<TeacherNoteRecord>> = [
    { key: "studentId", header: "Öğrenci", render: (record) => studentNames.get(record.studentId) ?? record.studentId },
    { key: "classId", header: "Sınıf", render: (record) => classLabel(record.studentId, references.students, classNames) },
    { key: "teacherId", header: "Öğretmen", render: (record) => teacherNames.get(record.teacherId) ?? record.teacherId },
    { key: "courseId", header: "Ders", render: (record) => optionalLabel(record.courseId, courseNames) },
    { key: "termId", header: "Dönem", render: (record) => optionalLabel(record.termId, termNames) },
    { key: "visibility", header: "Görünürlük", render: (record) => visibilityLabel(record.visibility) },
    { key: "developmentStatus", header: "Gelişim", render: (record) => record.developmentStatus ?? "-" },
    { key: "body", header: "Not", render: (record) => record.body },
    {
      key: "actions",
      header: "İşlem",
      render: (record) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(record)} aria-label={`${studentNames.get(record.studentId) ?? record.studentId} notunu düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(record)} aria-label={`${studentNames.get(record.studentId) ?? record.studentId} notunu sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingNote(null);
    setForm({ ...emptyForm, teacherId: references.teachers[0]?.id ?? "" });
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(record: TeacherNoteRecord) {
    setEditingNote(record);
    setForm({
      studentId: record.studentId,
      teacherId: record.teacherId,
      courseId: record.courseId ?? "",
      termId: record.termId ?? "",
      visibility: record.visibility,
      body: record.body,
      developmentStatus: record.developmentStatus ?? "",
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingNote(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = teacherNoteFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    if (!parsedForm.data.teacherId) {
      setError("Öğretmen zorunludur.");
      return;
    }

    try {
      const savedNote = editingNote
        ? await updateNote(auth.accessToken, editingNote.id, parsedForm.data)
        : await createNote(auth.accessToken, parsedForm.data);
      void savedNote;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Öğretmen notu kaydedilemedi.");
    }
  }

  async function handleDelete(record: TeacherNoteRecord) {
    if (!auth) return;
    if (!window.confirm(`${studentNames.get(record.studentId) ?? record.studentId} notu silinsin mi?`)) return;

    setError("");
    try {
      await deleteNote(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Öğretmen notu silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={notesQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={noteSortOptions}
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
              Not ekle
            </Button>
          </>
        }
        aria-label="Öğretmen notu yönetimi"
        columns={columns}
        description="Öğretmen notlarını öğrenci, öğretmen, ders ve dönem bağlamıyla yönet."
        emptyState={
          <EmptyState
            title="Öğretmen notu yok"
            description="Öğrenci gelişimini izlemek için ilk öğretmen notunu ekle."
            hint="Notlar iç kullanım veya veli/öğrenci görünümü olarak ayrılabilir."
            primaryAction={{ label: "Not ekle", onClick: openCreateForm }}
          />
        }
        emptyText="Öğretmen notu yok"
        error={error || (notesQuery.isError ? "Öğretmen notları alınamadı." : referencesQuery.isError ? "Seçim listeleri alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        loading={notesQuery.isPending || referencesQuery.isPending}
        rows={rows}
        title="Öğretmen Notları"
      />
      <NoteFormModal
        form={form}
        isEditing={Boolean(editingNote)}
        onCancel={closeForm}
        onChange={setForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        references={references}
      />
    </>
  );
}

function NoteFormModal({
  form,
  isEditing,
  onCancel,
  onChange,
  onSubmit,
  open,
  references,
}: {
  form: TeacherNoteFormState;
  isEditing: boolean;
  onCancel(): void;
  onChange(update: (current: TeacherNoteFormState) => TeacherNoteFormState): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  open: boolean;
  references: TeacherNoteReferences;
}) {
  return (
    <FormModal
      description="Öğrenci, öğretmen, görünürlük ve not zorunludur."
      onCancel={onCancel}
      onSubmit={onSubmit}
      open={open}
      submitLabel={isEditing ? "Kaydet" : "Ekle"}
      title={isEditing ? "Not düzenle" : "Not ekle"}
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
        Öğretmen
        <select value={form.teacherId ?? ""} onChange={(event) => onChange((current) => ({ ...current, teacherId: event.target.value }))}>
          <option value="">Seçiniz</option>
          {references.teachers.map((record) => (
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
              {formatCourseName(record.name)}
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
        Görünürlük
        <select value={form.visibility} onChange={(event) => onChange((current) => ({ ...current, visibility: event.target.value as TeacherNoteRecord["visibility"] }))}>
          <option value="INTERNAL">İç not</option>
          <option value="GUARDIAN_STUDENT">Veli/öğrenci görür</option>
        </select>
      </label>
      <label>
        Gelişim durumu
        <Input
          value={form.developmentStatus ?? ""}
          onChange={(event) => onChange((current) => ({ ...current, developmentStatus: event.target.value }))}
        />
      </label>
      <label>
        Not
        <Input required value={form.body} onChange={(event) => onChange((current) => ({ ...current, body: event.target.value }))} />
      </label>
    </FormModal>
  );
}

const noteSortOptions = [
  { label: "Oluşturma eski-yeni", value: "createdAt" },
  { label: "Oluşturma yeni-eski", value: "-createdAt" },
  { label: "Görünürlük A-Z", value: "visibility" },
  { label: "Görünürlük Z-A", value: "-visibility" },
];

interface TeacherNoteReferences {
  classes: ClassRecord[];
  courses: CourseRecord[];
  students: StudentRecord[];
  teachers: TeacherRecord[];
  terms: AcademicTermRecord[];
}

const emptyReferences: TeacherNoteReferences = {
  classes: [],
  courses: [],
  students: [],
  teachers: [],
  terms: [],
};

async function loadNotes(accessToken: string, listQuery: ListQueryState, classId: string) {
  const url = new URL(buildListUrl(`${apiBaseUrl}/teacher-notes`, listQuery));
  if (classId) url.searchParams.set("classId", classId);
  return apiListRequest<TeacherNoteRecord>(accessToken, url);
}

async function loadReferences(accessToken: string): Promise<TeacherNoteReferences> {
  const [classes, courses, students, teachers, terms] = await Promise.all([
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`),
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`),
    apiListRequest<TeacherRecord>(accessToken, `${apiBaseUrl}/teachers`),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return {
    classes: classes.data,
    courses: courses.data,
    students: students.data,
    teachers: teachers.data,
    terms: terms.data,
  };
}

async function createNote(accessToken: string, input: TeacherNoteFormPayload) {
  return apiRequest<TeacherNoteRecord>(accessToken, `${apiBaseUrl}/teacher-notes`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateNote(accessToken: string, id: string, input: TeacherNoteFormPayload) {
  return apiRequest<TeacherNoteRecord>(accessToken, `${apiBaseUrl}/teacher-notes/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteNote(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/teacher-notes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("TEACHER_NOTE_DELETE_FAILED");
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

function visibilityLabel(visibility: TeacherNoteRecord["visibility"]) {
  return visibility === "INTERNAL" ? "İç not" : "Veli/öğrenci görür";
}
