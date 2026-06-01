import { StudentDetailPage } from "../student-detail-page.js";

export default async function Page({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  return <StudentDetailPage studentId={studentId} />;
}
