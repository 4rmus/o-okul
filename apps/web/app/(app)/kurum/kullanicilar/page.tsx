import { UsersPage } from "./users-page.js";
import { PageFrame } from "../_shared/page-frame.js";

export default function Page() {
  return (
    <PageFrame title="Kullanıcılar">
      <UsersPage />
    </PageFrame>
  );
}
