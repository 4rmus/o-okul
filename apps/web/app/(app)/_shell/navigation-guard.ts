"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type LeaveCheck = () => Promise<boolean>;

let activeLeaveCheck: LeaveCheck | null = null;

/** Resolves true when no page holds unsaved work, otherwise asks the page whether in-app navigation may proceed. */
export function confirmInAppNavigation(): Promise<boolean> {
  return activeLeaveCheck ? activeLeaveCheck() : Promise.resolve(true);
}

export function hasInAppNavigationGuard() {
  return activeLeaveCheck !== null;
}

/**
 * While `when` is true, in-app link clicks (sidebar, bottom nav, breadcrumbs, page links) wait for `canLeave`
 * before the route changes; the command palette asks through `confirmInAppNavigation`. Reload and tab close
 * stay with the page's own beforeunload handler.
 */
export function useInAppNavigationGuard(when: boolean, canLeave: LeaveCheck) {
  const router = useRouter();
  const canLeaveRef = useRef(canLeave);
  useEffect(() => {
    canLeaveRef.current = canLeave;
  });

  useEffect(() => {
    if (!when) return undefined;
    const check: LeaveCheck = () => canLeaveRef.current();
    activeLeaveCheck = check;
    // Capture phase runs before next/link's own handler, so the route never changes before the answer.
    const handleClick = (event: MouseEvent) => {
      const href = guardedHref(event);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      void check().then((canNavigate) => {
        if (canNavigate) router.push(href);
      });
    };
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      if (activeLeaveCheck === check) activeLeaveCheck = null;
    };
  }, [router, when]);
}

function guardedHref(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return undefined;
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return undefined;
  // The command palette closes itself before asking, so its links consult the guard directly.
  if (anchor.closest('[data-navigation-guard="manual"]')) return undefined;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return undefined;
  // Same page (skip link, hash jump): nothing unmounts.
  if (url.pathname === window.location.pathname && url.search === window.location.search) return undefined;
  return `${url.pathname}${url.search}${url.hash}`;
}
