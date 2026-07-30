"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LearningOutcomeImportDryRunResult, LearningOutcomeImportResult, LearningOutcomeRecord } from "@o-okul/shared-types";
import { Button, CrudPage, EmptyState, Field, FormModal, InfoGrid, InfoItem, Input, type DataTableColumn, useConfirmDialog } from "@o-okul/ui";
import { Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { formatCourseName, formatOutcomeCode, formatOutcomeTitle } from "../../_shared/academic-labels.js";
import {
  firstFormError,
  learningOutcomeFormSchema,
  type LearningOutcomeFormPayload,
  type LearningOutcomeFormState,
} from "../../../../src/form-validation.js";
import { buildListUrl, ListControls, useUrlListState, type ListQueryState } from "../../../../src/list-controls.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const emptyForm: LearningOutcomeFormState = {
  branch: "",
  code: "",
  level: "",
  title: "",
};
const learningOutcomeImportMaxBytes = 5 * 1024 * 1024;
const learningOutcomeImportAllowedExtensions = new Set(["CSV", "XLSX"]);

export function LearningOutcomesPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const [listQuery, setListQuery] = useUrlListState(searchParams, { sortOptions: learningOutcomeSortOptions });
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isImportChecking, setIsImportChecking] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFileBase64, setImportFileBase64] = useState("");
  const [importFileLabel, setImportFileLabel] = useState("");
  const [importDryRun, setImportDryRun] = useState<LearningOutcomeImportDryRunResult | null>(null);
  const [importError, setImportError] = useState("");
  const [error, setError] = useState("");
  const rows = outcomesQuery.data?.data ?? [];
  const listTotal = outcomesQuery.data?.meta?.total ?? rows.length;
  const branchCount = new Set(rows.map((record) => formatCourseName(record.branch))).size;
  const levelCount = rows.filter((record) => Boolean(record.level)).length;
  const codeReadyCount = rows.filter((record) => Boolean(formatOutcomeCode(record.code))).length;
  const outcomeSummaryItems: OperationSummaryItem[] = [
    {
      description: "Optik, sınav ve rapor eşleşmesinde kullanılan katalog",
      key: "total",
      label: "Kazanım toplamı",
      value: formatCount(listTotal),
    },
    {
      description: "Katalogda temsil edilen branş sayısı",
      key: "branch",
      label: "Branş kapsamı",
      tone: branchCount > 0 ? "info" : "default",
      value: formatCount(branchCount),
    },
    {
      description: "Seviye etiketi bulunan kazanımlar",
      key: "level",
      label: "Seviye kapsamı",
      tone: levelCount === rows.length && rows.length > 0 ? "success" : "info",
      value: `${formatCount(levelCount)}/${formatCount(rows.length)}`,
    },
  ];
  const outcomeSummaryBadges: OperationSummaryBadge[] = [
    {
      key: "sort",
      label: `Sıralama: ${formatLearningOutcomeSort(listQuery.sort)}`,
      tone: "neutral",
    },
    {
      key: "report",
      label: "Rapor/optik kataloğu",
      tone: "info",
    },
  ];
  const outcomeSummaryActions: OperationSummaryAction[] = [
    {
      detail: "Kısa kod optik eşleştirme ve hata kitapçığı kırılımında kullanılır",
      key: "code-standard",
      label: "Kod standardı",
      status: codeReadyCount === rows.length && rows.length > 0 ? "Hazır" : "Kontrol",
      tone: codeReadyCount === rows.length && rows.length > 0 ? "success" : "warning",
      value: `${formatCount(codeReadyCount)} kod`,
    },
    {
      detail: "Branş etiketi sınav ve öğretmen raporu filtresini besler",
      key: "branch-coverage",
      label: "Branş dağılımı",
      status: branchCount > 0 ? "İzleniyor" : "Bekliyor",
      tone: branchCount > 0 ? "info" : "neutral",
      value: `${formatCount(branchCount)} branş`,
    },
    {
      detail: "Seviye alanı program ve sınıf hedefleriyle tutarlı okunur",
      key: "level-coverage",
      label: "Seviye etiketi",
      status: levelCount === rows.length && rows.length > 0 ? "Hazır" : "Opsiyonel",
      tone: levelCount === rows.length && rows.length > 0 ? "success" : "neutral",
      value: `${formatCount(levelCount)} etiket`,
    },
  ];

  useEffect(() => {
    if (searchParams.get("new") === "1") openCreateForm();
  }, [searchParams]);

  const columns: Array<DataTableColumn<LearningOutcomeRecord>> = [
    {
      key: "code",
      header: "Kod",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => formatOutcomeCode(record.code),
      sticky: "left",
    },
    {
      key: "branch",
      header: "Branş",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (record) => formatCourseName(record.branch),
    },
    {
      key: "title",
      header: "Kazanım",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => formatOutcomeTitle(record.title),
    },
    {
      key: "level",
      header: "Seviye",
      mobilePriority: "hidden",
      priority: "optional",
      render: (record) => record.level ?? "-",
    },
    {
      key: "actions",
      align: "center",
      header: "İşlem",
      mobilePriority: "primary",
      priority: "primary",
      render: (record) => (
        <span className="next-row-actions">
          <Button size="icon" variant="ghost" type="button" onClick={() => openEditForm(record)} aria-label={`${formatOutcomeCode(record.code)} düzenle`}>
            <Pencil size={17} aria-hidden="true" />
          </Button>
          <Button size="icon" variant="ghost" type="button" onClick={() => void handleDelete(record)} aria-label={`${formatOutcomeCode(record.code)} sil`}>
            <Trash2 size={17} aria-hidden="true" />
          </Button>
        </span>
      ),
      sticky: "right",
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
      branch: formatCourseName(record.branch),
      code: formatOutcomeCode(record.code),
      level: record.level ?? "",
      title: formatOutcomeTitle(record.title),
    });
    setError("");
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setIsSubmitting(false);
    setEditingOutcome(null);
    setForm(emptyForm);
  }

  function openImportModal() {
    setIsImportOpen(true);
    setImportError("");
    setImportFileBase64("");
    setImportFileLabel("");
    setImportDryRun(null);
  }

  function closeImportModal() {
    setIsImportOpen(false);
    setIsImportChecking(false);
    setIsImporting(false);
    setImportError("");
    setImportFileBase64("");
    setImportFileLabel("");
    setImportDryRun(null);
  }

  async function handleLearningOutcomeImportFile(file: File | undefined) {
    setImportFileBase64("");
    setImportFileLabel("");
    setImportDryRun(null);
    setImportError("");
    if (!auth || !file) return;

    const extension = inferLearningOutcomeImportExtension(file);
    if (!extension || !learningOutcomeImportAllowedExtensions.has(extension)) {
      setImportError("CSV veya XLSX dosyası seçin.");
      return;
    }
    if (file.size <= 0) {
      setImportError("Dosya boş görünüyor.");
      return;
    }
    if (file.size > learningOutcomeImportMaxBytes) {
      setImportError(`Dosya en fazla ${formatByteSize(learningOutcomeImportMaxBytes)} olabilir.`);
      return;
    }

    setIsImportChecking(true);
    try {
      const fileBase64 = await readFileAsBase64(file);
      const dryRun = await dryRunLearningOutcomeImport(auth.accessToken, fileBase64);
      setImportFileBase64(fileBase64);
      setImportFileLabel(`${extension} • ${formatByteSize(file.size)}`);
      setImportDryRun(dryRun);
    } catch {
      setImportError("Dosya kontrol edilemedi. Kod, branş ve başlık alanlarını kontrol edin.");
    } finally {
      setIsImportChecking(false);
    }
  }

  async function handleCommitLearningOutcomeImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || isImporting) return;
    if (!importFileBase64 || !importDryRun) {
      setImportError("Önce aktarım dosyası seçin.");
      return;
    }
    if (!importDryRun.wouldImport) {
      setImportError("Hatalar giderilmeden aktarım başlatılamaz.");
      return;
    }

    setImportError("");
    setIsImporting(true);
    try {
      await commitLearningOutcomeImport(auth.accessToken, importFileBase64);
      void queryClient.invalidateQueries({ queryKey: listQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["next-setup-progress", tenantId] });
      closeImportModal();
    } catch {
      setImportError("Aktarım tamamlanamadı. Tekrar eden kodları ve zorunlu alanları kontrol edin.");
    } finally {
      setIsImporting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || isSubmitting) return;

    setError("");
    const parsedForm = learningOutcomeFormSchema.safeParse(form);
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }

    setIsSubmitting(true);
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
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(record: LearningOutcomeRecord) {
    if (!auth) return;
    const confirmed = await confirm({
      confirmLabel: "Sil",
      message: `${formatOutcomeCode(record.code)} kazanımı silinsin mi?`,
      title: "Kazanımı sil",
    });
    if (!confirmed) return;

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
            <Button type="button" variant="secondary" onClick={openImportModal}>
              <Upload size={17} aria-hidden="true" />
              Excel ile aktar
            </Button>
            <Button onClick={openCreateForm}>
              <Plus size={17} aria-hidden="true" />
              Kazanım ekle
            </Button>
          </>
        }
        aria-label="Kazanım yönetimi"
        columns={columns}
        density="compact"
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
        summary={
          <OperationSummary
            actions={outcomeSummaryActions}
            ariaLabel="Kazanım operasyon özeti"
            badges={outcomeSummaryBadges}
            items={outcomeSummaryItems}
          />
        }
        tableCaption="Kazanım katalog listesi"
        tableDescription="Kazanım kodu, branş, kazanım adı ve seviye bilgisi."
        title="Kazanımlar"
      />
      <FormModal
        description="CSV veya XLSX dosyası seçildiğinde önce dry-run yapılır; hata yoksa aktarım tamamlanır."
        onCancel={closeImportModal}
        onSubmit={(event) => void handleCommitLearningOutcomeImport(event)}
        open={isImportOpen}
        submitLabel={isImporting ? "Aktarılıyor…" : "Aktar"}
        title="Kazanım Excel aktar"
      >
        <Field
          label="Aktarım dosyası"
          description={importFileLabel || `CSV/XLSX • en fazla ${formatByteSize(learningOutcomeImportMaxBytes)}`}
        >
          <Input
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              void handleLearningOutcomeImportFile(file);
              event.currentTarget.value = "";
            }}
          />
        </Field>
        <a className="uh-button uh-button--secondary uh-button--md" href="/templates/kazanim-aktarim-sablonu.xlsx" download>
          Kazanım XLSX şablonu
        </a>
        {isImportChecking ? <span className="next-field-hint">Kontrol ediliyor…</span> : null}
        {importDryRun ? (
          <InfoGrid>
            <InfoItem label="Satır" value={formatCount(importDryRun.totalRows)} />
            <InfoItem label="Geçerli" value={formatCount(importDryRun.validRows.length)} />
            <InfoItem label="Güncellenecek" value={formatCount(importDryRun.validRows.filter((row) => row.willUpdate).length)} />
            <InfoItem label="Hata" value={formatCount(importDryRun.errors.length)} />
          </InfoGrid>
        ) : null}
        {importDryRun && importDryRun.errors.length > 0 ? (
          <div className="next-form-guardians">
            <span className="next-field-hint">İlk hatalar</span>
            <ul>
              {importDryRun.errors.slice(0, 5).map((item, index) => (
                <li key={`${item.row}-${item.field}-${item.code}-${index}`}>{formatLearningOutcomeImportError(item)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {importError ? <p className="uh-crud-page__error">{importError}</p> : null}
      </FormModal>
      <FormModal
        description="Kod, branş ve kazanım adı zorunludur."
        onCancel={closeForm}
        onSubmit={(event) => void handleSubmit(event)}
        open={isFormOpen}
        submitError={error || undefined}
        submitLabel={editingOutcome ? "Kaydet" : "Ekle"}
        submitting={isSubmitting}
        title={editingOutcome ? "Kazanım düzenle" : "Kazanım ekle"}
      >
        <Field label="Kazanım kodu">
          <Input
            required
            value={form.code}
            onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
          />
        </Field>
        <Field label="Branş">
          <Input
            required
            value={form.branch}
            onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))}
          />
        </Field>
        <Field label="Kazanım adı">
          <Input
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
        </Field>
        <Field label="Seviye">
          <Input
            value={form.level ?? ""}
            onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))}
          />
        </Field>
      </FormModal>
      {confirmationDialog}
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

