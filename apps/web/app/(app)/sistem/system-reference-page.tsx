import { ReferenceBadge } from "../kurum/_shared/evidence-panels.js";
import { PageFrame } from "../kurum/_shared/page-frame.js";

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
      <section className="next-report-list" aria-label={title}>
        <h2>Referans</h2>
        {items.map((item) => (
          <p key={item}>{item}</p>
        ))}
      </section>
    </PageFrame>
  );
}
