import { MessageTemplatesPage } from "./message-templates-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Şablonlar">
      <MessageTemplatesPage />
    </PageFrame>
  );
}
