import { GuardianDetailPage } from "../guardian-detail-page.js";

export default async function Page({ params }: { params: Promise<{ guardianId: string }> }) {
  const { guardianId } = await params;
  return <GuardianDetailPage guardianId={guardianId} />;
}
