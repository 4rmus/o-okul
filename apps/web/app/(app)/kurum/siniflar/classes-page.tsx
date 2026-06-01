"use client";

import { type FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type { ClassRecord } from "@uzman-hocam/shared-types";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  classFormSchema,
  firstFormError,
  type ClassFormPayload,
  type ClassFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: ClassFormState = {
  name: "",
  level: "",
};

export function ClassesPage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const queryKey = ["next-classes", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-classes", auth?.session.tenantId ?? "anonymous"];
  const classesQuery = useQuery({
    queryKey,
    queryFn: () => loadClasses(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingClass, setEditingClass] = useState<ClassRecord | null>(null);
  const [form, setForm] = useState<ClassFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = classesQuery.data?.data ?? [];

  const columns: Array<DataTableColumn<ClassRecord>> = [
    {
      key: "name",
      header: "Sınıf",
      render: (record) => record.name,
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
    setEditingClass(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(record: ClassRecord) {
    setEditingClass(record);
    setForm({ name: record.name, level: record.level ?? "" });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingClass(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = classFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedClass = editingClass
        ? await updateClass(auth.accessToken, editingClass.id, parsedForm.data)
        : await createClass(auth.accessToken, parsedForm.data);
      void savedClass;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Sınıf kaydedilemedi.");
    }
  }

  async function handleDelete(record: ClassRecord) {
    if (!auth) return;
    if (!window.confirm(`${record.name} silinsin mi?`)) return;

    setError("");
    try {
      await deleteClass(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Sınıf silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={classesQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={classSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Sınıf ekle
            </Button>
          </>
        }
        aria-label="Sınıf yönetimi"
        columns={columns}
        description="Kurum sınıflarını aynı CRUD kalıbıyla yönet."
        emptyText="Sınıf kaydı yok"
        error={error || (classesQuery.isError ? "Sınıflar alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        loading={classesQuery.isPending}
        rows={rows}
        title="Sınıflar"
      />
      <FormModal
        description="Sınıf adı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingClass ? "Kaydet" : "Ekle"}
        title={editingClass ? "Sınıf düzenle" : "Sınıf ekle"}
      >
        <label>
          Sınıf adı
          <Input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
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

const classSortOptions = [
  { label: "Sınıf A-Z", value: "name" },
  { label: "Sınıf Z-A", value: "-name" },
  { label: "Seviye A-Z", value: "level" },
  { label: "Seviye Z-A", value: "-level" },
];

async function loadClasses(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<ClassRecord>(accessToken, buildListUrl(`${apiBaseUrl}/classes`, listQuery));
}

async function createClass(accessToken: string, input: ClassFormPayload) {
  return apiRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateClass(accessToken: string, id: string, input: ClassFormPayload) {
  return apiRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteClass(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/classes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("CLASS_DELETE_FAILED");
  }
}
