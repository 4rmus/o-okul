"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
import type { GuardianRecord } from "@uzman-hocam/shared-types";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  firstFormError,
  guardianFormSchema,
  type GuardianFormPayload,
  type GuardianFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: GuardianFormState = {
  firstName: "",
  lastName: "",
  phone: "",
};

export function GuardiansPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [listQuery, setListQuery] = useState<ListQueryState>(initialListQuery);
  const queryKey = ["next-guardians", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-guardians", auth?.session.tenantId ?? "anonymous"];
  const guardiansQuery = useQuery({
    queryKey,
    queryFn: () => loadGuardians(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingGuardian, setEditingGuardian] = useState<GuardianRecord | null>(null);
  const [form, setForm] = useState<GuardianFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = guardiansQuery.data?.data ?? [];

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<GuardianRecord>> = [
    {
      key: "name",
      header: "Ad Soyad",
      render: (guardian) => `${guardian.firstName} ${guardian.lastName}`,
    },
    {
      key: "phone",
      header: "Telefon",
      render: (guardian) => guardian.phone ?? "-",
    },
    {
      key: "actions",
      header: "İşlem",
      render: (guardian) => (
        <span className="next-row-actions">
          <Link href={`/kurum/veliler/${encodeURIComponent(guardian.id)}`} aria-label={`${guardian.firstName} detay`}>
            <Eye size={17} aria-hidden="true" />
          </Link>
          <button type="button" onClick={() => openEditForm(guardian)} aria-label={`${guardian.firstName} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleDelete(guardian)} aria-label={`${guardian.firstName} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openCreateForm() {
    setEditingGuardian(null);
    setForm(emptyForm);
    setError("");
    setIsFormOpen(true);
  }

  function openEditForm(guardian: GuardianRecord) {
    setEditingGuardian(guardian);
    setForm({
      firstName: guardian.firstName,
      lastName: guardian.lastName,
      phone: guardian.phone ?? "",
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setEditingGuardian(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = guardianFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedGuardian = editingGuardian
        ? await updateGuardian(auth.accessToken, editingGuardian.id, parsedForm.data)
        : await createGuardian(auth.accessToken, parsedForm.data);
      void savedGuardian;
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      closeForm();
    } catch {
      setError("Veli kaydedilemedi.");
    }
  }

  async function handleDelete(guardian: GuardianRecord) {
    if (!auth) return;
    if (!window.confirm(`${guardian.firstName} ${guardian.lastName} silinsin mi?`)) return;

    setError("");
    try {
      await deleteGuardian(auth.accessToken, guardian.id);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
    } catch {
      setError("Veli silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={guardiansQuery.data?.meta}
              onChange={setListQuery}
              sortOptions={guardianSortOptions}
              state={listQuery}
            />
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Veli ekle
            </Button>
          </>
        }
        aria-label="Veli yönetimi"
        columns={columns}
        description="Kurum velilerini aynı CRUD kalıbıyla yönet."
        emptyState={
          <EmptyState
            title="Veli kaydı yok"
            description="Öğrenci iletişimi ve portal davetleri için ilk veli kaydını oluştur."
            hint="Veli eklendikten sonra öğrenci bağlantısı ve portal daveti akışına geçebilirsin."
            primaryAction={{ label: "Veli ekle", onClick: openCreateForm }}
          />
        }
        emptyText="Veli kaydı yok"
        error={error || (guardiansQuery.isError ? "Veliler alınamadı." : undefined)}
        getRowKey={(guardian) => guardian.id}
        loading={guardiansQuery.isPending}
        rows={rows}
        title="Veliler"
      />
      <FormModal
        description="Ad ve soyad alanları zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitLabel={editingGuardian ? "Kaydet" : "Ekle"}
        title={editingGuardian ? "Veli düzenle" : "Veli ekle"}
      >
        <label>
          Ad
          <Input
            required
            value={form.firstName}
            onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))}
          />
        </label>
        <label>
          Soyad
          <Input
            required
            value={form.lastName}
            onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))}
          />
        </label>
        <label>
          Telefon
          <Input
            value={form.phone ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
          />
        </label>
      </FormModal>
    </>
  );
}

const guardianSortOptions = [
  { label: "Ad A-Z", value: "firstName" },
  { label: "Ad Z-A", value: "-firstName" },
  { label: "Soyad A-Z", value: "lastName" },
  { label: "Soyad Z-A", value: "-lastName" },
  { label: "Telefon A-Z", value: "phone" },
  { label: "Telefon Z-A", value: "-phone" },
];

async function loadGuardians(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<GuardianRecord>(accessToken, buildListUrl(`${apiBaseUrl}/guardians`, listQuery));
}

async function createGuardian(accessToken: string, input: GuardianFormPayload) {
  return apiRequest<GuardianRecord>(accessToken, `${apiBaseUrl}/guardians`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateGuardian(accessToken: string, id: string, input: GuardianFormPayload) {
  return apiRequest<GuardianRecord>(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteGuardian(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/guardians/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("GUARDIAN_DELETE_FAILED");
  }
}
