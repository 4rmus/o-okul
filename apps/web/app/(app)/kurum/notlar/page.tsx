import { TeacherNotesPage } from "./teacher-notes-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Öğretmen Notları">
      <TeacherNotesPage />
    </PageFrame>
  );
}
