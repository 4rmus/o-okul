import { ReferenceSystemPage } from "../system-reference-page.js";

export default function SistemGozlemlenebilirlikPage() {
  return (
    <ReferenceSystemPage
      title="Gözlemlenebilirlik"
      subtitle="Global metrik, log ve alert görünümü için başlangıç referansı."
      items={["Prometheus scrape", "Grafana dashboard", "Loki log panel", "Alert webhook"]}
    />
  );
}
