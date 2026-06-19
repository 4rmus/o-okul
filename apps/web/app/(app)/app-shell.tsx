"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Menu, Search, X, type LucideIcon } from "lucide-react";
import { Button, Dialog, Field, Input, Panel, StatusBadge, type StatusBadgeProps } from "@uzman-hocam/ui";
import type { ClassRecord, GuardianRecord, NotificationDeviceTokenRecord, StudentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../src/api-client.js";
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
import { dynamicDetailParents, institutionNavGroups, rolePortalItems, staticBreadcrumbLabels, systemNavGroups } from "./_shared/navigation.js";
const allNavigationItems = [
  ...systemNavGroups.flatMap((group) => group.items),
  ...institutionNavGroups.flatMap((group) => group.items),
  ...rolePortalItems,
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

const entitySearchLimit = 3;
const sidebarGroupStorageKey = "des.sidebar.expandedGroups.v2";

interface EntitySearchResult {
  group: string;
  href: string;
  id: string;
  label: string;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { auth, isBootstrapping, logout } = useAuth();
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [expandedSidebarGroups, setExpandedSidebarGroups] = useState<Record<string, boolean>>({});
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const commandOpenerRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileNavCloseRef = useRef<HTMLButtonElement | null>(null);
  const visiblePortalItems = useMemo(
    () => auth?.session ? rolePortalItems.filter((item) => hasSubjectPortalAccess(auth.session, item.role, item.subjectType)) : [],
    [auth],
  );
  const visibleInstitutionNavGroups = useMemo(() => auth?.session ? getInstitutionNavGroups(auth.session.roles) : [], [auth]);
  const visibleSystemNavGroups = useMemo(
    () => auth?.session && hasSystemAccess(auth.session.roles) ? systemNavGroups : [],
    [auth],
  );
  const commandItems = useMemo(
    () => buildCommandItems(visibleInstitutionNavGroups, visibleSystemNavGroups, visiblePortalItems, auth?.session.roles ?? []),
    [auth?.session.roles, visibleInstitutionNavGroups, visiblePortalItems, visibleSystemNavGroups],
  );
  const canUsePushDevices = auth?.session ? hasInstitutionAccess(auth.session.roles) || visiblePortalItems.length > 0 : false;
  const isAuthorizedPath = auth ? canAccessPath(auth.session, pathname, searchParams) : false;

  useEffect(() => {
    if (!isBootstrapping && !auth) {
      router.replace("/login");
      return;
    }

    if (!isBootstrapping && auth && !isAuthorizedPath) {
      router.replace(getHomePath(auth.session));
    }
  }, [auth, isAuthorizedPath, isBootstrapping, router]);

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
    router.replace("/login");
  }

  function isActive(href: string) {
    if (href === "/kurum") {
      return pathname === "/kurum";
    }
    if (href === "/sistem") {
      return pathname === "/sistem";
    }
    return pathname === href || pathname.startsWith(`${href}/`);
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
    <main className="next-app-shell">
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
        <div className="next-brand">
          <span className="next-brand-mark">UH</span>
          <span>Uzman Hocam</span>
        </div>
        <button className="next-command-open" type="button" onClick={(event) => openCommandPalette(event.currentTarget)} aria-label="Komut paleti" title="Komut paleti">
          <Search size={16} aria-hidden="true" />
        </button>
      </header>
      <aside
        className="next-sidebar"
        data-mobile-open={isMobileNavOpen ? "true" : "false"}
        id="next-sidebar"
        aria-label="Ana menü"
      >
        <header className="next-sidebar-header">
          <div className="next-brand">
            <span className="next-brand-mark">UH</span>
            <span>Uzman Hocam</span>
          </div>
          <button className="next-command-open" type="button" onClick={(event) => openCommandPalette(event.currentTarget)} aria-label="Komut paleti" title="Komut paleti">
            <Search size={16} aria-hidden="true" />
          </button>
          <button className="next-sidebar-close" type="button" onClick={closeMobileNav} ref={mobileNavCloseRef} aria-label="Ana menüyü kapat">
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <nav className="next-sidebar-nav" aria-label="Ana menü">
          {hasInstitutionAccess(auth.session.roles)
            ? visibleInstitutionNavGroups.map((group) => (
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
          {visiblePortalItems.length > 0 ? (
            <SidebarGroup
              expanded={Boolean(expandedSidebarGroups.portal) || visiblePortalItems.some((item) => isActive(item.href))}
              group={{ label: "Portal", items: visiblePortalItems }}
              groupKey="portal"
              isActive={visiblePortalItems.some((item) => isActive(item.href))}
              navCurrent={navCurrent}
              onToggle={toggleSidebarGroup}
            />
          ) : null}
          <button className="next-sidebar-logout" type="button" onClick={() => void handleLogout()}>
            Çıkış
          </button>
        </nav>
        {canUsePushDevices ? <PushDevicePanel accessToken={auth.accessToken} /> : null}
      </aside>
      <button
        aria-hidden={!isMobileNavOpen}
        aria-label="Menü arka planını kapat"
        className="next-sidebar-backdrop"
        onClick={closeMobileNav}
        tabIndex={isMobileNavOpen ? 0 : -1}
        type="button"
      />
      <section className="next-workspace">
        <RouteBreadcrumb pathname={pathname} />
        {children}
      </section>
      <CommandPalette
        accessToken={auth.accessToken}
        enableEntitySearch={canUseEntitySearch(auth.session.roles)}
        entitySearchRoles={auth.session.roles}
        items={commandItems}
        onClose={closeCommandPalette}
        onNavigate={navigateFromCommandPalette}
        open={isCommandOpen}
        query={commandQuery}
        setQuery={setCommandQuery}
      />
    </main>
  );
}

function focusCommandOpener(preferredOpener: HTMLButtonElement | null) {
  const candidates = [
    preferredOpener,
    ...Array.from(document.querySelectorAll<HTMLButtonElement>('.next-command-open[aria-label="Komut paleti"]')),
  ];
  const opener = candidates.find((candidate) => candidate && candidate.getClientRects().length > 0 && !candidate.disabled);
  opener?.focus();
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
    <Link className="next-sidebar-link" href={item.href} aria-current={current}>
      {Icon ? <Icon className="next-sidebar-link-icon" size={16} aria-hidden="true" /> : null}
      <span>{item.label}</span>
    </Link>
  );
}

function CommandPalette({
  accessToken,
  enableEntitySearch,
  entitySearchRoles,
  items,
  onClose,
  onNavigate,
  open,
  query,
  setQuery,
}: {
  accessToken: string;
  enableEntitySearch: boolean;
  entitySearchRoles: readonly string[];
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
      void searchEntities(accessToken, query, entitySearchRoles)
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
  }, [accessToken, enableEntitySearch, entitySearchRoles, query]);

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
                <small>{item.group}</small>
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
  if (pathname.startsWith("/sistem")) {
    return hasSystemAccess(session.roles);
  }
  if (pathname.startsWith("/kurum")) {
    return hasInstitutionAccess(session.roles) && canAccessInstitutionPath(session.roles, pathname);
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

  return true;
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

function buildCommandItems(
  institutionGroups: readonly NavigationGroup[],
  systemGroups: readonly NavigationGroup[],
  portalItems: readonly { href: string; label: string }[],
  roles: readonly string[],
): CommandPaletteItem[] {
  const navigationItems = [
    ...institutionGroups.flatMap((group) => group.items.map((item) => commandItem(item.href, item.label, group.label))),
    ...systemGroups.flatMap((group) => group.items.map((item) => commandItem(item.href, item.label, group.label))),
    ...portalItems.map((item) => commandItem(item.href, item.label, "Portal")),
  ];
  const actionItems = hasInstitutionAccess(roles)
    ? [
        hasCapabilityForRoles(roles, "operation:manage") ? commandItem("/kurum/kurulum", "Yeni dönem açılışı", "İş akışı") : null,
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
  return ["student:manage", "staff:manage", "class:manage"].some((capability) => hasCapabilityForRoles(roles, capability));
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

async function searchEntities(accessToken: string, query: string, roles: readonly string[]): Promise<EntitySearchResult[]> {
  const [students, teachers, guardians, classes] = await Promise.all([
    hasCapabilityForRoles(roles, "student:manage") ? safeEntityList<StudentRecord>(accessToken, "students", query) : Promise.resolve([]),
    hasCapabilityForRoles(roles, "staff:manage") ? safeEntityList<TeacherRecord>(accessToken, "teachers", query) : Promise.resolve([]),
    hasCapabilityForRoles(roles, "student:manage") ? safeEntityList<GuardianRecord>(accessToken, "guardians", query) : Promise.resolve([]),
    hasCapabilityForRoles(roles, "class:manage") ? safeEntityList<ClassRecord>(accessToken, "classes", query) : Promise.resolve([]),
  ]);

  return [
    ...students.map((student) => ({
      group: "Öğrenci",
      href: `/kurum/ogrenciler/${encodeURIComponent(student.id)}`,
      id: `student:${student.id}`,
      label: `${student.firstName} ${student.lastName}`,
    })),
    ...teachers.map((teacher) => ({
      group: "Öğretmen",
      href: `/kurum/ogretmenler/${encodeURIComponent(teacher.id)}`,
      id: `teacher:${teacher.id}`,
      label: `${teacher.firstName} ${teacher.lastName}`,
    })),
    ...guardians.map((guardian) => ({
      group: "Veli",
      href: `/kurum/veliler/${encodeURIComponent(guardian.id)}`,
      id: `guardian:${guardian.id}`,
      label: `${guardian.firstName} ${guardian.lastName}`,
    })),
    ...classes.map((record) => ({
      group: "Sınıf",
      href: `/kurum/siniflar/${encodeURIComponent(record.id)}`,
      id: `class:${record.id}`,
      label: record.name,
    })),
  ].slice(0, 12);
}

async function safeEntityList<TRecord>(accessToken: string, endpoint: string, query: string): Promise<TRecord[]> {
  try {
    const url = new URL(`${apiBaseUrl}/${endpoint}`);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(entitySearchLimit));
    return (await apiListRequest<TRecord>(accessToken, url.toString())).data;
  } catch {
    return [];
  }
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
  const override = (window as Window & { __UZMAN_HOCAM_WEB_PUSH_PUBLIC_KEY__?: string }).__UZMAN_HOCAM_WEB_PUSH_PUBLIC_KEY__;
  return override ?? process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ?? "";
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
