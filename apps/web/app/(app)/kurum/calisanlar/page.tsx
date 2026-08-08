import { PageFrame } from "../_shared/page-frame.js";
import { EmployeesPage } from "./employees-page.js";

export default function Page() {
  return (
    <PageFrame title="Çalışanlar ve Yetkiler" subtitle="Çalışan kaydı ile kurum hesabı ve yetki bağını görüntüleyin.">
      <EmployeesPage />
    </PageFrame>
  );
}
