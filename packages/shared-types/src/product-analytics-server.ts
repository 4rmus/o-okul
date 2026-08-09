import { createHmac } from "node:crypto";
import type { TenantPseudonym } from "./product-analytics.js";

export function createTenantPseudonym(tenantId: string, hmacKey: string): TenantPseudonym {
  if (!tenantId.trim() || hmacKey.length < 32) {
    throw new Error("TENANT_PSEUDONYM_INPUT_INVALID");
  }
  return createHmac("sha256", hmacKey)
    .update("o-okul:product-analytics:tenant:v1\0")
    .update(tenantId)
    .digest("hex") as TenantPseudonym;
}
