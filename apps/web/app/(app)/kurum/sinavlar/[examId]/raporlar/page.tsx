import { ReportsPage } from "../../../raporlar/reports-page.js";
import { ExamWorkspaceRoute } from "../../exam-workspace-route.js";

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return (
    <ExamWorkspaceRoute
      activeSection="reports"
      examId={examId}
      fallbackHref={`/kurum/raporlar?examId=${encodeURIComponent(examId)}`}
    >
      <ReportsPage fixedExamId={examId} />
    </ExamWorkspaceRoute>
  );
}
