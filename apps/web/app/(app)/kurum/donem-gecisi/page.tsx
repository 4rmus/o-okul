import { PageFrame } from "../_shared/page-frame.js";
import { TermTransitionWizard } from "./term-transition-wizard.js";

export default function Page() {
  return (
    <PageFrame subtitle="Yeni akademik yıla ve döneme geçişi adım adım yapın." title="Dönem Geçişi">
      <TermTransitionWizard />
    </PageFrame>
  );
}
