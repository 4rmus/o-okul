import { ReferenceSystemPage } from "../system-reference-page.js";

export default function SistemSagligiPage() {
  return (
    <ReferenceSystemPage
      title="Sistem Sağlığı"
      subtitle="Global sağlık görünümü canlı metriklere bağlanana kadar sistem-admin referans ekranı."
      items={["API health", "Readiness", "Queue", "Postgres", "Redis"]}
    />
  );
}
