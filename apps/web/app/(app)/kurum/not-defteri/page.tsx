import { PageFrame } from "../_shared/page-frame.js";
import { GradebookAdminPage } from "./gradebook-admin-page.js";

export default function Page() {
  return (
    <PageFrame title="Not Defteri">
      <GradebookAdminPage />
    </PageFrame>
  );
}
