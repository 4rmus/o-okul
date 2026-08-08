import { ReferenceSystemPage } from "../system-reference-page.js";

export default function SistemDenetimPage() {
  return (
    <ReferenceSystemPage
      title="Denetim"
      subtitle="Platform genel denetim kayıtları için başlangıç referansı."
      items={["Kurum oluşturuldu.", "Kurum bilgileri güncellendi.", "Kullanıcı kuruma eklendi.", "Kullanıcı yetkileri güncellendi."]}
    />
  );
}
