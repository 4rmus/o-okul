import { ExamWorkspacePage } from "../exam-workspace-page.js";

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <ExamWorkspacePage examId={examId} />;
}
