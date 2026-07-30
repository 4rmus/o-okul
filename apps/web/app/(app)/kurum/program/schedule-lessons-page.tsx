"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcademicTermRecord, ClassRecord, CourseRecord, ScheduleLessonRecord, TeacherRecord } from "@o-okul/shared-types";
import { Button, CrudPage, EmptyState, Field, FormModal, Input, Select, type DataTableColumn, useConfirmDialog } from "@o-okul/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { formatCourseName } from "../../_shared/academic-labels.js";
import {
  firstFormError,
  scheduleLessonFormSchema,
  type ScheduleLessonFormPayload,
  type ScheduleLessonFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const emptyForm: ScheduleLessonFormState = {
  classId: "",
  teacherId: "",
  courseId: "",
  termId: "",
  title: "",
  startsAt: "",
  endsAt: "",
};

export function ScheduleLessonsPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: scheduleSortOptions });
  const queryKey = ["next-schedule-lessons", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-schedule-lessons", auth?.session.tenantId ?? "anonymous"];
  const lessonsQuery = useQuery({
    queryKey,
    queryFn: () => loadLessons(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const referenceQuery = useQuery({
    queryKey: ["next-schedule-refs", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingLesson, setEditingLesson] = useState<ScheduleLessonRecord | null>(null);
  const [form, setForm] = useState<ScheduleLessonFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = lessonsQuery.data?.data ?? [];
  const references = referenceQuery.data ?? emptyReferences;
  const classNames = useMemo(() => new Map(references.classes.map((record) => [record.id, record.name])), [references.classes]);
  const courseNames = useMemo(() => new Map(references.courses.map((record) => [record.id, formatCourseName(record.name)])), [references.courses]);
  const termNames = useMemo(() => new Map(references.terms.map((record) => [record.id, record.name])), [references.terms]);
  const teacherNames = useMemo(
    () => new Map(references.teachers.map((record) => [record.id, `${record.firstName} ${record.lastName}`])),
    [references.teachers],
  );
  const listTotal = lessonsQuery.data?.meta?.total ?? rows.length;
  const classCoverageCount = new Set(rows.map((record) => record.classId)).size;
  const teacherCoverageCount = new Set(rows.map((record) => record.teacherId)).size;
  const courseLinkedCount = rows.filter((record) => Boolean(record.courseId)).length;
  const termLinkedCount = rows.filter((record) => Boolean(record.termId)).length;
  const programSummaryItems: OperationSummaryItem[] = [
    {
      description: "Ders programı kayıtları",
      key: "total",
      label: "Program toplamı",
      value: formatCount(listTotal),
    },
    {
      description: "Programda yer alan sınıf sayısı",
      key: "classes",
      label: "Sınıf kapsamı",
      tone: classCoverageCount > 0 ? "info" : "default",
      value: formatCount(classCoverageCount),
    },
    {
      description: "Ders ve dönem referansı olan kayıtlar",
      key: "context",
      label: "Bağlam tamlığı",
      tone: courseLinkedCount === rows.length && termLinkedCount === rows.length && rows.length > 0 ? "success" : "info",
      value: `${formatCount(courseLinkedCount)}/${formatCount(rows.length)}`,
    },
  ];
  const programSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: `Sıralama: ${formatScheduleSort(listQuery.sort)}`,
      tone: "neutral",
    },
    {
      key: "teachers",
      label: `${formatCount(teacherCoverageCount)} öğretmen kapsamı`,
      tone: teacherCoverageCount > 0 ? "info" : "neutral",
    },
  ];
  const programSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Saat aralığı ve sınıf/öğretmen bağı tek listede izlenir",
      key: "time-plan",
      label: "Saat planı",
      status: rows.length > 0 ? "İzleniyor" : "Bekliyor",
      tone: rows.length > 0 ? "info" : "neutral",
      value: `${formatCount(rows.length)} kayıt`,
    },
    {
      detail: "Ders adı sınav, yoklama ve rapor bağlamıyla eşleştirilir",
      key: "course-context",
      label: "Ders eşleşmesi",
      status: courseLinkedCount === rows.length && rows.length > 0 ? "Hazır" : "Kontrol",
      tone: courseLinkedCount === rows.length && rows.length > 0 ? "success" : "warning",
      value: `${formatCount(courseLinkedCount)} bağlı`,
    },
    {
      detail: "Dönem alanı takvim ve rapor filtrelerini tutarlı tutar",
      key: "term-context",
      label: "Dönem bağı",
      status: termLinkedCount === rows.length && rows.length > 0 ? "Hazır" : "Opsiyonel",
      tone: termLinkedCount === rows.length && rows.length > 0 ? "success" : "neutral",
      value: `${formatCount(termLinkedCount)} bağlı`,
    },
  ];

  const columns: Array<DataTableColumn<ScheduleLessonRecord>> = [
    { key: "title", header: "Ders", mobilePriority: "primary", priority: "primary", render: (record) => record.title, sticky: "left" },
    { key: "classId", header: "Sınıf", mobilePriority: "primary", priority: "secondary", render: (record) => classLabel(record.classId, classNames) },
    { key: "courseId", header: "Branş", mobilePriority: "secondary", priority: "secondary", render: (record) => courseLabel(record.courseId, courseNames) },
    { key: "termId", header: "Dönem", mobilePriority: "hidden", priority: "optional", render: (record) => termLabel(record.termId, termNames) },
    { key: "teacherId", header: "Öğretmen", mobilePriority: "hidden", priority: "secondary", render: (record) => teacherLabel(record.teacherId, teacherNames) },
    { key: "startsAt", header: "Başlangıç", mobilePriority: "secondary", priority: "secondary", render: (record) => formatDateTime(record.startsAt) },
    { key: "endsAt", header: "Bitiş", mobilePriority: "hidden", priority: "optional", render: (record) => formatDateTime(record.endsAt) },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => (
        <span className="next-row-actions">
          <Button size="icon" variant="ghost" type="button" onClick={() => openEditForm(record)} aria-label={`${record.title} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" type="button" onClick={() => void handleDelete(record)} aria-label={`${record.title} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </Button>
        </span>
      ),
      sticky: "right",
    },
  ];

  function openCreateForm() {
    setEditingLesson(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(record: ScheduleLessonRecord) {
    setEditingLesson(record);
    setForm({
      classId: record.classId,
      teacherId: record.teacherId,
      courseId: record.courseId ?? "",
      termId: record.termId ?? "",
      title: record.title,
      startsAt: toDateTimeInput(record.startsAt),
      endsAt: toDateTimeInput(record.endsAt),
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingLesson(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = scheduleLessonFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const payload = toSchedulePayload(parsedForm.data);
      const savedLesson = editingLesson
        ? await updateLesson(auth.accessToken, editingLesson.id, payload)
        : await createLesson(auth.accessToken, payload);
      void savedLesson;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch (submitError) {
      setError(apiErrorMessage(submitError, "Ders programı kaydedilemedi."));
    }
  }

  async function handleDelete(record: ScheduleLessonRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${record.title} ders programı kaydı silinsin mi?`,
      title: "Ders programını sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteLesson(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch (deleteError) {
      setError(apiErrorMessage(deleteError, "Ders programı silinemedi."));
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <ListControls
            meta={lessonsQuery.data?.meta}
            onChange={setListQuery}
            sortOptions={scheduleSortOptions}
            state={listQuery}
          >
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Ders ekle
            </Button>
          </ListControls>
        }
        aria-label="Ders programı yönetimi"
        columns={columns}
        density="compact"
        description="Kurum ders programını sınıf, öğretmen ve ders bağlantısıyla yönet."
        emptyState={
          <EmptyState
            title="Ders programı boş"
            description="Haftalık ders akışını oluşturmak için ilk dersi ekle."
            hint="Sınıf, öğretmen ve ders kayıtları hazırsa programı buradan bağlayabilirsin."
            primaryAction={{ label: "Ders ekle", onClick: openCreateForm }}
          />
        }
        emptyText="Ders programı kaydı yok"
        error={
          error ||
          (lessonsQuery.isError
            ? apiErrorMessage(lessonsQuery.error, "Ders programı alınamadı.")
            : referenceQuery.isError
              ? apiErrorMessage(referenceQuery.error, "Seçim listeleri alınamadı.")
              : undefined)
        }
        getRowKey={(record) => record.id}
        loading={lessonsQuery.isPending || referenceQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary
            actions={programSummaryActions}
            ariaLabel="Ders programı operasyon özeti"
            badges={programSummaryBadges}
            items={programSummaryItems}
          />
        }
        tableCaption="Ders programı operasyon listesi"
        tableDescription="Ders, sınıf, branş ve başlangıç bilgisi."
        title="Ders Programı"
      />
      <FormModal
        description="Sınıf, öğretmen, başlık ve saat aralığı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingLesson ? "Kaydet" : "Ekle"}
        title={editingLesson ? "Ders düzenle" : "Ders ekle"}
      >
        <Field label="Sınıf">
          <Select value={form.classId} onChange={(event) => setForm((current) => ({ ...current, classId: event.target.value }))}>
            <option value="">Seçiniz</option>
            {references.classes.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Öğretmen">
          <Select value={form.teacherId} onChange={(event) => setForm((current) => ({ ...current, teacherId: event.target.value }))}>
            <option value="">Seçiniz</option>
            {references.teachers.map((record) => (
              <option key={record.id} value={record.id}>
                {record.firstName} {record.lastName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Branş">
          <Select value={form.courseId ?? ""} onChange={(event) => setForm((current) => ({ ...current, courseId: event.target.value }))}>
            <option value="">Seçiniz</option>
            {references.courses.map((record) => (
              <option key={record.id} value={record.id}>
                {formatCourseName(record.name)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dönem">
          <Select value={form.termId ?? ""} onChange={(event) => setForm((current) => ({ ...current, termId: event.target.value }))}>
            <option value="">Seçiniz</option>
            {references.terms.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ders başlığı">
          <Input required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
        </Field>
        <Field label="Başlangıç">
          <Input required type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} />
        </Field>
        <Field label="Bitiş">
          <Input required type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} />
        </Field>
      </FormModal>
      {confirmationDialog}
    </>
  );
}

const emptyReferences = { classes: [], courses: [], teachers: [], terms: [] } satisfies {
  classes: ClassRecord[];
  courses: CourseRecord[];
  teachers: TeacherRecord[];
  terms: AcademicTermRecord[];
};

const scheduleSortOptions = [
  { label: "Başlangıç eski-yeni", value: "startsAt" },
  { label: "Başlangıç yeni-eski", value: "-startsAt" },
  { label: "Ders A-Z", value: "title" },
  { label: "Ders Z-A", value: "-title" },
];

async function loadLessons(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<ScheduleLessonRecord>(accessToken, buildListUrl(`${apiBaseUrl}/schedule-lessons`, listQuery));
}

async function loadReferences(accessToken: string) {
  const [classes, courses, teachers, terms] = await Promise.all([
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`),
    apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`),
    apiRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return { classes, courses, teachers, terms };
}

async function createLesson(accessToken: string, input: ScheduleLessonRecordPayload) {
  return apiRequest<ScheduleLessonRecord>(accessToken, `${apiBaseUrl}/schedule-lessons`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateLesson(accessToken: string, id: string, input: ScheduleLessonRecordPayload) {
  return apiRequest<ScheduleLessonRecord>(accessToken, `${apiBaseUrl}/schedule-lessons/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteLesson(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/schedule-lessons/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("SCHEDULE_LESSON_DELETE_FAILED");
  }
}

type ScheduleLessonRecordPayload = Omit<ScheduleLessonFormPayload, "courseId" | "termId" | "startsAt" | "endsAt"> & {
  courseId?: string;
  termId?: string;
  startsAt: string;
  endsAt: string;
};

function toSchedulePayload(input: ScheduleLessonFormPayload): ScheduleLessonRecordPayload {
  return {
    ...input,
    courseId: input.courseId || undefined,
    termId: input.termId || undefined,
    startsAt: toIsoDateTime(input.startsAt),
    endsAt: toIsoDateTime(input.endsAt),
  };
}

function courseLabel(courseId: string | undefined, courseNames: Map<string, string>): string {
  return courseId ? courseNames.get(courseId) ?? "Ders eşleşmedi" : "-";
}

function termLabel(termId: string | undefined, termNames: Map<string, string>): string {
  return termId ? termNames.get(termId) ?? "Dönem eşleşmedi" : "-";
}

function classLabel(classId: string, classNames: Map<string, string>): string {
  return classNames.get(classId) ?? "Sınıf eşleşmedi";
}

function teacherLabel(teacherId: string, teacherNames: Map<string, string>): string {
  return teacherNames.get(teacherId) ?? "Öğretmen eşleşmedi";
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

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function formatScheduleSort(value: string) {
  return scheduleSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}
