import { EvidenceTrustPanel, ReferenceBadge } from "../kurum/_shared/evidence-panels.js";
import { PageFrame } from "../kurum/_shared/page-frame.js";
import { Panel, StatusBadge } from "@uzman-hocam/ui";

export function ReferenceSystemPage({
  items,
  subtitle,
  title,
}: {
  items: readonly string[];
  subtitle: string;
  title: string;
}) {
  return (
    <PageFrame actions={<ReferenceBadge />} title={title} subtitle={subtitle}>
      <EvidenceTrustPanel
        ariaLabel={`${title} güven durumu`}
        title="Sistem Referans Kanıtı"
        description="Bu ekran sistem admin için modül kapsamını gösterir; staging/prod/live evidence yerine geçmez."
        items={[
          {
            label: "Ekran türü",
            value: "Referans",
            tone: "info",
            scope: "ui-safe",
            detail: "Operasyonel kontrol listesi sunar, gizli sistem verisi veya PII göstermez.",
          },
          {
            label: "Kanıt seviyesi",
            value: "Statik",
            tone: "warning",
            scope: "local-static",
            detail: "Canlı durum için ilgili smoke ve evidence dosyaları ayrıca çalıştırılır.",
          },
          {
            label: "Aksiyon",
            value: "Salt-okuma",
            tone: "success",
            scope: "server-audit",
            detail: "Bu yüzeyden production işlemi veya destructive aksiyon tetiklenmez.",
          },
        ]}
      />
      <Panel
        aria-label={`${title} referans kontrol listesi`}
        className="next-system-reference"
        description={`${items.length} salt-okuma kontrol başlığı`}
        title="Operasyon referansı"
      >
        <ol className="next-system-reference__list">
          {items.map((item, index) => (
            <li key={item}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <strong>{item}</strong>
              <StatusBadge tone="warning">Statik kanıt</StatusBadge>
            </li>
          ))}
        </ol>
      </Panel>
    </PageFrame>
  );
}
