"use client";

import { type FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GradeLevelRecord } from "@uzman-hocam/shared-types";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  firstFormError,
  gradeLevelFormSchema,
  type GradeLevelFormPayload,
  type GradeLevelFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: GradeLevelFormState = {
  name: "",
  code: "",
};

export function GradeLevelsPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
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

  const columns: Array<DataTableColumn<GradeLevelRecord>> = [
    {
      key: "name",
      header: "Seviye",
      render: (record) => record.name,
    },
    {
      key: "code",
      header: "Kod",
      render: (record) => record.code ?? "-",
    },
    {
      key: "actions",
      header: "İşlem",
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
    if (!window.confirm(`${record.name} silinsin mi?`)) return;

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
        description="Kurum seviyelerini sınıf bölümlerine bağlamak için yönet."
        emptyText="Seviye kaydı yok"
        error={error || (gradeLevelsQuery.isError ? "Seviyeler alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        loading={gradeLevelsQuery.isPending}
        rows={rows}
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
        <label>
          Seviye adı
          <Input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label>
          Kod
          <Input
            value={form.code ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
          />
        </label>
      </FormModal>
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
