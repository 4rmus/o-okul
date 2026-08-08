"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CampusRecord } from "@o-okul/shared-types";
import { Button, CrudPage, EmptyState, Field, FormModal, Input, Select, type DataTableColumn, useConfirmDialog } from "@o-okul/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  campusFormSchema,
  firstFormError,
  type CampusFormPayload,
  type CampusFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const emptyForm: CampusFormState = {
  name: "",
  code: "",
  unitType: "SCHOOL",
};

export function CampusesPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: campusSortOptions });
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
  const codedCampusCount = rows.filter((record) => Boolean(record.code)).length;
  const campusSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Kampüs toplamı",
      value: formatCount(campusesQuery.data?.meta?.total ?? rows.length),
    },
    {
      description: "Bu sayfada kodu olan kampüs",
      key: "code",
      label: "Kod kapsamı",
      tone: codedCampusCount > 0 ? "info" : "warning",
      value: `${codedCampusCount}/${rows.length}`,
    },
    {
      description: "Sınıf, rapor ve finans filtre bağlamı",
      key: "context",
      label: "Operasyon bağlamı",
      value: "Kurum yapısı",
    },
  ];
  const campusSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: `Sıralama: ${formatCampusSort(listQuery.sort)}`,
      tone: "neutral",
    },
    {
      key: "code",
      label: codedCampusCount === rows.length && rows.length > 0 ? "Kod alanı tamam" : "Kod alanı opsiyonel",
      tone: codedCampusCount === rows.length && rows.length > 0 ? "success" : "neutral",
    },
  ];
  const campusSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Kısa kod sınıf ve rapor filtrelerinde kullanılır",
      key: "code-readiness",
      label: "Kod temizliği",
      status: codedCampusCount === rows.length && rows.length > 0 ? "Hazır" : "Opsiyonel",
      tone: codedCampusCount > 0 ? "info" : "neutral",
      value: `${codedCampusCount}/${rows.length}`,
    },
    {
      detail: "Sınıf, öğrenci ve finans kırılımı",
      key: "structure-context",
      label: "Kurum yapısı",
      status: "Bağlam",
      tone: "info",
      value: "Sınıf/Finans",
    },
    {
      detail: "Kampüs filtresi rapor ve operasyon ekranlarına taşınır",
      key: "filter-context",
      label: "Rapor filtresi",
      status: "İzleniyor",
      tone: "neutral",
      value: "Kampüs",
    },
  ];

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<CampusRecord>> = [
    {
      key: "name",
      header: "Kampüs",
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
      key: "unitType",
      header: "Birim tipi",
      priority: "secondary",
      render: (record) => campusUnitTypeLabel(record.unitType),
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
          <Button size="icon" variant="ghost" type="button" onClick={() => openEditForm(record)} aria-label={`${record.name} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" type="button" onClick={() => void handleDelete(record)} aria-label={`${record.name} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </Button>
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
    setForm({ name: record.name, code: record.code ?? "", unitType: record.unitType ?? "SCHOOL" });
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
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${record.name} kampüsü silinsin mi?`,
      title: "Kampüsü sil",
    });
    if (!confirmed) return;

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
        density="compact"
        description="Kampüsleri ortak liste düzeninde yönetin."
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
        hasActiveFilters={Boolean(listQuery.q.trim())}
        loading={campusesQuery.isPending}
        rows={rows}
        summary={
          <OperationSummary
            actions={campusSummaryActions}
            ariaLabel="Kampüs operasyon özeti"
            badges={campusSummaryBadges}
            items={campusSummaryItems}
          />
        }
        tableCaption="Kampüs eğitim yapısı"
        tableDescription="Kampüs adı, kısa kod ve kampüs aksiyonları."
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
        <Field label="Kampüs adı">
          <Input
            required
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="Kod" description="Kısa kod sınıf, rapor ve kampüs filtrelerinde hızlı tanıma sağlar.">
          <Input
            value={form.code ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
          />
        </Field>
        <Field label="Birim tipi">
          <Select value={form.unitType} onChange={(event) => setForm((current) => ({ ...current, unitType: event.target.value as CampusFormState["unitType"] }))}>
            <option value="SCHOOL">Okul</option>
            <option value="COURSE">Kurs</option>
            <option value="MIXED">Karma</option>
          </Select>
        </Field>
      </FormModal>
      {confirmationDialog}
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

function formatCount(value: number) {
  return value.toLocaleString("tr-TR");
}

function formatCampusSort(value: string) {
  return campusSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}

function campusUnitTypeLabel(value: CampusRecord["unitType"]) {
  if (value === "SCHOOL") return "Okul";
  if (value === "COURSE") return "Kurs";
  if (value === "MIXED") return "Karma";
  return "-";
}
