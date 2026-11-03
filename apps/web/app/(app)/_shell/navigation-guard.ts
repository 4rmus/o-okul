"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type LeaveCheck = () => Promise<boolean>;

/**
 * Browser back/forward cannot be cancelled after the fact, so an armed guard sits on a sentinel history entry: a
 * copy of the page's own entry (same URL, same Next.js router state) pushed on top of it. Back pops the sentinel and
 * leaves the URL as it was; the capture listener below stops that popstate before the Next.js router sees it and
 * asks the page. Cancel pushes the sentinel again; confirm takes the step the user asked for.
 *
 * Next.js 16 patches history.pushState/replaceState and listens to popstate (non-capture) on window. States that
 * carry `__NA` pass the patch untouched, so the sentinel copies the current entry's state, `__NA` and router tree
 * included, and Next.js keeps restoring the page from it like any of its own entries. Capture listeners at the
 * target run before non-capture ones, which lets this module swallow the traversals it answers itself.
 *
 * Arming truncates the forward stack (any history push does). When the guard is released while the page stays
 * (unsaved work saved or discarded, or a guarded in-app navigation confirmed), the sentinel is popped with
 * history.back() and that popstate is swallowed, so no duplicate entry remains. Known leftover: a reload or an
 * unguarded programmatic navigation while armed keeps the sentinel; it restores the same page, one extra back.
 */
const baseKey = "__ookulGuardBase";
const sentinelKey = "__ookulGuardSentinel";
const sentinelRemovalTimeoutMs = 1000;
const unloadAllowanceMs = 1000;

type GuardPhase = "arming" | "armed" | "asking" | "released";

interface ActiveGuard {
  token: string;
  check: LeaveCheck;
  phase: GuardPhase;
  url: string;
  sentinelState: Record<string, unknown> | null;
}

let activeGuard: ActiveGuard | null = null;
let pendingRemoval: { done: Promise<void>; finish(): void } | null = null;
let allowUnloadUntil = 0;
let listenersInstalled = false;
let tokenSequence = 0;

/** Resolves true when no page holds unsaved work, otherwise asks the page whether in-app navigation may proceed. */
export async function confirmInAppNavigation(): Promise<boolean> {
  const guard = activeGuard;
  if (!guard) return true;
  // A back/forward question is already on screen; a second navigation waits for that answer instead.
  if (guard.phase === "asking") return false;
  const canNavigate = await guard.check();
  if (!canNavigate) return false;
  // The caller navigates next; the sentinel goes first so the new page lands directly above the guarded one.
  if (activeGuard === guard) await releaseGuard(guard);
  return true;
}

export function hasInAppNavigationGuard() {
  return activeGuard !== null;
}

/**
 * While `when` is true, in-app link clicks (sidebar, bottom nav, breadcrumbs, page links) and browser back/forward
 * wait for `canLeave` before the route changes; the command palette and the shell's persona switch and logout ask
 * through `confirmInAppNavigation`. Reload and tab close stay with the page's own beforeunload handler.
 */
export function useInAppNavigationGuard(when: boolean, canLeave: LeaveCheck) {
  const router = useRouter();
  const canLeaveRef = useRef(canLeave);
  useEffect(() => {
    canLeaveRef.current = canLeave;
  });

  useEffect(() => {
    if (!when) return undefined;
    installListeners();
    tokenSequence += 1;
    const guard: ActiveGuard = {
      token: `${Date.now().toString(36)}-${tokenSequence}`,
      check: () => canLeaveRef.current(),
      phase: "arming",
      url: window.location.href,
      sentinelState: null,
    };
    activeGuard = guard;
    void armGuard(guard);
    // Capture phase runs before next/link's own handler, so the route never changes before the answer.
    const handleClick = (event: MouseEvent) => {
      const href = guardedHref(event);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmInAppNavigation().then((canNavigate) => {
        if (canNavigate) router.push(href);
      });
    };
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      if (activeGuard !== guard) return;
      activeGuard = null;
      void releaseGuard(guard);
    };
  }, [router, when]);
}

async function armGuard(guard: ActiveGuard) {
  // A sentinel still being popped (strict-mode remount, quick save then retype) must leave before a new one comes.
  if (pendingRemoval) await pendingRemoval.done;
  if (activeGuard !== guard || guard.phase !== "arming") return;
  const current = isRecord(window.history.state) ? window.history.state : {};
  const base = { ...withoutGuardKeys(current), [baseKey]: guard.token };
  const sentinel = { ...withoutGuardKeys(current), [sentinelKey]: guard.token };
  guard.url = window.location.href;
  guard.sentinelState = sentinel;
  window.history.replaceState(base, "", guard.url);
  window.history.pushState(sentinel, "", guard.url);
  guard.phase = "armed";
}

/** Drops the guard's sentinel when the page stays; resolves once the history entry is gone. */
async function releaseGuard(guard: ActiveGuard) {
  const wasArmed = guard.phase === "armed";
  guard.phase = "released";
  if (!wasArmed || window.location.href !== guard.url) return;
  await removeSentinel();
}

function removeSentinel() {
  if (pendingRemoval) return pendingRemoval.done;
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => settle(), sentinelRemovalTimeoutMs);
    function settle() {
      window.clearTimeout(timer);
      pendingRemoval = null;
      resolve();
    }
    finish = settle;
  });
  pendingRemoval = { done, finish };
  window.history.back();
  return done;
}

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  window.addEventListener("popstate", handlePopState, { capture: true });
  window.addEventListener("beforeunload", handleBeforeUnload, { capture: true });
}

function handlePopState(event: PopStateEvent) {
  // The traversal this module started to drop a sentinel: same URL, same page, nothing for the router to do.
  if (pendingRemoval) {
    event.stopImmediatePropagation();
    pendingRemoval.finish();
    return;
  }
  const guard = activeGuard;
  if (!guard) return;
  if (guard.phase === "asking") {
    // Another back press while the question is open: the answer decides where the page goes.
    event.stopImmediatePropagation();
    return;
  }
  if (guard.phase !== "armed") return;
  event.stopImmediatePropagation();
  guard.phase = "asking";
  void guard.check().then(
    (canLeave) => answerTraversal(guard, canLeave),
    () => answerTraversal(guard, false),
  );
}

function answerTraversal(guard: ActiveGuard, canLeave: boolean) {
  if (activeGuard !== guard || guard.phase !== "asking") return;
  if (!canLeave) {
    // Back on top of the guarded page: same URL, the router never left it.
    window.history.pushState(guard.sentinelState, "", guard.url);
    guard.phase = "armed";
    return;
  }
  guard.phase = "released";
  // The page's own beforeunload would ask a second time when the previous entry is another document.
  allowUnloadUntil = Date.now() + unloadAllowanceMs;
  const state: unknown = window.history.state;
  if (isRecord(state) && state[baseKey] === guard.token) {
    // One step back: the sentinel is already gone, so the entry before the page is one more step.
    window.history.back();
    return;
  }
  // The browser already stands on the entry the user picked (a longer jump or a second back press); hand that
  // traversal to the router now.
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (Date.now() < allowUnloadUntil) event.stopImmediatePropagation();
}

function withoutGuardKeys(state: Record<string, unknown>) {
  const { [baseKey]: _base, [sentinelKey]: _sentinel, ...rest } = state;
  return rest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
