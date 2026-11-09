import { headers } from "next/headers";
import type { ReactNode } from "react";
import { webHostContext } from "../../src/tenant-host.js";
import { AppearanceSelect } from "../../src/appearance-select.js";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers();
  const host = webHostContext(requestHeaders.get("host"), process.env.DOMAIN);
  const tenantSlug = host.kind === "tenant" ? host.slug : host.kind === "system" ? "system" : undefined;
  return <main className="next-auth-layout" data-tenant-slug={tenantSlug}><div className="next-auth-appearance"><AppearanceSelect /></div>{children}</main>;
}
