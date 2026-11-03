import { ClassDetailPage } from "../class-detail-page.js";
import { ClassOverviewPanels } from "./class-overview-panels.js";

export default async function Page({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = await params;
  return <ClassDetailPage classId={classId} overviewPanels={<ClassOverviewPanels classId={classId} />} />;
}
