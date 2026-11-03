"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type LeaveCheck = () => Promise<boolean>;

/**
 * Browser back/forward cannot be cancelled after the fact, so an armed guard sits on a sentinel history entry: a
 * copy of the page's own entry (same URL, same Next.js router state) pushed on top of its base entry. Back pops the
 * sentinel and leaves the URL as it was; this module keeps that popstate from the Next.js router and asks the page.
 * Cancel puts the sentinel back; confirm takes the step the user asked for.
 *
 * Next.js 16 patches history.pushState/replaceState and listens to popstate on window. States that carry `__NA`
 * pass the patch untouched, so guard entries copy the page entry's state, `__NA` and router tree included, and
 * Next.js keeps restoring the page from them like any of its own entries.
 *
 * Keeping a traversal from the router: Chromium runs window popstate listeners in registration order whatever their
 * capture flag, and Next.js registers its listener when the app router mounts, usually before this module loads
 * (login → app is a client navigation). A listener alone therefore runs too late, and React renders the router's
 * traversal synchronously inside the popstate. So the module also gates `PopStateEvent.prototype.state`: for a
 * trusted popstate it claims, the getter returns null, and Next.js's handler returns early on a null state
 * (next/dist/client/components/app-router.js, onPopState). The decision is made once per event by whichever reads
 * first, the router's getter call or this module's listener, which then stops the remaining listeners.
 *
 * Invariant: the address bar always shows the page Next.js renders. Every traversal this module swallows leaves
 * the router on the guarded page, so the browser must end on an entry with the guarded URL:
 * - Cancel after one step back (the browser stands on the base) pushes the sentinel again.
 * - Cancel after a longer jump (long-press history menu, a second back press while the question is open) leaves
 *   the browser on another page's entry. Where the Navigation API reports history indexes (Chromium, recent
 *   Safari/Firefox) the guard steps forward to its sentinel and every entry stays. Elsewhere the distance is
 *   unknown: that entry is rewritten into the guarded page's base and the sentinel pushed on top, so the entry it
 *   held and the ones the jump passed over are dropped.
 * - Release pops the sentinel with history.back() only while the entry under it is known to be this guard's base;
 *   otherwise the sentinel turns into a plain copy of the page in place.
 *
 * Arming truncates the forward stack (any history push does). Release while the page stays (unsaved work saved or
 * discarded, a guarded in-app navigation confirmed) pops the sentinel and swallows that popstate, so no duplicate
 * entry remains. A caller that replaces the current entry next (logout, persona switch) releases with
 * `replace: true`: the sentinel itself is the entry it replaces, so no forward entry back into the page remains
 * and the page's copy stays behind it in the back stack. A confirmed step that does not happen (the navigation
 * fails, back on the first history entry) re-arms the guard once the page is found still on its URL.
 *
 * Known leftovers: a reload or an unguarded programmatic navigation while armed keeps the sentinel (it restores the
 * same page, one extra back); a removal traversal that arrives after its timeout is swallowed only within
 * `lateRemovalWindowMs`, and a real back press in that window right after such a timeout is ignored once.
 */
const baseKey = "__ookulGuardBase";
const sentinelKey = "__ookulGuardSentinel";
const releasedKey = "__ookulGuardReleased";
const sentinelRemovalTimeoutMs = 1000;
const lateRemovalWindowMs = 10_000;
const unloadAllowanceMs = 1000;
const rearmAfterMs = 2000;

type GuardPhase = "arming" | "armed" | "asking" | "released";
type ReleaseMode = "pop" | "replace";
type HistoryRecord = Record<string, unknown>;

interface ActiveGuard {
  token: string;
  check: LeaveCheck;
  phase: GuardPhase;
  url: string;
  /** The page entry's own state (router tree included) without guard keys. */
  pageState: HistoryRecord;
  /** True while the entry directly under the sentinel is this guard's base. */
  overBase: boolean;
  /** The sentinel's position in session history, where the Navigation API reports it. */
  sentinelIndex: number | undefined;
  /** The page stopped guarding (saved elsewhere, unmounted) while a back/forward question was open. */
  detached: boolean;
  /** The page unmounted while a back/forward question was open; its answer no longer moves history. */
  pageGone: boolean;
  /** location.href after the last traversal swallowed while asking. */
  traversalHref: string;
  rearmTimer: number | undefined;
}

export interface InAppNavigationOptions {
  /**
   * The caller replaces the current history entry next (logout, persona switch). The guard entry becomes the entry
   * that is replaced instead of being popped, so no forward entry back into the guarded page remains.
   */
  replace?: boolean;
}

