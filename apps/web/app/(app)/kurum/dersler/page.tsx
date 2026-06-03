import { CoursesPage } from "./courses-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Dersler">
      <CoursesPage />
    </PageFrame>
  );
}
