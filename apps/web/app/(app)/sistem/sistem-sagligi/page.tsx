import { ReferenceSystemPage } from "../system-reference-page.js";

export default function SistemSagligiPage() {
  return (
    <ReferenceSystemPage
      title="Sistem Sağlığı"
      subtitle="Tüm kurumları etkileyen uygulama ve bağlantı durumları için kontrol listesi."
      items={["Uygulama", "Bağlantı durumu", "Arka plan işleri", "Veritabanı", "Hızlı erişim hizmeti"]}
    />
  );
}