let activeGuard: ActiveGuard | null = null;
let pendingTraversal: { done: Promise<boolean>; finish(): void } | null = null;
let lateRemoval: { token: string; url: string; until: number } | null = null;
let allowUnloadUntil = 0;
let leavingDocument = false;
let listenersInstalled = false;
const claimedTraversals = new WeakMap<Event, boolean>();
let tokenSequence = 0;

/** Resolves true when no page holds unsaved work, otherwise asks the page whether in-app navigation may proceed. */
export async function confirmInAppNavigation(options: InAppNavigationOptions = {}): Promise<boolean> {
  const guard = activeGuard;
  if (!guard) return true;
  // A back/forward question is already on screen; a second navigation waits for that answer instead.
  if (guard.phase === "asking") return false;
  const canNavigate = await guard.check().catch(() => false);
  if (!canNavigate) return false;
  if (activeGuard === guard) {
    // The caller navigates next; the sentinel goes first so the new page lands directly above the guarded one.
    await releaseGuard(guard, options.replace ? "replace" : "pop");
    // The navigation may never happen (same route again, a failed request); the page then gets its guard back.
    scheduleRearm(guard);
  }
  return true;
}

/**
 * Re-arms the guard right away after a confirmed in-app navigation that did not take place (for example a failed
 * persona switch). It does nothing when no page holds unsaved work, the guard is armed, or the page has moved on.
 */
export function rearmInAppNavigationGuard() {
  if (activeGuard) rearm(activeGuard);
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
  const mountedRef = useRef(false);
  useEffect(() => {
    canLeaveRef.current = canLeave;
  });
  // Declared before the guard effect, so on unmount its cleanup runs first and the guard cleanup sees false.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!when) return undefined;
    installListeners();
    tokenSequence += 1;
    const guard: ActiveGuard = {
      token: `${Date.now().toString(36)}-${tokenSequence}`,
      check: () => canLeaveRef.current(),
      phase: "arming",
      url: window.location.href,
      pageState: {},
      overBase: false,
      sentinelIndex: undefined,
      detached: false,
      pageGone: false,
      traversalHref: "",
      rearmTimer: undefined,
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
      window.clearTimeout(guard.rearmTimer);
      if (activeGuard !== guard) return;
      activeGuard = null;
      if (guard.phase === "asking") {
        // The open question still gets its answer, so the address ends on the page that is rendered.
        guard.detached = true;
        guard.pageGone = !mountedRef.current;
        return;
      }
      void releaseGuard(guard, "pop");
    };
  }, [router, when]);
}

async function armGuard(guard: ActiveGuard) {
  // A sentinel still being popped (strict-mode remount, quick save then retype) must leave before a new one comes.
  if (pendingTraversal) await pendingTraversal.done;
  if (activeGuard !== guard || guard.phase !== "arming") return;
  const current = currentState();
  guard.url = window.location.href;
  guard.pageState = withoutGuardKeys(current);
  const ownEntryOverBase = guard.overBase && (current[releasedKey] === guard.token || current[sentinelKey] === guard.token);
  if (ownEntryOverBase) {
    // Re-arming over this guard's own entry, which still sits right above its base: it becomes the sentinel again.
    window.history.replaceState(sentinelState(guard), "", guard.url);
    guard.sentinelIndex = historyIndex();
    guard.phase = "armed";
    return;
  }
  pushSentinelOverBase(guard);
}

/** Marks the current entry as the page's base and puts the sentinel on top of it; the guard is armed after. */
function pushSentinelOverBase(guard: ActiveGuard) {
  window.history.replaceState(baseState(guard), "", guard.url);
  window.history.pushState(sentinelState(guard), "", guard.url);
  guard.sentinelIndex = historyIndex();
  guard.overBase = true;
  guard.phase = "armed";
}

/** Takes the guard's sentinel off while the page stays; resolves once the history entry is gone or converted. */
async function releaseGuard(guard: ActiveGuard, mode: ReleaseMode) {
  const wasArmed = guard.phase === "armed";
  guard.phase = "released";
  if (!wasArmed || window.location.href !== guard.url) return;
  if (mode === "pop" && guard.overBase) {
    await removeSentinel(guard);
    return;
  }
  // The entry stays and only the guard mark goes, so the address keeps matching the page. With `replace` the
  // caller's next replace overwrites this very entry.
  const current = currentState();
  const released = guard.overBase ? { ...withoutGuardKeys(current), [releasedKey]: guard.token } : withoutGuardKeys(current);
  window.history.replaceState(released, "", guard.url);
}

function removeSentinel(guard: ActiveGuard) {
  return traverseSilently(-1, () => {
    // A slow traversal may still land on the base later; handlePopState keeps it from the router.
    lateRemoval = { token: guard.token, url: guard.url, until: Date.now() + lateRemovalWindowMs };
  });
}

