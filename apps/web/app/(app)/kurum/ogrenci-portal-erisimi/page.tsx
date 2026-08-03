import { PageFrame } from "../_shared/page-frame.js";
import { StudentPortalAccessPage } from "./student-portal-access-page.js";

export default function Page() {
  return (
    <PageFrame title="Öğrenci Portal Erişimi" subtitle="Öğrenci kaydı, davet, hesap, üyelik ve aktif oturum durumunu görüntüleyin.">
      <StudentPortalAccessPage />
    </PageFrame>
  );
}
