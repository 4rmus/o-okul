"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AcademicTermRecord, AcademicYearRecord } from "@uzman-hocam/shared-types";
import { Button, CrudPage, EmptyState, FormModal, Input, type DataTableColumn } from "@uzman-hocam/ui";
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
import { buildListUrl, initialListQuery, ListControls, type ListQueryState } from "../../../../src/list-controls.js";

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
  const queryClient = useQueryClient();
  const [yearListQuery, setYearListQuery] = useState<ListQueryState>(initialListQuery);
  const [termListQuery, setTermListQuery] = useState<ListQueryState>(initialListQuery);
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
  const [editingYear, setEditingYear] = useState<AcademicYearRecord | null>(null);
  const [editingTerm, setEditingTerm] = useState<AcademicTermRecord | null>(null);
  const [yearForm, setYearForm] = useState<AcademicYearFormState>(emptyYearForm);
  const [termForm, setTermForm] = useState<AcademicTermFormState>(emptyTermForm);
  const [isYearFormOpen, setIsYearFormOpen] = useState(false);
  const [isTermFormOpen, setIsTermFormOpen] = useState(false);
  const [error, setError] = useState("");

  const yearColumns: Array<DataTableColumn<AcademicYearRecord>> = [
    { key: "name", header: "Akademik yıl", render: (record) => record.name },
    { key: "startsAt", header: "Başlangıç", render: (record) => record.startsAt },
    { key: "endsAt", header: "Bitiş", render: (record) => record.endsAt },
    { key: "isActive", header: "Durum", render: (record) => activeLabel(record.isActive) },
    {
      key: "actions",
      header: "İşlem",
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
    { key: "name", header: "Dönem", render: (record) => record.name },
    { key: "academicYearId", header: "Akademik yıl", render: (record) => yearNames.get(record.academicYearId) ?? record.academicYearId },
    { key: "startsAt", header: "Başlangıç", render: (record) => record.startsAt },
    { key: "endsAt", header: "Bitiş", render: (record) => record.endsAt },
    { key: "isActive", header: "Durum", render: (record) => activeLabel(record.isActive) },
    {
      key: "actions",
      header: "İşlem",
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
    if (!window.confirm(`${record.name} akademik yılı silinsin mi?`)) return;

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
    if (!window.confirm(`${record.name} dönemi silinsin mi?`)) return;

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
            <Button onClick={openTermCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Dönem ekle
            </Button>
          </>
        }
        aria-label="Akademik dönem yönetimi"
        columns={termColumns}
        description="Akademik yıllara bağlı dönemleri yönet."
        emptyState={
          <EmptyState
            title="Dönem yok"
            description="Akademik yıl oluşturduktan sonra ilk dönemi ekle."
            hint="Dönemler ders programı, not ve rapor akışlarını bağlar."
            primaryAction={{ label: "Dönem ekle", onClick: openTermCreateForm }}
          />
        }
        emptyText="Dönem kaydı yok"
        error={termsQuery.isError ? "Akademik dönemler alınamadı." : undefined}
        getRowKey={(record) => record.id}
        loading={termsQuery.isPending}
        rows={terms}
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
        <label>
          Akademik yıl adı
          <Input
            required
            value={yearForm.name}
            onChange={(event) => setYearForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label>
          Başlangıç
          <Input
            required
            type="date"
            value={yearForm.startsAt}
            onChange={(event) => setYearForm((current) => ({ ...current, startsAt: event.target.value }))}
          />
        </label>
        <label>
          Bitiş
          <Input
            required
            type="date"
            value={yearForm.endsAt}
            onChange={(event) => setYearForm((current) => ({ ...current, endsAt: event.target.value }))}
          />
        </label>
        <label>
          <input
            checked={yearForm.isActive}
            type="checkbox"
            onChange={(event) => setYearForm((current) => ({ ...current, isActive: event.target.checked }))}
          />
          Aktif
        </label>
      </FormModal>
      <FormModal
        description="Dönem adı, akademik yıl ve tarih aralığı zorunludur."
        onCancel={closeTermForm}
        onSubmit={(event) => void handleTermSubmit(event)}
        open={isTermFormOpen}
        submitLabel={editingTerm ? "Kaydet" : "Ekle"}
        title={editingTerm ? "Dönem düzenle" : "Dönem ekle"}
      >
        <label>
          Akademik yıl
          <select
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
          </select>
        </label>
        <label>
          Dönem adı
          <Input
            required
            value={termForm.name}
            onChange={(event) => setTermForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label>
          Başlangıç
          <Input
            required
            type="date"
            value={termForm.startsAt}
            onChange={(event) => setTermForm((current) => ({ ...current, startsAt: event.target.value }))}
          />
        </label>
        <label>
          Bitiş
          <Input
            required
            type="date"
            value={termForm.endsAt}
            onChange={(event) => setTermForm((current) => ({ ...current, endsAt: event.target.value }))}
          />
        </label>
        <label>
          <input
            checked={termForm.isActive}
            type="checkbox"
            onChange={(event) => setTermForm((current) => ({ ...current, isActive: event.target.checked }))}
          />
          Aktif
        </label>
      </FormModal>
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
