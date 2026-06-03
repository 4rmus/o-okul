import { ScheduleLessonsPage } from "./schedule-lessons-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Ders Programı">
      <ScheduleLessonsPage />
    </PageFrame>
  );
}
