interface EvidenceGate {
  command: string;
  detail: string;
  status: string;
  title: string;
}

interface EvidenceGateSectionProps {
  ariaLabel: string;
  gates: readonly EvidenceGate[];
  title: string;
}

interface EvidenceListSectionProps {
  ariaLabel: string;
  items: readonly string[];
  title: string;
}

export function EvidenceGateSection({ ariaLabel, gates, title }: EvidenceGateSectionProps) {
  return (
    <section className="next-report-list" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {gates.map((gate) => (
        <article key={gate.title}>
          <h3>{gate.title}</h3>
          <p>{gate.status}</p>
          <p>{gate.detail}</p>
          <code>{gate.command}</code>
        </article>
      ))}
    </section>
  );
}

export function EvidenceListSection({ ariaLabel, items, title }: EvidenceListSectionProps) {
  return (
    <section className="next-report-list" aria-label={ariaLabel}>
      <h2>{title}</h2>
      {items.map((item) => (
        <p key={item}>{item}</p>
      ))}
    </section>
  );
}
