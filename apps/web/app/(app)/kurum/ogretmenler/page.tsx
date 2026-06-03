import { TeachersPage } from "./teachers-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Öğretmenler">
      <TeachersPage />
    </PageFrame>
  );
}
