"use client";

import { EvidenceGateSection, EvidenceListSection, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
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
  {
    title: "Pilot kapanış",
    command: "PILOT_EVIDENCE_TARGET=file:///path/to/pilot.json pnpm pilot:check",
    status: "Production pilot kanıtı gerekir",
    detail: "14+ gün pilot, gerçek optik-karne-veli döngüsü, k6/RLS eşikleri, olay tatbikatı ve kritik hata 0 onaylanır.",
  },
  {
    title: "Go-live karar paketi",
    command: "GO_LIVE_EVIDENCE_TARGET=file:///path/to/go-live.json pnpm go-live:check",
    status: "İmzalı final karar gerekir",
    detail: "Production evidence summary, UAT, pilot, KVKK/DPA, rollback, operasyon sahipliği, cutover ve onaylar tek pakette kapanır.",
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
  "Deployment rollback evidence",
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
  "reports.uat.journeyScenariosVerified",
  "reports.restoreDrill.sourceBackup",
  "reports.deploymentRegion.datacenterCountryCode",
  "reports.deploymentRollback.rollbackImageTag",
] as const;

const finalDecisionFields = [
  "productionEvidenceSummary.summaryTarget",
  "productionEvidenceSummary.result = PASS",
  "pilot.pilotDurationDays >= 14",
  "pilot.criticalDefectsOpen = 0",
  "pilot.goLiveDecision = APPROVED",
  "legal.dataProcessingAgreementSigned = true",
  "operations.alertChannelReady = true",
  "cutover.monitoringWindowHours >= 24",
  "approvals: product / technical / operations / dataProtection",
  "goLiveDecision = APPROVED",
] as const;

const openExternalEvidence = [
  "Staging/prod domain",
  "TR datacenter/provider kanıtı",
  "SMS provider credential",
  "Notification provider credential",
  "Sentry DSN ve alert webhook",
  "Off-host backup ve WAL hedefi",
  "Deployment rollback tatbikatı",
  "Staging/prod UAT raporu",
  "Pilot kapanış kanıtı",
  "Go-live karar paketi",
] as const;

export function LiveReleasePage() {
  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Canlı Yayın"
      subtitle="Release öncesi production kanıt zincirini, özet dosyasını ve dış ortam gereksinimlerini izle."
    >
      <MetricPanelGrid
        ariaLabel="Canlı yayın özeti"
        metrics={[
          { label: "Kanıt zinciri", value: "18 kapı" },
          { label: "Final karar", value: "Ayrı kapı" },
          { label: "Release özeti", value: "PASS gerekir" },
          { label: "Dış ortam", value: "Kanıt bekler" },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: panel şu an CLI-only release rehberidir."
        reason="Canlı yayın üretim ortamını etkiler; prod evidence zinciri geçmeden panelde tek tık yayın aksiyonu gösterilmez."
        nextStep="Panel aksiyonu ancak C1/D1 kapıları, audit log ve çift onay modeli tamamlanınca değerlendirilir."
      />
      <EvidenceGateSection title="Kanıt Kapıları" ariaLabel="Canlı yayın kapıları" gates={releaseGates} />
      <EvidenceListSection title="Production Evidence Adımları" ariaLabel="Production evidence adımları" items={productionEvidenceSteps} />
      <EvidenceListSection title="Release Özeti Alanları" ariaLabel="Release özeti alanları" items={summaryFields} />
      <EvidenceListSection title="Go-live Karar Alanları" ariaLabel="Go-live karar alanları" items={finalDecisionFields} />
      <EvidenceListSection title="Dış Ortam Kanıtları" ariaLabel="Dış ortam kanıtları" items={openExternalEvidence} />
    </PageFrame>
  );
}
