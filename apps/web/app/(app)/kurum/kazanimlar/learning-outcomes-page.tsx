"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LearningOutcomeRecord } from "@o-okul/shared-types";
import { Button, CrudPage, EmptyState, Field, FormModal, Input, type DataTableColumn, useConfirmDialog } from "@o-okul/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { formatCourseName, formatOutcomeCode, formatOutcomeTitle } from "../../_shared/academic-labels.js";
import {
  firstFormError,
  learningOutcomeFormSchema,
  type LearningOutcomeFormPayload,
  type LearningOutcomeFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const emptyForm: LearningOutcomeFormState = {
  branch: "",
  code: "",
  level: "",
  title: "",
};

export function LearningOutcomesPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: learningOutcomeSortOptions });
  const queryKey = ["next-learning-outcomes", tenantId, listQuery];
  const listQueryKey = ["next-learning-outcomes", tenantId];
  const outcomesQuery = useQuery({
    queryKey,
    queryFn: () => loadLearningOutcomes(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingOutcome, setEditingOutcome] = useState<LearningOutcomeRecord | null>(null);
  const [form, setForm] = useState<LearningOutcomeFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = outcomesQuery.data?.data ?? [];
  const listTotal = outcomesQuery.data?.meta?.total ?? rows.length;
  const branchCount = new Set(rows.map((record) => formatCourseName(record.branch))).size;
  const levelCount = rows.filter((record) => Boolean(record.level)).length;
  const codeReadyCount = rows.filter((record) => Boolean(formatOutcomeCode(record.code))).length;
  const outcomeSummaryItems: OperationSummaryItem[] = [
    {
      description: "Optik, sınav ve rapor eşleşmesinde kullanılan katalog",
      key: "total",
      label: "Kazanım toplamı",
      value: formatCount(listTotal),
    },
    {
      description: "Katalogda temsil edilen branş sayısı",
      key: "branch",
      label: "Branş kapsamı",
      tone: branchCount > 0 ? "info" : "default",
      value: formatCount(branchCount),
    },
    {
      description: "Seviye etiketi bulunan kazanımlar",
      key: "level",
      label: "Seviye kapsamı",
      tone: levelCount === rows.length && rows.length > 0 ? "success" : "info",
      value: `${formatCount(levelCount)}/${formatCount(rows.length)}`,
    },
  ];
  const outcomeSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: `Sıralama: ${formatLearningOutcomeSort(listQuery.sort)}`,
      tone: "neutral",
    },
    {
      key: "report",
      label: "Rapor/optik kataloğu",
      tone: "info",
    },
  ];
  const outcomeSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Kısa kod optik eşleştirme ve hata kitapçığı kırılımında kullanılır",
      key: "code-standard",
      label: "Kod standardı",
      status: codeReadyCount === rows.length && rows.length > 0 ? "Hazır" : "Kontrol",
      tone: codeReadyCount === rows.length && rows.length > 0 ? "success" : "warning",
      value: `${formatCount(codeReadyCount)} kod`,
    },
    {
      detail: "Branş etiketi sınav ve öğretmen raporu filtresini besler",
      key: "branch-coverage",
      label: "Branş dağılımı",
      status: branchCount > 0 ? "İzleniyor" : "Bekliyor",
      tone: branchCount > 0 ? "info" : "neutral",
      value: `${formatCount(branchCount)} branş`,
    },
    {
      detail: "Seviye alanı program ve sınıf hedefleriyle tutarlı okunur",
      key: "level-coverage",
      label: "Seviye etiketi",
      status: levelCount === rows.length && rows.length > 0 ? "Hazır" : "Opsiyonel",
      tone: levelCount === rows.length && rows.length > 0 ? "success" : "neutral",
      value: `${formatCount(levelCount)} etiket`,
    },
  ];

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<LearningOutcomeRecord>> = [
    {
      key: "code",
      header: "Kod",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => formatOutcomeCode(record.code),
      sticky: "left",
    },
    {
      key: "branch",
      header: "Branş",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (record) => formatCourseName(record.branch),
    },
    {
      key: "title",
      header: "Kazanım",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => formatOutcomeTitle(record.title),
    },
    {
      key: "level",
      header: "Seviye",
      mobilePriority: "hidden",
      priority: "optional",
      render: (record) => record.level ?? "-",
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(record)} aria-label={`${formatOutcomeCode(record.code)} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(record)} aria-label={`${formatOutcomeCode(record.code)} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
      sticky: "right",
    },
  ];

  function openCreateForm() {
    setEditingOutcome(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(record: LearningOutcomeRecord) {
    setEditingOutcome(record);
    setForm({
      branch: formatCourseName(record.branch),
      code: formatOutcomeCode(record.code),
      level: record.level ?? "",
      title: formatOutcomeTitle(record.title),
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingOutcome(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = learningOutcomeFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedOutcome = editingOutcome
        ? await updateLearningOutcome(auth.accessToken, editingOutcome.id, parsedForm.data)
        : await createLearningOutcome(auth.accessToken, parsedForm.data);
      void savedOutcome;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-setup-progress", tenantId] });
      closeForm();
    } catch {
      setError("Kazanım kaydedilemedi.");
    }
  }

  async function handleDelete(record: LearningOutcomeRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${formatOutcomeCode(record.code)} kazanımı silinsin mi?`,
      title: "Kazanımı sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteLearningOutcome(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-setup-progress", tenantId] });
    } catch {
      setError("Kazanım silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={outcomesQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={learningOutcomeSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Kazanım ekle
            </Button>
          </>
        }
        aria-label="Kazanım yönetimi"
        columns={columns}
        density="compact"
        description="Sınav ve optik analizlerinde kullanılacak kazanım kataloğunu yönet."
        emptyState={
          <EmptyState
            title="Kazanım yok"
            description="İlk kazanımı ekleyerek sınav ve optik analizlerini hazırla."
            primaryAction={{ label: "Kazanım ekle", onClick: openCreateForm }}
            secondaryAction={{ label: "Kuruluma dön", href: "/kurum/kurulum" }}
          />
        }
        emptyText="Kazanım kaydı yok"
        error={error || (outcomesQuery.isError ? "Kazanımlar alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        loading={outcomesQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary
            actions={outcomeSummaryActions}
            ariaLabel="Kazanım operasyon özeti"
            badges={outcomeSummaryBadges}
            items={outcomeSummaryItems}
          />
        }
        tableCaption="Kazanım katalog listesi"
        tableDescription="Kazanım kodu, branş, kazanım adı ve seviye bilgisi."
        title="Kazanımlar"
      />
      <FormModal
        description="Kod, branş ve kazanım adı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingOutcome ? "Kaydet" : "Ekle"}
        title={editingOutcome ? "Kazanım düzenle" : "Kazanım ekle"}
      >
        <Field label="Kazanım kodu">
          <Input
            required
            value={form.code}
            onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
          />
        </Field>
        <Field label="Branş">
          <Input
            required
            value={form.branch}
            onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}
          />
        </Field>
        <Field label="Kazanım adı">
          <Input
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Seviye">
          <Input
            value={form.level ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))}
          />
        </Field>
      </FormModal>
      {confirmationDialog}
    </>
  );
}

const learningOutcomeSortOptions = [
  { label: "Kod A-Z", value: "code" },
  { label: "Kod Z-A", value: "-code" },
  { label: "Branş A-Z", value: "branch" },
  { label: "Branş Z-A", value: "-branch" },
  { label: "Kazanım A-Z", value: "title" },
  { label: "Kazanım Z-A", value: "-title" },
  { label: "Seviye A-Z", value: "level" },
  { label: "Seviye Z-A", value: "-level" },
];

async function loadLearningOutcomes(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<LearningOutcomeRecord>(accessToken, buildListUrl(`${apiBaseUrl}/learning-outcomes`, listQuery));
}

async function createLearningOutcome(accessToken: string, input: LearningOutcomeFormPayload) {
  return apiRequest<LearningOutcomeRecord>(accessToken, `${apiBaseUrl}/learning-outcomes`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateLearningOutcome(accessToken: string, id: string, input: LearningOutcomeFormPayload) {
  return apiRequest<LearningOutcomeRecord>(accessToken, `${apiBaseUrl}/learning-outcomes/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteLearningOutcome(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/learning-outcomes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("LEARNING_OUTCOME_DELETE_FAILED");
  }
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function formatLearningOutcomeSort(value: string) {
  return learningOutcomeSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}
