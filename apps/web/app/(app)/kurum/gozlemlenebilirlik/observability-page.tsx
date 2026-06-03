"use client";

const observabilityGates = [
  {
    title: "Observability UAT",
    command: "OBSERVABILITY_UAT_TARGET=file://$PWD/docs/evidence-templates/observability-uat.example.json pnpm observability:uat:check",
    status: "Kanıt raporu gerekir",
    detail: "Prometheus, Grafana, Loki ve alert kanalları staging veya production raporuyla doğrulanır.",
  },
  {
    title: "Alert webhook smoke",
    command: "ALERT_WEBHOOK_URL=https://alerts.example.test pnpm alert:webhook:smoke",
    status: "Webhook gerekir",
    detail: "Alert bildirim kanalına test olayı gönderilir ve 2xx yanıt beklenir.",
  },
  {
    title: "Sentry smoke",
    command: "SENTRY_SMOKE_CONFIRM=send pnpm sentry:smoke",
    status: "Sentry DSN gerekir",
    detail: "Sentry'ye PII içermeyen test olayı gönderilir.",
  },
] as const;

const dashboardPanels = [
  "API up",
  "Request rate",
  "Average duration",
  "Readiness failures",
  "Docker logs",
];

const alertRules = [
  "UzmanHocamApiDown",
  "UzmanHocamReadinessFailing",
  "UzmanHocamHigh5xxRate",
  "UzmanHocamSlowRequests",
];

const telemetryChecks = [
  "prometheusScrapeOk",
  "grafanaDashboardOk",
  "lokiLogPanelOk",
  "alertWebhookStatus 2xx",
];

export function ObservabilityPage() {
  return (
    <>
      <header className="next-topbar">
        <div>
          <h1>Gözlemlenebilirlik</h1>
          <p>Canlıya çıkış öncesi metrik, log ve alert kanıt kapılarını izle.</p>
        </div>
      </header>
      <section className="next-dashboard-grid" aria-label="Gözlemlenebilirlik özeti">
        <article className="next-metric">
          <span>Prometheus</span>
          <strong>Scrape gerekir</strong>
        </article>
        <article className="next-metric">
          <span>Grafana/Loki</span>
          <strong>Panel gerekir</strong>
        </article>
        <article className="next-metric">
          <span>Alert</span>
          <strong>Webhook 2xx</strong>
        </article>
      </section>
      <section className="next-report-list" aria-label="Gözlemlenebilirlik kapıları">
        <h2>Kanıt Kapıları</h2>
        {observabilityGates.map((gate) => (
          <article key={gate.title}>
            <h3>{gate.title}</h3>
            <p>{gate.status}</p>
            <p>{gate.detail}</p>
            <code>{gate.command}</code>
          </article>
        ))}
      </section>
      <ObservationList title="Dashboard Panelleri" ariaLabel="Dashboard panelleri" items={dashboardPanels} />
      <ObservationList title="Alert Kuralları" ariaLabel="Alert kuralları" items={alertRules} />
      <ObservationList title="Telemetri Kontrolleri" ariaLabel="Telemetri kontrolleri" items={telemetryChecks} />
    </>
  );
}

function ObservationList({ ariaLabel, items, title }: { ariaLabel: string; items: readonly string[]; title: string }) {
  return (
    <section className="next-report-list" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </section>
  );
}
