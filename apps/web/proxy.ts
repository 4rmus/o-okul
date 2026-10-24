import { type NextRequest, NextResponse } from "next/server.js";
import { isLogoutPendingValue, loginPathAfterLogout, logoutPendingParam } from "./src/logout-pending.js";
import { legacyLoginAllowed, tenantLoginOrigin, webHostContext } from "./src/tenant-host.js";

export function proxy(request: NextRequest) {
  const domain = process.env.DOMAIN?.trim().toLowerCase();
  const host = webHostContext(request.headers.get("host"), domain);
  if (!domain || host.kind === "legacy") return NextResponse.next();

  const path = request.nextUrl.pathname;
  // Login redirects keep only the unconfirmed-logout flag, so the login page does not resume a session the user ended.
  const logoutPending = isLogoutPendingValue(request.nextUrl.searchParams.get(logoutPendingParam));
  const legacyTenant = path.match(/^\/k\/([^/]+)\/giris$/)?.[1];
  const legacySystem = path === "/sistem/giris";
  if (legacyTenant || legacySystem) {
    if (!legacyLoginAllowed(process.env.LEGACY_TENANT_LOGIN_CUTOFF_AT)) {
      return new NextResponse("LEGACY_TENANT_LOGIN_RETIRED", { status: 410 });
    }
    try {
      const tenantSlug = legacySystem ? undefined : decodeURIComponent(legacyTenant!).trim().toLowerCase();
      const target = tenantSlug === undefined
        ? `${request.nextUrl.protocol}//sistem.${domain}/giris`
        : tenantLoginOrigin(tenantSlug, domain, request.nextUrl.protocol);
      // The flag only helps on the origin that holds the session cookies; another host has nothing to log out.
      const sameHost = tenantSlug === undefined ? host.kind === "system" : host.kind === "tenant" && host.slug === tenantSlug;
      return NextResponse.redirect(loginPathAfterLogout(target, logoutPending && sameHost), 307);
    } catch {
      return new NextResponse("TENANT_HOST_UNKNOWN", { status: 404 });
    }
  }

  if (path === "/login" && (host.kind === "tenant" || host.kind === "system")) {
    return NextResponse.redirect(new URL(loginPathAfterLogout("/giris", logoutPending), request.url), 307);
  }
  if (host.kind === "invalid") return new NextResponse("TENANT_HOST_UNKNOWN", { status: 404 });
  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
