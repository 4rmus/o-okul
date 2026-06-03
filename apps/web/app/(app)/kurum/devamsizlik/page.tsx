import { AttendancePage } from "./attendance-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Devamsızlık">
      <AttendancePage />
    </PageFrame>
  );
}
