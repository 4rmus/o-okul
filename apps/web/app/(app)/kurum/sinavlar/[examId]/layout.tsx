import type { ReactNode } from "react";

export default function ExamWorkspaceLayout({ children }: { children: ReactNode }) {
  return <section data-exam-workspace-layout="read-only">{children}</section>;
}
