"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LifeBuoy, Menu, Search, ShieldCheck, X } from "lucide-react";
import { Button } from "@o-okul/ui";
import { type ActivePersona, type MeProfileResponse, type TenantRecord } from "@o-okul/shared-types";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../src/api-client.js";
import { useAuth } from "../providers.js";
import { readRolePreviewToken } from "./portals/_shared/portal-shell.js";
import { canAccessInstitutionPath, getInstitutionNavGroups, hasCapabilityForRoles, hasInstitutionAccess, hasSubjectPortalAccess, hasSystemAccess } from "./_shared/access.js";
import { buildInstitutionRailGroups, institutionNavGroups, rolePortalNavGroups, systemNavGroups } from "./_shared/navigation.js";
import { buildCommandItems, canUseEntitySearch, CommandPalette, focusCommandOpener } from "./_shell/command-palette.js";
import { keepFocusInMobileNav, safeTenantBrand, ShellBrand, SidebarGroup, type NavigationGroup, type SidebarItem } from "./_shell/nav-sidebar.js";
import { DesktopTopBar, RouteBreadcrumb, WorkContext } from "./_shell/top-bar.js";
import { ThemeToggle } from "./_shell/theme-toggle.js";
import { PortalBottomNav } from "./_shell/portal-bottom-nav.js";
import { isWebPushCapabilityEnabled, PushDevicePanel } from "./_shell/push-devices.js";

const sidebarGroupStorageKey = "des.sidebar.expandedGroups.v2";

