"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CampusRecord } from "@uzman-hocam/shared-types";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  campusFormSchema,
  firstFormError,
  type CampusFormPayload,
  type CampusFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: CampusFormState = {
  name: "",
  code: "",
};

export function CampusesPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const queryKey = ["next-campuses", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-campuses", auth?.session.tenantId ?? "anonymous"];
  const campusesQuery = useQuery({
    queryKey,
    queryFn: () => loadCampuses(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingCampus, setEditingCampus] = useState<CampusRecord | null>(null);
  const [form, setForm] = useState<CampusFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = campusesQuery.data?.data ?? [];

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<CampusRecord>> = [
    {
      key: "name",
      header: "Kampüs",
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
    setEditingCampus(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(record: CampusRecord) {
    setEditingCampus(record);
    setForm({ name: record.name, code: record.code ?? "" });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingCampus(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = campusFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedCampus = editingCampus
        ? await updateCampus(auth.accessToken, editingCampus.id, parsedForm.data)
        : await createCampus(auth.accessToken, parsedForm.data);
      void savedCampus;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Kampüs kaydedilemedi.");
    }
  }

  async function handleDelete(record: CampusRecord) {
    if (!auth) return;
    if (!window.confirm(`${record.name} silinsin mi?`)) return;

    setError("");
    try {
      await deleteCampus(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Kampüs silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={campusesQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={campusSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Kampüs ekle
            </Button>
          </>
        }
        aria-label="Kampüs yönetimi"
        columns={columns}
        description="Kurum kampüslerini aynı CRUD kalıbıyla yönet."
        emptyState={
          <EmptyState
            title="Henüz kampüs yok"
            description="Kampüs ekleyerek sınıf yapısını kurmaya başla."
            primaryAction={{ label: "Kampüs ekle", onClick: openCreateForm }}
            secondaryAction={{ label: "Kuruluma dön", href: "/kurum/kurulum" }}
          />
        }
        emptyText="Kampüs kaydı yok"
        error={error || (campusesQuery.isError ? "Kampüsler alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        loading={campusesQuery.isPending}
        rows={rows}
        title="Kampüsler"
      />
      <FormModal
        description="Kampüs adı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingCampus ? "Kaydet" : "Ekle"}
        title={editingCampus ? "Kampüs düzenle" : "Kampüs ekle"}
      >
        <label>
          Kampüs adı
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

const campusSortOptions = [
  { label: "Kampüs A-Z", value: "name" },
  { label: "Kampüs Z-A", value: "-name" },
  { label: "Kod A-Z", value: "code" },
  { label: "Kod Z-A", value: "-code" },
];

async function loadCampuses(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<CampusRecord>(accessToken, buildListUrl(`${apiBaseUrl}/campuses`, listQuery));
}

async function createCampus(accessToken: string, input: CampusFormPayload) {
  return apiRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateCampus(accessToken: string, id: string, input: CampusFormPayload) {
  return apiRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteCampus(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/campuses/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("CAMPUS_DELETE_FAILED");
  }
}
