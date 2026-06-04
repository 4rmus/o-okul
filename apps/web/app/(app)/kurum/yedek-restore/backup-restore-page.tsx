"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState, Input } from "@uzman-hocam/ui";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
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
    title: "Off-host backup hedefi",
    command: "BACKUP_OFFSITE_TARGET=file:///mnt/backups pnpm backup:offsite:smoke",
    status: "Hedef gerekir",
    detail: "Off-host file veya S3 hedefinde yaz/oku/sil döngüsü hash ile doğrulanır.",
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
    onError: () => setError("Yedek restore işi başlatılamadı. Onay metnini ve hedefi kontrol et."),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    createJobMutation.mutate();
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
          { label: "Off-host hedef", value: "Env gerekir" },
          { label: "Drill raporu", value: "Kanıt gerekir" },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: panel yedek ve restore drill işini çift onayla kuyruğa alır."
        reason="Gerçek restore hâlâ yıkıcıdır; bu panel C1 kapsamında yalnız TENANT_ADMIN, audit log ve açık onayla denetlenebilir job başlatır."
        nextStep="Sonraki C1 dilimi worker tarafında gerçek backup/restore drill çıktısını bu job kaydına bağlar."
      />
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
              onChange={(event) => setTargetReference(event.target.value)}
              placeholder={operationType === "BACKUP" ? "file:///mnt/backups/tenant-a" : "file:///path/to/restore-drill.json"}
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
        {jobsQuery.isError ? <p className="next-form-error">Yedek restore işleri alınamadı.</p> : null}
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

function confirmationFor(operationType: BackupRestoreOperationType) {
  return operationType === "BACKUP" ? "YEDEK AL" : "RESTORE DRILL";
}

function operationLabel(operationType: BackupRestoreJobRecord["operationType"]) {
  return operationType === "BACKUP" ? "Yedek alma" : "Restore drill";
}

function statusLabel(status: BackupRestoreJobRecord["status"]) {
  if (status === "queued") return "Kuyrukta";
  if (status === "completed") return "Tamamlandı";
  return "Başarısız";
}
