import type { ReactNode } from "react";
import { ReportWorkspace } from "../../../raporlar/report-workspace.js";

// Rapor sekmeleri ayrı URL'lerdir; bileşen layout'ta kalır ki seçili öğrenci ve rapor verisi korunsun.
export default async function ReportWorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return (
    <>
      <ReportWorkspace examId={examId} />
      {children}
    </>
  );
}
