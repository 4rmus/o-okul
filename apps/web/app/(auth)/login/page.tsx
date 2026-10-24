import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLogoutPendingValue, loginPathAfterLogout, logoutPendingParam } from "../../../src/logout-pending.js";
import { webHostContext } from "../../../src/tenant-host.js";
import { TenantLocatorPage } from "../tenant-locator-page.js";
import { TenantLoginPage } from "../tenant-login-page.js";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requestHeaders = await headers();
  const domain = process.env.DOMAIN?.trim().toLowerCase();
  const host = webHostContext(requestHeaders.get("host"), domain);
  // Only the unconfirmed-logout flag survives the redirect, so the login page does not resume that session.
  if (host.kind === "tenant" || host.kind === "system") redirect(loginPathAfterLogout("/giris", isLogoutPendingValue((await searchParams)[logoutPendingParam])));
  if (host.kind === "root" && domain) return <TenantLocatorPage domain={domain} />;
  return <TenantLoginPage />;
}
