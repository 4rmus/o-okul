import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { webHostContext } from "../../../src/tenant-host.js";
import { TenantLocatorPage } from "../tenant-locator-page.js";
import { TenantLoginPage } from "../tenant-login-page.js";

export default async function LoginPage() {
  const requestHeaders = await headers();
  const domain = process.env.DOMAIN?.trim().toLowerCase();
  const host = webHostContext(requestHeaders.get("host"), domain);
  if (host.kind === "tenant" || host.kind === "system") redirect("/giris");
  if (host.kind === "root" && domain) return <TenantLocatorPage domain={domain} />;
  return <TenantLoginPage />;
}
