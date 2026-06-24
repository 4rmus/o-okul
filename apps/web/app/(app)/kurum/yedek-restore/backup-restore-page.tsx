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
    title: "Lokal restore smoke",
    command: "pnpm backup:restore:smoke",
    status: "Repo kapısı",
    detail: "Dump alınır, geçici veritabanına restore edilir ve kritik tablolar okunur.",
  },
  {
    title: "Kurum veri export",
    command: "GET /api/v1/backup-restore-jobs/tenant-export",
    status: "Panel indirir",
    detail: "Kurumun kendi eklediği kayıtlar JSON olarak kullanıcının bilgisayarına indirilir.",
  },
  {
    title: "Teknik off-host backup smoke",
    command: "BACKUP_OFFSITE_TARGET=s3://o-okul-prod-backups/tenant-a pnpm backup:offsite:smoke",
    status: "Ops hedefi gerekir",
    detail: "Ops ortamında file veya S3 hedefinde yaz/oku/sil döngüsü hash ile doğrulanır.",
  },
  {
    title: "WAL arşiv hedefi",
    command: "WAL_ARCHIVE_TARGET=file:///mnt/wal pnpm wal:archive:smoke",
    status: "Hedef gerekir",
    detail: "PITR için WAL arşiv hedefinin erişilebilirliği yaz/oku/sil smoke ile kanıtlanır.",
  },
  {
    title: "Restore drill kanıtı",
    command: "RESTORE_DRILL_TARGET=file://$PWD/docs/evidence-templates/restore-drill.example.json pnpm restore:drill:check",
    status: "Kanıt raporu gerekir",
    detail: "Staging veya production restore denemesi JSON raporuyla doğrulanır.",
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
}

