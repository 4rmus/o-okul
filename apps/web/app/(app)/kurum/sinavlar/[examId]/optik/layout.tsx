import type { ReactNode } from "react";
import { OpticalWorkspace } from "../../../optik/optical-workspace.js";

// Optik sekmeleri ayrı URL'lerdir; bileşen layout'ta kalır ki yükleme → eşleşmeyenler durumu korunsun.
export default async function OpticalWorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return (
    <>
      <OpticalWorkspace examId={examId} />
      {children}
    </>
  );
}