interface WorkContextOptions {
  campuses: Array<{ id: string; name: string }>;
  terms: Array<{ id: string; name: string }>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { auth, isBootstrapping, logout, switchPersona } = useAuth();
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [expandedSidebarGroups, setExpandedSidebarGroups] = useState<Record<string, boolean>>({});
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isWorkContextActivated, setIsWorkContextActivated] = useState(false);
  const [isPersonaSwitching, setIsPersonaSwitching] = useState(false);
  const [personaSwitchError, setPersonaSwitchError] = useState("");
  const commandOpenerRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavCloseRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const isRolePreviewRoute = hasRolePreviewAccess(searchParams);
  const visiblePortalNavGroups = useMemo(
    () => auth?.session ? rolePortalNavGroups.filter((group) => hasSubjectPortalAccess(auth.session, group.role, group.subjectType)) : [],
    [auth],
  );
  const visibleInstitutionNavGroups = useMemo(
    () => auth?.session && hasInstitutionAccess(auth.session.roles)
      ? getInstitutionNavGroups(
          auth.session.roles,
          auth.session.activePersona,
          institutionNavGroups,
        )
      : [],
    [auth],
  );
  const institutionRailNavGroups = useMemo(
    () => buildInstitutionRailGroups(visibleInstitutionNavGroups),
    [visibleInstitutionNavGroups],
  );
  const visibleSystemNavGroups = useMemo(
    () => auth?.session && hasSystemAccess(auth.session.roles) ? systemNavGroups : [],
    [auth],
  );
  const commandItems = useMemo(
    () => buildCommandItems(visibleInstitutionNavGroups, visibleSystemNavGroups, visiblePortalNavGroups, auth?.session.roles ?? []),
    [auth?.session.roles, visibleInstitutionNavGroups, visiblePortalNavGroups, visibleSystemNavGroups],
  );
  const canUsePushDevices = auth?.session
    ? isWebPushCapabilityEnabled() && (hasInstitutionAccess(auth.session.roles) || visiblePortalNavGroups.length > 0)
    : false;
  const canUseShellSearch = auth?.session ? hasShellSearchAccess(auth.session) : false;
  const workContextCampusId = pathname.startsWith("/kurum") ? searchParams.get("campusId") ?? "" : "";
  const workContextTermId = pathname.startsWith("/kurum") ? searchParams.get("termId") ?? "" : "";
  const tenantBrandQuery = useQuery({
    queryKey: ["next-shell-tenant-brand", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadShellTenant(auth?.accessToken ?? ""),
    enabled: Boolean(auth && hasInstitutionAccess(auth.session.roles) && !isRolePreviewRoute),
    refetchOnWindowFocus: false,
  });
  const workContextQuery = useQuery({
    queryKey: ["next-shell-work-context", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadWorkContextOptions(auth?.accessToken ?? ""),
    enabled: Boolean(
      auth
      && hasInstitutionAccess(auth.session.roles)
      && !isRolePreviewRoute
      && pathname.startsWith("/kurum")
      && (workContextCampusId || workContextTermId || isWorkContextActivated)
    ),
    refetchOnWindowFocus: false,
  });
  const profileQuery = useQuery({
    queryKey: ["next-shell-profile", auth?.session.userId ?? "anonymous", auth?.session.id ?? "none"],
    queryFn: () => apiRequest<MeProfileResponse>(auth?.accessToken ?? "", `${apiBaseUrl}/me/profile`),
    enabled: Boolean(auth && !isRolePreviewRoute),
    refetchOnWindowFocus: false,
  });
  const tenantBrand = safeTenantBrand(tenantBrandQuery.data);
  const personaSwitchTarget = resolvePersonaSwitchTarget(profileQuery.data);
  const isAuthorizedPath = auth ? canAccessPath(auth.session, pathname, searchParams) : false;
  const portalBottomNavRoot = auth && !hasInstitutionAccess(auth.session.roles)
    ? hasSubjectPortalAccess(auth.session, "TEACHER", "TEACHER") ? "/ogretmen" as const
      : hasSubjectPortalAccess(auth.session, "STUDENT", "STUDENT") ? "/ogrenci" as const
        : undefined
    : undefined;

  useEffect(() => {
    if (!isBootstrapping && !auth) {
      router.replace(loginPathFor(pathname));
      return;
    }

    if (!isBootstrapping && auth?.session.mustChangePassword) {
      router.replace("/sifre-degistir");
      return;
    }

    if (!isBootstrapping && auth && !isAuthorizedPath) {
      router.replace(getHomePath(auth.session));
    }
  }, [auth, isAuthorizedPath, isBootstrapping, pathname, router]);

  useEffect(() => {
    if (!auth) return;
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [auth]);

  useEffect(() => {
    try {
      const storedGroups = window.localStorage.getItem(sidebarGroupStorageKey);
      if (storedGroups) {
        const parsedGroups = JSON.parse(storedGroups) as Record<string, boolean>;
        const expandedGroupKey = Object.keys(parsedGroups).find((key) => parsedGroups[key]);
        setExpandedSidebarGroups(expandedGroupKey ? { [expandedGroupKey]: true } : {});
      }
    } catch {
      setExpandedSidebarGroups({});
    }
  }, []);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isCommandOpen || !commandOpenerRef.current) return;

    window.setTimeout(() => focusCommandOpener(commandOpenerRef.current), 0);
  }, [isCommandOpen]);

  useEffect(() => {
    if (!isMobileNavOpen) return undefined;

    window.setTimeout(() => mobileNavCloseRef.current?.focus(), 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMobileNav();
        return;
      }
      if (event.key === "Tab") {
        keepFocusInMobileNav(event, sidebarRef.current);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileNavOpen]);

  if (isBootstrapping) {
    return (
      <main className="next-auth-layout">
        <p className="next-status-note">Oturum kontrol ediliyor</p>
      </main>
    );
  }

  if (!auth) {
    return null;
  }

  if (!isAuthorizedPath) {
    return (
      <main className="next-auth-layout">
        <p className="next-status-note">Yetkili ana sayfaya yönlendiriliyor</p>
      </main>
    );
  }

  async function handleLogout() {
    await logout();
    router.replace(loginPathFor(pathname));
  }

  async function handlePersonaSwitch() {
    if (!personaSwitchTarget || isPersonaSwitching) return;
    setIsPersonaSwitching(true);
    setPersonaSwitchError("");
    try {
      await switchPersona(personaSwitchTarget);
      closeMobileNav();
    } catch {
      setPersonaSwitchError("Çalışma alanı değiştirilemedi. Tekrar deneyin.");
    } finally {
      setIsPersonaSwitching(false);
    }
  }

  function isActive(href: string) {
    const hrefPath = href.split(/[?#]/)[0] || href;
    if (hrefPath === "/kurum") {
      return pathname === "/kurum";
    }
    if (hrefPath === "/sistem") {
      return pathname === "/sistem";
    }
    if (isPortalRootPath(hrefPath)) {
      return pathname === hrefPath;
    }
    return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
  }

  function navCurrent(item: SidebarItem | string) {
    if (typeof item === "string") return isActive(item) ? "page" : undefined;
    return (item.matchHrefs ?? [item.href]).some(isActive) ? "page" : undefined;
  }

  function openCommandPalette(opener: HTMLButtonElement) {
    commandOpenerRef.current = opener;
    opener.focus();
    setIsCommandOpen(true);
  }

  function closeCommandPalette(options: { restoreFocus?: boolean } = {}) {
    if (options.restoreFocus !== false) {
      focusCommandOpener(commandOpenerRef.current);
    }
    setIsCommandOpen(false);
    setCommandQuery("");
    if (options.restoreFocus === false) {
      commandOpenerRef.current = null;
    }
  }

  function navigateFromCommandPalette(href: string) {
    closeCommandPalette({ restoreFocus: false });
    router.push(href);
  }

  // Bağlam URL'de tutulur (ADR-0006); campusId/termId okuyan sayfaların query key'leri değişir ve yeniden sorgular.
  function updateWorkContext(key: "campusId" | "termId", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function openCommandSearch(value: string) {
    setCommandQuery(value);
    setIsCommandOpen(true);
  }

  function openMobileNav() {
    setIsMobileNavOpen(true);
  }

  function closeMobileNav() {
    setIsMobileNavOpen(false);
    window.setTimeout(() => mobileNavTriggerRef.current?.focus(), 0);
  }

  function isGroupActive(group: NavigationGroup) {
    return group.items.some((item) => navCurrent(item) === "page");
  }

  function toggleSidebarGroup(groupKey: string) {
    setExpandedSidebarGroups((current) => {
      const next = current[groupKey] ? {} : { [groupKey]: true };

      try {
        window.localStorage.setItem(sidebarGroupStorageKey, JSON.stringify(next));
      } catch {}

      return next;
    });
  }

  return (
    <div className="next-app-shell" data-shell-version="v3">
      <a className="next-skip-link" href="#next-content">
        İçeriğe geç
      </a>
      <header className="next-mobile-topbar">
        <button
          aria-controls="next-sidebar"
          aria-expanded={isMobileNavOpen}
          aria-label="Ana menüyü aç"
          className="next-mobile-nav-toggle"
          onClick={openMobileNav}
          ref={mobileNavTriggerRef}
          type="button"
        >
          <Menu size={18} aria-hidden="true" />
        </button>
        <ShellBrand tenantBrand={tenantBrand} />
        <div className="next-mobile-topbar__actions">
          <ThemeToggle />
          <button className="next-command-open" type="button" onClick={(event) => openCommandPalette(event.currentTarget)} aria-label="Komut paleti" title="Komut paleti">
            <Search size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <aside
        className="next-sidebar"
        data-mobile-open={isMobileNavOpen ? "true" : "false"}
        id="next-sidebar"
        aria-label="Ana menü"
        ref={sidebarRef}
      >
        <header className="next-sidebar-header">
          <ShellBrand tenantBrand={tenantBrand} />
          <button className="next-command-open" type="button" onClick={(event) => openCommandPalette(event.currentTarget)} aria-label="Komut paleti" title="Komut paleti">
            <Search size={16} aria-hidden="true" />
          </button>
          <button className="next-sidebar-close" type="button" onClick={closeMobileNav} ref={mobileNavCloseRef} aria-label="Ana menüyü kapat">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <nav className="next-sidebar-nav" aria-label="Ana menü">
          {hasInstitutionAccess(auth.session.roles)
            ? institutionRailNavGroups.map((group) => (
                <SidebarGroup
                  key={group.label}
                  expanded={Boolean(expandedSidebarGroups[`institution:${group.label}`]) || isGroupActive(group)}
                  group={group}
                  groupKey={`institution:${group.label}`}
                  isActive={isGroupActive(group)}
                  navCurrent={navCurrent}
                  onToggle={toggleSidebarGroup}
                />
              ))
            : null}
          {visibleSystemNavGroups.length > 0
            ? visibleSystemNavGroups.map((group) => (
                <SidebarGroup
                  key={group.label}
                  expanded={Boolean(expandedSidebarGroups[`system:${group.label}`]) || isGroupActive(group)}
                  group={group}
                  groupKey={`system:${group.label}`}
                  isActive={isGroupActive(group)}
                  navCurrent={navCurrent}
                  onToggle={toggleSidebarGroup}
                />
              ))
            : null}
          {visiblePortalNavGroups.length > 0
            ? visiblePortalNavGroups.map((group) => (
                <SidebarGroup
                  key={group.label}
                  expanded={Boolean(expandedSidebarGroups[`portal:${group.label}`]) || isGroupActive(group)}
                  group={group}
                  groupKey={`portal:${group.label}`}
                  isActive={isGroupActive(group)}
                  navCurrent={navCurrent}
                  onToggle={toggleSidebarGroup}
                />
              ))
            : null}
          {personaSwitchTarget ? (
            <Button variant="secondary" type="button" disabled={isPersonaSwitching} onClick={() => void handlePersonaSwitch()}>
              {personaSwitchLabel(personaSwitchTarget, isPersonaSwitching)}
            </Button>
          ) : null}
          {personaSwitchError ? <p className="next-status-note" role="alert">{personaSwitchError}</p> : null}
          <Link className="next-sidebar-link" href="/hesap/oturumlar" aria-current={navCurrent("/hesap/oturumlar")}>
            <ShieldCheck className="next-sidebar-link-icon" size={16} aria-hidden="true" />
            <span>Oturumlar</span>
          </Link>
          <Link className="next-sidebar-link" href="/iletisim#destek">
            <LifeBuoy className="next-sidebar-link-icon" size={16} aria-hidden="true" />
            <span>o-okul desteği</span>
          </Link>
          <Button variant="ghost" className="next-sidebar-logout" type="button" onClick={() => void handleLogout()}>
            Çıkış
          </Button>
        </nav>
        {canUsePushDevices && !isRolePreviewRoute ? <PushDevicePanel accessToken={auth.accessToken} /> : null}
      </aside>
      <button
        aria-hidden={!isMobileNavOpen}
        aria-label="Menü arka planını kapat"
        className="next-sidebar-backdrop"
        onClick={closeMobileNav}
        tabIndex={isMobileNavOpen ? 0 : -1}
        type="button"
      />
      <main
        className="next-workspace"
        id="next-content"
        tabIndex={-1}
        aria-hidden={isMobileNavOpen ? "true" : undefined}
      >
        <DesktopTopBar
          canUseShellSearch={canUseShellSearch}
          onLogout={() => void handleLogout()}
          onPersonaSwitch={personaSwitchTarget ? () => void handlePersonaSwitch() : undefined}
          personaSwitchLabel={personaSwitchTarget ? personaSwitchLabel(personaSwitchTarget, isPersonaSwitching) : undefined}
          personaSwitching={isPersonaSwitching}
          onSearch={openCommandSearch}
          session={auth.session}
          tenantBrand={tenantBrand}
        />
        <RouteBreadcrumb pathname={pathname} />
        {pathname.startsWith("/kurum") ? (
          <WorkContext
            campusId={workContextCampusId}
            campuses={workContextQuery.data?.campuses ?? []}
            onActivate={() => setIsWorkContextActivated(true)}
            onChange={updateWorkContext}
            termId={workContextTermId}
            terms={workContextQuery.data?.terms ?? []}
            tenantName={tenantBrand?.name}
          />
        ) : null}
        {children}
      </main>
      {portalBottomNavRoot ? <PortalBottomNav isActive={isActive} onMore={openMobileNav} root={portalBottomNavRoot} /> : null}
      <CommandPalette
        accessToken={auth.accessToken}
        enableEntitySearch={canUseEntitySearch(auth.session.roles)}
        items={commandItems}
        onClose={closeCommandPalette}
        onNavigate={navigateFromCommandPalette}
        open={isCommandOpen}
        query={commandQuery}
        setQuery={setCommandQuery}
      />
    </div>
  );
}

function resolvePersonaSwitchTarget(profile: MeProfileResponse | undefined): ActivePersona | undefined {
  if (!profile?.activePersona || !profile.availablePersonas?.includes("STAFF") || !profile.availablePersonas.includes("TEACHER")) {
    return undefined;
  }
  return profile.activePersona === "STAFF" ? "TEACHER" : "STAFF";
}

function personaSwitchLabel(target: ActivePersona, pending: boolean) {
  if (pending) return "Çalışma alanı değiştiriliyor";
  return target === "TEACHER" ? "Öğretmen alanına geç" : "Kurum alanına geç";
}

function isPortalRootPath(pathname: string) {
  return pathname === "/ogretmen" || pathname === "/ogrenci" || pathname === "/veli";
}

type AppSession = NonNullable<ReturnType<typeof useAuth>["auth"]>["session"];

function canAccessPath(session: AppSession, pathname: string, searchParams?: Pick<URLSearchParams, "get">) {
  if (pathname.startsWith("/hesap")) {
    return true;
  }
  if (pathname.startsWith("/sistem")) {
    return hasSystemAccess(session.roles);
  }
  if (pathname.startsWith("/kurum")) {
    return hasInstitutionAccess(session.roles) && canAccessInstitutionPath(session.roles, pathname, session.activePersona);
  }
  if (pathname.startsWith("/ogretmen")) {
    if (canAccessRolePreviewRoute(session, searchParams)) {
      return true;
    }
    return hasSubjectPortalAccess(session, "TEACHER", "TEACHER");
  }
  if (pathname.startsWith("/ogrenci")) {
    if (canAccessRolePreviewRoute(session, searchParams)) {
      return true;
    }
    return hasSubjectPortalAccess(session, "STUDENT", "STUDENT");
  }
  if (pathname.startsWith("/veli")) {
    if (canAccessRolePreviewRoute(session, searchParams)) {
      return true;
    }
    return hasSubjectPortalAccess(session, "GUARDIAN", "GUARDIAN");
  }

  return false;
}

function hasRolePreviewAccess(searchParams?: Pick<URLSearchParams, "get">) {
  return Boolean(searchParams && readRolePreviewToken(searchParams));
}

function canAccessRolePreviewRoute(session: AppSession, searchParams?: Pick<URLSearchParams, "get">) {
  return hasRolePreviewAccess(searchParams) && hasInstitutionAccess(session.roles) && hasCapabilityForRoles(session.roles, "role-preview:manage");
}

function getHomePath(session: AppSession) {
  if (hasSystemAccess(session.roles)) return "/sistem";
  if (hasInstitutionAccess(session.roles)) return "/kurum";
  if (hasSubjectPortalAccess(session, "TEACHER", "TEACHER")) return "/ogretmen";
  if (hasSubjectPortalAccess(session, "STUDENT", "STUDENT")) return "/ogrenci";
  if (hasSubjectPortalAccess(session, "GUARDIAN", "GUARDIAN")) return "/veli";
  return "/login";
}

function loginPathFor(pathname: string) {
  return pathname.startsWith("/sistem") ? "/sistem/giris" : "/login";
}

function hasShellSearchAccess(session: AppSession) {
  return hasInstitutionAccess(session.roles) || hasSubjectPortalAccess(session, "TEACHER", "TEACHER");
}

async function loadShellTenant(accessToken: string): Promise<TenantRecord | undefined> {
  try {
    return await apiRequest<TenantRecord>(accessToken, `${apiBaseUrl}/me/tenant`);
  } catch {
    return undefined;
  }
}

async function loadWorkContextOptions(accessToken: string): Promise<WorkContextOptions> {
  const [campuses, terms] = await Promise.all([
    apiListRequest<{ id: string; name: string }>(accessToken, `${apiBaseUrl}/campuses`),
    apiListRequest<{ id: string; name: string }>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return { campuses: campuses.data, terms: terms.data };
}
