import { TeacherDetailPage } from "../teacher-detail-page.js";

export default async function Page({ params }: { params: Promise<{ teacherId: string }> }) {
  const { teacherId } = await params;
  return <TeacherDetailPage teacherId={teacherId} />;
}
