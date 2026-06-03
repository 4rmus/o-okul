"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { NotificationDeviceTokenRecord } from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiRequest } from "../../src/api-client.js";
import { useAuth } from "../providers.js";

const institutionNavGroups = [
  {
    label: "Kurum",
    items: [{ href: "/kurum", label: "Genel Bakış" }],
  },
  {
    label: "Kişiler",
    items: [
      { href: "/kurum/ogrenciler", label: "Öğrenciler" },
      { href: "/kurum/veliler", label: "Veliler" },
      { href: "/kurum/ogretmenler", label: "Öğretmenler" },
    ],
  },
  {
    label: "Akademik",
    items: [
      { href: "/kurum/kampusler", label: "Kampüsler" },
      { href: "/kurum/akademik-takvim", label: "Akademik Takvim" },
      { href: "/kurum/seviyeler", label: "Seviyeler" },
      { href: "/kurum/siniflar", label: "Sınıflar" },
      { href: "/kurum/dersler", label: "Dersler" },
      { href: "/kurum/program", label: "Ders Programı" },
      { href: "/kurum/etutler", label: "Etütler" },
      { href: "/kurum/devamsizlik", label: "Devamsızlık" },
      { href: "/kurum/notlar", label: "Öğretmen Notları" },
      { href: "/kurum/materyaller", label: "Materyaller" },
    ],
  },
  {
    label: "Sınav ve Rapor",
    items: [
      { href: "/kurum/sinavlar", label: "Sınavlar" },
      { href: "/kurum/optik", label: "Optik" },
      { href: "/kurum/raporlar", label: "Raporlar" },
    ],
  },
  {
    label: "Finans",
    items: [{ href: "/kurum/finans", label: "Ödemeler" }],
  },
  {
    label: "İletişim",
    items: [
      { href: "/kurum/duyurular", label: "Duyurular" },
      { href: "/kurum/sablonlar", label: "Şablonlar" },
      { href: "/kurum/destek", label: "Destek" },
    ],
  },
  {
    label: "Operasyon",
    items: [
      { href: "/kurum/kullanicilar", label: "Kullanıcılar" },
      { href: "/kurum/rol-onizleme", label: "Rol Önizleme" },
      { href: "/kurum/denetim", label: "Denetim" },
      { href: "/kurum/kvkk", label: "KVKK" },
      { href: "/kurum/guvenlik-denetimi", label: "Güvenlik Denetimi" },
      { href: "/kurum/gozlemlenebilirlik", label: "Gözlemlenebilirlik" },
      { href: "/kurum/uat-rollback", label: "UAT / Rollback" },
      { href: "/kurum/canli-yayin", label: "Canlı Yayın" },
      { href: "/kurum/sistem-sagligi", label: "Sistem Sağlığı" },
      { href: "/kurum/yedek-restore", label: "Yedek / Restore" },
    ],
  },
] as const;

const rolePortalItems = [
  { href: "/ogretmen", label: "Öğretmen Portalı", role: "TEACHER", subjectType: "TEACHER" },
  { href: "/ogrenci", label: "Öğrenci Portalı", role: "STUDENT", subjectType: "STUDENT" },
  { href: "/veli", label: "Veli Portalı", role: "GUARDIAN", subjectType: "GUARDIAN" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { auth, isBootstrapping, logout } = useAuth();

  useEffect(() => {
    if (!isBootstrapping && !auth) {
      window.location.replace("/login");
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
        <div className="next-brand">
          <span className="next-brand-mark">UH</span>
          <span>Uzman Hocam</span>
        </div>
        <nav>
          {hasInstitutionAccess(auth.session.roles)
            ? institutionNavGroups.map((group) => (
                <div key={group.label} className="next-sidebar-group">
                  <p className="next-sidebar-group-title">{group.label}</p>
                  {group.items.map((item) => (
                    <Link key={item.href} href={item.href} aria-current={navCurrent(item.href)}>
                      {item.label}
                    </Link>
                  ))}
                </div>
              ))
            : null}
          {visiblePortalItems.length > 0 ? (
            <div className="next-sidebar-group">
              <p className="next-sidebar-group-title">Portal</p>
              {visiblePortalItems.map((item) => (
                <Link key={item.href} href={item.href} aria-current={navCurrent(item.href)}>
                  {item.label}
                </Link>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={() => void handleLogout()}>
            Çıkış
          </button>
        </nav>
        <PushDevicePanel accessToken={auth.accessToken} />
      </aside>
      <section className="next-workspace">{children}</section>
    </main>
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
