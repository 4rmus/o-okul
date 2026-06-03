import { FinancePage } from "./finance-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Finans">
      <FinancePage />
    </PageFrame>
  );
}
