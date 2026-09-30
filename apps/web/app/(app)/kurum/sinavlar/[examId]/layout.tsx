import type { ReactNode } from "react";
import { ExamWorkspaceFrame } from "../exam-workspace-frame.js";

export default async function ExamWorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <ExamWorkspaceFrame examId={examId}>{children}</ExamWorkspaceFrame>;
}
