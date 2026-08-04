import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { webHostContext } from "../../../src/tenant-host.js";
import { TenantLoginPage } from "../tenant-login-page.js";

export default async function LoginPage() {
  const requestHeaders = await headers();
  const host = webHostContext(requestHeaders.get("host"), process.env.DOMAIN);
  if (host.kind === "root") redirect("/login");
  if (host.kind === "invalid") notFound();
  if (host.kind === "system") return <TenantLoginPage tenantSlug="system" canonicalHost />;
  if (host.kind === "tenant") return <TenantLoginPage tenantSlug={host.slug} canonicalHost />;
  return <TenantLoginPage />;
}
