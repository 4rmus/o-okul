import { MessageTemplatesPage } from "./message-templates-page.js";
import { PageFrame } from "../_shared/page-frame.js";
import { isSmsEnabled } from "../../../../src/sms-feature.js";

export default function Page() {
  if (!isSmsEnabled) return null;

  return (
    <PageFrame title="Şablonlar">
      <MessageTemplatesPage />
    </PageFrame>
  );
}
