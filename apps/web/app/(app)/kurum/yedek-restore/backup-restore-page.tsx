"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DataTable, EmptyState, Field, Input, Panel, Select, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { apiBaseUrl, apiErrorMessage, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { useAuth } from "../../../providers.js";
import { EvidenceTrustPanel, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const backupGates = [
  {
    title: "Yerel geri yükleme kontrolü",
    command: "pnpm backup:restore:smoke",
    status: "Yerel kontrol",
    detail: "Veritabanı dökümü alınır, geçici veritabanına geri yüklenir ve kritik tablolar okunur.",
  },
  {
    title: "Kurum verisini dışa aktarma",
    command: "GET /api/v1/backup-restore-jobs/tenant-export",
    status: "Ekrandan indirilir",
    detail: "Kurumun kendi eklediği kayıtlar JSON olarak kullanıcının bilgisayarına indirilir.",
  },
  {
    title: "Sunucu dışı yedekleme kontrolü",
    command: "BACKUP_OFFSITE_TARGET=s3://o-okul-prod-backups/tenant-a pnpm backup:offsite:smoke",
    status: "Yedek hedefi gerekir",
    detail: "Operasyon ortamında dosya veya S3 hedefindeki yazma, okuma ve silme döngüsü özet değeriyle doğrulanır.",
  },
  {
    title: "Veritabanı işlem geçmişi arşivi",
    command: "WAL_ARCHIVE_TARGET=file:///mnt/wal pnpm wal:archive:smoke",
    status: "Hedef gerekir",
    detail: "Belirli bir zamana dönüş için işlem geçmişi arşivinin erişilebilirliği yazma, okuma ve silme kontrolüyle doğrulanır.",
  },
  {
    title: "Geri yükleme tatbikatı kanıtı",
    command: "RESTORE_DRILL_TARGET=file://$PWD/docs/evidence-templates/restore-drill.example.json pnpm restore:drill:check",
    status: "Kanıt raporu gerekir",
    detail: "Deneme veya canlı ortam geri yükleme tatbikatı JSON raporuyla doğrulanır.",
  },
] as const;

const requiredTables = ["Tenant", "AuditLog", "ReportSnapshot", "_prisma_migrations"];

const restoreEvidenceFields = [
  "result = PASS",
  "environment = staging veya production",
  "drillDate",
  "sourceBackup",
  "targetDatabase",
  "tableCounts",
  "errors boş",
];

type BackupRestoreOperationType = "BACKUP" | "RESTORE_DRILL";

interface BackupRestoreJobRecord {
  id: string;
  operationType: BackupRestoreOperationType;
  targetReference: string;
  reason?: string;
  jobId: string;
  status: "queued" | "completed" | "failed";
  result?: "PASS";
  checkedTables: string[];
  errorCode?: string;
  createdAt: string;
}

interface BackupRestoreJobRow {
  checkedTables: string;
  evidence: string;
  id: string;
  operation: string;
  reason: string;
  status: string;
  statusTone: StatusBadgeProps["tone"];
  target: string;
  technicalReference?: string;
}

interface BackupRestoreEvidenceRow {
  detail: string;
  key: string;
  label: string;
  technicalReference?: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

export function BackupRestorePage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [operationType, setOperationType] = useState<BackupRestoreOperationType>("RESTORE_DRILL");
  const [targetReference, setTargetReference] = useState("");
  const [reason, setReason] = useState("Aylık geri yükleme kanıtı");
  const [confirmationText, setConfirmationText] = useState("");
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exportPending, setExportPending] = useState(false);
  const queryKey = ["next-backup-restore-jobs", auth?.session.tenantId ?? "anonymous"];
  const jobsQuery = useQuery({
    queryKey,
    queryFn: () => loadBackupRestoreJobs(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const jobs = jobsQuery.data ?? [];
  const summaryItems = buildBackupRestoreSummaryItems(jobs, jobsQuery.isPending);
  const summaryBadges = buildBackupRestoreSummaryBadges(jobs);
  const summaryActions = buildBackupRestoreSummaryActions(jobs);
  const jobRows = buildBackupRestoreJobRows(jobs);
  const gateRows = buildBackupRestoreGateRows();
  const restoreEvidenceRows = buildBackupRestoreEvidenceRows(
    restoreEvidenceFields,
    "Zorunlu alan",
    "Geri yükleme tatbikatı JSON raporunda deneme/canlı ortam bağlamıyla doğrulanır.",
    "warning",
  );
  const criticalTableRows = buildBackupRestoreEvidenceRows(
    requiredTables,
    "Geri yükleme kontrolü",
    "Geçici geri yükleme veritabanında tablo varlığı ve sayımı okunur.",
    "info",
  );
  const createJobMutation = useMutation({
    mutationFn: () =>
      createBackupRestoreJob(auth?.accessToken ?? "", {
        confirmationText: confirmationTokenFor(operationType),
        operationType,
        reason,
        targetReference,
      }),
    onSuccess: () => {
      setConfirmationText("");
      setError("");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (jobError) => setError(apiErrorMessage(jobError, "Yedekleme veya geri yükleme işi başlatılamadı. Onay metnini ve hedefi kontrol edin.")),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetError = validateTargetReference(operationType, targetReference);
    if (targetError) {
      setError(targetError);
      return;
    }
    if (confirmationText.trim() !== confirmationDisplayFor(operationType)) {
      setError(`Onay alanına ${confirmationDisplayFor(operationType)} yazın.`);
      return;
    }
    setError("");
    createJobMutation.mutate();
  }

  async function handleTenantExportDownload() {
    if (!auth) return;

    setExportPending(true);
    setExportError("");
    try {
      await downloadTenantExport(auth.accessToken);
    } catch (downloadError) {
      setExportError(apiErrorMessage(downloadError, "Kurum veri yedeği indirilemedi."));
    } finally {
      setExportPending(false);
    }
  }

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Yedekleme ve Geri Yükleme"
      subtitle="Yedekleme, geri yükleme ve belirli bir zamana dönüş kontrollerini tek yerde izleyin."
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="Yedekleme ve geri yükleme operasyon özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Yedekleme ve geri yükleme güven durumu"
        title="Yedekleme Güvence Durumu"
        description="Kurum verisini dışa aktarabilir ve korumalı işlemleri izleyebilirsiniz. Geri yükleme, ayrı konumdaki yedek ve belirli bir zamana dönüş kontrolleri ayrıca doğrulanır."
        items={[
          {
            label: "Ekrandan dışa aktarım",
            value: "Kullanıcı yedeği",
            tone: "success",
            scope: "configured-api",
            detail: "Kurum verisi JSON olarak indirilir; sunucu tarafındaki geri yükleme kanıtının yerine geçmez.",
          },
          {
            label: "İş geçmişi",
            value: "Maskeli",
            tone: "info",
            scope: "ui-safe",
            detail: "Hedef konumu ve hazırlama işlemi kaydı ekran görüntülerinde açık gösterilmez.",
          },
          {
            label: "Operasyon kanıtı",
            value: "Deneme/canlı ortam",
            tone: "warning",
            scope: "staging-prod",
            detail: "Geri yükleme, ayrı konumdaki yedek ve işlem geçmişi kontrolleri ayrıca tamamlanır.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: kurum kullanıcısı kendi eklediği veriyi bilgisayarına JSON yedek olarak indirir."
        reason="Kurum verisi ek bir hizmet zorunluluğu olmadan bilgisayara indirilebilir; sistem yedekleme ve geri yükleme işlemleri ayrı yürütülür."
        nextStep="İşlem sonucu bu kayıtta Başarılı veya Başarısız olarak gösterilir. Geri yükleme tatbikatı yalnız çift onay ve işlem kaydıyla başlatılır."
      />
      <Panel
        actions={
          <Button disabled={exportPending || !auth} type="button" onClick={handleTenantExportDownload}>
            {exportPending ? "Yedek hazırlanıyor" : "Kurum verisini indir"}
          </Button>
        }
        aria-label="Kurum veri yedeği"
        description="Kurumun kendi eklediği operasyon kayıtları sunucu dışına taşınabilir JSON dosyası olarak hazırlanır."
        title="Kurum Veri Yedeği"
      >
        <p>Öğrenci, veli, öğretmen, sınıf, finans, sınav, rapor, duyuru ve destek kayıtlarını JSON dosyası olarak indir.</p>
        {exportError ? <p className="next-form-error">{exportError}</p> : null}
      </Panel>
      <Panel
        as="form"
        aria-label="Panel geri yükleme tatbikatı işi"
        className="next-backup-job-panel"
        description="Yedekleme ve geri yükleme tatbikatı hedef doğrulama, onay metni ve işlem kaydıyla başlatılır."
        title="Korumalı İş Başlatma"
        onSubmit={handleSubmit}
      >
        <Field label="İş tipi">
          <Select
            value={operationType}
            onChange={(event) => {
              const nextOperationType = event.target.value as BackupRestoreOperationType;
              setOperationType(nextOperationType);
              setReason(nextOperationType === "BACKUP" ? "Panelden korumalı yedek alma" : "Aylık geri yükleme kanıtı");
              setConfirmationText("");
            }}
          >
            <option value="RESTORE_DRILL">Geri yükleme tatbikatı</option>
            <option value="BACKUP">Yedek alma</option>
          </Select>
        </Field>
        <Field label={operationType === "BACKUP" ? "Yedek hedefi" : "Geri yükleme kanıt dosyası"}>
          <Input
            required
            value={targetReference}
            onChange={(event) => {
              setTargetReference(event.target.value);
              setError("");
            }}
            placeholder={operationType === "BACKUP" ? "s3://bucket/prefix" : "file:///mnt/restore-drills/restore-drill.json"}
          />
        </Field>
        <Field label="Gerekçe">
          <Input value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        <Field label="Onay metni">
          <Input
            required
            value={confirmationText}
            onChange={(event) => setConfirmationText(event.target.value)}
            placeholder={confirmationDisplayFor(operationType)}
          />
          <p>
            Bu işlem için <strong>{confirmationDisplayFor(operationType)}</strong> ifadesini aynen yazın.
          </p>
        </Field>
        {error ? <p className="next-form-error">{error}</p> : null}
        <Button disabled={createJobMutation.isPending} type="submit">
          {operationType === "BACKUP" ? "Yedek al" : "Geri yüklemeyi dene"}
        </Button>
      </Panel>
      <Panel
        aria-label="Yedekleme ve geri yükleme işleri"
        description="Son panel işleri maskeli hedef ve hazırlama işlemi kaydıyla listelenir."
        title="Son İşler"
      >
        <DataTable
          caption="Yedekleme ve geri yükleme işleri"
          columns={backupRestoreJobColumns}
          density="compact"
          description="Yedek alma ve geri yükleme denemelerinin kişisel bilgileri açık göstermeyen işlem durumu."
          emptyText={
            <EmptyState
              title="Henüz panelden başlatılmış iş yok."
              description="Çift onayla yedekleme veya geri yükleme tatbikatı başlatıldığında son durum burada görünür."
            />
          }
          error={jobsQuery.isError ? apiErrorMessage(jobsQuery.error, "Yedekleme ve geri yükleme işleri alınamadı.") : undefined}
          getRowKey={(row) => row.id}
          loading={jobsQuery.isPending}
          rows={jobRows}
        />
      </Panel>
      <Panel
        aria-label="Yedekleme ve geri yükleme doğrulamaları"
        description="Dışa aktarım, geri yükleme, ayrı konumdaki yedek ve işlem geçmişi kontrolleri."
        title="Doğrulama Adımları"
      >
        <DataTable
          caption="Yedekleme ve geri yükleme kanıtları"
          columns={backupRestoreEvidenceColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={gateRows}
        />
      </Panel>
      <Panel
        aria-label="Geri yükleme tatbikatı raporu"
        description="Başarılı bir geri yükleme tatbikatında bulunması gereken zorunlu doğrulama alanları."
        title="Geri Yükleme Tatbikatı Raporu"
      >
        <DataTable
          caption="Geri yükleme tatbikatı rapor alanları"
          columns={backupRestoreEvidenceColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={restoreEvidenceRows}
        />
      </Panel>
      <Panel
        aria-label="Kritik geri yükleme tabloları"
        description="Geri yükleme kontrolü sonrasında okunması gereken kritik kurum, işlem kaydı, rapor ve şema geçişi tabloları."
        title="Kritik Tablolar"
      >
        <DataTable
          caption="Kritik geri yükleme tabloları"
          columns={backupRestoreEvidenceColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={criticalTableRows}
        />
      </Panel>
    </PageFrame>
  );
}

const backupRestoreJobColumns: Array<DataTableColumn<BackupRestoreJobRow>> = [
  {
    key: "operation",
    header: "İş",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => (
      <span aria-level={3} role="heading">
        {row.operation}
      </span>
    ),
    sticky: "left",
  },
  {
    key: "status",
    header: "Durum",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => <StatusBadge tone={row.statusTone}>{row.status}</StatusBadge>,
  },
  {
    key: "target",
    header: "Hedef",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.target,
  },
  {
    key: "context",
    header: "Bağlam",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.reason,
  },
  {
    key: "evidence",
    header: "Kanıt",
    mobilePriority: "hidden",
    priority: "optional",
    render: (row) => (
      <>
        <span>{row.evidence}</span>
        <br />
        <span>{row.checkedTables}</span>
        {row.technicalReference ? (
          <details>
            <summary>İleri ayrıntılar</summary>
            <code>{row.technicalReference}</code>
          </details>
        ) : null}
      </>
    ),
  },
  {
    key: "reference",
    header: "Referans",
    mobilePriority: "secondary",
    priority: "secondary",
    render: () => <code>{maskJobReference()}</code>,
  },
];

const backupRestoreEvidenceColumns: Array<DataTableColumn<BackupRestoreEvidenceRow>> = [
  {
    key: "item",
    header: "Kanıt",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => (
      <>
        <span>{row.label}</span>
        {row.technicalReference ? (
          <details>
            <summary>İleri ayrıntılar</summary>
            <code>{row.technicalReference}</code>
          </details>
        ) : null}
      </>
    ),
    sticky: "left",
  },
  {
    key: "status",
    header: "Durum",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => <StatusBadge tone={row.tone}>{row.value}</StatusBadge>,
  },
  {
    key: "detail",
    header: "Bağlam",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.detail,
  },
];

function buildBackupRestoreSummaryItems(jobs: BackupRestoreJobRecord[], isLoading: boolean): OperationSummaryItem[] {
  const latestJob = jobs[0];
  return [
    {
      description: "Ekrandaki kurum verisi dışa aktarım bağlantısı",
      key: "tenant-export",
      label: "Kurum yedeği",
      tone: "success",
      value: "İndirilebilir",
    },
    {
      description: "Son panel işi",
      key: "job-history",
      label: "İş geçmişi",
      tone: latestJob ? statusSummaryTone(latestJob.status) : isLoading ? "default" : "info",
      value: isLoading ? "Yükleniyor" : latestJob ? statusLabel(latestJob.status) : "Boş",
    },
    {
      description: "Deneme/canlı ortam geri yükleme tatbikatı kanıtı",
      key: "restore-drill",
      label: "Tatbikat raporu",
      tone: "warning",
      value: "Kanıt gerekir",
    },
    {
      description: "Sunucu dışı yedekleme ve veritabanı işlem geçmişi arşivi",
      key: "ops-evidence",
      label: "Operasyon kanıtı",
      tone: "warning",
      value: "Ayrı kapı",
    },
  ];
}

function buildBackupRestoreSummaryBadges(jobs: BackupRestoreJobRecord[]): OperationSummaryBadge[] {
  return [
    {
      key: "export",
      label: "Kurum verisi dışa aktarımı",
      tone: "success",
    },
    {
      key: "masking",
      label: "Kişisel bilgiler maskeli",
      tone: "info",
    },
    {
      key: "jobs",
      label: `${jobs.length} panel işi`,
      tone: jobs.length > 0 ? "info" : "neutral",
    },
    {
      key: "release",
      label: "Yayın doğrulaması ayrıca yapılır",
      tone: "warning",
    },
  ];
}

function buildBackupRestoreSummaryActions(jobs: BackupRestoreJobRecord[]): OperationSummaryAction[] {
  return [
    {
      detail: "Kurumun eklediği kayıtlar JSON dosyası olarak indirilir",
      key: "tenant-export",
      label: "Kurum verisini dışa aktarma",
      status: "Ekrandan indirilir",
      tone: "success",
      value: "JSON yedek",
    },
    {
      detail: "Hedef doğrulama, onay metni ve işlem kaydı gerekir",
      key: "protected-job",
      label: "Korumalı iş",
      status: "Çift onay",
      tone: "warning",
      value: "Yedekleme / tatbikat",
    },
    {
      detail: "Sunucu dışı yedekleme, veritabanı işlem geçmişi ve geri yükleme tatbikatı kanıtı yayın doğrulamasında tamamlanır",
      key: "release-evidence",
      label: "Yayın doğrulaması",
      status: "Deneme/canlı ortam",
      tone: "warning",
      value: "Ayrı kapı",
    },
  ];
}

function buildBackupRestoreJobRows(jobs: BackupRestoreJobRecord[]): BackupRestoreJobRow[] {
  return jobs.map((job) => ({
    checkedTables: job.checkedTables.length > 0 ? job.checkedTables.map(backupEvidenceLabel).join(", ") : "-",
    evidence: jobEvidenceLabel(job),
    id: job.id,
    operation: operationLabel(job.operationType),
    reason: job.reason ?? "-",
    status: statusLabel(job.status),
    statusTone: statusTone(job.status),
    target: maskTargetReference(job.targetReference),
    technicalReference: job.checkedTables.length > 0 ? job.checkedTables.join(", ") : undefined,
  }));
}

function buildBackupRestoreGateRows(): BackupRestoreEvidenceRow[] {
  return backupGates.map((gate) => ({
    detail: gate.detail,
    key: gate.title,
    label: gate.title,
    technicalReference: gate.command,
    tone: gate.status.includes("gerekir") || gate.status.includes("zorunlu") ? "warning" : "info",
    value: gate.status,
  }));
}

function buildBackupRestoreEvidenceRows(
  items: readonly string[],
  value: string,
  detail: string,
  tone: StatusBadgeProps["tone"],
): BackupRestoreEvidenceRow[] {
  return items.map((item) => ({
    detail,
    key: item,
    label: backupEvidenceLabel(item),
    technicalReference: item,
    tone,
    value,
  }));
}

function backupEvidenceLabel(item: string) {
  const labels: Record<string, string> = {
    "result = PASS": "Sonuç: Başarılı",
    "environment = staging veya production": "Kontrol ortamı: deneme veya canlı",
    drillDate: "Tatbikat tarihi",
    sourceBackup: "Kullanılan yedek",
    targetDatabase: "Kontrol veritabanı",
    tableCounts: "Kontrol edilen kayıt sayıları",
    "errors boş": "Hata kaydı yok",
    Tenant: "Kurum kayıtları",
    AuditLog: "İşlem kayıtları",
    ReportSnapshot: "Rapor sürümleri",
    _prisma_migrations: "Veritabanı güncelleme kayıtları",
  };
  return labels[item] ?? item;
}

function loadBackupRestoreJobs(accessToken: string): Promise<BackupRestoreJobRecord[]> {
  return apiRequest<BackupRestoreJobRecord[]>(accessToken, `${apiBaseUrl}/backup-restore-jobs`);
}

function createBackupRestoreJob(
  accessToken: string,
  input: { confirmationText: string; operationType: BackupRestoreOperationType; reason: string; targetReference: string },
): Promise<BackupRestoreJobRecord> {
  return apiRequest<BackupRestoreJobRecord>(accessToken, `${apiBaseUrl}/backup-restore-jobs`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function downloadTenantExport(accessToken: string): Promise<void> {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/backup-restore-jobs/tenant-export`);
  if (!response.ok) {
    throw new Error("TENANT_EXPORT_DOWNLOAD_FAILED");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = readContentDispositionFileName(response.headers.get("content-disposition")) ?? `o-okul-kurum-yedegi-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function readContentDispositionFileName(value: string | null): string | undefined {
  const match = value?.match(/filename="([^"]+)"/);
  return match?.[1];
}

function confirmationDisplayFor(operationType: BackupRestoreOperationType) {
  return operationType === "BACKUP" ? "YEDEK AL" : "GERİ YÜKLEME TATBİKATI";
}

function confirmationTokenFor(operationType: BackupRestoreOperationType) {
  return operationType === "BACKUP" ? "YEDEK AL" : "RESTORE DRILL";
}

function validateTargetReference(operationType: BackupRestoreOperationType, targetReference: string): string {
  const trimmed = targetReference.trim();
  if (!trimmed) return "Hedef referansı zorunlu.";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return operationType === "BACKUP"
      ? "Yedek hedefi s3://bucket/prefix veya kalıcı file:// dizin olmalı."
      : "Geri yükleme kanıt dosyası kalıcı file:// yolunda olmalı.";
  }

  if (operationType === "BACKUP") {
    if (url.protocol === "s3:") {
      const prefix = url.pathname.replace(/^\/+|\/+$/g, "");
      return url.hostname && prefix ? "" : "Yedek S3 hedefi bucket ve prefix içermeli.";
    }
    if (url.protocol !== "file:") return "Yedek hedefi s3://bucket/prefix veya kalıcı file:// dizin olmalı.";
    return isLocalTempOrRootFileUrl(url) ? "Yedek file:// hedefi root, /tmp veya /var/tmp altında olamaz." : "";
  }

  if (url.protocol !== "file:") return "Geri yükleme kanıt dosyası kalıcı file:// yolunda olmalı.";
  return isLocalTempFileUrl(url) ? "Geri yükleme kanıt dosyası /tmp veya /var/tmp altında olamaz." : "";
}

function isLocalTempOrRootFileUrl(url: URL): boolean {
  const normalizedPath = normalizedFilePath(url);
  return normalizedPath === "/" || isLocalTempPath(normalizedPath);
}

function isLocalTempFileUrl(url: URL): boolean {
  return isLocalTempPath(normalizedFilePath(url));
}

function normalizedFilePath(url: URL): string {
  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    pathname = url.pathname;
  }
  return pathname.replace(/\/+$/g, "") || "/";
}

function isLocalTempPath(path: string): boolean {
  return path === "/tmp" || path.startsWith("/tmp/") || path === "/var/tmp" || path.startsWith("/var/tmp/");
}

function operationLabel(operationType: BackupRestoreJobRecord["operationType"]) {
  return operationType === "BACKUP" ? "Yedekleme" : "Geri yükleme tatbikatı";
}

function jobEvidenceLabel(job: BackupRestoreJobRecord) {
  if (job.errorCode) return "İşlem tamamlanamadı; destek ayrıntılarını kontrol edin.";
  if (job.result === "PASS") return "Başarılı";
  if (job.status === "failed") return "Başarısız";
  return "-";
}

function statusLabel(status: BackupRestoreJobRecord["status"]) {
  if (status === "queued") return "Hazırlanıyor";
  if (status === "completed") return "Tamamlandı";
  return "Başarısız";
}

function statusSummaryTone(status: BackupRestoreJobRecord["status"]): NonNullable<OperationSummaryItem["tone"]> {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

function statusTone(status: BackupRestoreJobRecord["status"]): StatusBadgeProps["tone"] {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

function maskTargetReference(targetReference: string) {
  const trimmed = targetReference.trim();
  if (trimmed.startsWith("s3://")) return "s3://<redacted>";
  if (trimmed.startsWith("file://")) return "file://<redacted>";
  return "Hedef maskeli";
}

function maskJobReference() {
  return "İş referansı maskeli";
}
