"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronDown, LifeBuoy, LogOut, Menu, Search, ShieldCheck, UserRound, X, type LucideIcon } from "lucide-react";
import { Button, Dialog, Field, Input, Panel, StatusBadge, type StatusBadgeProps } from "@o-okul/ui";
import { isTenantRoleName, tenantRoleLabel, type ActivePersona, type GlobalSearchResultRecord, type MeProfileResponse, type NotificationDeviceTokenRecord, type Session, type TenantRecord } from "@o-okul/shared-types";
import { apiBaseUrl, apiListRequest, apiRequest, withQueryParams } from "../../src/api-client.js";
import { appBrand } from "../../src/brand.js";
import { featureRolloutQueryKey, isFeatureEnabled, loadFeatureRollouts } from "../../src/feature-rollouts.js";
import { productTerms } from "../../src/product-terms.js";
import { useAuth } from "../providers.js";
import { readRolePreviewToken } from "./portals/_shared/portal-shell.js";
import {
  canAccessInstitutionPath,
  getInstitutionNavGroups,
  hasCapabilityForRoles,
  hasInstitutionAccess,
  hasSubjectPortalAccess,
  hasSystemAccess,
} from "./_shared/access.js";
import { dynamicDetailParents, institutionNavGroups, institutionNavGroupsV2, rolePortalItems, rolePortalNavGroups, staticBreadcrumbLabels, systemNavGroups } from "./_shared/navigation.js";
const allNavigationItems = [
  ...systemNavGroups.flatMap((group) => group.items),
  ...institutionNavGroups.flatMap((group) => group.items),
  ...rolePortalItems,
  ...rolePortalNavGroups.flatMap((group) => group.items),
];

const breadcrumbLabelByPath = {
  ...Object.fromEntries(allNavigationItems.map((item) => [item.href, item.label])),
  ...staticBreadcrumbLabels,
};

interface CommandPaletteItem {
  group: string;
  href: string;
  id: string;
  label: string;
}

type NavigationGroup = {
  label: string;
  items: readonly { href: string; icon?: LucideIcon; label: string }[];
};

type SidebarItem = {
  href: string;
  icon?: LucideIcon;
  label: string;
};

const entitySearchLimit = 12;
const sidebarGroupStorageKey = "des.sidebar.expandedGroups.v2";

interface EntitySearchResult {
  group: string;
  href: string;
  id: string;
  label: string;
  subtitle?: string;
}

interface ShellTenantBrand {
  logoUrl?: string;
  name: string;
}

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
  const [isPersonaSwitching, setIsPersonaSwitching] = useState(false);
  const [personaSwitchError, setPersonaSwitchError] = useState("");
  const commandOpenerRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavCloseRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const isRolePreviewRoute = hasRolePreviewAccess(searchParams);
  const featureRolloutsQuery = useQuery({
    queryKey: featureRolloutQueryKey(
      auth?.session.tenantId,
      auth?.session.id,
      auth?.session.activePersona,
    ),
    queryFn: () => loadFeatureRollouts(auth?.accessToken ?? ""),
    enabled: Boolean(
      auth
      && pathname.startsWith("/kurum")
      && hasInstitutionAccess(auth.session.roles)
      && !isRolePreviewRoute
    ),
    refetchOnWindowFocus: false,
  });
  const shellV2Enabled = featureRolloutsQuery.isSuccess
    && !featureRolloutsQuery.isError
    && isFeatureEnabled(featureRolloutsQuery.data, "web.shell-v2");
  const visiblePortalNavGroups = useMemo(
    () => auth?.session ? rolePortalNavGroups.filter((group) => hasSubjectPortalAccess(auth.session, group.role, group.subjectType)) : [],
    [auth],
  );
  const visibleInstitutionNavGroups = useMemo(
    () => auth?.session && hasInstitutionAccess(auth.session.roles)
      ? getInstitutionNavGroups(
          auth.session.roles,
          auth.session.activePersona,
          shellV2Enabled ? institutionNavGroupsV2 : institutionNavGroups,
        )
      : [],
    [auth, shellV2Enabled],
  );
  const institutionRailNavGroups = useMemo(
    () => visibleInstitutionNavGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => !item.hiddenFromRail) }))
      .filter((group) => group.items.length > 0),
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
      && (workContextCampusId || workContextTermId)
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

  function navCurrent(href: string) {
    return isActive(href) ? "page" : undefined;
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
    return group.items.some((item) => isActive(item.href));
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
    <div className="next-app-shell" data-shell-version={shellV2Enabled ? "v2" : "legacy"}>
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
        <button className="next-command-open" type="button" onClick={(event) => openCommandPalette(event.currentTarget)} aria-label="Komut paleti" title="Komut paleti">
          <Search size={16} aria-hidden="true" />
        </button>
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
            campusName={workContextQuery.data?.campuses.find((campus) => campus.id === workContextCampusId)?.name}
            termId={workContextTermId}
            termName={workContextQuery.data?.terms.find((term) => term.id === workContextTermId)?.name}
            tenantName={tenantBrand?.name}
          />
        ) : null}
        {children}
      </main>
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

