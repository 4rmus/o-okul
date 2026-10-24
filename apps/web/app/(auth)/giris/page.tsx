import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { isLogoutPendingValue, loginPathAfterLogout, logoutPendingParam } from "../../../src/logout-pending.js";
import { webHostContext } from "../../../src/tenant-host.js";
import { TenantLoginPage } from "../tenant-login-page.js";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requestHeaders = await headers();
  const host = webHostContext(requestHeaders.get("host"), process.env.DOMAIN);
  // Only the unconfirmed-logout flag survives the redirect, so the login page does not resume that session.
  if (host.kind === "root") redirect(loginPathAfterLogout("/login", isLogoutPendingValue((await searchParams)[logoutPendingParam])));
  if (host.kind === "invalid") notFound();
  if (host.kind === "system") return <TenantLoginPage tenantSlug="system" canonicalHost />;
  if (host.kind === "tenant") return <TenantLoginPage tenantSlug={host.slug} canonicalHost />;
  return <TenantLoginPage />;
}
