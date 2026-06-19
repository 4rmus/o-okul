"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcademicTermRecord, AcademicYearRecord } from "@uzman-hocam/shared-types";
import {
  Button,
  Checkbox,
  CrudPage,
  EmptyState,
  Field,
  FormModal,
  Input,
  Select,
  StatusBadge,
  type DataTableColumn,
  type StatusBadgeProps,
  useConfirmDialog,
} from "@uzman-hocam/ui";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import {
  academicTermFormSchema,
  academicYearFormSchema,
  firstFormError,
  type AcademicTermFormPayload,
  type AcademicTermFormState,
  type AcademicYearFormPayload,
  type AcademicYearFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const emptyYearForm: AcademicYearFormState = {
  name: "",
  startsAt: "",
  endsAt: "",
  isActive: false,
};

const emptyTermForm: AcademicTermFormState = {
  academicYearId: "",
  name: "",
  startsAt: "",
  endsAt: "",
  isActive: false,
};

export function AcademicCalendarPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const [yearListQuery, setYearListQuery] = useUrlListState(searchParams, { namespace: "years", sortOptions: academicYearSortOptions });
  const [termListQuery, setTermListQuery] = useUrlListState(searchParams, { namespace: "terms", sortOptions: academicTermSortOptions });
  const yearQueryKey = ["next-academic-years", auth?.session.tenantId ?? "anonymous", yearListQuery];
  const termQueryKey = ["next-academic-terms", auth?.session.tenantId ?? "anonymous", termListQuery];
  const yearListQueryKey = ["next-academic-years", auth?.session.tenantId ?? "anonymous"];
  const termListQueryKey = ["next-academic-terms", auth?.session.tenantId ?? "anonymous"];
  const yearsQuery = useQuery({
    queryKey: yearQueryKey,
    queryFn: () => loadAcademicYears(auth?.accessToken ?? "", yearListQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const termsQuery = useQuery({
    queryKey: termQueryKey,
    queryFn: () => loadAcademicTerms(auth?.accessToken ?? "", termListQuery),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const years = yearsQuery.data?.data ?? [];
  const terms = termsQuery.data?.data ?? [];
  const yearNames = useMemo(() => new Map(years.map((record) => [record.id, record.name])), [years]);
  const activeYearCount = years.filter((record) => record.isActive).length;
  const activeTermCount = terms.filter((record) => record.isActive).length;
  const yearDateCoverageCount = years.filter((record) => Boolean(record.startsAt && record.endsAt)).length;
  const termDateCoverageCount = terms.filter((record) => Boolean(record.startsAt && record.endsAt)).length;
  const linkedYearCount = new Set(terms.map((record) => record.academicYearId).filter((academicYearId) => yearNames.has(academicYearId))).size;
  const termYearMatchCount = terms.filter((record) => yearNames.has(record.academicYearId)).length;
  const [editingYear, setEditingYear] = useState<AcademicYearRecord | null>(null);
  const [editingTerm, setEditingTerm] = useState<AcademicTermRecord | null>(null);
  const [yearForm, setYearForm] = useState<AcademicYearFormState>(emptyYearForm);
  const [termForm, setTermForm] = useState<AcademicTermFormState>(emptyTermForm);
  const [isYearFormOpen, setIsYearFormOpen] = useState(false);
  const [isTermFormOpen, setIsTermFormOpen] = useState(false);
  const [error, setError] = useState("");

  const yearSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Akademik yıl toplamı",
      value: formatCount(yearsQuery.data?.meta?.total ?? years.length),
    },
    {
      description: "Bu sayfada aktif yıl",
      key: "active",
      label: "Aktif yıl",
      tone: activeYearCount === 1 ? "success" : activeYearCount > 1 ? "danger" : "warning",
      value: `${activeYearCount}/${years.length}`,
    },
    {
      description: "Başlangıç ve bitiş tarihi tamam",
      key: "date-coverage",
      label: "Tarih kapsamı",
      tone: yearDateCoverageCount === years.length && years.length > 0 ? "success" : "default",
      value: `${yearDateCoverageCount}/${years.length}`,
    },
    {
      description: "Döneme bağlı akademik yıl",
      key: "term-coverage",
      label: "Dönem kapsamı",
      tone: linkedYearCount > 0 ? "info" : "warning",
      value: `${linkedYearCount}/${years.length}`,
    },
  ];
  const yearSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: `Sıralama: ${formatAcademicYearSort(yearListQuery.sort)}`,
      tone: "neutral",
    },
    {
      key: "url-state",
      label: "Yıl listesi URL state",
      tone: "info",
    },
  ];
  const yearSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Ders programı ve rapor bağlamı",
      key: "active-year",
      label: "Aktif yıl kontrolü",
      status: activeYearCount === 1 ? "Hazır" : activeYearCount > 1 ? "Çakışma" : "Eksik",
      tone: activeYearCount === 1 ? "success" : activeYearCount > 1 ? "danger" : "warning",
      value: activeYearCount === 1 ? "Tek aktif" : `${activeYearCount} aktif`,
    },
    {
      detail: "Dönemler akademik yıla bağlanır",
      key: "term-link",
      label: "Dönem bağlantısı",
      status: linkedYearCount > 0 ? "Bağlı" : "Bekliyor",
      tone: linkedYearCount > 0 ? "info" : "neutral",
      value: `${linkedYearCount}/${years.length}`,
    },
    {
      detail: "Tarih aralığı boş kayıtları yakalar",
      key: "year-dates",
      label: "Tarih aralığı",
      status: yearDateCoverageCount === years.length && years.length > 0 ? "Hazır" : "Kontrol",
      tone: yearDateCoverageCount === years.length && years.length > 0 ? "success" : "neutral",
      value: `${yearDateCoverageCount}/${years.length}`,
    },
  ];

  const termSummaryItems: OperationSummaryItem[] = [
    {
      description: "Filtrelenmiş toplam kayıt",
      key: "total",
      label: "Dönem toplamı",
      value: formatCount(termsQuery.data?.meta?.total ?? terms.length),
    },
    {
      description: "Bu sayfada aktif dönem",
      key: "active",
      label: "Aktif dönem",
      tone: activeTermCount === 1 ? "success" : activeTermCount > 1 ? "danger" : "warning",
      value: `${activeTermCount}/${terms.length}`,
    },
    {
      description: "Akademik yıl adı çözümlenmiş",
      key: "year-match",
      label: "Yıl eşleşmesi",
      tone: termYearMatchCount === terms.length && terms.length > 0 ? "success" : "warning",
      value: `${termYearMatchCount}/${terms.length}`,
    },
    {
      description: "Başlangıç ve bitiş tarihi tamam",
      key: "date-coverage",
      label: "Tarih kapsamı",
      tone: termDateCoverageCount === terms.length && terms.length > 0 ? "success" : "default",
      value: `${termDateCoverageCount}/${terms.length}`,
    },
  ];
  const termSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: `Sıralama: ${formatAcademicTermSort(termListQuery.sort)}`,
      tone: "neutral",
    },
    {
      key: "year-required",
      label: years.length > 0 ? "Dönem ekleme hazır" : "Dönem için yıl gerekli",
      tone: years.length > 0 ? "success" : "warning",
    },
    {
      key: "url-state",
      label: "Dönem listesi URL state",
      tone: "info",
    },
  ];
  const termSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Not, devamsızlık ve rapor varsayılanı",
      key: "active-term",
      label: "Aktif dönem kontrolü",
      status: activeTermCount === 1 ? "Hazır" : activeTermCount > 1 ? "Çakışma" : "Eksik",
      tone: activeTermCount === 1 ? "success" : activeTermCount > 1 ? "danger" : "warning",
      value: activeTermCount === 1 ? "Tek aktif" : `${activeTermCount} aktif`,
    },
    {
      detail: "Dönem, akademik yıl listesiyle eşleşir",
      key: "year-match",
      label: "Yıl eşleşmesi",
      status: termYearMatchCount === terms.length && terms.length > 0 ? "Bağlı" : "Kontrol",
      tone: termYearMatchCount === terms.length && terms.length > 0 ? "success" : "warning",
      value: `${termYearMatchCount}/${terms.length}`,
    },
    {
      detail: "Tarih aralığı rapor ve yoklama bağlamını besler",
      key: "term-dates",
      label: "Dönem tarihleri",
      status: termDateCoverageCount === terms.length && terms.length > 0 ? "Hazır" : "Kontrol",
      tone: termDateCoverageCount === terms.length && terms.length > 0 ? "success" : "neutral",
      value: `${termDateCoverageCount}/${terms.length}`,
    },
  ];

  const yearColumns: Array<DataTableColumn<AcademicYearRecord>> = [
    { key: "name", header: "Akademik yıl", priority: "primary", render: (record) => record.name, sticky: "left" },
    { key: "startsAt", header: "Başlangıç", mobileLabel: "Başlangıç", priority: "secondary", render: (record) => record.startsAt },
    { key: "endsAt", header: "Bitiş", mobileLabel: "Bitiş", priority: "optional", render: (record) => record.endsAt },
    {
      key: "isActive",
      header: "Durum",
      priority: "primary",
      render: (record) => <StatusBadge tone={activeTone(record.isActive)}>{activeLabel(record.isActive)}</StatusBadge>,
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      priority: "primary",
      sticky: "right",
      render: (record) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openYearEditForm(record)} aria-label={`${record.name} yılını düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleYearDelete(record)} aria-label={`${record.name} yılını sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  const termColumns: Array<DataTableColumn<AcademicTermRecord>> = [
    { key: "name", header: "Dönem", priority: "primary", render: (record) => record.name, sticky: "left" },
    {
      key: "academicYearId",
      header: "Akademik yıl",
      priority: "secondary",
      render: (record) => yearNames.get(record.academicYearId) ?? "Yıl eşleşmesi yok",
    },
    { key: "startsAt", header: "Başlangıç", mobileLabel: "Başlangıç", priority: "secondary", render: (record) => record.startsAt },
    { key: "endsAt", header: "Bitiş", mobileLabel: "Bitiş", priority: "optional", render: (record) => record.endsAt },
    {
      key: "isActive",
      header: "Durum",
      priority: "primary",
      render: (record) => <StatusBadge tone={activeTone(record.isActive)}>{activeLabel(record.isActive)}</StatusBadge>,
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      priority: "primary",
      sticky: "right",
      render: (record) => (
        <span className="next-row-actions">
          <button type="button" onClick={() => openTermEditForm(record)} aria-label={`${record.name} dönemini düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => void handleTermDelete(record)} aria-label={`${record.name} dönemini sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </button>
        </span>
      ),
    },
  ];

  function openYearCreateForm() {
    setEditingYear(null);
    setYearForm(emptyYearForm);
    setError("");
    setIsYearFormOpen(true);
  }

  function openYearEditForm(record: AcademicYearRecord) {
    setEditingYear(record);
    setYearForm({
      name: record.name,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      isActive: record.isActive,
    });
    setError("");
    setIsYearFormOpen(true);
  }

  function closeYearForm() {
    setIsYearFormOpen(false);
    setEditingYear(null);
    setYearForm(emptyYearForm);
  }

  function openTermCreateForm() {
    if (years.length === 0) return;
    setEditingTerm(null);
    setTermForm({
      ...emptyTermForm,
      academicYearId: years[0]?.id ?? "",
    });
    setError("");
    setIsTermFormOpen(true);
  }

  function openTermEditForm(record: AcademicTermRecord) {
    setEditingTerm(record);
    setTermForm({
      academicYearId: record.academicYearId,
      name: record.name,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      isActive: record.isActive,
    });
    setError("");
    setIsTermFormOpen(true);
  }

  function closeTermForm() {
    setIsTermFormOpen(false);
    setEditingTerm(null);
    setTermForm(emptyTermForm);
  }

  async function handleYearSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = academicYearFormSchema.safeParse(yearForm);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedYear = editingYear
        ? await updateAcademicYear(auth.accessToken, editingYear.id, parsedForm.data)
        : await createAcademicYear(auth.accessToken, parsedForm.data);
      void savedYear;
      void queryClient.invalidateQueries({ queryKey: yearListQueryKey });
      void queryClient.invalidateQueries({ queryKey: termListQueryKey });
      closeYearForm();
    } catch {
      setError("Akademik yıl kaydedilemedi.");
    }
  }

  async function handleTermSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = academicTermFormSchema.safeParse(termForm);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    try {
      const savedTerm = editingTerm
        ? await updateAcademicTerm(auth.accessToken, editingTerm.id, parsedForm.data)
        : await createAcademicTerm(auth.accessToken, parsedForm.data);
      void savedTerm;
      void queryClient.invalidateQueries({ queryKey: termListQueryKey });
      closeTermForm();
    } catch {
      setError("Akademik dönem kaydedilemedi.");
    }
  }

  async function handleYearDelete(record: AcademicYearRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${record.name} akademik yılı silinsin mi?`,
      title: "Akademik yılı sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteAcademicYear(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: yearListQueryKey });
      void queryClient.invalidateQueries({ queryKey: termListQueryKey });
    } catch {
      setError("Akademik yıl silinemedi.");
    }
  }

  async function handleTermDelete(record: AcademicTermRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${record.name} dönemi silinsin mi?`,
      title: "Dönemi sil",
    });
    if (!confirmed) return;

    setError("");
    try {
      await deleteAcademicTerm(auth.accessToken, record.id);
      void queryClient.invalidateQueries({ queryKey: termListQueryKey });
    } catch {
      setError("Akademik dönem silinemedi.");
    }
  }

  return (
    <>
      <CrudPage
        actions={
          <>
            <ListControls
              meta={yearsQuery.data?.meta}
              onChange={setYearListQuery}
              sortOptions={academicYearSortOptions}
              state={yearListQuery}
            />
            <Button onClick={openYearCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Akademik yıl ekle
            </Button>
          </>
        }
        aria-label="Akademik yıl yönetimi"
        columns={yearColumns}
        density="compact"
        description="Kurumun eğitim yıllarını tarih aralıklarıyla yönet."
        emptyState={
          <EmptyState
            title="Akademik yıl yok"
            description="Yeni dönemi planlamak için ilk akademik yılı oluştur."
            hint="Akademik yıl, dönem ve ders programı kayıtlarının temelidir."
            primaryAction={{ label: "Akademik yıl ekle", onClick: openYearCreateForm }}
          />
        }
        emptyText="Akademik yıl kaydı yok"
        error={error || (yearsQuery.isError ? "Akademik yıllar alınamadı." : undefined)}
        getRowKey={(record) => record.id}
        loading={yearsQuery.isPending}
        rows={years}
        summary={
          <OperationSummary
            actions={yearSummaryActions}
            ariaLabel="Akademik yıl operasyon özeti"
            badges={yearSummaryBadges}
            items={yearSummaryItems}
          />
        }
        tableCaption="Akademik yıl takvimi"
        tableDescription="Yıl adı, tarih aralığı, aktiflik ve dönem bağlantısı URL durumuyla korunur."
        title="Akademik Takvim"
      />
      <CrudPage
        actions={
          <>
            <ListControls
              meta={termsQuery.data?.meta}
              onChange={setTermListQuery}
              sortOptions={academicTermSortOptions}
              state={termListQuery}
            />
            <Button disabled={years.length === 0} onClick={openTermCreateForm} title={years.length === 0 ? "Önce akademik yıl ekle" : undefined}>
              <Plus size={17} aria-hidden="true" />
              Dönem ekle
            </Button>
          </>
        }
        aria-label="Akademik dönem yönetimi"
        columns={termColumns}
        density="compact"
        description="Akademik yıllara bağlı dönemleri yönet."
        emptyState={
          <EmptyState
            title="Dönem yok"
            description="Akademik yıl oluşturduktan sonra ilk dönemi ekle."
            hint="Dönemler ders programı, not ve rapor akışlarını bağlar."
            primaryAction={years.length > 0 ? { label: "Dönem ekle", onClick: openTermCreateForm } : undefined}
          />
        }
        emptyText="Dönem kaydı yok"
        error={termsQuery.isError ? "Akademik dönemler alınamadı." : undefined}
        getRowKey={(record) => record.id}
        loading={termsQuery.isPending}
        rows={terms}
        summary={
          <OperationSummary
            actions={termSummaryActions}
            ariaLabel="Akademik dönem operasyon özeti"
            badges={termSummaryBadges}
            items={termSummaryItems}
          />
        }
        tableCaption="Akademik dönem takvimi"
        tableDescription="Dönem adı, bağlı akademik yıl, tarih aralığı ve aktiflik durumu."
        title="Dönemler"
      />
      <FormModal
        description="Akademik yıl adı ve tarih aralığı zorunludur."
        onCancel={closeYearForm}
        onSubmit={(event) => void handleYearSubmit(event)}
        open={isYearFormOpen}
        submitLabel={editingYear ? "Kaydet" : "Ekle"}
        title={editingYear ? "Akademik yıl düzenle" : "Akademik yıl ekle"}
      >
        <Field label="Akademik yıl adı" description="Örn. 2026-2027">
          <Input
            required
            value={yearForm.name}
            onChange={(event) => setYearForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="Başlangıç" description="Yılın kurum operasyonlarında açılacağı tarih.">
          <Input
            required
            type="date"
            value={yearForm.startsAt}
            onChange={(event) => setYearForm((current) => ({ ...current, startsAt: event.target.value }))}
          />
        </Field>
        <Field label="Bitiş" description="Yıl kapanış tarihi; dönemler bu aralıkta planlanır.">
          <Input
            required
            type="date"
            value={yearForm.endsAt}
            onChange={(event) => setYearForm((current) => ({ ...current, endsAt: event.target.value }))}
          />
        </Field>
        <Field label="Aktif" description="Aktif yıl ders programı, yoklama ve rapor bağlamını etkiler.">
          <Checkbox
            checked={yearForm.isActive}
            label="Aktif akademik yıl"
            description="Ders programı, yoklama ve rapor bağlamında varsayılan yıl olur."
            onChange={(event) => setYearForm((current) => ({ ...current, isActive: event.target.checked }))}
          />
        </Field>
      </FormModal>
      <FormModal
        description="Dönem adı, akademik yıl ve tarih aralığı zorunludur."
        onCancel={closeTermForm}
        onSubmit={(event) => void handleTermSubmit(event)}
        open={isTermFormOpen}
        submitLabel={editingTerm ? "Kaydet" : "Ekle"}
        title={editingTerm ? "Dönem düzenle" : "Dönem ekle"}
      >
        <Field label="Akademik yıl" description="Dönemin bağlı olduğu akademik yıl.">
          <Select
            required
            value={termForm.academicYearId}
            onChange={(event) => setTermForm((current) => ({ ...current, academicYearId: event.target.value }))}
          >
            <option value="">Seçiniz</option>
            {years.map((record) => (
              <option key={record.id} value={record.id}>
                {record.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dönem adı" description="Örn. 1. Dönem veya Bahar.">
          <Input
            required
            value={termForm.name}
            onChange={(event) => setTermForm((current) => ({ ...current, name: event.target.value }))}
          />
        </Field>
        <Field label="Başlangıç" description="Dönemin başladığı tarih.">
          <Input
            required
            type="date"
            value={termForm.startsAt}
            onChange={(event) => setTermForm((current) => ({ ...current, startsAt: event.target.value }))}
          />
        </Field>
        <Field label="Bitiş" description="Dönemin kapandığı tarih.">
          <Input
            required
            type="date"
            value={termForm.endsAt}
            onChange={(event) => setTermForm((current) => ({ ...current, endsAt: event.target.value }))}
          />
        </Field>
        <Field label="Aktif" description="Aktif dönem not, yoklama ve karne bağlamında öne çıkar.">
          <Checkbox
            checked={termForm.isActive}
            label="Aktif dönem"
            description="Not, yoklama ve karne akışlarında varsayılan dönem olur."
            onChange={(event) => setTermForm((current) => ({ ...current, isActive: event.target.checked }))}
          />
        </Field>
      </FormModal>
      {confirmationDialog}
    </>
  );
}

const academicYearSortOptions = [
  { label: "Yıl A-Z", value: "name" },
  { label: "Yıl Z-A", value: "-name" },
  { label: "Başlangıç A-Z", value: "startsAt" },
  { label: "Başlangıç Z-A", value: "-startsAt" },
];

const academicTermSortOptions = [
  { label: "Dönem A-Z", value: "name" },
  { label: "Dönem Z-A", value: "-name" },
  { label: "Başlangıç A-Z", value: "startsAt" },
  { label: "Başlangıç Z-A", value: "-startsAt" },
];

async function loadAcademicYears(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<AcademicYearRecord>(accessToken, buildListUrl(`${apiBaseUrl}/academic-years`, listQuery));
}

async function loadAcademicTerms(accessToken: string, listQuery: ListQueryState) {
  return apiListRequest<AcademicTermRecord>(accessToken, buildListUrl(`${apiBaseUrl}/academic-terms`, listQuery));
}

async function createAcademicYear(accessToken: string, input: AcademicYearFormPayload) {
  return apiRequest<AcademicYearRecord>(accessToken, `${apiBaseUrl}/academic-years`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateAcademicYear(accessToken: string, id: string, input: AcademicYearFormPayload) {
  return apiRequest<AcademicYearRecord>(accessToken, `${apiBaseUrl}/academic-years/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteAcademicYear(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/academic-years/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("ACADEMIC_YEAR_DELETE_FAILED");
  }
}

async function createAcademicTerm(accessToken: string, input: AcademicTermFormPayload) {
  return apiRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateAcademicTerm(accessToken: string, id: string, input: AcademicTermFormPayload) {
  return apiRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

async function deleteAcademicTerm(accessToken: string, id: string) {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/academic-terms/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("ACADEMIC_TERM_DELETE_FAILED");
  }
}

function activeLabel(isActive: boolean) {
  return isActive ? "Aktif" : "Pasif";
}

function activeTone(isActive: boolean): StatusBadgeProps["tone"] {
  return isActive ? "success" : "neutral";
}

function formatAcademicYearSort(value: string) {
  return academicYearSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}

function formatAcademicTermSort(value: string) {
  return academicTermSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}

function formatCount(value: number) {
  return value.toLocaleString("tr-TR");
}
