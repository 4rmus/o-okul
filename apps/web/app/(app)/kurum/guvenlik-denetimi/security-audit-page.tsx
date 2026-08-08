"use client";

import { useQuery } from "@tanstack/react-query";
import type { AuditLogListItemRecord } from "@o-okul/shared-types";
import { DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiListRequest, withQueryParams } from "../../../../src/api-client.js";
import { EvidenceTrustPanel, OperationDecisionNotice, ReferenceBadge } from "../_shared/evidence-panels.js";
import { PageFrame } from "../_shared/page-frame.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

const securityGates = [
  {
    title: "Güvenlik denetimi",
    command: "SECURITY_AUDIT_TARGET=file://$PWD/docs/evidence-templates/security-audit.example.json pnpm security:audit:check",
    status: "Kanıt raporu gerekir",
    evidenceState: "Yayın kararı için yeterli değil",
    scope: "Bu ekrandaki bilgi",
    tone: "warning",
    detail: "Deneme veya canlı ortam güvenlik raporu başarılı olmalı ve kritik bulgu içermemelidir.",
  },
  {
    title: "Canlı ortam ayarları",
    command: "pnpm prod:env:check",
    status: "Canlı ortam gerekir",
    evidenceState: "Deneme/canlı ortam",
    scope: "Deneme/canlı ortam",
    tone: "danger",
    detail: "Oturum, bağlantı, hizmet sağlayıcı ve diğer güvenlik ayarları doğrulanır.",
  },
  {
    title: "Canlı veritabanı erişimi",
    command: "pnpm db:rls:check:live",
    status: "Canlı DB gerekir",
    evidenceState: "Canlı kanıt",
    scope: "Canlı veritabanı",
    tone: "danger",
    detail: "Her kurumun yalnız kendi verisine erişebildiği canlı veritabanında kontrol edilir.",
  },
  {
    title: "Güvenli bağlantı",
    command: "pnpm traefik:https:smoke",
    status: "Deneme veya canlı adres gerekir",
    evidenceState: "Deneme/canlı ortam",
    scope: "Deneme/canlı ortam",
    tone: "danger",
    detail: "Güvenli bağlantı ve tarayıcı güvenlik ayarları uçtan uca doğrulanır.",
  },
] as const;

const securityHeaders = [
  buildSecurityControl("Strict-Transport-Security", "Yanıt başlığı gerekir", "Deneme/canlı ortam", "HTTPS kontrolü ve canlı ortam yanıt başlığı kanıtında doğrulanır.", "warning"),
  buildSecurityControl("X-Content-Type-Options", "Yanıt başlığı gerekir", "Deneme/canlı ortam", "İçerik türü algılama koruması canlı ortam yanıt başlığı kanıtında doğrulanır.", "warning"),
  buildSecurityControl("X-Frame-Options", "Yanıt başlığı gerekir", "Deneme/canlı ortam", "Sayfanın izinsiz çerçevelenmesine karşı koruma canlı ortam yanıt başlığı kanıtında doğrulanır.", "warning"),
  buildSecurityControl("Referrer-Policy", "Yanıt başlığı gerekir", "Deneme/canlı ortam", "Yönlendiren adres bilgisinin sızmasını azaltan ayar canlı ortam yanıt başlığı kanıtında doğrulanır.", "warning"),
  buildSecurityControl("Permissions-Policy", "Yanıt başlığı gerekir", "Deneme/canlı ortam", "Tarayıcı yetki sınırları canlı ortam yanıt başlığı kanıtında doğrulanır.", "warning"),
  buildSecurityControl("Content-Security-Policy", "Yanıt başlığı gerekir", "Deneme/canlı ortam", "İçerik güvenliği politikası canlı ortam yanıt başlığı kanıtında doğrulanır.", "warning"),
] as const;

const authControls = [
  buildSecurityControl("Güvenli çerez ayarı (COOKIE_SECURE=true)", "Canlı ortam", "Oturum ayarları", "Güvenli çerez ayarı canlı ortamda doğrulanır.", "warning"),
  buildSecurityControl("Hatalı giriş sınırı", "Oturum kontrolü", "Giriş güvenliği", "Arka arkaya hatalı girişlerde hesabın geçici olarak korunmaya alındığı doğrulanır.", "warning"),
  buildSecurityControl("Güçlü oturum anahtarları", "Canlı ortam", "Oturum ayarları", "Oturum anahtarlarının gücü ve yenilenmesi canlı ortamda doğrulanır.", "warning"),
  buildSecurityControl("Oturum yenileme ve iptal", "Oturum kontrolü", "Giriş güvenliği", "Yenilenen oturumların gerektiğinde iptal edilebildiği doğrulanır.", "warning"),
] as const;

