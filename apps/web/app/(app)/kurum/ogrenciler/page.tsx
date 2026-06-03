import { StudentsPage } from "./students-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Öğrenciler">
      <StudentsPage />
    </PageFrame>
  );
}
