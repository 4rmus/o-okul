"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LearningOutcomeRecord } from "@uzman-hocam/shared-types";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  firstFormError,
  learningOutcomeFormSchema,
  type LearningOutcomeFormPayload,
  type LearningOutcomeFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

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
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
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

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<LearningOutcomeRecord>> = [
    {
      key: "code",
      header: "Kod",
      render: (record) => record.code,
    },
    {
      key: "branch",
      header: "Branş",
      render: (record) => record.branch,
    },
    {
      key: "title",
      header: "Kazanım",
      render: (record) => record.title,
    },
    {
      key: "level",
      header: "Seviye",
      render: (record) => record.level ?? "-",
    },
    {
      key: "actions",
      header: "İşlem",
      render: (record) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openEditForm(record)} aria-label={`${record.code} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(record)} aria-label={`${record.code} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
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
      branch: record.branch,
      code: record.code,
      level: record.level ?? "",
      title: record.title,
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
    if (!window.confirm(`${record.code} silinsin mi?`)) return;

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
        <label>
          Kazanım kodu
          <Input
            required
            value={form.code}
            onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
          />
        </label>
        <label>
          Branş
          <Input
            required
            value={form.branch}
            onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}
          />
        </label>
        <label>
          Kazanım adı
          <Input
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <label>
          Seviye
          <Input
            value={form.level ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))}
          />
        </label>
      </FormModal>
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
