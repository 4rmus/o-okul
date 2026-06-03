import { AnnouncementsPage } from "./announcements-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Duyurular">
      <AnnouncementsPage />
    </PageFrame>
  );
}
