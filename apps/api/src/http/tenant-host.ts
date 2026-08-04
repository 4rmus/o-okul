import type { Request } from "express";
import { createTrustedProxyPredicate } from "./trusted-proxy.js";

export const reservedTenantSlugs = new Set([
  "www",
  "sistem",
  "system",
  "api",
  "admin",
  "ops",
  "evidence",
  "status",
  "staging",
  "mail",
  "support",
  "cdn",
  "assets",
]);

export const tenantSlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

export type TenantHostContext =
  | { kind: "legacy" }
  | { kind: "root" }
  | { kind: "system" }
  | { kind: "tenant"; slug: string };

export class TenantHostError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function resolveTenantHostContext(
  request: Pick<Request, "header" | "socket">,
  env: NodeJS.ProcessEnv = process.env,
): TenantHostContext {
  const host = requestHost(request, env);
  const domain = normalizeDomain(env.DOMAIN);
  if (!domain) return { kind: "legacy" };
  if (!host) throw new TenantHostError(404, "TENANT_HOST_UNKNOWN");
  if (isLocalHost(host)) return { kind: "legacy" };
  if (host === domain) return { kind: "root" };

  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) throw new TenantHostError(404, "TENANT_HOST_UNKNOWN");
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes(".")) throw new TenantHostError(404, "TENANT_HOST_UNKNOWN");
  if (label === "sistem") return { kind: "system" };
  if (reservedTenantSlugs.has(label)) throw new TenantHostError(404, "TENANT_HOST_RESERVED");
  if (!tenantSlugPattern.test(label)) throw new TenantHostError(404, "TENANT_HOST_UNKNOWN");
  return { kind: "tenant", slug: label };
}

export function resolveTenantSlugFromRequest(
  request: Pick<Request, "header" | "socket">,
  bodyTenantSlug: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string {
  const supplied = bodyTenantSlug?.trim().toLowerCase();
  const host = resolveTenantHostContext(request, env);
  if (host.kind === "legacy") return requireLegacyTenantSlug(supplied);
  if (host.kind === "system") {
    if (supplied && supplied !== "system") throw new TenantHostError(403, "TENANT_HOST_MISMATCH");
    return "system";
  }
  if (host.kind === "tenant") {
    if (supplied && supplied !== host.slug) throw new TenantHostError(403, "TENANT_HOST_MISMATCH");
    return host.slug;
  }
  if (!legacyTenantLoginAllowed(env, now)) throw new TenantHostError(410, "LEGACY_TENANT_LOGIN_RETIRED");
  return requireLegacyTenantSlug(supplied);
}

export function assertSessionTenantMatchesHost(
  request: Pick<Request, "header" | "socket">,
  sessionTenant: { tenantId: string; tenantSlug?: string },
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): void {
  const host = resolveTenantHostContext(request, env);
  if (host.kind === "legacy") return;
  if (host.kind === "root") {
    if (legacyTenantLoginAllowed(env, now)) return;
    throw new TenantHostError(403, "TENANT_HOST_MISMATCH");
  }
  if (host.kind === "system") {
    if (sessionTenant.tenantId !== "system") throw new TenantHostError(403, "TENANT_HOST_MISMATCH");
    return;
  }
  if (sessionTenant.tenantId === "system" || sessionTenant.tenantSlug !== host.slug) {
    throw new TenantHostError(403, "TENANT_HOST_MISMATCH");
  }
}

export function legacyTenantLoginAllowed(env: NodeJS.ProcessEnv = process.env, now = Date.now()): boolean {
  const rawCutoff = env.LEGACY_TENANT_LOGIN_CUTOFF_AT?.trim();
  if (!rawCutoff) return true;
  const cutoff = Date.parse(rawCutoff);
  return Number.isFinite(cutoff) && now < cutoff;
}

export function assertValidTenantSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!tenantSlugPattern.test(normalized) || reservedTenantSlugs.has(normalized)) {
    throw new TenantHostError(400, reservedTenantSlugs.has(normalized) ? "TENANT_HOST_RESERVED" : "TENANT_SLUG_INVALID");
  }
  return normalized;
}

function requireLegacyTenantSlug(slug: string | undefined): string {
  if (!slug) throw new TenantHostError(400, "TENANT_HOST_REQUIRED");
  return slug;
}

function requestHost(request: Pick<Request, "header" | "socket">, env: NodeJS.ProcessEnv): string | undefined {
  const remoteAddress = request.socket?.remoteAddress;
  const trustedProxy = remoteAddress ? createTrustedProxyPredicate(env)(remoteAddress) : false;
  const rawHost = trustedProxy ? request.header("x-forwarded-host") ?? request.header("host") : request.header("host");
  return normalizeHost(rawHost);
}

function normalizeDomain(value: string | undefined): string | undefined {
  const domain = normalizeHost(value);
  return domain && !domain.includes(":") ? domain : undefined;
}

function normalizeHost(value: string | undefined): string | undefined {
  const raw = value?.trim().toLowerCase();
  if (!raw || /[,/@\\\s]/.test(raw)) return undefined;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 0 ? raw.slice(1, end) : undefined;
  }
  return raw.replace(/:\d+$/, "").replace(/\.$/, "");
}

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
