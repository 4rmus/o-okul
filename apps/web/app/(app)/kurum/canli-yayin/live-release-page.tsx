"use client";

import { DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { EvidenceTrustPanel, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const releaseGates = [
  {
    title: "Tüm doğrulamaları çalıştır",
    command: "pnpm prod:evidence:check -- --summary-file ./release-evidence/summary.json",
    status: "Deneme ve canlı ortam sonuçları gerekir",
    detail: "Canlı ortam, güvenli bağlantı, bildirim, hata izleme, yedekleme, KVKK, güvenlik ve kullanıcı kabul kontrolleri birlikte çalışır.",
  },
  {
    title: "Yayın adayı kontrolleri",
    command: "pnpm run ci && pnpm prod:readiness:check && pnpm prod:evidence:templates:check",
    status: "Yayın adayı gerekir",
    detail: "Kod, yayın hazırlığı ve doğrulama şablonları aynı sürüm üzerinde kontrol edilir.",
  },
  {
    title: "Canlı servis kontrolleri",
    command: "pnpm db:rls:check:live && pnpm postgres-stores:smoke && pnpm backup:restore:smoke",
    status: "Canlı veritabanı gerekir",
    detail: "Kurum verisi ayrımı, veritabanı kayıtları ve yedekten geri yükleme davranışı canlı bağlantıyla kontrol edilir.",
  },
  {
    title: "Pilot değerlendirmesi",
    command: "PILOT_EVIDENCE_TARGET=file:///path/to/pilot.json pnpm pilot:check",
    status: "Canlı pilot sonuçları gerekir",
    detail: "En az 14 günlük pilotta gerçek optik, karne ve veli akışı; performans, veri ayrımı, olay tatbikatı ve kritik hata durumu doğrulanır.",
  },
  {
    title: "Canlıya geçiş kararı",
    command: "GO_LIVE_EVIDENCE_TARGET=file:///path/to/go-live.json pnpm go-live:check",
    status: "İmzalı karar gerekir",
    detail: "Canlı ortam doğrulamaları, kullanıcı kabulü, pilot, KVKK, önceki sürüme dönüş, sorumlular ve onaylar birlikte tamamlanır.",
  },
] as const;

const productionEvidenceSteps = [
  "Canlı ortam ayarları",
  "Güvenli HTTPS bağlantısı",
  "SMS kapalıyken davranış",
  "Bildirim hizmeti",
  "Hata izleme test olayı",
  "Uyarı kanalı",
  "Harici yedek hedefi",
  "Veritabanı değişiklik arşivi",
  "Önceki sürüme dönüş denemesi",
  "Yedekten geri yükleme denemesi",
  "KVKK veri envanteri",
  "Kimlik bilgisi geçişi",
  "Mali kayıt saklama",
  "Yüklenen dosya virüs taraması",
  "İzleme ve uyarı kullanıcı kabulü",
  "Güvenlik denetimi",
  "Kullanıcı kabul testi",
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
  "Deneme veya canlı ortam adresi",
  "SMS kapalı senaryo erişim bilgisi",
  "Bildirim hizmeti erişim bilgisi",
  "Hata izleme ve uyarı kanalı",
  "Harici yedek ve veritabanı arşivi",
  "Önceki sürüme dönüş tatbikatı",
  "Kullanıcı kabul raporu",
  "Pilot değerlendirme sonuçları",
  "Canlıya geçiş karar paketi",
] as const;

interface LiveReleaseRow {
  detail: string;
  key: string;
  label: string;
  scope: string;
  technicalReference?: string;
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
    scope: "Yayın kontrolü",
    technicalReference: gate.command,
    tone: releaseGateTone(gate.status),
    value: gate.status,
  }));
  const productionEvidenceRows = buildLiveReleaseRows(productionEvidenceSteps, (step) => ({
    detail: productionEvidenceDetail(step),
    key: step,
    label: step,
    scope: productionEvidenceScope(step),
    tone: productionEvidenceTone(step),
    value: "Doğrulama gerekir",
  }));
  const summaryFieldRows = buildLiveReleaseRows(summaryFields, (field) => ({
    detail: "Canlı ortam doğrulama özetinde başarılı sonucu destekleyen alan.",
    key: field,
    label: summaryFieldLabel(field),
    scope: field.includes("reports.") ? "Rapor referansı" : "Özet alanı",
    technicalReference: field,
    tone: "warning",
    value: "Zorunlu",
  }));
  const finalDecisionRows = buildLiveReleaseRows(finalDecisionFields, (field) => ({
    detail: finalDecisionDetail(field),
    key: field,
    label: finalDecisionLabel(field),
    scope: field.includes("approvals") || field.includes("goLiveDecision") ? "İmzalı karar" : "Canlıya geçiş paketi",
    technicalReference: field,
    tone: "danger",
    value: "Zorunlu",
  }));
  const externalEvidenceRows = buildLiveReleaseRows(openExternalEvidence, (item) => ({
    detail: "Yerel kod kontrolü yeterli değildir; deneme, canlı ortam veya hizmet sağlayıcı sonucu gerekir.",
    key: item,
    label: item,
    scope: externalEvidenceScope(item),
    tone: "warning",
    value: "Doğrulama bekliyor",
  }));

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Yayın Hazırlığı"
      subtitle="Canlıya geçmeden önce kod, dış sistem, pilot ve onay kontrollerini izleyin."
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="Yayın hazırlığı özeti"
        badges={summaryBadges}
        items={summaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Canlıya geçiş doğrulama durumu"
        title="Canlıya Geçiş Durumu"
        description="Bu ekran yayın hazırlığını özetler. Canlı ortam doğrulamaları, pilot ve imzalı onaylar tamamlanmadan yayın işlemi açılamaz."
        items={[
          {
            label: "Kod ve şablon kontrolleri",
            value: "Ön kontrol",
            tone: "info",
            scope: "local-static",
            detail: "Kod ve doğrulama şablonları yayın adayı üzerinde kontrol edilir.",
          },
          {
            label: "Canlı ortam doğrulamaları",
            value: "Başarılı olmalı",
            tone: "warning",
            scope: "staging-prod",
            detail: "Güvenli bağlantı, dış hizmetler, yedekleme, KVKK, güvenlik ve kullanıcı kabulü birlikte tamamlanır.",
          },
          {
            label: "Canlıya geçiş kararı",
            value: "İmzalı onay",
            tone: "danger",
            scope: "live-required",
            detail: "Pilot, sorumlular, geçiş planı ve veri koruma onayları olmadan canlıya geçilemez.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Bu ekran yayın işlemi yapmaz; hazırlık durumunu gösterir."
        reason="Canlıya geçiş üretim ortamını etkiler. Tüm doğrulamalar ve onaylar tamamlanmadan tek tıkla yayın işlemi sunulmaz."
        nextStep="Aşağıdaki kontrolleri tamamlayın, pilot sonuçlarını ekleyin ve imzalı canlıya geçiş kararını alın."
      />
      <Panel
        aria-label="Yayın öncesi kontroller"
        description="Yayın adayı, canlı ortam doğrulamaları, pilot ve canlıya geçiş kararı tek tabloda izlenir."
        title="Yayın Öncesi Kontroller"
      >
        <DataTable
          caption="Yayın öncesi kontroller"
          columns={liveReleaseColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={gateRows}
        />
      </Panel>
      <Panel
        aria-label="Canlı ortam doğrulamaları"
        description="Dış hizmetler, güvenlik, KVKK, yedekleme, izleme ve kullanıcı kabulü birlikte kontrol edilir."
        title="Canlı Ortam Doğrulamaları"
      >
        <DataTable
          caption="Canlı ortam doğrulamaları"
          columns={liveReleaseColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={productionEvidenceRows}
        />
      </Panel>
      <Panel
        aria-label="Doğrulama özeti alanları"
        description="Canlı ortam doğrulama özetinde başarılı sonucu destekleyen zorunlu alanlar."
        title="Doğrulama Özeti Alanları"
      >
        <DataTable
          caption="Doğrulama özeti alanları"
          columns={liveReleaseColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={summaryFieldRows}
        />
      </Panel>
      <Panel
        aria-label="Canlıya geçiş kararları"
        description="Pilot sonuçları, yasal onaylar, sorumlular ve geçiş planı kararları."
        title="Canlıya Geçiş Kararları"
      >
        <DataTable
          caption="Canlıya geçiş kararları"
          columns={liveReleaseColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={finalDecisionRows}
        />
      </Panel>
      <Panel
        aria-label="Dış sistem doğrulamaları"
        description="Yerel kod kontrolüyle tamamlanmayan deneme, canlı ortam ve dış hizmet doğrulamaları."
        title="Dış Sistem Doğrulamaları"
      >
        <DataTable
          caption="Dış sistem doğrulamaları"
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
    header: "Kontrol",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => (
      <>
        <span>{row.label}</span>
        {row.technicalReference ? (
          <details>
            <summary>İleri ayrıntılar</summary>
            <code>{row.technicalReference}</code>
          </details>
        ) : null}
      </>
    ),
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
    header: "Kaynak",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.scope,
  },
  {
    key: "detail",
    header: "Açıklama",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.detail,
  },
];

function buildLiveReleaseSummaryItems(): OperationSummaryItem[] {
  return [
    {
      description: "Canlı ortam doğrulama adımları",
      key: "evidence-chain",
      label: "Doğrulamalar",
      tone: "warning",
      value: `${productionEvidenceSteps.length} kontrol`,
    },
    {
      description: "Canlı ortam doğrulama özeti",
      key: "summary",
      label: "Doğrulama özeti",
      tone: "warning",
      value: "Başarılı olmalı",
    },
    {
      description: "Pilot ve canlıya geçiş onayları",
      key: "pilot",
      label: "Pilot değerlendirmesi",
      tone: "danger",
      value: "14+ gün",
    },
    {
      description: "Bu ekrandan doğrudan yayın yapılmaz",
      key: "panel-action",
      label: "Yayın işlemi",
      tone: "info",
      value: "Kapalı",
    },
    {
      description: "Dış hizmet ve canlı ortam doğrulamaları",
      key: "external-evidence",
      label: "Dış sistemler",
      tone: "warning",
      value: "Sonuç bekliyor",
    },
  ];
}

function buildLiveReleaseSummaryBadges(): OperationSummaryBadge[] {
  return [
    {
      key: "cli-only",
      label: "Bu ekran yalnız bilgi verir",
      tone: "info",
    },
    {
      key: "local-static",
      label: "Yerel kontrol yeterli değildir",
      tone: "warning",
    },
    {
      key: "staging-prod",
      label: "Deneme ve canlı ortam sonucu gerekir",
      tone: "warning",
    },
    {
      key: "live-required",
      label: "Canlı doğrulama gerekir",
      tone: "danger",
    },
  ];
}

function buildLiveReleaseSummaryActions(): OperationSummaryAction[] {
  return [
    {
      detail: "Canlı ortam doğrulama özeti başarılı olmadan yayın kararı alınmaz",
      key: "prod-evidence",
      label: "Canlı ortam doğrulamaları",
      status: "Başarılı olmalı",
      tone: "warning",
      value: `${productionEvidenceSteps.length} kontrol`,
    },
    {
      detail: "En az 14 gün pilot, açık kritik hata olmaması ve gerçek kurum akışı",
      key: "pilot",
      label: "Pilot değerlendirmesi",
      status: "Sonuç gerekir",
      tone: "danger",
      value: "Canlıya geçmeden önce",
    },
    {
      detail: "İmzalı ürün, teknik, operasyon ve veri koruma onayı",
      key: "decision",
      label: "Canlıya geçiş kararı",
      status: "İmzalı onay",
      tone: "danger",
      value: "Ayrı onay",
    },
    {
      detail: "Dış hizmet, yedekleme, önceki sürüme dönüş ve uyarı sonuçları ilgili sistemlerden gelir",
      key: "external",
      label: "Dış sistem doğrulaması",
      status: "Sonuç bekliyor",
      tone: "warning",
      value: "Deneme/canlı",
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
  if (status.includes("İmzalı") || status.includes("Canlı pilot")) return "danger";
  return "warning";
}

function productionEvidenceScope(step: string) {
  if (step.includes("hizmeti") || step.includes("Hata izleme") || step.includes("Uyarı")) return "Hizmet sağlayıcı";
  if (step.includes("yedek") || step.includes("arşivi") || step.includes("geri yükleme") || step.includes("sürüme dönüş")) return "Yedekleme / geri dönüş";
  if (step.includes("KVKK") || step.includes("Kimlik") || step.includes("Mali") || step.includes("virüs")) return "Veri yönetimi";
  if (step.includes("kabul") || step.includes("Güvenlik") || step.includes("İzleme")) return "Yayın kontrolü";
  return "Canlı ortam";
}

function productionEvidenceTone(step: string): StatusBadgeProps["tone"] {
  if (step.includes("sürüme dönüş") || step.includes("Harici yedek") || step.includes("arşivi")) return "danger";
  return "warning";
}

function productionEvidenceDetail(step: string) {
  if (step.includes("HTTPS")) return "Güvenli bağlantı deneme ve canlı ortamda doğrulanır.";
  if (step.includes("hizmeti") || step.includes("Hata izleme") || step.includes("Uyarı")) return "Gerçek hizmet erişimiyle, kişisel veri içermeyen bir deneme yapılır.";
  if (step.includes("yedek") || step.includes("arşivi") || step.includes("geri yükleme")) return "Yedeğin geri yüklenebildiği ve kurum dışında güvenle saklandığı doğrulanır.";
  if (step.includes("kabul")) return "Deneme veya canlı ortam kullanıcı kabul raporunda açık hata bırakılmamalıdır.";
  return "Canlı ortam doğrulama özetinde başarılı olarak raporlanır.";
}

function finalDecisionDetail(field: string) {
  if (field.includes("pilot")) return "Pilot gerçek kullanım, süre ve açık kritik hata ölçütleriyle değerlendirilir.";
  if (field.includes("legal")) return "KVKK ve veri işleme onayı canlıya geçiş paketinde imzalı olarak yer alır.";
  if (field.includes("operations")) return "Uyarı kanalı ve sorumlular canlı izleme süresiyle birlikte belirlenir.";
  if (field.includes("approvals")) return "Ürün, teknik, operasyon ve veri koruma onayları birlikte gerekir.";
  return "Canlıya geçiş karar paketinde zorunlu alan olarak tutulur.";
}

function summaryFieldLabel(field: (typeof summaryFields)[number]) {
  const labels: Record<(typeof summaryFields)[number], string> = {
    "result = PASS": "Genel sonuç başarılı",
    generatedAt: "Doğrulama zamanı",
    nodeEnv: "Çalışma ortamı",
    "appUrl / apiUrl / webUrl": "Uygulama ve hizmet adresleri",
    "checks status = PASS": "Tüm kontroller başarılı",
    "reports.uat.rollbackImageTag": "Kabul raporundaki geri dönüş sürümü",
    "reports.uat.journeyScenariosVerified": "Doğrulanan kullanıcı yolculukları",
    "reports.restoreDrill.sourceBackup": "Geri yüklemede kullanılan yedek",
    "reports.deploymentRollback.rollbackImageTag": "Geri dönüşte kullanılacak sürüm",
  };
  return labels[field];
}

function finalDecisionLabel(field: (typeof finalDecisionFields)[number]) {
  const labels: Record<(typeof finalDecisionFields)[number], string> = {
    "productionEvidenceSummary.summaryTarget": "Doğrulama özeti dosyası",
    "productionEvidenceSummary.result = PASS": "Doğrulama özeti başarılı",
    "pilot.pilotDurationDays >= 14": "Pilot süresi en az 14 gün",
    "pilot.criticalDefectsOpen = 0": "Açık kritik hata yok",
    "pilot.goLiveDecision = APPROVED": "Pilot canlıya geçiş kararı onaylı",
    "legal.dataProcessingAgreementSigned = true": "Veri işleme sözleşmesi imzalı",
    "operations.alertChannelReady = true": "Uyarı kanalı hazır",
    "cutover.monitoringWindowHours >= 24": "Geçiş sonrası izleme en az 24 saat",
    "approvals: product / technical / operations / dataProtection": "Gerekli sorumlu onayları",
    "goLiveDecision = APPROVED": "Son canlıya geçiş kararı onaylı",
  };
  return labels[field];
}

function externalEvidenceScope(item: string) {
  if (item.includes("hizmeti") || item.includes("Hata izleme")) return "Hizmet sağlayıcı";
  if (item.includes("yedek") || item.includes("arşivi") || item.includes("sürüme dönüş")) return "Yedekleme / geri dönüş";
  if (item.includes("bölge")) return "Bölge doğrulaması";
  if (item.includes("kabul") || item.includes("Pilot") || item.includes("Canlıya")) return "Yayın kararı";
  return "Deneme/canlı";
}
