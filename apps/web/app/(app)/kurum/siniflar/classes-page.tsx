"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn, useConfirmDialog } from "@uzman-hocam/ui";
import type { CampusRecord, ClassRecord, GradeLevelRecord } from "@uzman-hocam/shared-types";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  classFormSchema,
  firstFormError,
  type ClassFormPayload,
  type ClassFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";

const emptyForm: ClassFormState = {
  name: "",
  level: "",
  campusId: "",
  gradeLevelId: "",
  section: "",
};

export function ClassesPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: classSortOptions });
  const queryKey = ["next-classes", auth?.session.tenantId ?? "anonymous", listQuery];
  const listQueryKey = ["next-classes", auth?.session.tenantId ?? "anonymous"];
  const classesQuery = useQuery({
    queryKey,
    queryFn: () => loadClasses(auth?.accessToken ?? "", listQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const campusesQuery = useQuery({
    queryKey: ["next-class-campuses", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadCampuses(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const gradeLevelsQuery = useQuery({
    queryKey: ["next-class-grade-levels", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadGradeLevels(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const [editingClass, setEditingClass] = useState<ClassRecord | null>(null);
  const [form, setForm] = useState<ClassFormState>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [error, setError] = useState("");
  const rows = classesQuery.data?.data ?? [];
  const campuses = campusesQuery.data?.data ?? [];
  const gradeLevels = gradeLevelsQuery.data?.data ?? [];
  const campusNames = new Map(campuses.map((record) => [record.id, record.name]));
  const gradeLevelNames = new Map(gradeLevels.map((record) => [record.id, record.name]));

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<ClassRecord>> = [
    {
      key: "name",
      header: "Sınıf",
      render: (record) => record.name,
    },
    {
      key: "level",
      header: "Seviye",
      render: (record) => gradeLevelLabel(record, gradeLevelNames),
    },
    {
      key: "section",
      header: "Şube",
      render: (record) => record.section ?? "-",
    },
    {
      key: "campusId",
      header: "Kampüs",
      render: (record) => campusLabel(record.campusId, campusNames),
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
    setForm({
      name: record.name,
      level: record.level ?? "",
      campusId: record.campusId ?? "",
      gradeLevelId: record.gradeLevelId ?? "",
      section: record.section ?? "",
    });
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
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${record.name} sınıfı silinsin mi?`,
      title: "Sınıfı sil",
    });
    if (!confirmed) return;

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
        emptyState={
          <EmptyState
            title="Henüz sınıf yok"
            description="Sınıf ekleyerek öğrencileri yerleştireceğin temel yapıyı kur."
            hint={gradeLevels.length === 0 ? "Önce seviye eklemen önerilir." : undefined}
            primaryAction={{ label: "Sınıf ekle", onClick: openCreateForm }}
            secondaryAction={{ label: "Kuruluma dön", href: "/kurum/kurulum" }}
          />
        }
        emptyText="Sınıf kaydı yok"
        error={
          error ||
          (classesQuery.isError ? "Sınıflar alınamadı." : campusesQuery.isError ? "Kampüsler alınamadı." : gradeLevelsQuery.isError ? "Seviyeler alınamadı." : undefined)
        }
        getRowKey={(record) => record.id}
        loading={classesQuery.isPending || campusesQuery.isPending || gradeLevelsQuery.isPending}
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
          <select
            value={form.gradeLevelId ?? ""}
            onChange={(event) => {
              const gradeLevel = gradeLevels.find((record) => record.id === event.target.value);
              setForm((current) => ({ ...current, gradeLevelId: event.target.value, level: gradeLevel?.code ?? "" }));
            }}
          >
            <option value="">Seçiniz</option>
            {gradeLevels.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Şube
          <Input
            value={form.section ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))}
          />
        </label>
        <label>
          Kampüs
          <select value={form.campusId ?? ""} onChange={(event) => setForm((current) => ({ ...current, campusId: event.target.value }))}>
            <option value="">Seçiniz</option>
            {campuses.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </select>
        </label>
      </FormModal>
      {confirmationDialog}
    </>
  );
}

const classSortOptions = [
  { label: "Sınıf A-Z", value: "name" },
  { label: "Sınıf Z-A", value: "-name" },
  { label: "Seviye A-Z", value: "level" },
  { label: "Seviye Z-A", value: "-level" },
  { label: "Şube A-Z", value: "section" },
  { label: "Şube Z-A", value: "-section" },
];

async function loadClasses(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<ClassRecord>(accessToken, buildListUrl(`${apiBaseUrl}/classes`, listQuery));
}

async function loadCampuses(accessToken: string) {
  return apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`);
}

async function loadGradeLevels(accessToken: string) {
  return apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`);
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

function campusLabel(campusId: string | undefined, campusNames: Map<string, string>) {
  if (!campusId) return "-";
  return campusNames.get(campusId) ?? campusId;
}

function gradeLevelLabel(record: ClassRecord, gradeLevelNames: Map<string, string>) {
  if (record.gradeLevelId) return gradeLevelNames.get(record.gradeLevelId) ?? record.gradeLevelId;
  return record.level ?? "-";
}
