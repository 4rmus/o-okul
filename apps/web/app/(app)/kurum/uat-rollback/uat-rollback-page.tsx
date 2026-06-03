"use client";

const uatGates = [
  {
    title: "UAT kanıtı",
    command: "UAT_EVIDENCE_TARGET=file://$PWD/docs/evidence-templates/uat.example.json pnpm uat:check",
    status: "Kanıt raporu gerekir",
    detail: "Staging veya production UAT raporu PASS dönmeli ve defect içermemeli.",
  },
  {
    title: "CI ve prod env",
    command: "pnpm run ci && pnpm prod:env:check",
    status: "Repo + env gerekir",
    detail: "Release adayı ve üretim env kapıları doğrulanır.",
  },
  {
    title: "Canlı smoke zinciri",
    command: "pnpm raw-import:smoke && pnpm report-generation:smoke && pnpm queue:smoke",
    status: "Canlı servis gerekir",
    detail: "Import, rapor üretimi ve queue akışı staging/prod ortamında çalışır.",
  },
  {
    title: "Rollback referansı",
    command: "rollbackImageTag + restoreBackupReference",
    status: "Kanıt raporunda zorunlu",
    detail: "Son başarılı image tag'i ve restore edilebilir backup referansı yazılır.",
  },
] as const;

const uatFlows = [
  "tenant admin login",
  "teacher workflow",
  "guardian workflow",
  "raw import smoke",
  "report generation smoke",
  "sms batch smoke",
  "privacy purge",
] as const;

const requiredCommands = [
  "pnpm run ci",
  "pnpm prod:env:check",
  "pnpm db:rls:check:live",
  "pnpm raw-import:smoke",
  "pnpm report-generation:smoke",
  "pnpm queue:smoke",
  "pnpm sms:smoke",
  "pnpm traefik:https:smoke",
] as const;

const rollbackFields = ["releaseCandidate", "rollbackImageTag", "restoreBackupReference", "defects boş"] as const;

export function UatRollbackPage() {
  return (
    <>
      <header className="next-topbar">
        <div>
          <h1>UAT / Rollback</h1>
          <p>Staging/prod UAT, rollback image ve restore backup kanıtlarını izle.</p>
        </div>
      </header>
      <section className="next-dashboard-grid" aria-label="UAT rollback özeti">
        <article className="next-metric">
          <span>UAT raporu</span>
          <strong>Kanıt gerekir</strong>
        </article>
        <article className="next-metric">
          <span>Rollback</span>
          <strong>Image tag</strong>
        </article>
        <article className="next-metric">
          <span>Restore referansı</span>
          <strong>Backup gerekir</strong>
        </article>
      </section>
      <section className="next-report-list" aria-label="UAT rollback kapıları">
        <h2>Kanıt Kapıları</h2>
        {uatGates.map((gate) => (
          <article key={gate.title}>
            <h3>{gate.title}</h3>
            <p>{gate.status}</p>
            <p>{gate.detail}</p>
            <code>{gate.command}</code>
          </article>
        ))}
      </section>
      <UatList title="UAT Akışları" ariaLabel="UAT akışları" items={uatFlows} />
      <UatList title="Zorunlu Komutlar" ariaLabel="Zorunlu komutlar" items={requiredCommands} />
      <UatList title="Rollback Alanları" ariaLabel="Rollback alanları" items={rollbackFields} />
    </>
  );
}

function UatList({ ariaLabel, items, title }: { ariaLabel: string; items: readonly string[]; title: string }) {
  return (
    <section className="next-report-list" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </section>
  );
}
