import { TenantLoginPage } from "../../../tenant-login-page.js";

export default async function Page({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  return <TenantLoginPage tenantSlug={tenantSlug} />;
}
