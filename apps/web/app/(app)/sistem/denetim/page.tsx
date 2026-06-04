import { ReferenceSystemPage } from "../system-reference-page.js";

export default function SistemDenetimPage() {
  return (
    <ReferenceSystemPage
      title="Denetim"
      subtitle="Platform genel denetim kayıtları için başlangıç referansı."
      items={["tenant.created", "tenant.updated", "user.membership_created", "user.roles_updated"]}
    />
  );
}
