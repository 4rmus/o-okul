import { tenantLoginOrigin } from "../../src/tenant-host.js";

export function tenantLoginUrl(baseOrigin: string, tenantSlug: string): string {
  const baseUrl = new URL(baseOrigin);
  return tenantLoginOrigin(tenantSlug, baseUrl.host, baseUrl.protocol);
}
