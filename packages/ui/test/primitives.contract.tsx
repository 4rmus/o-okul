import type { ComponentProps } from "react";
import { ActionCard, InfoGrid, InfoItem, MetricCard, MetricGrid, Panel } from "../src/index.js";

type MetricTone = NonNullable<ComponentProps<typeof MetricCard>["tone"]>;
type MetricSpan = NonNullable<ComponentProps<typeof MetricCard>["span"]>;
type PanelTone = NonNullable<ComponentProps<typeof Panel>["tone"]>;

const metricTone: MetricTone = "info";
const metricSpan: MetricSpan = "wide";
const panelTone: PanelTone = "muted";

export const metricContract = (
  <MetricGrid role="region" aria-label="Rapor metrikleri" className="next-report-summary">
    <MetricCard
      aria-label="Başarı yüzdesi"
      className="next-report-summary__success"
      description="Ana karşılaştırma metriği"
      label="Başarı %"
      span={metricSpan}
      tone={metricTone}
      value="%82,5"
    />
    <MetricCard label="Net" tone="success" value="24,5" />
    <MetricCard label="Soru" value="30" />
  </MetricGrid>
);

export const infoContract = (
  <InfoGrid role="group" aria-label="Rapor bağlamı" className="next-report-context">
    <InfoItem aria-label="Sınav adı" description="Yayınlanan snapshot" label="Sınav" value="LGS Rapor Denemesi" />
    <InfoItem label="Üretim" value="Excel/PDF hazır" />
  </InfoGrid>
);

export const panelContract = (
  <Panel
    actions={<button type="button">Dışa aktar</button>}
    as="form"
    aria-label="Rapor filtresi"
    description="Tenant kapsamı korunarak rapor hazırlanır."
    onSubmit={(event) => event.preventDefault()}
    title="Rapor çalışma alanı"
    tone={panelTone}
  >
    <label>
      Sınav
      <input name="exam" />
    </label>
  </Panel>
);

export const actionCardContract = (
  <>
    <ActionCard
      as="a"
      badge="İncele"
      context="Portal"
      detail="Soru sayısı bağlamıyla okunur"
      href="#rapor"
      label="Rapor özeti"
      state="Hazır"
      tone="info"
      value="Başarı %"
    />
    <ActionCard
      as="div"
      badge="Tamamlandı"
      detail="Kurum kapsamı doğrulandı"
      label="Operasyon"
      role="listitem"
      tone="success"
      value="4 görev"
    />
  </>
);

// @ts-expect-error MetricCard requires a value for reproducible report metrics.
export const metricWithoutValue = <MetricCard label="Eksik metrik" />;

// @ts-expect-error InfoItem requires both label and value for accessible context cards.
export const infoWithoutValue = <InfoItem label="Eksik bilgi" />;

// @ts-expect-error ActionCard link variant requires href for deterministic navigation.
export const actionCardLinkWithoutHref = <ActionCard as="a" label="Eksik aksiyon" value="Git" />;
