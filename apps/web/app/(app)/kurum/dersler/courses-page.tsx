"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CourseRecord } from "@uzman-hocam/shared-types";
import { Button, CrudPage, EmptyState, Field, FormModal, Input, type DataTableColumn, useConfirmDialog } from "@uzman-hocam/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { formatCourseName, formatOutcomeCode } from "../../_shared/academic-labels.js";
import {
  courseFormSchema,
  firstFormError,
  type CourseFormPayload,
  type CourseFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const emptyForm: CourseFormState = {
  name: "",
  code: "",
};

export function CoursesPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: courseSortOptions });
  const queryKey = ["next-courses", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-courses", auth?.session.tenantId ?? "anonymous"];
  const coursesQuery = useQuery({
    queryKey,
    queryFn: () => loadCourses(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingCourse, setEditingCourse] = useState<CourseRecord | null>(null);
  const [form, setForm] = useState<CourseFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = coursesQuery.data?.data ?? [];
  const codedCourseCount = rows.filter((record) => Boolean(record.code)).length;
  const courseSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Ders toplamı",
      value: formatCount(coursesQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "Bu sayfada kodu olan ders",
      key: "code",
      label: "Kod kapsamı",
      tone: codedCourseCount > 0 ? "info" : "warning",
      value: `${codedCourseCount}/${rows.length}`,
    },
    {
      description: "Program, öğretmen ve rapor eşleşmesi",
      key: "usage",
      label: "Operasyon bağlamı",
      value: "Program/Rapor",
    },
  ];
  const courseSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: `Sıralama: ${formatCourseSort(listQuery.sort)}`,
      tone: "neutral",
    },
    {
      key: "code",
      label: codedCourseCount === rows.length && rows.length > 0 ? "Kod alanı tamam" : "Kod alanı opsiyonel",
      tone: codedCourseCount === rows.length && rows.length > 0 ? "success" : "neutral",
    },
  ];
  const courseSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Kısa kod program ve kazanım eşleşmesini hızlandırır",
      key: "code-readiness",
      label: "Kod temizliği",
      status: codedCourseCount === rows.length && rows.length > 0 ? "Hazır" : "Opsiyonel",
      tone: codedCourseCount > 0 ? "info" : "neutral",
      value: `${codedCourseCount}/${rows.length}`,
    },
    {
      detail: "Ders programı, öğretmen ataması ve yoklama",
      key: "program-context",
      label: "Program bağı",
      status: "Bağlam",
      tone: "info",
      value: "Program",
    },
    {
      detail: "Sınav branşı ve kazanım raporu için kullanılır",
      key: "report-context",
      label: "Rapor eşleşmesi",
      status: "İzleniyor",
      tone: "neutral",
      value: "Sınav/Kazanım",
    },
  ];

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<CourseRecord>> = [
    {
      key: "name",
      header: "Ders",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => formatCourseName(record.name),
      sticky: "left",
    },
    {
      key: "code",
      header: "Kod",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (record) => formatOutcomeCode(record.code),
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      mobilePriority: "primary",
      priority: "primary",
      sticky: "right",
      render: (record) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(record)} aria-label={`${formatCourseName(record.name)} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(record)} aria-label={`${formatCourseName(record.name)} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingCourse(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(record: CourseRecord) {
    setEditingCourse(record);
    setForm({
      name: formatCourseName(record.name),
      code: record.code ? formatOutcomeCode(record.code) : "",
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingCourse(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = courseFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedCourse = editingCourse
        ? await updateCourse(auth.accessToken, editingCourse.id, parsedForm.data)
        : await createCourse(auth.accessToken, parsedForm.data);
      void savedCourse;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Ders kaydedilemedi.");
    }
  }

  async function handleDelete(record: CourseRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${formatCourseName(record.name)} dersi silinsin mi?`,
      title: "Dersi sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteCourse(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Ders silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={coursesQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={courseSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Ders ekle
            </Button>
          </>
        }
        aria-label="Ders yönetimi"
        columns={columns}
        density="compact"
        description="Kurum derslerini aynı CRUD kalıbıyla yönet."
        emptyState={
          <EmptyState
            title="Henüz ders yok"
            description="Ders ekleyerek öğretmen, program ve sınav akışlarını hazırlamaya başla."
            primaryAction={{ label: "Ders ekle", onClick: openCreateForm }}
            secondaryAction={{ label: "Kuruluma dön", href: "/kurum/kurulum" }}
          />
        }
        emptyText="Ders kaydı yok"
        error={error || (coursesQuery.isError ? "Dersler alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        loading={coursesQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary
            actions={courseSummaryActions}
            ariaLabel="Ders operasyon özeti"
            badges={courseSummaryBadges}
            items={courseSummaryItems}
          />
        }
        tableCaption="Ders eğitim yapısı"
        tableDescription="Ders adı, kısa kod ve ders aksiyonları."
        title="Dersler"
      />
      <FormModal
        description="Ders adı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingCourse ? "Kaydet" : "Ekle"}
        title={editingCourse ? "Ders düzenle" : "Ders ekle"}
      >
        <Field label="Ders adı">
          <Input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="Kod" description="Kısa kod program, sınav ve kazanım eşleşmelerinde kullanılır.">
          <Input
            value={form.code ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
          />
        </Field>
      </FormModal>
      {confirmationDialog}
    </>
  );
}

const courseSortOptions = [
  { label: "Ders A-Z", value: "name" },
  { label: "Ders Z-A", value: "-name" },
  { label: "Kod A-Z", value: "code" },
  { label: "Kod Z-A", value: "-code" },
];

async function loadCourses(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<CourseRecord>(accessToken, buildListUrl(`${apiBaseUrl}/courses`, listQuery));
}

async function createCourse(accessToken: string, input: CourseFormPayload) {
  return apiRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateCourse(accessToken: string, id: string, input: CourseFormPayload) {
  return apiRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteCourse(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/courses/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("COURSE_DELETE_FAILED");
  }
}

function formatCount(value: number) {
  return value.toLocaleString("tr-TR");
}

function formatCourseSort(value: string) {
  return courseSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}
