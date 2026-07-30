import { EvidenceTrustPanel, ReferenceBadge } from "../kurum/_shared/evidence-panels.js";
import { PageFrame } from "../kurum/_shared/page-frame.js";
import { Panel, StatusBadge } from "@o-okul/ui";

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
        title="Sistem Kontrol Listesi"
        description="Bu ekran sistem yöneticisine kontrol edilecek başlıkları gösterir. Canlı durum, ilgili doğrulama ekranından ayrıca incelenir."
        items={[
          {
            label: "Ekran türü",
            value: "Kontrol listesi",
            tone: "info",
            scope: "ui-safe",
            detail: "Gizli sistem bilgisi veya kişisel veri göstermeden kontrol başlıklarını listeler.",
          },
          {
            label: "Bilgi düzeyi",
            value: "Ön kontrol",
            tone: "warning",
            scope: "local-static",
            detail: "Canlı durum için ilgili doğrulama adımları ayrıca çalıştırılır.",
          },
          {
            label: "İşlem",
            value: "Yalnızca görüntüleme",
            tone: "success",
            scope: "server-audit",
            detail: "Bu ekrandan canlı sistemi değiştiren veya veri silen bir işlem başlatılmaz.",
          },
        ]}
      />
      <Panel
        aria-label={`${title} referans kontrol listesi`}
        className="next-system-reference"
        description={`${items.length} kontrol başlığı`}
        title="Kontrol Başlıkları"
      >
        <ol className="next-system-reference__list">
          {items.map((item, index) => (
            <li key={item}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <strong>{item}</strong>
              <StatusBadge tone="warning">Ön kontrol</StatusBadge>
            </li>
          ))}
        </ol>
      </Panel>
    </PageFrame>
  );
}