/** history.go(delta) whose popstate never reaches the router; resolves false when it did not arrive in time. */
function traverseSilently(delta: number, onTimeout?: () => void): Promise<boolean> {
  if (pendingTraversal) return pendingTraversal.done.then(() => false);
  let finish = () => {};
  const done = new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => settle(false), sentinelRemovalTimeoutMs);
    function settle(arrived: boolean) {
      window.clearTimeout(timer);
      pendingTraversal = null;
      if (!arrived) onTimeout?.();
      resolve(arrived);
    }
    finish = () => settle(true);
  });
  pendingTraversal = { done, finish };
  window.history.go(delta);
  return done;
}

function scheduleRearm(guard: ActiveGuard) {
  window.clearTimeout(guard.rearmTimer);
  guard.rearmTimer = window.setTimeout(() => rearm(guard), rearmAfterMs);
}

function rearm(guard: ActiveGuard) {
  window.clearTimeout(guard.rearmTimer);
  guard.rearmTimer = undefined;
  if (activeGuard !== guard || guard.phase !== "released" || leavingDocument) return;
  if (window.location.href !== guard.url) return;
  allowUnloadUntil = 0;
  guard.phase = "arming";
  void armGuard(guard);
}

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  installStateGate();
  window.addEventListener("popstate", handlePopState, { capture: true });
  window.addEventListener("beforeunload", handleBeforeUnload, { capture: true });
  // A page restored from the back/forward cache did not leave after all.
  window.addEventListener("pageshow", () => {
    leavingDocument = false;
  });
}

function handlePopState(event: PopStateEvent) {
  if (claimTraversal(event)) event.stopImmediatePropagation();
}

/** Hides the state of a claimed popstate from the router (see the module comment). */
function installStateGate() {
  const descriptor = Object.getOwnPropertyDescriptor(PopStateEvent.prototype, "state");
  const readState = descriptor?.get;
  if (!descriptor?.configurable || !readState) return;
  Object.defineProperty(PopStateEvent.prototype, "state", {
    configurable: true,
    enumerable: descriptor.enumerable,
    get(this: PopStateEvent): unknown {
      const state: unknown = readState.call(this);
      // Synthetic events (the hand-over in leaveTo) and events of other types always carry their state.
      if (!this.isTrusted || this.type !== "popstate") return state;
      return claimTraversal(this) ? null : state;
    },
  });
}

/** Decides once per popstate whether this module answers it; the router then never sees it. */
function claimTraversal(event: Event) {
  const known = claimedTraversals.get(event);
  if (known !== undefined) return known;
  const claimed = decideTraversal();
  claimedTraversals.set(event, claimed);
  return claimed;
}

function decideTraversal() {
  // A traversal this module started (dropping or returning to a sentinel): the router stays on the page.
  if (pendingTraversal) {
    pendingTraversal.finish();
    return true;
  }
  const guard = activeGuard;
  if (consumeLateRemoval(guard)) return true;
  if (!guard) return false;
  if (guard.phase === "asking") {
    // Another back press while the question is open: the answer decides where the page goes.
    guard.traversalHref = window.location.href;
    return true;
  }
  if (guard.phase !== "armed") return false;
  guard.phase = "asking";
  guard.traversalHref = window.location.href;
  void guard.check().then(
    (canLeave) => answerTraversal(guard, canLeave),
    () => answerTraversal(guard, false),
  );
  return true;
}

/** A sentinel removal whose traversal came after its timeout lands on a base of the same page: swallow it once. */
function consumeLateRemoval(guard: ActiveGuard | null) {
  const late = lateRemoval;
  if (!late) return false;
  if (Date.now() > late.until || window.location.href !== late.url) {
    lateRemoval = null;
    return false;
  }
  const state = currentState();
  const reArmed = guard !== null && guard.phase === "armed" && state[baseKey] === guard.token;
  if (state[baseKey] !== late.token && !reArmed) return false;
  lateRemoval = null;
  // A guard armed in the meantime stood on its sentinel; the late step took it off, so it goes back on.
  if (reArmed) window.history.pushState(sentinelState(guard), "", guard.url);
  return true;
}

function answerTraversal(guard: ActiveGuard, canLeave: boolean) {
  if (guard.phase !== "asking") return;
  if (guard.detached) {
    answerDetachedTraversal(guard, canLeave);
    return;
  }
  if (activeGuard !== guard) return;
  const current = currentState();
  if (current[sentinelKey] === guard.token) {
    // Back then forward again while asking: the browser is where it started.
    guard.phase = "armed";
    return;
  }
  if (!canLeave) {
    restoreSentinel(guard, current);
    return;
  }
  guard.phase = "released";
  leaveTo(guard, current);
  // Back on the first history entry does nothing; the guard comes back if the page is still here.
  scheduleRearm(guard);
}