async function dryRunLearningOutcomeImport(accessToken: string, fileBase64: string) {
  return apiRequest<LearningOutcomeImportDryRunResult>(accessToken, `${apiBaseUrl}/learning-outcomes/imports/dry-run`, {
    body: JSON.stringify({ fileBase64 }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function commitLearningOutcomeImport(accessToken: string, fileBase64: string) {
  return apiRequest<LearningOutcomeImportResult>(accessToken, `${apiBaseUrl}/learning-outcomes/imports`, {
    body: JSON.stringify({ fileBase64 }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function formatLearningOutcomeSort(value: string) {
  return learningOutcomeSortOptions.find((option) => option.value === value)?.label ?? "Varsayılan";
}

function formatByteSize(byteSize: number) {
  if (byteSize >= 1024 * 1024) {
    return `${(byteSize / (1024 * 1024)).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(byteSize / 1024)).toLocaleString("tr-TR")} KB`;
}

function inferLearningOutcomeImportExtension(file: File): "CSV" | "XLSX" | undefined {
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLocaleUpperCase("tr-TR");
  if (extension === "CSV" || extension === "XLSX") return extension;
  if (file.type === "text/csv" || file.type === "text/plain") return "CSV";
  if (file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "XLSX";
  return undefined;
}

function formatLearningOutcomeImportError(error: LearningOutcomeImportDryRunResult["errors"][number]) {
  const row = `${error.row}. satır`;
  if (error.code === "REQUIRED") return `${row}: ${learningOutcomeImportFieldLabel(error.field)} zorunlu`;
  if (error.code === "DUPLICATE_CODE") return `${row}: kod tekrar ediyor (${error.value ?? "-"})`;
  return `${row}: dosya satırı kontrol edilmeli`;
}

function learningOutcomeImportFieldLabel(field: LearningOutcomeImportDryRunResult["errors"][number]["field"]) {
  const labels: Record<LearningOutcomeImportDryRunResult["errors"][number]["field"], string> = {
    branch: "branş",
    code: "kod",
    title: "başlık",
  };
  return labels[field];
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1] ?? "" : result);
    };
    reader.readAsDataURL(file);
  });
}
