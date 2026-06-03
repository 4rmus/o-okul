"use client";

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
    <>
      <header className="next-topbar">
        <div>
          <h1>Yedek / Restore</h1>
          <p>Canlıya çıkmadan önce backup, restore ve PITR kanıt kapılarını izle.</p>
        </div>
      </header>
      <section className="next-dashboard-grid" aria-label="Yedek restore özeti">
        <article className="next-metric">
          <span>Restore smoke</span>
          <strong>Hazır</strong>
        </article>
        <article className="next-metric">
          <span>Off-host hedef</span>
          <strong>Env gerekir</strong>
        </article>
        <article className="next-metric">
          <span>Drill raporu</span>
          <strong>Kanıt gerekir</strong>
        </article>
      </section>
      <section className="next-report-list" aria-label="Yedek restore kapıları">
        <h2>Kanıt Kapıları</h2>
        {backupGates.map((gate) => (
          <article key={gate.title}>
            <h3>{gate.title}</h3>
            <p>{gate.status}</p>
            <p>{gate.detail}</p>
            <code>{gate.command}</code>
          </article>
        ))}
      </section>
      <section className="next-report-list" aria-label="Restore drill raporu">
        <h2>Restore Drill Raporu</h2>
        {restoreEvidenceFields.map((field) => (
          <p key={field}>{field}</p>
        ))}
      </section>
      <section className="next-report-list" aria-label="Kritik restore tabloları">
        <h2>Kritik Tablolar</h2>
        {requiredTables.map((table) => (
          <p key={table}>{table}</p>
        ))}
      </section>
    </>
  );
}
