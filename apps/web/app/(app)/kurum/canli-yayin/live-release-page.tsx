"use client";

const releaseGates = [
  {
    title: "Toplu kanıt zinciri",
    command: "pnpm prod:evidence:check -- --summary-file ./release-evidence/summary.json",
    status: "Staging/prod kanıtı gerekir",
    detail: "Production env, TLS, SMS, e-posta/push, Sentry, backup, KVKK, güvenlik ve UAT kapıları tek sırada çalışır.",
  },
  {
    title: "Repo ve readiness",
    command: "pnpm run ci && pnpm prod:readiness:check && pnpm prod:evidence:templates:check",
    status: "Release adayı gerekir",
    detail: "Kod, readiness ve kanıt şablonları aynı release adayı üzerinde doğrulanır.",
  },
  {
    title: "Canlı servis smoke",
    command: "pnpm db:rls:check:live && pnpm postgres-stores:smoke && pnpm backup:restore:smoke",
    status: "Canlı DB gerekir",
    detail: "RLS, Postgres store yolları ve lokal restore davranışı canlı bağlantıyla kontrol edilir.",
  },
] as const;

const productionEvidenceSteps = [
  "Production env",
  "Traefik HTTPS",
  "SMS provider",
  "Notification provider",
  "Sentry test event",
  "Alert webhook",
  "Off-host backup target",
  "WAL archive target",
  "Deployment region evidence",
  "Restore drill evidence",
  "KVKK inventory evidence",
  "Identity migration evidence",
  "Financial retention evidence",
  "Upload AV evidence",
  "Observability UAT evidence",
  "Security audit evidence",
  "UAT evidence",
] as const;

const summaryFields = [
  "result = PASS",
  "generatedAt",
  "nodeEnv",
  "appUrl / apiUrl / webUrl",
  "checks status = PASS",
  "reports.uat.rollbackImageTag",
  "reports.restoreDrill.sourceBackup",
  "reports.deploymentRegion.datacenterCountryCode",
] as const;

const openExternalEvidence = [
  "Staging/prod domain",
  "TR datacenter/provider kanıtı",
  "SMS provider credential",
  "Notification provider credential",
  "Sentry DSN ve alert webhook",
  "Off-host backup ve WAL hedefi",
  "Staging/prod UAT raporu",
] as const;

export function LiveReleasePage() {
  return (
    <>
      <header className="next-topbar">
        <div>
          <h1>Canlı Yayın</h1>
          <p>Release öncesi production kanıt zincirini, özet dosyasını ve dış ortam gereksinimlerini izle.</p>
        </div>
      </header>
      <section className="next-dashboard-grid" aria-label="Canlı yayın özeti">
        <article className="next-metric">
          <span>Kanıt zinciri</span>
          <strong>17 kapı</strong>
        </article>
        <article className="next-metric">
          <span>Release özeti</span>
          <strong>PASS gerekir</strong>
        </article>
        <article className="next-metric">
          <span>Dış ortam</span>
          <strong>Kanıt bekler</strong>
        </article>
      </section>
      <section className="next-report-list" aria-label="Canlı yayın kapıları">
        <h2>Kanıt Kapıları</h2>
        {releaseGates.map((gate) => (
          <article key={gate.title}>
            <h3>{gate.title}</h3>
            <p>{gate.status}</p>
            <p>{gate.detail}</p>
            <code>{gate.command}</code>
          </article>
        ))}
      </section>
      <ReleaseList title="Production Evidence Adımları" ariaLabel="Production evidence adımları" items={productionEvidenceSteps} />
      <ReleaseList title="Release Özeti Alanları" ariaLabel="Release özeti alanları" items={summaryFields} />
      <ReleaseList title="Dış Ortam Kanıtları" ariaLabel="Dış ortam kanıtları" items={openExternalEvidence} />
    </>
  );
}

function ReleaseList({ ariaLabel, items, title }: { ariaLabel: string; items: readonly string[]; title: string }) {
  return (
    <section className="next-report-list" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </section>
  );
}