const dataControls = [
  buildSecurityControl("Canlı veritabanı erişim kontrolü", "Canlı doğrulama", "Canlı veritabanı", "Her kurumun yalnız kendi verisine erişebildiği canlı veritabanında doğrulanır.", "danger"),
  buildSecurityControl("Kurum verisi ayrımı", "Kurum / kişisel veri", "Sunucu ve veritabanı", "Kurum verilerinin yalnız arayüz filtresiyle değil, sunucu ve veritabanı kurallarıyla ayrıldığı doğrulanır.", "warning"),
  buildSecurityControl("İşlem kayıtlarında kişisel veri gizleme", "Kişisel veriler gizli", "Sunucu kayıtları", "Kullanıcı anahtarları, değişiklik ayrıntıları ve kişisel veriler işlem kayıtlarında gösterilmez.", "success"),
  buildSecurityControl("Hata izleme kişisel veri ayarı", "Kişisel veri kapalı", "Canlı ortam ayarları", "Hata izleme hizmetine varsayılan kişisel veri gönderimi kapalı tutulur.", "warning"),
] as const;

interface SecurityControlRow {
  detail: string;
  key: string;
  label: string;
  scope: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

interface SecurityControlDefinition {
  detail: string;
  label: string;
  scope: string;
  tone: StatusBadgeProps["tone"];
  value: string;
}

export function SecurityAuditPage() {
  const { auth } = useAuth();
  const securityEventsQuery = useQuery({
    queryKey: ["next-security-audit-events", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadSecurityEvents(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const securityEvents = securityEventsQuery.data ?? [];
  const securitySummaryItems = buildSecuritySummaryItems(securityEvents);
  const securitySummaryBadges = buildSecuritySummaryBadges(securityEvents);
  const securitySummaryActions = buildSecuritySummaryActions(securityEvents);
  const securityGateRows = buildSecurityGateRows();
  const securityHeaderRows = buildSecurityControlRows(securityHeaders);
  const authControlRows = buildSecurityControlRows(authControls);
  const dataControlRows = buildSecurityControlRows(dataControls);

  return (
    <PageFrame
      actions={<ReferenceBadge />}
      title="Güvenlik Denetimi"
      subtitle="Canlıya geçmeden önce bağlantı, oturum ve veri güvenliği kontrollerini izleyin."
    >
      <OperationSummary
        actions={securitySummaryActions}
        ariaLabel="Güvenlik durumu özeti"
        badges={securitySummaryBadges}
        items={securitySummaryItems}
      />
      <EvidenceTrustPanel
        ariaLabel="Güvenlik güven durumu"
        title="Güvenlik Doğrulama Durumu"
        description="Bu ekran son güvenlik olaylarını gösterir. Canlıya geçiş için deneme ve canlı ortam kontrolleri ayrıca tamamlanmalıdır."
        items={[
          {
            label: "Bu ekrandaki bilgiler",
            value: "Yalnızca görüntüleme",
            tone: "info",
            scope: "server-audit",
            detail: "İşlem kayıtlarının özetidir; gizli bulgular ve kişisel veriler gösterilmez.",
          },
          {
            label: "Kod kontrolleri",
            value: "Ön kontrol",
            tone: "warning",
            scope: "local-static",
            detail: "Kod ve örnek rapor kontrolleri canlı ortam doğrulamasının yerine geçmez.",
          },
          {
            label: "Canlı ortam doğrulaması",
            value: "Gerekli",
            tone: "danger",
            scope: "staging-prod",
            detail: "Güvenli bağlantı, canlı ortam ayarları ve kurum verisi ayrımı ayrıca doğrulanır.",
          },
        ]}
      />
      <OperationDecisionNotice
        decision="Son güvenlik olayları bu ekranda yalnızca görüntülenir."
        reason="Kullanıcı, KVKK ve kurum olayları kişisel veriler gizlenerek listelenir; ayrıntılı güvenlik raporu ayrı tutulur."
        nextStep="Canlıya geçmeden önce aşağıdaki bağlantı, oturum ve veri kontrollerini tamamlayın."
      />
      <Panel
        aria-label="Son güvenlik olayları"
        description="Olay türü, ilgili kayıt ve tarih gösterilir; kullanıcı anahtarları, değişiklik ayrıntıları ve kişisel veriler gizlenir."
        title="Son Güvenlik Olayları"
      >
        {securityEventsQuery.isPending ? <p>Olaylar alınıyor</p> : null}
        {securityEventsQuery.isError ? <p>Güvenlik olayları alınamadı.</p> : null}
        <DataTable
          caption="Güvenlik olayları"
          columns={securityEventColumns}
          density="compact"
          description="Kimlik, KVKK, kurum ve kullanıcı olayları kişisel veriler gizlenerek listelenir."
          emptyText="Güvenlik olayı yok"
          error={securityEventsQuery.isError ? "Güvenlik olayları alınamadı." : undefined}
          getRowKey={(event) => event.id}
          loading={securityEventsQuery.isPending}
          rows={securityEventsQuery.isError ? [] : securityEvents}
        />
      </Panel>
      <Panel
        aria-label="Canlıya geçiş güvenlik kontrolleri"
        description="Güvenlik raporu, canlı ortam ayarları, kurum verisi ayrımı ve güvenli bağlantı ayrı ayrı doğrulanır."
        title="Canlıya Geçiş Kontrolleri"
      >
        <DataTable
          caption="Canlıya geçiş güvenlik kontrolleri"
          columns={securityControlColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={securityGateRows}
        />
      </Panel>
      <Panel
        aria-label="Bağlantı güvenliği kontrolleri"
        description="Tarayıcı ve sunucu arasındaki güvenlik ayarları deneme ve canlı ortam adreslerinde doğrulanır."
        title="Bağlantı Güvenliği"
      >
        <DataTable
          caption="Bağlantı güvenliği kontrolleri"
          columns={securityControlColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={securityHeaderRows}
        />
      </Panel>
      <Panel
        aria-label="Oturum güvenliği kontrolleri"
        description="Güvenli çerez, hatalı giriş sınırı ve oturum yenileme davranışı canlı ortam ayarlarıyla doğrulanır."
        title="Oturum Güvenliği"
      >
        <DataTable
          caption="Oturum güvenliği kontrolleri"
          columns={securityControlColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={authControlRows}
        />
      </Panel>
      <Panel
        aria-label="Kurum ve kişisel veri güvenliği kontrolleri"
        description="Kurum verilerinin ayrılması ve kişisel verilerin gizlenmesi, sunucu ve veritabanı kontrolleriyle doğrulanır."
        title="Kurum ve Kişisel Veri Güvenliği"
      >
        <DataTable
          caption="Kurum ve kişisel veri güvenliği kontrolleri"
          columns={securityControlColumns}
          density="compact"
          getRowKey={(row) => row.key}
          rows={dataControlRows}
        />
      </Panel>
    </PageFrame>
  );
}

const securityEventColumns: Array<DataTableColumn<AuditLogListItemRecord>> = [
  {
    key: "event",
    header: "Olay",
    mobilePriority: "primary",
    priority: "primary",
    render: (event) => (
      <span className="next-report-student-name">
        {formatSecurityEventAction(event)}
        <small>{formatSecurityActionLabel(event)}</small>
      </span>
    ),
    sticky: "left",
  },
  {
    key: "category",
    header: "Kategori",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (event) => <StatusBadge tone={securityEventCategoryTone(event.category)}>{formatSecurityCategory(event.category)}</StatusBadge>,
  },
  {
    key: "entity",
    header: "Kayıt",
    mobilePriority: "primary",
    priority: "primary",
    render: formatSecurityEntityType,
  },
  {
    key: "created",
    header: "Tarih",
    mobilePriority: "hidden",
    priority: "optional",
    render: (event) => formatDate(event.createdAt),
  },
];

const securityControlColumns: Array<DataTableColumn<SecurityControlRow>> = [
  {
    key: "control",
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
    key: "scope",
    header: "Ortam",
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

function buildSecurityGateRows(): SecurityControlRow[] {
  return securityGates.map((gate) => ({
    detail: `${gate.detail} ${gate.command}`,
    key: gate.title,
    label: gate.title,
    scope: gate.scope,
    tone: gate.tone,
    value: gate.evidenceState,
  }));
}

function buildSecurityControlRows(items: readonly SecurityControlDefinition[]): SecurityControlRow[] {
  return items.map((item) => ({
    detail: item.detail,
    key: item.label,
    label: item.label,
    scope: item.scope,
    tone: item.tone,
    value: item.value,
  }));
}

function buildSecurityControl(
  label: string,
  value: string,
  scope: string,
  detail: string,
  tone: StatusBadgeProps["tone"],
): SecurityControlDefinition {
  return {
    detail,
    label,
    scope,
    tone,
    value,
  };
}

function buildSecuritySummaryItems(securityEvents: AuditLogListItemRecord[]): OperationSummaryItem[] {
  return [
    {
      description: "İşlem kayıtlarındaki son güvenlik olayı",
      key: "latest-event",
      label: "Son olay",
      tone: securityEvents[0] ? "info" : "default",
      value: securityEvents[0] ? formatSecurityEventAction(securityEvents[0]) : "Yok",
    },
    {
      description: "Güvenli bağlantı deneme ve canlı ortamda doğrulanır",
      key: "https",
      label: "HTTPS",
      tone: "warning",
      value: "Canlı ortam kontrolü bekliyor",
    },
    {
      description: "Kişisel veriler gizlenerek listelenen olaylar",
      key: "event-count",
      label: "Okunan olay",
      value: formatCount(securityEvents.length),
    },
    {
      description: "Değişiklik ayrıntıları ve kullanıcı anahtarları gösterilmez",
      key: "pii",
      label: "Kişisel veri",
      tone: "success",
      value: "Maskeli",
    },
  ];
}

function buildSecuritySummaryBadges(securityEvents: AuditLogListItemRecord[]): OperationSummaryBadge[] {
  return [
    {
      key: "source",
      label: "Kişisel veriler gizli",
      tone: "success",
    },
    {
      key: "pii",
      label: "Değişiklik ayrıntıları gizli",
      tone: "success",
    },
    {
      key: "release",
      label: "Yayın doğrulaması ayrıca yapılır",
      tone: "warning",
    },
    {
      key: "events",
      label: securityEvents.length > 0 ? "Olay akışı var" : "Olay bekleniyor",
      tone: securityEvents.length > 0 ? "info" : "neutral",
    },
  ];
}

function buildSecuritySummaryActions(securityEvents: AuditLogListItemRecord[]): OperationSummaryAction[] {
  const latestCategory = securityEvents[0] ? formatSecurityCategory(securityEvents[0].category) : "Yok";
  return [
    {
      detail: "Güvenlik olayları kişisel veri içermeyen listeden okunur",
      key: "audit-source",
      label: "Olay kaynağı",
      status: "Kişisel veriler gizli",
      tone: "success",
      value: "Sunucu kaydı",
    },
    {
      detail: "Deneme ve canlı ortam güvenlik raporları ayrıca doğrulanır",
      key: "evidence",
      label: "Canlı ortam kontrolü",
      status: "Ayrı doğrulama",
      tone: "warning",
      value: "Gerekli",
    },
    {
      detail: "Son olay türü bilgi verir; tek başına canlıya geçiş kararı oluşturmaz",
      key: "latest-category",
      label: "Son olay türü",
      status: securityEvents[0] ? "Okundu" : "Bekleniyor",
      tone: securityEvents[0] ? "info" : "neutral",
      value: latestCategory,
    },
  ];
}

async function loadSecurityEvents(accessToken: string) {
  const url = withQueryParams(`${apiBaseUrl}/audit-logs/safe-list`, { limit: "20", sort: "-createdAt" });
  const auditLogs = await apiListRequest<AuditLogListItemRecord>(accessToken, url);
  return auditLogs.data.filter(isSecurityEvent).slice(0, 5);
}

function isSecurityEvent(record: AuditLogListItemRecord) {
  return ["identity", "invitation", "kvkk", "tenant", "user"].includes(record.category);
}

function formatSecurityCategory(category: AuditLogListItemRecord["category"]) {
  if (category === "identity") return "Kimlik";
  if (category === "invitation") return "Davet";
  if (category === "kvkk") return "KVKK";
  if (category === "tenant") return "Kurum";
  if (category === "user") return "Kullanıcı";
  return "Güvenlik";
}

function securityEventCategoryTone(category: AuditLogListItemRecord["category"]): StatusBadgeProps["tone"] {
  if (category === "identity" || category === "kvkk") return "warning";
  if (category === "tenant") return "info";
  return "neutral";
}

function formatSecurityEventAction(event: AuditLogListItemRecord) {
  if (event.category === "identity") return "Kimlik olayı";
  if (event.category === "invitation") return "Davet olayı";
  if (event.category === "kvkk") return "KVKK olayı";
  if (event.category === "tenant") return "Kurum olayı";
  if (event.category === "user") return "Kullanıcı olayı";
  return "Güvenlik olayı";
}

function formatSecurityActionLabel(record: AuditLogListItemRecord) {
  return record.actionLabel;
}

function formatSecurityEntityType(event: AuditLogListItemRecord) {
  return event.entityLabel;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("tr-TR");
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}
