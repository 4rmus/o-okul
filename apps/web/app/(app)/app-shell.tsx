"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { NotificationDeviceTokenRecord } from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiRequest } from "../../src/api-client.js";
import { useAuth } from "../providers.js";
import { dynamicDetailParents, institutionNavGroups, rolePortalItems, staticBreadcrumbLabels } from "./_shared/navigation.js";
const allNavigationItems = [
  ...institutionNavGroups.flatMap((group) => group.items),
  ...rolePortalItems,
];

const breadcrumbLabelByPath = {
  ...Object.fromEntries(allNavigationItems.map((item) => [item.href, item.label])),
  ...staticBreadcrumbLabels,
};

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { auth, isBootstrapping, logout } = useAuth();

  useEffect(() => {
    if (!isBootstrapping && !auth) {
      router.replace("/login");
      return;
    }

    if (!isBootstrapping && auth && !canAccessPath(auth.session, pathname)) {
      router.replace(getHomePath(auth.session));
    }
  }, [auth, isBootstrapping, pathname, router]);

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
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function navCurrent(href: string) {
    return isActive(href) ? "page" : undefined;
  }

  const visiblePortalItems = rolePortalItems.filter((item) => hasSubjectPortalAccess(auth.session, item.role, item.subjectType));

  return (
    <main className="next-app-shell">
      <aside className="next-sidebar" aria-label="Ana menü">
        <header className="next-sidebar-header">
          <div className="next-brand">
            <span className="next-brand-mark">UH</span>
            <span>Uzman Hocam</span>
          </div>
        </header>
        <nav className="next-sidebar-nav" aria-label="Ana menü">
          {hasInstitutionAccess(auth.session.roles)
            ? institutionNavGroups.map((group) => (
                <section key={group.label} className="next-sidebar-group">
                  <p className="next-sidebar-group-title">{group.label}</p>
                  <ul className="next-sidebar-group-list">
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <Link className="next-sidebar-link" href={item.href} aria-current={navCurrent(item.href)}>
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            : null}
          {visiblePortalItems.length > 0 ? (
            <section className="next-sidebar-group">
              <p className="next-sidebar-group-title">Portal</p>
              <ul className="next-sidebar-group-list">
                {visiblePortalItems.map((item) => (
                  <li key={item.href}>
                    <Link className="next-sidebar-link" href={item.href} aria-current={navCurrent(item.href)}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <button className="next-sidebar-logout" type="button" onClick={() => void handleLogout()}>
            Çıkış
          </button>
        </nav>
        <PushDevicePanel accessToken={auth.accessToken} />
      </aside>
      <section className="next-workspace">
        <RouteBreadcrumb pathname={pathname} />
        {children}
      </section>
    </main>
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

function canAccessPath(session: AppSession, pathname: string) {
  if (pathname.startsWith("/kurum")) {
    return hasInstitutionAccess(session.roles);
  }
  if (pathname.startsWith("/ogretmen")) {
    return hasSubjectPortalAccess(session, "TEACHER", "TEACHER");
  }
  if (pathname.startsWith("/ogrenci")) {
    return hasSubjectPortalAccess(session, "STUDENT", "STUDENT");
  }
  if (pathname.startsWith("/veli")) {
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

  return currentSegment
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function getHomePath(session: AppSession) {
  if (hasInstitutionAccess(session.roles)) return "/kurum";
  if (hasSubjectPortalAccess(session, "TEACHER", "TEACHER")) return "/ogretmen";
  if (hasSubjectPortalAccess(session, "STUDENT", "STUDENT")) return "/ogrenci";
  if (hasSubjectPortalAccess(session, "GUARDIAN", "GUARDIAN")) return "/veli";
  return "/login";
}

function hasInstitutionAccess(roles: readonly string[]) {
  return roles.includes("TENANT_ADMIN") || roles.includes("SYSTEM_ADMIN");
}

function hasSubjectPortalAccess(session: AppSession, role: string, subjectType: AppSession["subjectType"]) {
  return session.roles.includes(role) && session.subjectType === subjectType;
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
