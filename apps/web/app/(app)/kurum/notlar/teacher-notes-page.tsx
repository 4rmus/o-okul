"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcademicTermRecord, ClassRecord, CourseRecord, StudentRecord, TeacherNoteRecord, TeacherRecord } from "@o-okul/shared-types";
import {
  Button,
  CrudPage,
  EmptyState,
  Field,
  FormModal,
  Input,
  Select,
  StatusBadge,
  Textarea,
  type DataTableColumn,
  useConfirmDialog,
} from "@o-okul/ui";
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
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

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
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: noteSortOptions });
  const [classId, setClassId] = useState(() => searchParams.get("classId") ?? "");
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
  const internalNoteCount = rows.filter((record) => record.visibility === "INTERNAL").length;
  const sharedNoteCount = rows.filter((record) => record.visibility === "GUARDIAN_STUDENT").length;
  const developmentTaggedCount = rows.filter((record) => Boolean(record.developmentStatus)).length;
  const selectedClassName = classId ? classNames.get(classId) ?? "Seçili sınıf" : "Tüm sınıflar";
  const noteSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Not toplamı",
      value: formatCount(notesQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "İç not / veli-öğrenci görünür",
      key: "visibility",
      label: "Görünürlük",
      tone: sharedNoteCount > 0 ? "info" : "default",
      value: `${formatCount(internalNoteCount)} / ${formatCount(sharedNoteCount)}`,
    },
    {
      description: "Gelişim durumu yazılmış",
      key: "development",
      label: "Gelişim etiketi",
      tone: developmentTaggedCount > 0 ? "success" : "warning",
      value: `${formatCount(developmentTaggedCount)}/${formatCount(rows.length)}`,
    },
    {
      description: "Öğrenci, öğretmen ve ders referansı",
      key: "references",
      label: "Bağlam",
      value: `${references.students.length}/${references.teachers.length}/${references.courses.length}`,
    },
  ];
  const noteSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "class",
      label: `Sınıf: ${selectedClassName}`,
      tone: classId ? "info" : "neutral",
    },
    {
      key: "sort",
      label: `Sıralama: ${formatNoteSort(listQuery.sort)}`,
      tone: "neutral",
    },
    {
      key: "privacy",
      label: "Veli görünürlüğü kontrollü",
      tone: sharedNoteCount > 0 ? "warning" : "success",
    },
  ];

  const columns: Array<DataTableColumn<TeacherNoteRecord>> = [
    { key: "studentId", header: "Öğrenci", priority: "primary", render: (record) => studentLabel(record.studentId, studentNames), sticky: "left" },
    { key: "classId", header: "Sınıf", priority: "secondary", render: (record) => classLabel(record.studentId, references.students, classNames) },
    { key: "teacherId", header: "Öğretmen", priority: "secondary", render: (record) => teacherLabel(record.teacherId, teacherNames) },
    { key: "courseId", header: "Ders", priority: "secondary", render: (record) => optionalLabel(record.courseId, courseNames, "Ders bilgisi yok") },
    { key: "termId", header: "Dönem", priority: "optional", render: (record) => optionalLabel(record.termId, termNames, "Dönem bilgisi yok") },
    {
      key: "visibility",
      header: "Görünürlük",
      priority: "primary",
      render: (record) => <StatusBadge tone={visibilityTone(record.visibility)}>{visibilityLabel(record.visibility)}</StatusBadge>,
    },
    { key: "developmentStatus", header: "Gelişim", priority: "secondary", render: (record) => record.developmentStatus ?? "-" },
    { key: "body", header: "Not", priority: "optional", render: (record) => record.body },
    {
      key: "actions",
      header: "İşlem",
      priority: "primary",
      render: (record) => (
        <span className="next-row-actions">
          <Button size="icon" variant="ghost" type="button" onClick={() => openEditForm(record)} aria-label={`${studentLabel(record.studentId, studentNames)} notunu düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" type="button" onClick={() => void handleDelete(record)} aria-label={`${studentLabel(record.studentId, studentNames)} notunu sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </Button>
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
    const label = studentLabel(record.studentId, studentNames);
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${label} notu silinsin mi?`,
      title: "Notu sil",
    });
    if (!confirmed) return;

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
        density="compact"
        loading={notesQuery.isPending || referencesQuery.isPending}
        rows={rows}
        summary={<OperationSummary ariaLabel="Öğretmen notu operasyon özeti" badges={noteSummaryBadges} items={noteSummaryItems} />}
        tableCaption="Öğretmen notları operasyon listesi"
        tableDescription="Öğrenci, öğretmen, ders, dönem ve görünürlük kırılımıyla gelişim notu takibi."
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
      {confirmationDialog}
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
      <Field label="Öğretmen">
        <Select value={form.teacherId ?? ""} onChange={(event) => onChange((current) => ({ ...current, teacherId: event.target.value }))}>
          <option value="">Seçiniz</option>
          {references.teachers.map((record) => (
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
      <Field label="Görünürlük">
        <Select value={form.visibility} onChange={(event) => onChange((current) => ({ ...current, visibility: event.target.value as TeacherNoteRecord["visibility"] }))}>
          <option value="INTERNAL">İç not</option>
          <option value="GUARDIAN_STUDENT">Veli/öğrenci görür</option>
        </Select>
      </Field>
      <Field label="Gelişim durumu" description="Opsiyonel kısa takip etiketi. Örn: Dikkat, gelişiyor, iyi.">
        <Input
          value={form.developmentStatus ?? ""}
          onChange={(event) => onChange((current) => ({ ...current, developmentStatus: event.target.value }))}
        />
      </Field>
      <Field label="Not">
        <Textarea required rows={4} value={form.body} onChange={(event) => onChange((current) => ({ ...current, body: event.target.value }))} />
      </Field>
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
  return classNames.get(student.classId) ?? "Sınıf bilgisi yok";
}

function studentLabel(studentId: string, studentNames: Map<string, string>) {
  return studentNames.get(studentId) ?? "Öğrenci eşleşmedi";
}

function teacherLabel(teacherId: string | undefined, teacherNames: Map<string, string>) {
  return teacherId ? teacherNames.get(teacherId) ?? "Öğretmen eşleşmedi" : "-";
}

function optionalLabel(id: string | undefined, labels: Map<string, string>, fallback: string) {
  if (!id) return "-";
  return labels.get(id) ?? fallback;
}

function visibilityLabel(visibility: TeacherNoteRecord["visibility"]) {
  return visibility === "INTERNAL" ? "İç not" : "Veli/öğrenci görür";
}

function visibilityTone(visibility: TeacherNoteRecord["visibility"]) {
  return visibility === "INTERNAL" ? "neutral" : "warning";
}

function formatNoteSort(sort: string) {
  return noteSortOptions.find((option) => option.value === sort)?.label ?? "Varsayılan";
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
