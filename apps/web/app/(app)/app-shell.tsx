"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
      { href: "/kurum/siniflar", label: "Sınıflar" },
      { href: "/kurum/materyaller", label: "Materyaller" },
    ],
  },
  {
    label: "Sınav ve Rapor",
    items: [
      { href: "/kurum/optik", label: "Optik" },
      { href: "/kurum/raporlar", label: "Raporlar" },
    ],
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
      { href: "/kurum/denetim", label: "Denetim" },
      { href: "/kurum/kvkk", label: "KVKK" },
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
      </aside>
      <section className="next-workspace">{children}</section>
    </main>
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
