"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GradeLevelRecord } from "@uzman-hocam/shared-types";
import { Button, CrudPage, EmptyState, Field, FormModal, Input, type DataTableColumn, useConfirmDialog } from "@uzman-hocam/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  firstFormError,
  gradeLevelFormSchema,
  type GradeLevelFormPayload,
  type GradeLevelFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const emptyForm: GradeLevelFormState = {
  name: "",
  code: "",
};

export function GradeLevelsPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: gradeLevelSortOptions });
  const queryKey = ["next-grade-levels", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-grade-levels", auth?.session.tenantId ?? "anonymous"];
  const gradeLevelsQuery = useQuery({
    queryKey,
    queryFn: () => loadGradeLevels(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingGradeLevel, setEditingGradeLevel] = useState<GradeLevelRecord | null>(null);
  const [form, setForm] = useState<GradeLevelFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = gradeLevelsQuery.data?.data ?? [];
  const codedGradeLevelCount = rows.filter((record) => Boolean(record.code)).length;
  const gradeLevelSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Seviye toplamı",
      value: formatCount(gradeLevelsQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "Bu sayfada kodu olan seviye",
      key: "code",
      label: "Kod kapsamı",
      tone: codedGradeLevelCount > 0 ? "info" : "warning",
      value: `${codedGradeLevelCount}/${rows.length}`,
    },
    {
      description: "Sınıf, rapor ve kurulum bağlamı",
      key: "context",
      label: "Operasyon bağlamı",
      value: "Sınıf yapısı",
    },
  ];
  const gradeLevelSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: `Sıralama: ${formatGradeLevelSort(listQuery.sort)}`,
      tone: "neutral",
    },
    {
      key: "code",
      label: codedGradeLevelCount === rows.length && rows.length > 0 ? "Kod alanı tamam" : "Kod alanı opsiyonel",
      tone: codedGradeLevelCount === rows.length && rows.length > 0 ? "success" : "neutral",
    },
  ];
  const gradeLevelSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Kısa kod sınıf eşleşmesini ve rapor filtresini besler",
      key: "code-readiness",
      label: "Kod temizliği",
      status: codedGradeLevelCount === rows.length && rows.length > 0 ? "Hazır" : "Opsiyonel",
      tone: codedGradeLevelCount > 0 ? "info" : "neutral",
      value: `${codedGradeLevelCount}/${rows.length}`,
    },
    {
      detail: "Sınıf kurulumu ve öğrenci yerleşimi",
      key: "class-context",
      label: "Sınıf eşleşmesi",
      status: "Bağlam",
      tone: "info",
      value: "Seviye ref",
    },
    {
      detail: "Sınav ve karne filtrelerinde seviye kullanılır",
      key: "report-context",
      label: "Rapor filtresi",
      status: "İzleniyor",
      tone: "neutral",
      value: "Seviye",
    },
  ];

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<GradeLevelRecord>> = [
    {
      key: "name",
      header: "Seviye",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => record.name,
      sticky: "left",
    },
    {
      key: "code",
      header: "Kod",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (record) => record.code ?? "-",
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
          <button type="button" onClick={() => openEditForm(record)} aria-label={`${record.name} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(record)} aria-label={`${record.name} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingGradeLevel(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(record: GradeLevelRecord) {
    setEditingGradeLevel(record);
    setForm({ name: record.name, code: record.code ?? "" });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingGradeLevel(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = gradeLevelFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedGradeLevel = editingGradeLevel
        ? await updateGradeLevel(auth.accessToken, editingGradeLevel.id, parsedForm.data)
        : await createGradeLevel(auth.accessToken, parsedForm.data);
      void savedGradeLevel;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Seviye kaydedilemedi.");
    }
  }

  async function handleDelete(record: GradeLevelRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${record.name} seviyesi silinsin mi?`,
      title: "Seviyeyi sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteGradeLevel(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Seviye silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={gradeLevelsQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={gradeLevelSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Seviye ekle
            </Button>
          </>
        }
        aria-label="Seviye yönetimi"
        columns={columns}
        density="compact"
        description="Kurum seviyelerini sınıf bölümlerine bağlamak için yönet."
        emptyState={
          <EmptyState
            title="Henüz seviye yok"
            description="Seviye ekleyerek sınıfları daha düzenli kur."
            primaryAction={{ label: "Seviye ekle", onClick: openCreateForm }}
            secondaryAction={{ label: "Kuruluma dön", href: "/kurum/kurulum" }}
          />
        }
        emptyText="Seviye kaydı yok"
        error={error || (gradeLevelsQuery.isError ? "Seviyeler alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        loading={gradeLevelsQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary
            actions={gradeLevelSummaryActions}
            ariaLabel="Seviye operasyon özeti"
            badges={gradeLevelSummaryBadges}
            items={gradeLevelSummaryItems}
          />
        }
        tableCaption="Seviye eğitim yapısı"
        tableDescription="Seviye adı, kısa kod ve seviye aksiyonları."
        title="Seviyeler"
      />
      <FormModal
        description="Seviye adı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingGradeLevel ? "Kaydet" : "Ekle"}
        title={editingGradeLevel ? "Seviye düzenle" : "Seviye ekle"}
      >
        <Field label="Seviye adı">
          <Input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="Kod" description="Kısa kod sınıf eşleşmesi ve rapor filtrelerinde kullanılır.">
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

const gradeLevelSortOptions = [
  { label: "Seviye A-Z", value: "name" },
  { label: "Seviye Z-A", value: "-name" },
  { label: "Kod A-Z", value: "code" },
  { label: "Kod Z-A", value: "-code" },
];

async function loadGradeLevels(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<GradeLevelRecord>(accessToken, buildListUrl(`${apiBaseUrl}/grade-levels`, listQuery));
}

async function createGradeLevel(accessToken: string, input: GradeLevelFormPayload) {
  return apiRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateGradeLevel(accessToken: string, id: string, input: GradeLevelFormPayload) {
  return apiRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteGradeLevel(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/grade-levels/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("GRADE_LEVEL_DELETE_FAILED");
  }
}

function formatCount(value: number) {
  return value.toLocaleString("tr-TR");
}

function formatGradeLevelSort(value: string) {
  return gradeLevelSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}
