import { assertValidTenantSlug } from "./tenant-host.js";

export function tenantWebUrl(
  path: string,
  tenantSlug: string,
  env: NodeJS.ProcessEnv = process.env,
): URL {
  const fallback = new URL(path, env.WEB_URL ?? "http://localhost:3000");
  const domain = env.DOMAIN?.trim().toLowerCase();
  if (!domain || fallback.hostname === "localhost" || fallback.hostname === "127.0.0.1") return fallback;
  const slug = tenantSlug === "system" ? "sistem" : assertValidTenantSlug(tenantSlug);
  fallback.hostname = `${slug}.${domain}`;
  return fallback;
}
