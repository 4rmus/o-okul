"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Input } from "@uzman-hocam/ui";
import { apiBaseUrl, apiErrorMessage, apiRequest, authenticatedFetch } from "../../../../src/api-client.js";
import { useAuth } from "../../../providers.js";
import { EvidenceGateSection, EvidenceListSection, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

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
    command: "BACKUP_OFFSITE_TARGET=file:///mnt/backups pnpm backup:offsite:smoke",
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
      <MetricPanelGrid
        ariaLabel="Yedek restore özeti"
        metrics={[
          { label: "Restore smoke", value: "Hazır" },
          { label: "Kurum yedeği", value: "İndirilebilir" },
          { label: "Drill raporu", value: "Kanıt gerekir" },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: kurum kullanıcısı kendi eklediği veriyi bilgisayarına JSON yedek olarak indirir."
        reason="Bu ilk model dış provider veya S3 şartı koymadan kurum verisinin sunucu dışına alınmasını sağlar; teknik backup/restore işleri ayrı kalır."
        nextStep="Worker sonucu bu job kaydına PASS/failed olarak bağlar; restore drill hâlâ ops kanıtıdır ve teknik iş tetikleme yalnız çift onay ve audit log ile kullanılır."
      />
      <section className="next-report-list" aria-label="Kurum veri yedeği">
        <h2>Kurum Veri Yedeği</h2>
        <p>Öğrenci, veli, öğretmen, sınıf, finans, sınav, rapor, duyuru ve destek kayıtlarını JSON dosyası olarak indir.</p>
        {exportError ? <p className="next-form-error">{exportError}</p> : null}
        <Button disabled={exportPending || !auth} type="button" onClick={handleTenantExportDownload}>
          {exportPending ? "Yedek hazırlanıyor" : "Kurum verisini indir"}
        </Button>
      </section>
      <section className="next-report-list" aria-label="Panel restore drill işi">
        <h2>Panel İş Tetikleme</h2>
        <form onSubmit={handleSubmit}>
          <label>
            İş tipi
            <select
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
            </select>
          </label>
          <label>
            {operationType === "BACKUP" ? "Yedek hedefi" : "Restore kanıt dosyası"}
            <Input
              required
              value={targetReference}
              onChange={(event) => {
                setTargetReference(event.target.value);
                setError("");
              }}
              placeholder={operationType === "BACKUP" ? "s3://uzman-hocam-prod-backups/tenant-a" : "file:///mnt/restore-drills/restore-drill.json"}
            />
          </label>
          <label>
            Gerekçe
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <label>
            Onay metni
            <Input
              required
              value={confirmationText}
              onChange={(event) => setConfirmationText(event.target.value)}
              placeholder={confirmationFor(operationType)}
            />
          </label>
          {error ? <p className="next-form-error">{error}</p> : null}
          <Button disabled={createJobMutation.isPending} type="submit">
            {operationType === "BACKUP" ? "Yedek alma işi başlat" : "Restore drill işi başlat"}
          </Button>
        </form>
      </section>
      <section className="next-report-list" aria-label="Yedek restore işleri">
        <h2>Son İşler</h2>
        {jobsQuery.isError ? <p className="next-form-error">{apiErrorMessage(jobsQuery.error, "Yedek restore işleri alınamadı.")}</p> : null}
        {jobs.length === 0 ? (
          <EmptyState
            title="Henüz panelden başlatılmış iş yok."
            description="Çift onayla yedek alma veya restore drill işi başlatınca son durum burada görünür."
          />
        ) : null}
        {jobs.map((job) => (
          <article key={job.id}>
            <h3>{operationLabel(job.operationType)}</h3>
            <p>{statusLabel(job.status)}</p>
            <p>{job.targetReference}</p>
            <p>{job.reason ?? "-"}</p>
            {job.result ? <p>{job.result}</p> : null}
            {job.checkedTables.length > 0 ? <p>{job.checkedTables.join(", ")}</p> : null}
            {job.errorCode ? <p>{job.errorCode}</p> : null}
            <code>{job.jobId}</code>
          </article>
        ))}
      </section>
      <EvidenceGateSection title="Kanıt Kapıları" ariaLabel="Yedek restore kapıları" gates={backupGates} />
      <EvidenceListSection title="Restore Drill Raporu" ariaLabel="Restore drill raporu" items={restoreEvidenceFields} />
      <EvidenceListSection title="Kritik Tablolar" ariaLabel="Kritik restore tabloları" items={requiredTables} />
    </PageFrame>
  );
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
  link.download = readContentDispositionFileName(response.headers.get("content-disposition")) ?? `uzman-hocam-kurum-yedegi-${new Date().toISOString().slice(0, 10)}.json`;
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
