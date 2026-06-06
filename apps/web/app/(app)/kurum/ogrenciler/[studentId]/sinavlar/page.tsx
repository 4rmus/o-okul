import { StudentDetailPage } from "../../student-detail-page.js";

export default async function StudentExamDetailRoute({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <StudentDetailPage mode="exams" studentId={studentId} />;
}