function WorkContext({
  campusId,
  campusName,
  termId,
  termName,
  tenantName,
}: {
  campusId: string;
  campusName?: string;
  termId: string;
  termName?: string;
  tenantName?: string;
}) {
  const items = [
    { label: productTerms.institution, value: tenantName ?? "Kurum çalışma alanı" },
    {
      label: productTerms.branch,
      value: campusId ? campusName ?? "Seçilmedi" : productTerms.allBranches,
    },
    {
      label: "Dönem",
      value: termId ? termName ?? "Seçilmedi" : "Tüm dönemler",
    },
  ];

  return (
    <dl className="next-work-context" aria-label="Çalışma bilgileri">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DesktopTopBar({
  canUseShellSearch,
  onLogout,
  onPersonaSwitch,
  personaSwitchLabel,
  personaSwitching,
  onSearch,
  session,
  tenantBrand,
}: {
  canUseShellSearch: boolean;
  onLogout(): void;
  onPersonaSwitch?: () => void;
  personaSwitchLabel?: string;
  personaSwitching: boolean;
  onSearch(value: string): void;
  session: Session;
  tenantBrand?: ShellTenantBrand;
}) {
  const primaryRole = session.roles.find(isTenantRoleName);
  const roleLabel = primaryRole ? tenantRoleLabel(primaryRole) : (session.roles[0] ?? "Hesap");
  const contextLabel = tenantBrand?.name ?? sessionContextLabel(session);

  return (
    <header className="next-desktop-topbar" aria-label="Üst gezinme">
      <div className="next-desktop-topbar__search">
        {canUseShellSearch ? <ShellSearchBar onSearch={onSearch} /> : <span className="next-desktop-topbar__brand">{appBrand.name}</span>}
      </div>
      <div className="next-desktop-topbar__context" aria-label="Seçili kurum veya çalışma alanı">
        <Building2 size={16} aria-hidden="true" />
        <span>{contextLabel}</span>
      </div>
      <div className="next-desktop-topbar__account">
        <UserRound size={16} aria-hidden="true" />
        <span>{roleLabel}</span>
        {onPersonaSwitch && personaSwitchLabel ? (
          <Button type="button" variant="secondary" disabled={personaSwitching} onClick={onPersonaSwitch}>
            {personaSwitchLabel}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onLogout}>
          <LogOut size={16} aria-hidden="true" />
          Çıkış
        </Button>
      </div>
    </header>
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

function ShellBrand({ tenantBrand }: { tenantBrand?: ShellTenantBrand }) {
  const brandName = tenantBrand?.name ?? appBrand.name;

  return (
    <div className="next-brand">
      {tenantBrand?.logoUrl ? (
        <img className="next-brand-logo" src={tenantBrand.logoUrl} alt={`${brandName} logosu`} />
      ) : (
        <span className="next-brand-mark">{appBrand.mark}</span>
      )}
      <span>{brandName}</span>
    </div>
  );
}

function sessionContextLabel(session: Session) {
  if (session.subjectType === "STUDENT") return "Öğrenci portalı";
  if (session.subjectType === "GUARDIAN") return "Veli portalı";
  if (session.subjectType === "TEACHER") return "Öğretmen portalı";
  if (hasSystemAccess(session.roles) && !hasInstitutionAccess(session.roles)) return "Sistem";
  return "Kurum";
}

function safeTenantBrand(tenant: TenantRecord | undefined): ShellTenantBrand | undefined {
  const name = safeTenantName(tenant?.name);
  if (!name) return undefined;
  const logoUrl = safeLogoUrl(tenant?.logoUrl);
  return logoUrl ? { logoUrl, name } : { name };
}

function safeTenantName(value: string | undefined) {
  const name = value?.trim();
  if (!name || /^tenant[-_][a-z0-9-]+$/i.test(name)) return undefined;
  return name;
}

function safeLogoUrl(value: string | undefined) {
  const url = value?.trim();
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function focusCommandOpener(preferredOpener: HTMLButtonElement | null) {
  const candidates = [
    preferredOpener,
    ...Array.from(document.querySelectorAll<HTMLButtonElement>('.next-command-open[aria-label="Komut paleti"]')),
  ];
  const opener = candidates.find((candidate) => candidate && candidate.getClientRects().length > 0 && !candidate.disabled);
  opener?.focus();
}

function isPortalRootPath(pathname: string) {
  return pathname === "/ogretmen" || pathname === "/ogrenci" || pathname === "/veli";
}

function keepFocusInMobileNav(event: KeyboardEvent, sidebar: HTMLElement | null) {
  if (!sidebar) return;
  const focusableElements = Array.from(
    sidebar.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== "hidden");
  if (focusableElements.length === 0) return;

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  if (!first || !last) return;

  const activeElement = document.activeElement;
  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function SidebarGroup({
  expanded,
  group,
  groupKey,
  isActive,
  navCurrent,
  onToggle,
}: {
  expanded: boolean;
  group: NavigationGroup;
  groupKey: string;
  isActive: boolean;
  navCurrent(href: string): "page" | undefined;
  onToggle(groupKey: string): void;
}) {
  const listId = `sidebar-group-${groupKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <section
      className="next-sidebar-group"
      data-active={isActive ? "true" : "false"}
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        className="next-sidebar-group-toggle"
        type="button"
        aria-controls={listId}
        aria-expanded={expanded}
        onClick={() => onToggle(groupKey)}
      >
        <span>{group.label}</span>
        <ChevronDown className="next-sidebar-group-toggle-icon" size={14} aria-hidden="true" />
      </button>
      <ul className="next-sidebar-group-list" id={listId}>
        {group.items.map((item) => (
          <li key={item.href}>
            <SidebarLink item={item} current={navCurrent(item.href)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SidebarLink({ current, item }: { current?: "page"; item: SidebarItem }) {
  const Icon = item.icon;

  return (
    <Link className="next-sidebar-link" href={item.href} aria-current={current} title={item.label}>
      {Icon ? <Icon className="next-sidebar-link-icon" size={16} aria-hidden="true" /> : null}
      <span>{item.label}</span>
    </Link>
  );
}

function ShellSearchBar({ onSearch }: { onSearch(value: string): void }) {
  const [value, setValue] = useState("");

  function handleSearch(value: string) {
    setValue(value);
    onSearch(value);
  }

  return (
    <label className="next-shell-search">
      <Search size={16} aria-hidden="true" />
      <input
        aria-label="Genel arama"
        onChange={(event) => handleSearch(event.target.value)}
        onFocus={() => onSearch(value)}
        placeholder="Ara"
        type="search"
        value={value}
      />
    </label>
  );
}

function CommandPalette({
  accessToken,
  enableEntitySearch,
  items,
  onClose,
  onNavigate,
  open,
  query,
  setQuery,
}: {
  accessToken: string;
  enableEntitySearch: boolean;
  items: CommandPaletteItem[];
  onClose(): void;
  onNavigate(href: string): void;
  open: boolean;
  query: string;
  setQuery(value: string): void;
}) {
  const filteredItems = filterCommandItems(items, query).slice(0, 10);
  const [entityResults, setEntityResults] = useState<EntitySearchResult[]>([]);
  const [isEntitySearchLoading, setIsEntitySearchLoading] = useState(false);

  function handleCommandItemClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      onClose();
      return;
    }

    event.preventDefault();
    onNavigate(href);
  }

  useEffect(() => {
    const normalizedQuery = normalizeCommandText(query);
    if (!enableEntitySearch || normalizedQuery.length < 2) {
      setEntityResults([]);
      setIsEntitySearchLoading(false);
      return;
    }

    let isStale = false;
    setIsEntitySearchLoading(true);
    const timeoutId = window.setTimeout(() => {
      void searchEntities(accessToken, query)
        .then((results) => {
          if (!isStale) setEntityResults(results);
        })
        .catch(() => {
          if (!isStale) setEntityResults([]);
        })
        .finally(() => {
          if (!isStale) setIsEntitySearchLoading(false);
        });
    }, 180);

    return () => {
      isStale = true;
      window.clearTimeout(timeoutId);
    };
  }, [accessToken, enableEntitySearch, query]);

  return (
    <Dialog
      className="next-command-palette"
      description="Yetkili olduğunuz modüller ve kurum kayıtları içinde hızlı geçiş yapın."
      footer={<Button onClick={onClose} variant="secondary">Kapat</Button>}
      onClose={onClose}
      open={open}
      title="Komut paleti"
    >
      <div className="next-command-panel">
        <Field className="next-command-search" label="Komut ara">
          <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} />
        </Field>
        <div className="next-command-results">
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => (
              <Link key={item.id} href={item.href} onClick={(event) => handleCommandItemClick(event, item.href)}>
                <span>{item.label}</span>
                <small>{item.group}</small>
              </Link>
            ))
          ) : (
            <p>Sonuç yok</p>
          )}
        </div>
        {enableEntitySearch && normalizeCommandText(query).length >= 2 ? (
          <div className="next-command-results" aria-label="Varlık araması">
            <h3>Varlık araması</h3>
            {isEntitySearchLoading ? <p>Aranıyor...</p> : null}
            {!isEntitySearchLoading && entityResults.length === 0 ? <p>Varlık sonucu yok</p> : null}
            {entityResults.map((item) => (
              <Link key={item.id} href={item.href} onClick={(event) => handleCommandItemClick(event, item.href)}>
                <span>{item.label}</span>
                <small>{item.subtitle ? `${item.group} · ${item.subtitle}` : item.group}</small>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function RouteBreadcrumb({ pathname }: { pathname: string }) {
  const crumbs = getBreadcrumbs(pathname);

  return (
    <nav className="next-breadcrumb" aria-label="Gezinme yolu">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={crumb.path}>
            {crumb.isCurrent ? (
              <span aria-current="page">{crumb.label}</span>
            ) : (
              <Link href={crumb.path}>{crumb.label}</Link>
            )}
            {index < crumbs.length - 1 ? <span aria-hidden="true">/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function PushDevicePanel({ accessToken }: { accessToken: string }) {
  const [devices, setDevices] = useState<NotificationDeviceTokenRecord[]>([]);
  const [status, setStatus] = useState("Hazır");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;
    apiRequest<NotificationDeviceTokenRecord[]>(accessToken, `${apiBaseUrl}/me/notification-devices`)
      .then((records) => {
        if (isMounted) setDevices(Array.isArray(records) ? records : []);
      })
      .catch(() => {
        if (isMounted) setStatus("Cihaz bilgisi alınamadı");
      });
    return () => {
      isMounted = false;
    };
  }, [accessToken]);

  async function handleRegister() {
    setIsSaving(true);
    try {
      const token = await resolveWebPushToken();
      const record = await apiRequest<NotificationDeviceTokenRecord>(accessToken, `${apiBaseUrl}/me/notification-devices`, {
        body: JSON.stringify({
          provider: "web-push",
          token,
          platform: "web",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      setDevices((current) => [record, ...current.filter((device) => device.id !== record.id)]);
      setStatus("Push açık");
    } catch (error) {
      setStatus(error instanceof Error ? humanizePushError(error.message) : "Push açılamadı");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDisable(id: string) {
    setIsSaving(true);
    try {
      const record = await apiRequest<NotificationDeviceTokenRecord>(accessToken, `${apiBaseUrl}/me/notification-devices/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setDevices((current) => current.map((device) => (device.id === id ? record : device)));
      setStatus("Cihaz kapatıldı");
    } catch {
      setStatus("Cihaz kapatılamadı");
    } finally {
      setIsSaving(false);
    }
  }

  const activeDevices = devices.filter((device) => !device.disabledAt);
  const latestDevice = activeDevices[0];
  const statusLabel = isSaving ? "İşleniyor" : status;
  const statusTone = getPushStatusTone(status, activeDevices.length, isSaving);

  return (
    <Panel
      actions={<StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>}
      aria-label="Bildirim cihazı"
      as="aside"
      className="next-push-panel"
      description={`${activeDevices.length} aktif cihaz`}
      title="Bildirim cihazı"
    >
      <div className="next-push-panel__actions">
        <Button disabled={isSaving} onClick={() => void handleRegister()} size="sm">
          Push iznini aç
        </Button>
        {latestDevice ? (
          <Button
            disabled={isSaving}
            onClick={() => void handleDisable(latestDevice.id)}
            size="sm"
            variant="secondary"
          >
            Cihazı kapat
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

function getPushStatusTone(status: string, activeDeviceCount: number, isSaving: boolean): StatusBadgeProps["tone"] {
  if (isSaving) return "info";
  if (status === "Push açık" || (status === "Hazır" && activeDeviceCount > 0)) return "success";
  if (status === "Cihaz kapatıldı") return "warning";
  if (status !== "Hazır") return "danger";
  return "neutral";
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

function getBreadcrumbs(pathname: string) {
  const cleanPath = pathname && pathname.startsWith("/") ? pathname : `/${pathname ?? ""}`;
  const segments = cleanPath.split("/").filter(Boolean);

  if (segments.length === 0) {
    return [{ label: "Ana Sayfa", path: "/", isCurrent: true }];
  }

  const items: Array<{ label: string; path: string; isCurrent: boolean }> = [
    { label: "Ana Sayfa", path: "/", isCurrent: false },
  ];

  let current = "";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;

    current += `/${segment}`;
    const isCurrent = index === segments.length - 1;
    const previous = index === 0 ? undefined : segments[index - 1];
    items.push({
      label: resolveBreadcrumbLabel(current, previous, segment, index),
      path: current,
      isCurrent,
    });
  }

  return items;
}

function resolveBreadcrumbLabel(path: string, previousSegment: string | undefined, currentSegment: string, index: number) {
  const customLabel = breadcrumbLabelByPath[path];
  if (customLabel) return customLabel;

  if (index >= 2 && previousSegment && dynamicDetailParents.includes(previousSegment)) {
    return "Detay";
  }

  if (currentSegment === "kurum") return "Kurum";
  if (currentSegment === "sistem") return "Sistem";

  return currentSegment
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
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

function buildCommandItems(
  institutionGroups: readonly NavigationGroup[],
  systemGroups: readonly NavigationGroup[],
  portalGroups: readonly NavigationGroup[],
  roles: readonly string[],
): CommandPaletteItem[] {
  const navigationItems = [
    ...institutionGroups.flatMap((group) => group.items.map((item) => commandItem(item.href, item.label, group.label))),
    ...systemGroups.flatMap((group) => group.items.map((item) => commandItem(item.href, item.label, group.label))),
    ...portalGroups.flatMap((group) => group.items.map((item) => commandItem(item.href, item.label, group.label))),
  ];
  const actionItems = hasInstitutionAccess(roles)
    ? [
        hasCapabilityForRoles(roles, "setup:manage") ? commandItem("/kurum/kurulum", "Yeni dönem açılışı", "İş akışı") : null,
        hasCapabilityForRoles(roles, "academic:manage") ? commandItem("/kurum/raporlar", "Sınav sonrası kapanış", "İş akışı") : null,
        hasCapabilityForRoles(roles, "class:manage") ? commandItem("/kurum/kampusler?new=1", "Kampüs ekle", "Hızlı işlem") : null,
        hasCapabilityForRoles(roles, "class:manage") ? commandItem("/kurum/seviyeler?new=1", "Seviye ekle", "Hızlı işlem") : null,
        hasCapabilityForRoles(roles, "class:manage") ? commandItem("/kurum/siniflar?new=1", "Sınıf ekle", "Hızlı işlem") : null,
        hasCapabilityForRoles(roles, "academic:manage") ? commandItem("/kurum/dersler?new=1", "Ders ekle", "Hızlı işlem") : null,
        hasCapabilityForRoles(roles, "staff:manage") ? commandItem("/kurum/ogretmenler?new=1", "Öğretmen ekle", "Hızlı işlem") : null,
        hasCapabilityForRoles(roles, "student:manage") ? commandItem("/kurum/ogrenciler?new=1", "Öğrenci ekle", "Hızlı işlem") : null,
      ].filter((item): item is CommandPaletteItem => Boolean(item))
    : [];
  const systemActions = hasSystemAccess(roles) ? [commandItem("/sistem/kurumlar", "Kurum oluştur", "Hızlı işlem")] : [];

  return dedupeCommandItems([...navigationItems, ...actionItems, ...systemActions]);
}

function canUseEntitySearch(roles: readonly string[]) {
  return hasCapabilityForRoles(roles, "search:read");
}

function commandItem(href: string, label: string, group: string): CommandPaletteItem {
  return { group, href, id: `${group}:${label}:${href}`, label };
}

function dedupeCommandItems(items: CommandPaletteItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function filterCommandItems(items: CommandPaletteItem[], query: string) {
  const normalizedQuery = normalizeCommandText(query);
  if (!normalizedQuery) return items;
  return items.filter((item) =>
    normalizeCommandText(`${item.label} ${item.group} ${item.href}`).includes(normalizedQuery),
  );
}

async function searchEntities(accessToken: string, query: string): Promise<EntitySearchResult[]> {
  try {
    const url = withQueryParams(`${apiBaseUrl}/search`, { limit: String(entitySearchLimit), q: query });
    const results = (await apiListRequest<GlobalSearchResultRecord>(accessToken, url)).data;
    return results.map((result) => ({
      group: searchResultGroupLabel(result.type),
      href: result.href,
      id: `${result.type}:${result.id}`,
      label: result.title,
      subtitle: result.subtitle,
    }));
  } catch {
    return [];
  }
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

function searchResultGroupLabel(type: GlobalSearchResultRecord["type"]): string {
  if (type === "students") return "Öğrenci";
  if (type === "teachers") return "Öğretmen";
  if (type === "guardians") return "Veli";
  return "Sınıf";
}

function normalizeCommandText(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

async function resolveWebPushToken(): Promise<string> {
  const publicKey = readWebPushPublicKey();
  if (!publicKey) throw new Error("WEB_PUSH_PUBLIC_KEY_MISSING");
  if (!("Notification" in window)) throw new Error("WEB_PUSH_UNSUPPORTED");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("WEB_PUSH_UNSUPPORTED");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("WEB_PUSH_PERMISSION_DENIED");

  const registration = await navigator.serviceWorker.register("/push-sw.js");
  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription = existingSubscription ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  return JSON.stringify(subscription.toJSON());
}

function readWebPushPublicKey(): string {
  const override = typeof window === "undefined"
    ? undefined
    : (window as Window & { __O_OKUL_WEB_PUSH_PUBLIC_KEY__?: string }).__O_OKUL_WEB_PUSH_PUBLIC_KEY__;
  return override ?? process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? "";
}

function isWebPushCapabilityEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WEB_PUSH_ENABLED === "true" && Boolean(readWebPushPublicKey().trim());
}

function urlBase64ToUint8Array(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputBuffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(outputBuffer);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputBuffer;
}

function humanizePushError(message: string): string {
  if (message === "WEB_PUSH_PUBLIC_KEY_MISSING") return "Push anahtarı eksik";
  if (message === "WEB_PUSH_PERMISSION_DENIED") return "Push izni verilmedi";
  if (message === "WEB_PUSH_UNSUPPORTED") return "Tarayıcı desteklemiyor";
  return "Push açılamadı";
}
