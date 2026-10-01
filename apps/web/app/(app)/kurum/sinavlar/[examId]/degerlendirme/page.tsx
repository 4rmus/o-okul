import { ExamEvaluationPage } from "../../exam-evaluation-page.js";

export default async function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params;
  return <ExamEvaluationPage examId={examId} />;
}
