"use client";

import { EvidenceGateSection, EvidenceListSection } from "../_shared/evidence-panels.js";
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

export function BackupRestorePage() {
  return (
    <PageFrame title="Yedek / Restore" subtitle="Canlıya çıkmadan önce backup, restore ve PITR kanıt kapılarını izle.">
      <MetricPanelGrid
        ariaLabel="Yedek restore özeti"
        metrics={[
          { label: "Restore smoke", value: "Hazır" },
          { label: "Off-host hedef", value: "Env gerekir" },
          { label: "Drill raporu", value: "Kanıt gerekir" },
        ]}
      />
      <EvidenceGateSection title="Kanıt Kapıları" ariaLabel="Yedek restore kapıları" gates={backupGates} />
      <EvidenceListSection title="Restore Drill Raporu" ariaLabel="Restore drill raporu" items={restoreEvidenceFields} />
      <EvidenceListSection title="Kritik Tablolar" ariaLabel="Kritik restore tabloları" items={requiredTables} />
    </PageFrame>
  );
}
