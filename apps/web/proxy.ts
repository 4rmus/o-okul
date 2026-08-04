import { type NextRequest, NextResponse } from "next/server";
import { legacyLoginAllowed, tenantLoginOrigin, webHostContext } from "./src/tenant-host.js";

export function proxy(request: NextRequest) {
  const domain = process.env.DOMAIN?.trim().toLowerCase();
  const host = webHostContext(request.headers.get("host"), domain);
  if (!domain || host.kind === "legacy") return NextResponse.next();

  const path = request.nextUrl.pathname;
  const legacyTenant = path.match(/^\/k\/([^/]+)\/giris$/)?.[1];
  const legacySystem = path === "/sistem/giris";
  if (legacyTenant || legacySystem) {
    if (!legacyLoginAllowed(process.env.LEGACY_TENANT_LOGIN_CUTOFF_AT)) {
      return new NextResponse("LEGACY_TENANT_LOGIN_RETIRED", { status: 410 });
    }
    try {
      const target = legacySystem
        ? `${request.nextUrl.protocol}//sistem.${domain}/giris`
        : tenantLoginOrigin(decodeURIComponent(legacyTenant!), domain, request.nextUrl.protocol);
      return NextResponse.redirect(target, 307);
    } catch {
      return new NextResponse("TENANT_HOST_UNKNOWN", { status: 404 });
    }
  }

  if (path === "/login" && (host.kind === "tenant" || host.kind === "system")) {
    return NextResponse.redirect(new URL("/giris", request.url), 307);
  }
  if (host.kind === "invalid") return new NextResponse("TENANT_HOST_UNKNOWN", { status: 404 });
  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
