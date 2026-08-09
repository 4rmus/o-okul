import { ParserConfigPage } from "../../../optik/parser-config-page.js";
import { ExamWorkspaceRoute } from "../../exam-workspace-route.js";

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return (
    <ExamWorkspaceRoute
      activeSection="optical"
      examId={examId}
      fallbackHref={`/kurum/optik?examId=${encodeURIComponent(examId)}`}
    >
      <ParserConfigPage fixedExamId={examId} />
    </ExamWorkspaceRoute>
  );
}
