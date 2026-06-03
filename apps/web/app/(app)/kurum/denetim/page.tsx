import { AuditLogsPage } from "./audit-logs-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Denetim">
      <AuditLogsPage />
    </PageFrame>
  );
}
