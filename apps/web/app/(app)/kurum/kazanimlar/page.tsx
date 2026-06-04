import { PageFrame } from "../_shared/page-frame.js";
import { LearningOutcomesPage } from "./learning-outcomes-page.js";

export default function Page() {
  return (
    <PageFrame title="Kazanımlar">
      <LearningOutcomesPage />
    </PageFrame>
  );
}