interface BackupRestoreEvidenceRow {
  detail: string;
  key: string;
  label: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

export function BackupRestorePage() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const [operationType, setOperationType] = useState<BackupRestoreOperationType>("RESTORE_DRILL");
  const [targetReference, setTargetReference] = useState("");
  const [reason, setReason] = useState("Aylık restore kanıtı");
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
    "Restore drill JSON raporunda staging/prod bağlamıyla doğrulanır.",
    "warning",
  );
  const criticalTableRows = buildBackupRestoreEvidenceRows(
    requiredTables,
    "Restore smoke",
    "Geçici restore veritabanında tablo varlığı ve sayımı okunur.",
    "info",
  );
  const createJobMutation = useMutation({
    mutationFn: () =>
      createBackupRestoreJob(auth?.accessToken ?? "", {
        confirmationText,
        operationType,
        reason,
        targetReference,
      }),
    onSuccess: () => {
      setConfirmationText("");
      setError("");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (jobError) => setError(apiErrorMessage(jobError, "Yedek restore işi başlatılamadı. Onay metnini ve hedefi kontrol et.")),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetError = validateTargetReference(operationType, targetReference);
    if (targetError) {
      setError(targetError);
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
      title="Yedek / Restore"
      subtitle="Canlıya çıkmadan önce backup, restore ve PITR kanıt kapılarını izle."
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="Yedek restore operasyon özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Yedek restore güven durumu"
        title="Yedek Kanıt Gücü"
        description="Panel kullanıcıya kurum export'u ve korumalı iş takibi verir; restore drill PASS ve off-host/PITR doğrulaması ayrı ops kanıtıdır."
        items={[
          {
            label: "Panel export",
            value: "Kullanıcı yedeği",
            tone: "success",
            scope: "configured-api",
            detail: "Kurum verisi JSON olarak indirilir; server-side restore kanıtı yerine geçmez.",
          },
          {
            label: "İş geçmişi",
            value: "Maskeli",
            tone: "info",
            scope: "ui-safe",
            detail: "Hedef path, bucket ve kuyruk id ekran görüntülerinde ham gösterilmez.",
          },
          {
            label: "Ops kanıtı",
            value: "Staging/prod",
            tone: "warning",
            scope: "staging-prod",
            detail: "Restore drill, off-host backup ve WAL smoke kanıtları ayrıca tamamlanır.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: kurum kullanıcısı kendi eklediği veriyi bilgisayarına JSON yedek olarak indirir."
        reason="Bu ilk model dış provider veya S3 şartı koymadan kurum verisinin sunucu dışına alınmasını sağlar; teknik backup/restore işleri ayrı kalır."
        nextStep="Worker sonucu bu job kaydına PASS/failed olarak bağlar; restore drill hâlâ ops kanıtıdır ve teknik iş tetikleme yalnız çift onay ve audit log ile kullanılır."
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
        aria-label="Panel restore drill işi"
        className="next-backup-job-panel"
        description="Teknik yedek ve restore drill işleri hedef doğrulama, onay metni ve audit iziyle başlatılır."
        title="Panel İş Tetikleme"
        onSubmit={handleSubmit}
      >
        <Field label="İş tipi">
          <Select
            value={operationType}
            onChange={(event) => {
              const nextOperationType = event.target.value as BackupRestoreOperationType;
              setOperationType(nextOperationType);
              setReason(nextOperationType === "BACKUP" ? "Panelden korumalı yedek alma" : "Aylık restore kanıtı");
              setConfirmationText("");
            }}
          >
            <option value="RESTORE_DRILL">Restore drill</option>
            <option value="BACKUP">Yedek alma</option>
          </Select>
        </Field>
        <Field label={operationType === "BACKUP" ? "Yedek hedefi" : "Restore kanıt dosyası"}>
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
            placeholder={confirmationFor(operationType)}
          />
        </Field>
        {error ? <p className="next-form-error">{error}</p> : null}
        <Button disabled={createJobMutation.isPending} type="submit">
          {operationType === "BACKUP" ? "Yedek alma işi başlat" : "Restore drill işi başlat"}
        </Button>
      </Panel>
      <Panel
        aria-label="Yedek restore işleri"
        description="Son panel işleri maskeli hedef ve maskeli kuyruk referansıyla listelenir."
        title="Son İşler"
      >
        <DataTable
          caption="Yedek restore işleri"
          columns={backupRestoreJobColumns}
          density="compact"
          description="Yedek alma ve restore drill işlerinin PII güvenli operasyon durumu."
          emptyText={
            <EmptyState
              title="Henüz panelden başlatılmış iş yok."
              description="Çift onayla yedek alma veya restore drill işi başlatınca son durum burada görünür."
            />
          }
          error={jobsQuery.isError ? apiErrorMessage(jobsQuery.error, "Yedek restore işleri alınamadı.") : undefined}
          getRowKey={(row) => row.id}
          loading={jobsQuery.isPending}
          rows={jobRows}
        />
      </Panel>
      <Panel
        aria-label="Yedek restore kapıları"
        description="Panel export, restore smoke, off-host backup, WAL ve restore drill release kapıları."
        title="Kanıt Kapıları"
      >
        <DataTable
          caption="Yedek restore kanıt kapıları"
          columns={backupRestoreEvidenceColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={gateRows}
        />
      </Panel>
      <Panel
        aria-label="Restore drill raporu"
        description="Restore drill PASS çıktısında bulunması gereken zorunlu evidence alanları."
        title="Restore Drill Raporu"
      >
        <DataTable
          caption="Restore drill rapor alanları"
          columns={backupRestoreEvidenceColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={restoreEvidenceRows}
        />
      </Panel>
      <Panel
        aria-label="Kritik restore tabloları"
        description="Restore smoke sonrası okunması gereken kritik tenant, audit, rapor ve migration tabloları."
        title="Kritik Tablolar"
      >
        <DataTable
          caption="Kritik restore tabloları"
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
    render: (row) => row.label,
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
      description: "Panelden tenant export endpointi",
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
      description: "Staging/prod restore drill evidence",
      key: "restore-drill",
      label: "Drill raporu",
      tone: "warning",
      value: "Kanıt gerekir",
    },
    {
      description: "Off-host backup ve WAL hedefi",
      key: "ops-evidence",
      label: "Ops kanıtı",
      tone: "warning",
      value: "Ayrı kapı",
    },
  ];
}

function buildBackupRestoreSummaryBadges(jobs: BackupRestoreJobRecord[]): OperationSummaryBadge[] {
  return [
    {
      key: "export",
      label: "tenant-export-v1",
      tone: "success",
    },
    {
      key: "masking",
      label: "PII maskeli",
      tone: "info",
    },
    {
      key: "jobs",
      label: `${jobs.length} panel işi`,
      tone: jobs.length > 0 ? "info" : "neutral",
    },
    {
      key: "release",
      label: "Release kanıtı ayrı",
      tone: "warning",
    },
  ];
}

function buildBackupRestoreSummaryActions(jobs: BackupRestoreJobRecord[]): OperationSummaryAction[] {
  return [
    {
      detail: "GET /api/v1/backup-restore-jobs/tenant-export",
      key: "tenant-export",
      label: "Kurum veri export",
      status: "Panel indirir",
      tone: "success",
      value: "JSON yedek",
    },
    {
      detail: "Hedef doğrulama, onay metni ve audit izi gerekir",
      key: "protected-job",
      label: "Korumalı iş",
      status: "Çift onay",
      tone: "warning",
      value: "Backup / drill",
    },
    {
      detail: "Off-host, WAL ve restore drill evidence release kapısında tamamlanır",
      key: "release-evidence",
      label: "Release kanıtı",
      status: "Staging/prod",
      tone: "warning",
      value: "Ayrı kapı",
    },
  ];
}

function buildBackupRestoreJobRows(jobs: BackupRestoreJobRecord[]): BackupRestoreJobRow[] {
  return jobs.map((job) => ({
    checkedTables: job.checkedTables.length > 0 ? job.checkedTables.join(", ") : "-",
    evidence: job.errorCode ? job.errorCode : job.result ?? "-",
    id: job.id,
    operation: operationLabel(job.operationType),
    reason: job.reason ?? "-",
    status: statusLabel(job.status),
    statusTone: statusTone(job.status),
    target: maskTargetReference(job.targetReference),
  }));
}

function buildBackupRestoreGateRows(): BackupRestoreEvidenceRow[] {
  return backupGates.map((gate) => ({
    detail: `${gate.detail} ${gate.command}`,
    key: gate.title,
    label: gate.title,
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
    label: item,
    tone,
    value,
  }));
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

function confirmationFor(operationType: BackupRestoreOperationType) {
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
      : "Restore kanıt dosyası file:// artifact yolu olmalı.";
  }

  if (operationType === "BACKUP") {
    if (url.protocol === "s3:") {
      const prefix = url.pathname.replace(/^\/+|\/+$/g, "");
      return url.hostname && prefix ? "" : "Yedek S3 hedefi bucket ve prefix içermeli.";
    }
    if (url.protocol !== "file:") return "Yedek hedefi s3://bucket/prefix veya kalıcı file:// dizin olmalı.";
    return isLocalTempOrRootFileUrl(url) ? "Yedek file:// hedefi root, /tmp veya /var/tmp altında olamaz." : "";
  }

  if (url.protocol !== "file:") return "Restore kanıt dosyası file:// artifact yolu olmalı.";
  return isLocalTempFileUrl(url) ? "Restore kanıt dosyası /tmp veya /var/tmp altında olamaz." : "";
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
  return operationType === "BACKUP" ? "Yedek alma" : "Restore drill";
}

function statusLabel(status: BackupRestoreJobRecord["status"]) {
  if (status === "queued") return "Kuyrukta";
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
