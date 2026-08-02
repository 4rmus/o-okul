import { PageFrame } from "../_shared/page-frame.js";
import { LicenseTermsPage } from "./license-terms-page.js";

export default function Page() {
  return (
    <PageFrame title="Lisans Dönemleri" subtitle="Kurumun sözleşme dönemlerini ve erişim durumunu görüntüleyin.">
      <LicenseTermsPage />
    </PageFrame>
  );
}
