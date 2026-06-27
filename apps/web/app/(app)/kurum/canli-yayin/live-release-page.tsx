"use client";

import { DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { EvidenceTrustPanel, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

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
  "SMS disabled path",
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
  "SMS disabled path credential",
  "Notification provider credential",
  "Sentry DSN ve alert webhook",
  "Off-host backup ve WAL hedefi",
  "Deployment rollback tatbikatı",
  "Staging/prod UAT raporu",
  "Pilot kapanış kanıtı",
  "Go-live karar paketi",
] as const;

interface LiveReleaseRow {
  detail: string;
  key: string;
  label: string;
  scope: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

export function LiveReleasePage() {
  const summaryItems = buildLiveReleaseSummaryItems();
  const summaryBadges = buildLiveReleaseSummaryBadges();
  const summaryActions = buildLiveReleaseSummaryActions();
  const gateRows = buildLiveReleaseRows(releaseGates, (gate) => ({
    detail: gate.detail,
    key: gate.title,
    label: gate.title,
    scope: gate.command,
    tone: releaseGateTone(gate.status),
    value: gate.status,
  }));
  const productionEvidenceRows = buildLiveReleaseRows(productionEvidenceSteps, (step) => ({
    detail: productionEvidenceDetail(step),
    key: step,
    label: step,
    scope: productionEvidenceScope(step),
    tone: productionEvidenceTone(step),
    value: "Evidence gerekir",
  }));
  const summaryFieldRows = buildLiveReleaseRows(summaryFields, (field) => ({
    detail: "Production evidence summary dosyasında PASS kararını destekleyen alan.",
    key: field,
    label: field,
    scope: field.includes("reports.") ? "Rapor referansı" : "Özet alanı",
    tone: "warning",
    value: "Zorunlu",
  }));
  const finalDecisionRows = buildLiveReleaseRows(finalDecisionFields, (field) => ({
    detail: finalDecisionDetail(field),
    key: field,
    label: field,
    scope: field.includes("approvals") || field.includes("goLiveDecision") ? "İmzalı karar" : "Go-live packet",
    tone: "danger",
    value: "Zorunlu",
  }));
  const externalEvidenceRows = buildLiveReleaseRows(openExternalEvidence, (item) => ({
    detail: "Repo/static PASS sayılmaz; staging/prod veya provider kanıtıyla kapanır.",
    key: item,
    label: item,
    scope: externalEvidenceScope(item),
    tone: "warning",
    value: "Açık kanıt",
  }));

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Canlı Yayın"
      subtitle="Release öncesi production kanıt zincirini, özet dosyasını ve dış ortam gereksinimlerini izle."
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="Canlı yayın operasyon özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Canlı yayın güven durumu"
        title="Release Kanıt Gücü"
        description="Bu ekran release kararını özetler; production evidence summary, pilot kapanışı ve go-live onayları tamamlanmadan yayın aksiyonu gösterilmez."
        items={[
          {
            label: "Repo kapıları",
            value: "CI + şablon",
            tone: "info",
            scope: "local-static",
            detail: "Kod ve evidence şablonları release adayı üzerinde doğrulanır.",
          },
          {
            label: "Production evidence",
            value: "PASS gerekir",
            tone: "warning",
            scope: "staging-prod",
            detail: "TLS, provider, backup, KVKK, güvenlik ve UAT kanıtları tek zincirde kapanır.",
          },
          {
            label: "Go-live kararı",
            value: "İmzalı onay",
            tone: "danger",
            scope: "live-required",
            detail: "Pilot, operasyon sahipliği, cutover ve veri koruma onayları olmadan canlı aksiyon yoktur.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Karar: panel şu an CLI-only release rehberidir."
        reason="Canlı yayın üretim ortamını etkiler; prod evidence zinciri geçmeden panelde tek tık yayın aksiyonu gösterilmez."
        nextStep="Panel aksiyonu ancak C1/D1 kapıları, audit log ve çift onay modeli tamamlanınca değerlendirilir."
      />
      <Panel
        aria-label="Canlı yayın kapıları"
        description="Release adayı, production evidence, pilot ve go-live karar kapıları tek operasyonal tabloda izlenir."
        title="Kanıt Kapıları"
      >
        <DataTable
          caption="Canlı yayın kanıt kapıları"
          columns={liveReleaseColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={gateRows}
        />
      </Panel>
      <Panel
        aria-label="Production evidence adımları"
        description="Provider, güvenlik, KVKK, backup, observability ve UAT kanıt zinciri."
        title="Production Evidence Adımları"
      >
        <DataTable
          caption="Production evidence adımları"
          columns={liveReleaseColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={productionEvidenceRows}
        />
      </Panel>
      <Panel
        aria-label="Release özeti alanları"
        description="Production evidence summary içinde PASS kararını destekleyen zorunlu alanlar."
        title="Release Özeti Alanları"
      >
        <DataTable
          caption="Release özeti alanları"
          columns={liveReleaseColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={summaryFieldRows}
        />
      </Panel>
      <Panel
        aria-label="Go-live karar alanları"
        description="Pilot kapanışı, legal onaylar, operasyon sahipliği ve cutover karar alanları."
        title="Go-live Karar Alanları"
      >
        <DataTable
          caption="Go-live karar alanları"
          columns={liveReleaseColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={finalDecisionRows}
        />
      </Panel>
      <Panel
        aria-label="Dış ortam kanıtları"
        description="Yerel/static sonuçla kapanmayan staging/prod, provider ve canlı ortam kanıtları."
        title="Dış Ortam Kanıtları"
      >
        <DataTable
          caption="Dış ortam kanıtları"
          columns={liveReleaseColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={externalEvidenceRows}
        />
      </Panel>
    </PageFrame>
  );
}

const liveReleaseColumns: Array<DataTableColumn<LiveReleaseRow>> = [
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
    key: "scope",
    header: "Kapsam",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.scope,
  },
  {
    key: "detail",
    header: "Bağlam",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.detail,
  },
];

function buildLiveReleaseSummaryItems(): OperationSummaryItem[] {
  return [
    {
      description: "Production evidence zinciri",
      key: "evidence-chain",
      label: "Kanıt zinciri",
      tone: "warning",
      value: `${productionEvidenceSteps.length} kapı`,
    },
    {
      description: "Production evidence summary",
      key: "summary",
      label: "Release özeti",
      tone: "warning",
      value: "PASS gerekir",
    },
    {
      description: "Pilot ve go-live onay paketi",
      key: "pilot",
      label: "Pilot kapanış",
      tone: "danger",
      value: "14+ gün",
    },
    {
      description: "Tek tık canlı yayın aksiyonu",
      key: "panel-action",
      label: "Panel aksiyonu",
      tone: "info",
      value: "CLI-only",
    },
    {
      description: "Provider ve staging/prod doğrulamaları",
      key: "external-evidence",
      label: "Dış ortam",
      tone: "warning",
      value: "Kanıt bekler",
    },
  ];
}

function buildLiveReleaseSummaryBadges(): OperationSummaryBadge[] {
  return [
    {
      key: "cli-only",
      label: "CLI-only",
      tone: "info",
    },
    {
      key: "local-static",
      label: "Yerel/static karar vermez",
      tone: "warning",
    },
    {
      key: "staging-prod",
      label: "Staging/prod evidence",
      tone: "warning",
    },
    {
      key: "live-required",
      label: "Canlı kanıt gerekir",
      tone: "danger",
    },
  ];
}

function buildLiveReleaseSummaryActions(): OperationSummaryAction[] {
  return [
    {
      detail: "prod:evidence summary PASS üretmeden release kararı yok",
      key: "prod-evidence",
      label: "Production evidence",
      status: "PASS gerekir",
      tone: "warning",
      value: "18 kapı",
    },
    {
      detail: "14+ gün pilot, kritik hata 0 ve gerçek operasyon döngüsü",
      key: "pilot",
      label: "Pilot kapanış",
      status: "Kanıt gerekir",
      tone: "danger",
      value: "Go-live öncesi",
    },
    {
      detail: "İmzalı ürün, teknik, operasyon ve veri koruma onayı",
      key: "decision",
      label: "Go-live karar paketi",
      status: "İmzalı onay",
      tone: "danger",
      value: "Ayrı kapı",
    },
    {
      detail: "Provider, backup, rollback, alert ve bölge kanıtları dış ortamdan gelir",
      key: "external",
      label: "Dış ortam kanıtı",
      status: "Açık kanıt",
      tone: "warning",
      value: "Staging/prod",
    },
  ];
}

function buildLiveReleaseRows<TItem>(
  items: readonly TItem[],
  mapItem: (item: TItem) => LiveReleaseRow,
): LiveReleaseRow[] {
  return items.map(mapItem);
}

function releaseGateTone(status: string): StatusBadgeProps["tone"] {
  if (status.includes("İmzalı") || status.includes("Production pilot")) return "danger";
  return "warning";
}

function productionEvidenceScope(step: string) {
  if (step.includes("provider") || step.includes("Sentry") || step.includes("Alert")) return "Provider";
  if (step.includes("backup") || step.includes("WAL") || step.includes("Restore") || step.includes("rollback")) return "DR / rollback";
  if (step.includes("KVKK") || step.includes("Identity") || step.includes("Financial") || step.includes("Upload")) return "Governance";
  if (step.includes("UAT") || step.includes("Security") || step.includes("Observability")) return "Release QA";
  return "Production env";
}

function productionEvidenceTone(step: string): StatusBadgeProps["tone"] {
  if (step.includes("Deployment") || step.includes("Off-host") || step.includes("WAL")) return "danger";
  return "warning";
}

function productionEvidenceDetail(step: string) {
  if (step.includes("Traefik")) return "Public HTTPS smoke staging/prod ortamında kanıtlanır.";
  if (step.includes("provider") || step.includes("Sentry") || step.includes("Alert")) return "Gerçek provider credential ve PII içermeyen smoke gerekir.";
  if (step.includes("backup") || step.includes("WAL") || step.includes("Restore")) return "Restore edilebilir off-host/PITR evidence release dosyasında tutulur.";
  if (step.includes("UAT")) return "Staging/prod UAT raporu defects boş olacak şekilde bağlanır.";
  return "Production evidence summary içinde PASS olarak raporlanır.";
}

function finalDecisionDetail(field: string) {
  if (field.includes("pilot")) return "Pilot kapanışı gerçek kullanım, süre ve kritik defect ölçütleriyle doğrulanır.";
  if (field.includes("legal")) return "KVKK/DPA onayı go-live paketinde imzalı kanıt olarak yer alır.";
  if (field.includes("operations")) return "Alert ve operasyon sahipliği canlı izleme penceresiyle tamamlanır.";
  if (field.includes("approvals")) return "Ürün, teknik, operasyon ve veri koruma onayları birlikte gerekir.";
  return "Go-live karar paketi içinde zorunlu alan olarak tutulur.";
}

function externalEvidenceScope(item: string) {
  if (item.includes("provider") || item.includes("Sentry")) return "Provider";
  if (item.includes("backup") || item.includes("WAL") || item.includes("rollback")) return "DR / rollback";
  if (item.includes("datacenter")) return "Bölge kanıtı";
  if (item.includes("UAT") || item.includes("Pilot") || item.includes("Go-live")) return "Release karar";
  return "Staging/prod";
}
