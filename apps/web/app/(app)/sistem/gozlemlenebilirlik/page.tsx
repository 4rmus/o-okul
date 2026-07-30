import { ReferenceSystemPage } from "../system-reference-page.js";

export default function SistemGozlemlenebilirlikPage() {
  return (
    <ReferenceSystemPage
      title="Sistem İzleme"
      subtitle="Tüm kurumları etkileyen çalışma durumu, kayıtlar ve uyarılar için kontrol listesi."
      items={["Sistem ölçümleri", "İzleme panosu", "Uygulama kayıtları", "Uyarı bildirimleri"]}
    />
  );
}
