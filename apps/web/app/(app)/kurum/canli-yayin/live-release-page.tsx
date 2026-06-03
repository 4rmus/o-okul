"use client";

import { EvidenceGateSection, EvidenceListSection } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";

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
    <PageFrame
      title="Canlı Yayın"
      subtitle="Release öncesi production kanıt zincirini, özet dosyasını ve dış ortam gereksinimlerini izle."
    >
      <MetricPanelGrid
        ariaLabel="Canlı yayın özeti"
        metrics={[
          { label: "Kanıt zinciri", value: "17 kapı" },
          { label: "Release özeti", value: "PASS gerekir" },
          { label: "Dış ortam", value: "Kanıt bekler" },
        ]}
      />
      <EvidenceGateSection title="Kanıt Kapıları" ariaLabel="Canlı yayın kapıları" gates={releaseGates} />
      <EvidenceListSection title="Production Evidence Adımları" ariaLabel="Production evidence adımları" items={productionEvidenceSteps} />
      <EvidenceListSection title="Release Özeti Alanları" ariaLabel="Release özeti alanları" items={summaryFields} />
      <EvidenceListSection title="Dış Ortam Kanıtları" ariaLabel="Dış ortam kanıtları" items={openExternalEvidence} />
    </PageFrame>
  );
}
