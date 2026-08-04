export const reservedTenantSlugs = new Set([
  "www", "sistem", "system", "api", "admin", "ops", "evidence", "status", "staging", "mail", "support", "cdn", "assets",
]);

const tenantSlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

export type WebHostContext =
  | { kind: "legacy" }
  | { kind: "root" }
  | { kind: "system" }
  | { kind: "tenant"; slug: string }
  | { kind: "invalid" };

export function webHostContext(rawHost: string | null | undefined, rawDomain: string | undefined): WebHostContext {
  const host = normalizeHost(rawHost);
  const domain = normalizeHost(rawDomain);
  if (!domain || !host || isLocalHost(host)) return { kind: "legacy" };
  if (host === domain) return { kind: "root" };
  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) return { kind: "invalid" };
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes(".")) return { kind: "invalid" };
  if (label === "sistem") return { kind: "system" };
  if (reservedTenantSlugs.has(label) || !tenantSlugPattern.test(label)) return { kind: "invalid" };
  return { kind: "tenant", slug: label };
}

export function tenantLoginOrigin(slug: string, domain: string, protocol = "https:"): string {
  const normalized = slug.trim().toLowerCase();
  if (!tenantSlugPattern.test(normalized) || reservedTenantSlugs.has(normalized)) throw new Error("TENANT_SLUG_INVALID");
  return `${protocol}//${normalized}.${domain}/giris`;
}

export function legacyLoginAllowed(cutoff: string | undefined, now = Date.now()): boolean {
  if (!cutoff?.trim()) return true;
  const parsed = Date.parse(cutoff);
  return Number.isFinite(parsed) && now < parsed;
}

export function browserTenantSlug(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.querySelector<HTMLElement>("main[data-tenant-slug]")?.dataset.tenantSlug || undefined;
}

function normalizeHost(value: string | null | undefined): string | undefined {
  const raw = value?.trim().toLowerCase();
  if (!raw || /[,/@\\\s]/.test(raw)) return undefined;
  return raw.replace(/:\d+$/, "").replace(/\.$/, "");
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
