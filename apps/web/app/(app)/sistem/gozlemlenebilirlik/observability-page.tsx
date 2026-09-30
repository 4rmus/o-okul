import { DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { EvidenceGateSection, EvidenceTrustPanel, OperationDecisionNotice, ReferenceBadge } from "../../kurum/_shared/evidence-panels.js";
import { PageFrame } from "../../kurum/_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge } from "../../kurum/_shared/operation-summary.js";

const observabilityGates = [
  {
    title: "Sistem izleme kabulü",
    command: "OBSERVABILITY_UAT_TARGET=file://$PWD/docs/evidence-templates/observability-uat.example.json pnpm observability:uat:check",
    status: "Kanıt raporu gerekir",
    detail: "Sistem ölçümleri, izleme panoları, kayıtlar ve uyarılar deneme veya canlı ortam raporuyla doğrulanır.",
  },
  {
    title: "Uyarı bildirim denemesi",
    command: "ALERT_WEBHOOK_URL=https://alerts.example.test pnpm alert:webhook:smoke",
    status: "Bildirim adresi gerekir",
    detail: "Uyarı kanalına kişisel veri içermeyen bir test bildirimi gönderilir ve başarılı yanıt beklenir.",
  },
  {
    title: "Hata izleme denemesi",
    command: "SENTRY_SMOKE_CONFIRM=send pnpm sentry:smoke",
    status: "Hata izleme bağlantısı gerekir",
    detail: "Hata izleme kanalına kişisel veri içermeyen bir test olayı gönderilir.",
  },
] as const;

const dashboardPanels = [
  "Uygulama çalışma durumu",
  "İstek yoğunluğu",
  "Ortalama yanıt süresi",
  "Bağlantı sorunları",
  "Uygulama kayıtları",
];

const alertRules = [
  "Uygulama yanıt vermiyor",
  "Bağlantılar hazır değil",
  "Bağlantı sorunu arttı",
  "Yanıt süresi uzadı",
];

const telemetryChecks = [
  "Sistem ölçümleri alınıyor",
  "İzleme panosu açılıyor",
  "Uygulama kayıtları görüntüleniyor",
  "Uyarı bildirimi ulaşıyor",
];

interface ObservabilityChecklistRow {
  detail: string;
  key: string;
  label: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

// ponytail: canlı durum Sistem Sağlığı ekranında, ölçümler Grafana'da; bu ekran yalnız izleme kabul maddelerini listeler (DEC-20260930-02).
const summaryBadges: OperationSummaryBadge[] = [
  { key: "alert", label: "Uyarı denemesi gerekir", tone: "warning" },
  { key: "dashboard", label: "İzleme panosu doğrulaması ayrı", tone: "warning" },
];

const summaryActions: OperationSummaryAction[] = [
  {
    detail: "Uyarı ve hata izleme kanalları test olayıyla doğrulanır",
    key: "alert-channel",
    label: "Uyarı kanalı",
    status: "Deneme gerekir",
    tone: "warning",
    value: "Canlı kanıt",
  },
  {
    detail: "İzleme panosu ve uygulama kayıtları ortam raporuyla doğrulanır",
    key: "dashboard",
    label: "İzleme panoları",
    status: "Ayrı kontrol",
    tone: "warning",
    value: "Deneme/canlı ortam",
  },
];

export function ObservabilityPage() {
  const dashboardRows = buildChecklistRows(dashboardPanels, "Ortam doğrulaması gerekir", "İzleme panosu ve uygulama kayıtları deneme veya canlı ortam raporuyla doğrulanır.", "warning");
  const alertRows = buildChecklistRows(alertRules, "Deneme gerekir", "Uyarı ve hata izleme kanalları kişisel veri içermeyen bir test olayıyla doğrulanır.", "warning");
  const telemetryRows = buildChecklistRows(telemetryChecks, "Doğrulama gerekir", "Bu teknik kontrol deneme veya canlı ortam raporunda tamamlanır.", "info");

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Sistem İzleme"
      subtitle="Tüm kurumları etkileyen izleme panoları, uyarı kuralları ve hata izleme denemeleri için kabul listesi."
    >
      <OperationSummary
        actions={summaryActions}
        ariaLabel="Sistem izleme özeti"
        badges={summaryBadges}
        items={[
          { description: "Doğrulanacak izleme panosu", key: "dashboards", label: "İzleme panoları", tone: "warning", value: String(dashboardPanels.length) },
          { description: "Denenecek uyarı kuralı", key: "alerts", label: "Uyarı kuralları", tone: "warning", value: String(alertRules.length) },
          { description: "Yayın öncesi teknik kontrol", key: "gates", label: "Teknik kontroller", tone: "info", value: String(observabilityGates.length) },
        ]}
      />
      <EvidenceTrustPanel
        ariaLabel="Sistem izleme doğrulama durumu"
        title="İzleme Bilgileri Nasıl Doğrulanır?"
        description="Anlık uygulama ve bağlantı durumu Sistem Sağlığı ekranından okunur. İzleme panoları, kayıtlar ve uyarı kanalları deneme ortamında doğrulanır."
        items={[
          {
            label: "Uyarı kanalı",
            value: "Deneme gerekir",
            tone: "warning",
            scope: "live-required",
            detail: "Uyarı ve hata izleme kanalları kişisel veri içermeyen bir test olayıyla doğrulanır.",
          },
          {
            label: "İzleme panoları",
            value: "Deneme/canlı ortam",
            tone: "danger",
            scope: "staging-prod",
            detail: "İzleme panosu ve uygulama kayıtları ortam raporuyla doğrulanır.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Sistem ölçümleri izleme panosundan okunur."
        reason="Ölçümler tüm kurumların toplam trafiğini içerdiği için yalnız izleme sistemine açılır."
        nextStep="Uyarı ve hata izleme denemelerini deneme ortamında çalıştırıp raporunu ekleyin."
      />
      <Panel
        aria-label="İzleme panoları"
        description="Temel sistem göstergeleri ve uygulama kayıtları."
        title="İzleme Panoları"
      >
        <DataTable
          caption="Sistem izleme panoları"
          columns={checklistColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={dashboardRows}
        />
      </Panel>
      <Panel
        aria-label="Uyarı kuralları"
        description="Uyarı kuralları, bildirim ve hata izleme kanallarında denenmeden yayın onayı verilmez."
        title="Uyarı Kuralları"
      >
        <DataTable
          caption="Sistem uyarı kuralları"
          columns={checklistColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={alertRows}
        />
      </Panel>
      <details>
        <summary>İleri ayrıntılar</summary>
        <EvidenceGateSection title="Yayın Öncesi Teknik Kontroller" ariaLabel="Sistem izleme teknik kontrolleri" gates={observabilityGates} />
        <Panel
          aria-label="Teknik izleme kontrolleri"
          description="Sistem ölçümleri, izleme panoları, kayıtlar ve uyarı kanalları ortam raporuyla doğrulanır."
          title="Teknik İzleme Kontrolleri"
        >
          <DataTable
            caption="Teknik sistem izleme kontrolleri"
            columns={checklistColumns}
            density="compact"
            getRowKey={(row) => row.key}
            rows={telemetryRows}
          />
        </Panel>
      </details>
    </PageFrame>
  );
}

const checklistColumns: Array<DataTableColumn<ObservabilityChecklistRow>> = [
  {
    key: "item",
    header: "Kontrol",
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
    key: "detail",
    header: "Açıklama",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.detail,
  },
];

function buildChecklistRows(
  items: readonly string[],
  value: string,
  detail: string,
  tone: StatusBadgeProps["tone"],
): ObservabilityChecklistRow[] {
  return items.map((item) => ({
    detail,
    key: item,
    label: item,
    tone,
    value,
  }));
}
