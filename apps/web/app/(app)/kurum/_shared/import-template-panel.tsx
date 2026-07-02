interface ImportTemplatePanelProps {
  className?: string;
}

const importTemplates = [
  { href: "/templates/ogretmen-aktarim-sablonu.xlsx", label: "Öğretmen XLSX şablonu" },
  { href: "/templates/ogrenci-aktarim-sablonu.xlsx", label: "Öğrenci XLSX şablonu" },
] as const;

export function ImportTemplatePanel({ className }: ImportTemplatePanelProps) {
  return (
    <section aria-label="Aktarım şablonları" className={className ?? "next-onboarding-template-panel"}>
      <div>
        <h3>Aktarım şablonları</h3>
        <p>Öğretmen ve öğrenci aktarımı için sade, boş ve uygulama alanlarına uyumlu dosyalar.</p>
      </div>
      <div className="next-onboarding-template-actions">
        {importTemplates.map((template) => (
          <a className="uh-button uh-button--secondary uh-button--md" href={template.href} key={template.href} download>
            {template.label}
          </a>
        ))}
      </div>
    </section>
  );
}
