"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Button } from "@o-okul/ui";
import type { NavigationGroup, SidebarItem } from "./nav-sidebar.js";
import { hasInAppNavigationGuard } from "./navigation-guard.js";

export function CampusNavigation({ groups, grouped, navCurrent, pathname }: {
  groups: readonly NavigationGroup[];
  grouped: boolean;
  navCurrent(item: SidebarItem | string): "page" | undefined;
  pathname: string;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setOpenGroup(null), [pathname]);
  useEffect(() => {
    if (!openGroup) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setOpenGroup(null);
    }
    // The page dialog must restore focus to the disclosure, not a link hidden by its opening.
    function closeBeforePageDialog(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !hasInAppNavigationGuard()) return;
      const link = event.target instanceof Element ? event.target.closest("ul a[href]") : null;
      if (!link || !navRef.current?.contains(link)) return;
      openerRef.current?.focus({ preventScroll: true });
      setOpenGroup(null);
    }
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("click", closeBeforePageDialog, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("click", closeBeforePageDialog, true);
    };
  }, [openGroup]);

  function itemLink(item: SidebarItem) {
    return <Link key={item.href} href={item.href} aria-current={navCurrent(item)} onClick={() => setOpenGroup(null)}>{item.label}</Link>;
  }

  return (
    <nav className="next-campus-nav" aria-label="Ana menü" ref={navRef}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpenGroup(null); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && openGroup) {
          event.preventDefault();
          setOpenGroup(null);
          openerRef.current?.focus();
        }
      }}>
      {groups.map((group, index) => !grouped || group.items.length === 1
        ? group.items.map(itemLink)
        : <div className="next-campus-nav-group" key={group.label}>
            <Button variant="ghost" type="button" aria-expanded={openGroup === group.label} aria-controls={`campus-navigation-${index}`}
              data-active={group.items.some((item) => navCurrent(item) === "page") ? "true" : undefined}
              onClick={(event) => {
                openerRef.current = event.currentTarget;
                setOpenGroup((current) => current === group.label ? null : group.label);
              }}>
              {group.label}<ChevronDown size={14} aria-hidden="true" />
            </Button>
            <ul id={`campus-navigation-${index}`} hidden={openGroup !== group.label}>
              {group.items.map((item) => <li key={item.href}>{itemLink(item)}</li>)}
            </ul>
          </div>)}
      <Link className="next-campus-account-link" href="/hesap/oturumlar" aria-current={navCurrent("/hesap/oturumlar")}>Oturumlar</Link>
      <Link href="/iletisim#destek">o-okul desteği</Link>
    </nav>
  );
}