/** Cancel: the router never left the page, so the browser must stand on the page's entry with the sentinel on top. */
function restoreSentinel(guard: ActiveGuard, current: HistoryRecord) {
  if (current[baseKey] === guard.token) {
    // One step back: the sentinel goes on again (the push drops the old one from the forward stack).
    pushSentinelOverBase(guard);
    return;
  }
  // A longer jump (long-press history menu, a second back press) left the browser on another page's entry.
  const delta = distanceToSentinel(guard);
  if (delta === undefined) {
    overwriteWithBase(guard);
    return;
  }
  // The Navigation API knows how far the sentinel is: step forward to it and keep every entry in between. The
  // phase stays "asking" until the step lands, so neither a link nor another back press starts a second question.
  void traverseSilently(delta).then(() => {
    if (guard.phase !== "asking") return;
    if (guard.detached) {
      settleDetachedStay(guard);
      return;
    }
    if (currentState()[sentinelKey] === guard.token && window.location.href === guard.url) {
      guard.phase = "armed";
      return;
    }
    overwriteWithBase(guard);
  });
}

/**
 * Without the Navigation API the distance to the sentinel is unknown. The entry the browser stands on becomes the
 * page's base so the address matches what is rendered; the entry it held and the ones the jump passed over are lost.
 */
function overwriteWithBase(guard: ActiveGuard) {
  pushSentinelOverBase(guard);
}

function distanceToSentinel(guard: ActiveGuard) {
  const index = historyIndex();
  if (index === undefined || guard.sentinelIndex === undefined || index >= guard.sentinelIndex) return undefined;
  return guard.sentinelIndex - index;
}

function historyIndex(): number | undefined {
  const navigation = (window as unknown as { navigation?: { currentEntry?: { index?: unknown } | null } }).navigation;
  const index = navigation?.currentEntry?.index;
  return typeof index === "number" && index >= 0 ? index : undefined;
}

/** Confirm: takes the step the user asked for from wherever the swallowed traversals left the browser. */
function leaveTo(guard: ActiveGuard, current: HistoryRecord) {
  // The page's own beforeunload would ask a second time when the previous entry is another document.
  allowUnloadUntil = Date.now() + unloadAllowanceMs;
  if (current[baseKey] === guard.token) {
    // One step back: the sentinel is already gone, so the entry before the page is one more step.
    window.history.back();
    return;
  }
  // The browser already stands on the entry the user picked (a longer jump or a second back press); hand that
  // traversal to the router now.
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state as unknown }));
}

/** The page stopped guarding while the question was open; the answer still decides where the browser ends. */
function answerDetachedTraversal(guard: ActiveGuard, canLeave: boolean) {
  // The page is gone, or the router moved on by itself after the guard stepped aside: nothing left to settle.
  if (guard.pageGone || window.location.href !== guard.traversalHref) {
    guard.phase = "released";
    return;
  }
  const current = currentState();
  if (canLeave) {
    guard.phase = "released";
    if (current[sentinelKey] !== guard.token) leaveTo(guard, current);
    return;
  }
  const delta = current[baseKey] === guard.token || current[sentinelKey] === guard.token ? undefined : distanceToSentinel(guard);
  if (delta === undefined) {
    settleDetachedStay(guard);
    return;
  }
  void traverseSilently(delta).then(() => settleDetachedStay(guard));
}

/** Stay without a guard: the browser ends on an unmarked entry for the page that is still rendered. */
function settleDetachedStay(guard: ActiveGuard) {
  guard.phase = "released";
  if (guard.pageGone) return;
  const current = currentState();
  const own = current[baseKey] === guard.token || current[sentinelKey] === guard.token;
  window.history.replaceState(own ? withoutGuardKeys(current) : guard.pageState, "", guard.url);
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (Date.now() < allowUnloadUntil) {
    leavingDocument = true;
    event.stopImmediatePropagation();
  }
}

function baseState(guard: ActiveGuard): HistoryRecord {
  return { ...guard.pageState, [baseKey]: guard.token };
}

function sentinelState(guard: ActiveGuard): HistoryRecord {
  return { ...guard.pageState, [sentinelKey]: guard.token };
}

function currentState(): HistoryRecord {
  const state: unknown = window.history.state;
  return isRecord(state) ? state : {};
}

function withoutGuardKeys(state: HistoryRecord) {
  const { [baseKey]: _base, [sentinelKey]: _sentinel, [releasedKey]: _released, ...rest } = state;
  return rest;
}

function isRecord(value: unknown): value is HistoryRecord {
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

// Installed when the module loads, so a page that is the first one in the tab already registers before the router.
if (typeof window !== "undefined") installListeners();
