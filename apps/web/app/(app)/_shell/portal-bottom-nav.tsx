"use client";

import Link from "next/link";
import { Button } from "@o-okul/ui";
import { BarChart3, LayoutDashboard, Megaphone, MoreHorizontal, NotebookTabs } from "lucide-react";

type PortalRoot = "/ogretmen" | "/ogrenci";

// <1024 px alt sekme çubuğu (§2): Özet · Ödevler · Raporlar · Duyurular · Daha fazla.
// "Daha fazla" menüdeki diğer portal öğelerini (mobil çekmece) açar; yeni route eklenmez.
export function PortalBottomNav({ isActive, onMore, root }: { isActive(href: string): boolean; onMore(): void; root: PortalRoot }) {
  const items = [
    { href: root, icon: LayoutDashboard, label: "Özet" },
    { href: `${root}/odevler`, icon: NotebookTabs, label: "Ödevler" },
    { href: `${root}/raporlar`, icon: BarChart3, label: "Raporlar" },
    { href: `${root}/duyurular`, icon: Megaphone, label: "Duyurular" },
  ];

  return (
    <nav aria-label="Portal kısayolları" className="next-portal-bottom-nav">
      {items.map(({ href, icon: Icon, label }) => (
        <Link aria-current={isActive(href) ? "page" : undefined} className="next-portal-bottom-nav__link" href={href} key={href}>
          <Icon aria-hidden="true" size={18} />
          <span>{label}</span>
        </Link>
      ))}
      <Button className="next-portal-bottom-nav__link" onClick={onMore} variant="ghost">
        <MoreHorizontal aria-hidden="true" size={18} />
        <span>Daha fazla</span>
      </Button>
    </nav>
  );
}
