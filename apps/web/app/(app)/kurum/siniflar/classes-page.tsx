"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, CrudPage, EmptyState, Field, FormModal, Input, Select, type DataTableColumn, useConfirmDialog } from "@o-okul/ui";
import type { CampusRecord, ClassRecord, GradeLevelRecord } from "@o-okul/shared-types";
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
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

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
  const campusCoverageCount = new Set(rows.map((record) => record.campusId).filter(Boolean)).size;
  const gradeLevelCoverageCount = new Set(rows.map((record) => record.gradeLevelId || record.level).filter(Boolean)).size;
  const sectionCoverageCount = rows.filter((record) => Boolean(record.section)).length;
  const classSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Sınıf toplamı",
      value: formatCount(classesQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "Bu sayfada bağlı kampüs",
      key: "campus",
      label: "Kampüs kapsamı",
      tone: campusCoverageCount > 0 ? "info" : "warning",
      value: campusCoverageCount > 0 ? `${campusCoverageCount} kampüs` : "Bağsız",
    },
    {
      description: "Seviye veya legacy level",
      key: "grade",
      label: "Seviye kapsamı",
      tone: gradeLevelCoverageCount > 0 ? "success" : "warning",
      value: gradeLevelCoverageCount > 0 ? `${gradeLevelCoverageCount} seviye` : "Eksik",
    },
    {
      description: "Şube alanı dolu sınıflar",
      key: "section",
      label: "Şube düzeni",
      value: `${sectionCoverageCount}/${rows.length}`,
    },
  ];
  const classSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "campus-ref",
      label: campuses.length > 0 ? "Kampüs referansı hazır" : "Kampüs referansı bekliyor",
      tone: campuses.length > 0 ? "success" : "warning",
    },
    {
      key: "grade-ref",
      label: gradeLevels.length > 0 ? "Seviye referansı hazır" : "Seviye referansı bekliyor",
      tone: gradeLevels.length > 0 ? "success" : "warning",
    },
    {
      key: "sort",
      label: `Sıralama: ${formatClassSort(listQuery.sort)}`,
      tone: "neutral",
    },
  ];
  const classSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Kampüs ve seviye referansları birlikte izlenir",
      key: "references",
      label: "Referans eşleşmesi",
      status: campuses.length > 0 && gradeLevels.length > 0 ? "Hazır" : "Kontrol",
      tone: campuses.length > 0 && gradeLevels.length > 0 ? "success" : "warning",
      value: `Kampüs ${campuses.length} / Seviye ${gradeLevels.length}`,
    },
    {
      detail: "Bu sayfadaki sınıf dağılımı",
      key: "campus-distribution",
      label: "Kampüs dağılımı",
      status: campusCoverageCount > 0 ? "İzleniyor" : "Eksik",
      tone: campusCoverageCount > 0 ? "info" : "warning",
      value: campusCoverageCount > 0 ? `${campusCoverageCount} kampüs` : "Bağsız",
    },
    {
      detail: "Şube alanı sınıf adını destekler",
      key: "section-coverage",
      label: "Şube düzeni",
      status: sectionCoverageCount > 0 ? "İzleniyor" : "Opsiyonel",
      tone: sectionCoverageCount > 0 ? "neutral" : "warning",
      value: `${sectionCoverageCount}/${rows.length}`,
    },
  ];

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<ClassRecord>> = [
    {
      key: "name",
      header: "Sınıf",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => record.name,
      sticky: "left",
    },
    {
      key: "level",
      header: "Seviye",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (record) => gradeLevelLabel(record, gradeLevelNames),
    },
    {
      key: "section",
      header: "Şube",
      mobilePriority: "hidden",
      priority: "optional",
      render: (record) => record.section ?? "-",
    },
    {
      key: "campusId",
      header: "Kampüs",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (record) => campusLabel(record.campusId, campusNames),
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
        density="compact"
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
        summary={
          <OperationSummary
            actions={classSummaryActions}
            ariaLabel="Sınıf operasyon özeti"
            badges={classSummaryBadges}
            items={classSummaryItems}
          />
        }
        tableCaption="Sınıf eğitim yapısı"
        tableDescription="Sınıf, seviye, şube ve kampüs ilişkileri."
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
        <Field label="Sınıf adı">
          <Input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="Seviye" description="Seçilen seviye sınıf raporları ve filtreleriyle eşleşir.">
          <Select
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
          </Select>
        </Field>
        <Field label="Şube">
          <Input
            value={form.section ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))}
          />
        </Field>
        <Field label="Kampüs" description="Kampüs bağlantısı sınıf rapor ve operasyon filtrelerinde bağlam sağlar.">
          <Select value={form.campusId ?? ""} onChange={(event) => setForm((current) => ({ ...current, campusId: event.target.value }))}>
            <option value="">Seçiniz</option>
            {campuses.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </Select>
        </Field>
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
    body: JSON.stringify(toClassRequestPayload(input)),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateClass(accessToken: string, id: string, input: ClassFormPayload) {
  return apiRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes/${encodeURIComponent(id)}`, {
    body: JSON.stringify(toClassRequestPayload(input)),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

function toClassRequestPayload(input: ClassFormPayload) {
  return {
    level: input.level,
    name: input.name,
    section: input.section,
    ...(input.campusId ? { campusId: input.campusId } : {}),
    ...(input.gradeLevelId ? { gradeLevelId: input.gradeLevelId } : {}),
  };
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

function formatCount(value: number) {
  return value.toLocaleString("tr-TR");
}

function formatClassSort(value: string) {
  return classSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}
