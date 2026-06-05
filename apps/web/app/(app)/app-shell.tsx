"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Search, type LucideIcon } from "lucide-react";
import type { ClassRecord, GuardianRecord, NotificationDeviceTokenRecord, StudentRecord, TeacherRecord } from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiListRequest, apiRequest } from "../../src/api-client.js";
import { useAuth } from "../providers.js";
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

  useEffect(() => {
    if (!isBootstrapping && !auth) {
      router.replace("/login");
      return;
    }

    if (!isBootstrapping && auth && !canAccessPath(auth.session, pathname, searchParams)) {
      router.replace(getHomePath(auth.session));
    }
  }, [auth, isBootstrapping, pathname, router, searchParams]);

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
        setExpandedSidebarGroups(JSON.parse(storedGroups) as Record<string, boolean>);
      }
    } catch {
      setExpandedSidebarGroups({});
    }
  }, []);

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

  function navigateCommand(href: string) {
    setIsCommandOpen(false);
    setCommandQuery("");
    router.replace(href);
  }

  function isGroupActive(group: NavigationGroup) {
    return group.items.some((item) => isActive(item.href));
  }

  function toggleSidebarGroup(groupKey: string) {
    setExpandedSidebarGroups((current) => {
      const next = { ...current };
      if (next[groupKey]) {
        delete next[groupKey];
      } else {
        next[groupKey] = true;
      }

      try {
        window.localStorage.setItem(sidebarGroupStorageKey, JSON.stringify(next));
      } catch {}

      return next;
    });
  }

  return (
    <main className="next-app-shell">
      <aside className="next-sidebar" aria-label="Ana menü">
        <header className="next-sidebar-header">
          <div className="next-brand">
            <span className="next-brand-mark">UH</span>
            <span>Uzman Hocam</span>
          </div>
          <button className="next-command-open" type="button" onClick={() => setIsCommandOpen(true)} aria-label="Komut paleti" title="Komut paleti">
            <Search size={16} aria-hidden="true" />
          </button>
        </header>
        <nav className="next-sidebar-nav" aria-label="Ana menü">
          {hasInstitutionAccess(auth.session.roles)
            ? visibleInstitutionNavGroups.map((group) => (
                <SidebarGroup
                  key={group.label}
                  expanded={Boolean(expandedSidebarGroups[`institution:${group.label}`])}
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
                  expanded={Boolean(expandedSidebarGroups[`system:${group.label}`])}
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
              expanded={Boolean(expandedSidebarGroups.portal)}
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
      <section className="next-workspace">
        <RouteBreadcrumb pathname={pathname} />
        {children}
      </section>
      <CommandPalette
        accessToken={auth.accessToken}
        enableEntitySearch={hasInstitutionAccess(auth.session.roles)}
        items={commandItems}
        onClose={() => setIsCommandOpen(false)}
        onNavigate={navigateCommand}
        open={isCommandOpen}
        query={commandQuery}
        setQuery={setCommandQuery}
      />
    </main>
  );
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

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="next-command-palette" role="dialog" aria-modal="true" aria-labelledby="next-command-title">
      <div className="next-command-panel">
        <div className="next-command-header">
          <h2 id="next-command-title">Komut paleti</h2>
          <button type="button" onClick={onClose}>
            Kapat
          </button>
        </div>
        <label>
          Komut ara
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <div className="next-command-results">
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => (
              <button key={item.id} type="button" onClick={() => onNavigate(item.href)}>
                <span>{item.label}</span>
                <small>{item.group}</small>
              </button>
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
              <button key={item.id} type="button" onClick={() => onNavigate(item.href)}>
                <span>{item.label}</span>
                <small>{item.group}</small>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
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

  return (
    <section className="next-push-panel" aria-label="Bildirim cihazı">
      <div>
        <h2>Bildirim cihazı</h2>
        <p>{activeDevices.length} aktif cihaz</p>
      </div>
      <button type="button" disabled={isSaving} onClick={() => void handleRegister()}>
        Push iznini aç
      </button>
      {latestDevice ? (
        <button type="button" disabled={isSaving} onClick={() => void handleDisable(latestDevice.id)}>
          Cihazı kapat
        </button>
      ) : null}
      <p>{status}</p>
    </section>
  );
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
    if (searchParams?.get("rolePreviewToken") && hasInstitutionAccess(session.roles)) {
      return true;
    }
    return hasSubjectPortalAccess(session, "TEACHER", "TEACHER");
  }
  if (pathname.startsWith("/ogrenci")) {
    if (searchParams?.get("rolePreviewToken") && hasInstitutionAccess(session.roles)) {
      return true;
    }
    return hasSubjectPortalAccess(session, "STUDENT", "STUDENT");
  }
  if (pathname.startsWith("/veli")) {
    if (searchParams?.get("rolePreviewToken") && hasInstitutionAccess(session.roles)) {
      return true;
    }
    return hasSubjectPortalAccess(session, "GUARDIAN", "GUARDIAN");
  }

  return true;
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
        commandItem("/kurum/kurulum", "Yeni dönem açılışı", "İş akışı"),
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
  const [students, teachers, guardians, classes] = await Promise.all([
    safeEntityList<StudentRecord>(accessToken, "students", query),
    safeEntityList<TeacherRecord>(accessToken, "teachers", query),
    safeEntityList<GuardianRecord>(accessToken, "guardians", query),
    safeEntityList<ClassRecord>(accessToken, "classes", query),
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
