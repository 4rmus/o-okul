"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

type LeaveCheck = () => Promise<boolean>;

/**
 * Browser back/forward cannot be cancelled after the fact, so an armed guard sits on a sentinel history entry: a
 * copy of the page's own entry (same URL, same Next.js router state) pushed on top of its base entry. Back pops the
 * sentinel and leaves the URL as it was; this module keeps that popstate from the Next.js router and asks the page.
 * Cancel puts the sentinel back and the scroll position the user had; confirm takes the step the user asked for.
 *
 * Next.js 16.2.6 patches history.pushState/replaceState and listens to popstate on window without capture
 * (next/dist/client/components/app-router.js). States that carry `__NA` pass the patch untouched, so guard entries
 * copy the page entry's state, `__NA` and router tree included, and Next.js keeps restoring the page from them.
 *
 * Keeping a traversal from the router: listener order on window differs by engine. A probe (Playwright 1.60,
 * 2026-11-03) that registered a non-capture popstate listener before a capture one saw Chromium 148 run them in
 * registration order and WebKit 26.4 run the capture listener first. Next.js registers its listener when the app
 * router mounts, usually before this module loads (login → app is a client navigation), so in Chromium a listener
 * alone runs too late, and React renders the router's traversal synchronously inside the popstate. So the module also
 * gates `PopStateEvent.prototype.state`: for a trusted popstate it claims, the getter returns null, and Next.js's
 * handler returns early on a null state (onPopState). The decision is made once per trusted event by whichever reads
 * first, the router's getter call or this module's capture listener, which then stops the remaining listeners.
 * Synthetic popstates (the hand-over in leaveTo) pass both untouched.
 *
 * Which traversals are claimed while armed: every one except a step onto this guard's own sentinel or onto another
 * entry of the same page that is not its base (a fragment entry, for example from an in-page anchor). Those keep the
 * page, so the router may restore them. URLs are compared without their hash.
 *
 * Invariant: the address bar always shows the page Next.js renders. Every traversal this module swallows leaves
 * the router on the guarded page, so the browser must end on an entry of the guarded page:
 * - Cancel after one step back (the browser stands on the base) pushes the sentinel again.
 * - Cancel after a longer jump (long-press history menu, a second back press while the question is open) leaves
 *   the browser on another page's entry. Where the Navigation API reports history indexes (Chromium, Safari 26) the
 *   guard steps forward to its sentinel and every entry stays. Elsewhere the distance is unknown: that entry is
 *   rewritten into the guarded page's base and the sentinel pushed on top, so the entry it held and the ones the
 *   jump passed over are dropped.
 * - Release pops the sentinel with history.go(-1) while the browser stands on it; a release before a history replace
 *   only marks it. Standing on another entry of the page (a fragment entry above the sentinel), history stays as is.
 *
 * Re-arming follows the outcome of a confirmed step, never a fixed delay on the in-app paths:
 * - Link clicks and the command palette pass their navigation as `navigate`; it runs inside the page's own React
 *   transition, and when that transition settles with the page still mounted on its address the guard comes back.
 *   A navigation that succeeds unmounts the page first.
 * - Logout and persona switch release with `replace: true` (the caller's history replace overwrites the sentinel, so
 *   no forward entry back into the page remains) and call `rearmInAppNavigationGuard` themselves when the page stays.
 * - A confirmed browser back re-arms only if neither a traversal nor an unload followed within
 *   `confirmedBackOutcomeMs` and the address still is the page's (back on the tab's first entry goes nowhere).
 *
 * Entries from an earlier document of this tab (reload, discarded tab, bfcache miss) carry guard keys no live guard
 * owns. The entry the new document starts on is cleaned when this module loads; a confirmed back steps over the
 * entries of the same URL right below the base (Navigation API `entries()`), so it does not land on the page again.
 *
 * Known leftovers: an unguarded programmatic navigation while armed keeps the sentinel (it restores the same page,
 * one extra back), and so does a reload without the Navigation API; a sentinel removal whose popstate arrives after
 * `traversalTimeoutMs` lands on the base unannounced and, if the page re-armed in between, opens the question once; a
 * guard armed on a fragment entry made by a plain in-page anchor copies that entry's null state, so its entries carry
 * no Next.js router state; a traversal onto an older entry of the same URL that is not this guard's base counts as
 * staying on the page, so the router restores it without asking.
 */
const baseKey = "__ookulGuardBase";
const sentinelKey = "__ookulGuardSentinel";
const releasedKey = "__ookulGuardReleased";
const traversalTimeoutMs = 3000;
const unloadAllowanceMs = 1000;
const confirmedBackOutcomeMs = 2000;

type GuardPhase = "arming" | "armed" | "asking" | "released";
type ReleaseMode = "pop" | "replace";
type HistoryRecord = Record<string, unknown>;

interface NavigationEntryLike {
  url: string | null;
}

interface NavigationLike {
  currentEntry?: { index?: unknown } | null;
  entries?: () => NavigationEntryLike[];
}

interface ActiveGuard {
  token: string;
  check: LeaveCheck;
  phase: GuardPhase;
  /** location.href when armed; history writes use it, page comparisons ignore its hash. */
  url: string;
  /** The page entry's own state (router tree included) without guard keys. */
  pageState: HistoryRecord;
  /** The sentinel's position in session history, where the Navigation API reports it. */
  sentinelIndex: number | undefined;
  /** The page stopped guarding (saved elsewhere, unmounted) while a back/forward question was open. */
  detached: boolean;
  /** The page unmounted while a back/forward question was open; its answer no longer moves history. */
  pageGone: boolean;
  /** location.href after the last traversal swallowed while asking. */
  traversalHref: string;
  /** Scroll position when the open back/forward question began; cancel puts it back. */
  scroll: { x: number; y: number };
  /** Runs a confirmed navigation inside the page's transition (see useInAppNavigationGuard). */
  navigate(run: () => void): void;
  /** Bounded wait after a confirmed browser back (see the module comment). */
  outcomeTimer: number | undefined;
}

export interface InAppNavigationOptions {
  /**
   * The caller replaces the current history entry next (logout, persona switch). The guard entry becomes the entry
   * that is replaced instead of being popped, so no forward entry back into the guarded page remains. The caller
   * calls `rearmInAppNavigationGuard` when the page stays after all.
   */
  replace?: boolean;
  /**
   * The navigation to run once confirmed, for example `() => router.push(href)`. It runs inside the guarded page's
   * transition; when that settles with the page still mounted on its address, the guard comes back.
   */
  navigate?: () => void;
}

let activeGuard: ActiveGuard | null = null;
let pendingTraversal: { done: Promise<boolean>; finish(): void } | null = null;
let allowUnloadUntil = 0;
let leavingDocument = false;
let listenersInstalled = false;
const claimedTraversals = new WeakMap<Event, boolean>();
/** Tokens of guards created by this document; guard keys with any other token are stale. */
const ownTokens = new Set<string>();
let tokenSequence = 0;

/**
 * Resolves true when no page holds unsaved work, otherwise asks the page whether in-app navigation may proceed.
 * With `navigate`, a confirmed (or unguarded) navigation is started here.
 */
export async function confirmInAppNavigation(options: InAppNavigationOptions = {}): Promise<boolean> {
  const guard = activeGuard;
  if (!guard) {
    options.navigate?.();
    return true;
  }
  // A back/forward question is already on screen; a second navigation waits for that answer instead.
  if (guard.phase === "asking") return false;
  const canNavigate = await guard.check().catch(() => false);
  if (!canNavigate) return false;
  if (activeGuard !== guard) {
    options.navigate?.();
    return true;
  }
  // The navigation comes next; the sentinel goes first so the new page lands directly above the guarded one.
  await releaseGuard(guard, options.replace ? "replace" : "pop");
  if (options.navigate) guard.navigate(options.navigate);
  return true;
}

/**
 * Re-arms the guard right away after a confirmed in-app navigation that did not take place (a failed persona switch
 * or logout, a persona that keeps the page). It does nothing when no page holds unsaved work, the guard is armed, or
 * the page has moved on.
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
 *
 * A guarded link click is cancelled and, once confirmed, always continues as `router.push(pathname + search + hash)`:
 * next/link's `replace` and `scroll={false}` intents are not carried over.
 */
export function useInAppNavigationGuard(when: boolean, canLeave: LeaveCheck) {
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  const canLeaveRef = useRef(canLeave);
  const mountedRef = useRef(false);
  const guardRef = useRef<ActiveGuard | null>(null);
  const navigationStartedRef = useRef(false);
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
  // A confirmed navigation whose transition settled while this page is still mounted did not leave it (same page
  // again, a redirect back here); rearm checks that the address still is the page's.
  useEffect(() => {
    if (isNavigating || !navigationStartedRef.current) return;
    navigationStartedRef.current = false;
    if (guardRef.current) rearm(guardRef.current);
  }, [isNavigating]);

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
      sentinelIndex: undefined,
      detached: false,
      pageGone: false,
      traversalHref: "",
      scroll: { x: 0, y: 0 },
      navigate: (run) => {
        navigationStartedRef.current = true;
        startNavigation(run);
      },
      outcomeTimer: undefined,
    };
    ownTokens.add(guard.token);
    activeGuard = guard;
    guardRef.current = guard;
    void armGuard(guard);
    // Capture phase runs before next/link's own handler, so the route never changes before the answer.
    const handleClick = (event: MouseEvent) => {
      const href = guardedHref(event);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmInAppNavigation({ navigate: () => router.push(href) });
    };
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.clearTimeout(guard.outcomeTimer);
      if (guardRef.current === guard) guardRef.current = null;
      if (activeGuard !== guard) return;
      activeGuard = null;
      if (guard.phase === "asking") {
        // The open question still gets its answer, so the address ends on the page that is rendered.
        guard.detached = true;
        guard.pageGone = !mountedRef.current;
        return;
      }
      // A released guard (confirmed navigation or replace on its way) has nothing left to pop.
      void releaseGuard(guard, "pop");
    };
  }, [router, when]);
}

async function armGuard(guard: ActiveGuard) {
  // A sentinel still being popped (strict-mode remount, quick save then retype) must leave before a new one comes.
  if (pendingTraversal) await pendingTraversal.done;
  if (activeGuard !== guard || guard.phase !== "arming") return;
  neutraliseStaleEntry();
  const current = currentState();
  guard.url = window.location.href;
  guard.pageState = withoutGuardKeys(current);
  if (current[releasedKey] === guard.token || current[sentinelKey] === guard.token) {
    // Re-arming over this guard's own entry, which was pushed right above its base: it becomes the sentinel again.
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
  guard.phase = "armed";
}

/** Takes the guard's sentinel off while the page stays; resolves once the history entry is gone or converted. */
async function releaseGuard(guard: ActiveGuard, mode: ReleaseMode) {
  const wasArmed = guard.phase === "armed";
  guard.phase = "released";
  // Standing on another entry of the page (a fragment entry above the sentinel) or elsewhere: leave history alone.
  if (!wasArmed || currentState()[sentinelKey] !== guard.token || !isGuardedPage(guard)) return;
  if (mode === "pop") {
    await traverseSilently(-1);
    return;
  }
  // The entry stays and only the guard mark goes, so the address keeps matching the page. The caller's next replace
  // overwrites this very entry; if the page stays, re-arming turns it back into the sentinel.
  window.history.replaceState({ ...withoutGuardKeys(currentState()), [releasedKey]: guard.token }, "", window.location.href);
}

/** history.go(delta) whose popstate never reaches the router; resolves false when it did not arrive in time. */
function traverseSilently(delta: number): Promise<boolean> {
  if (pendingTraversal) return pendingTraversal.done.then(() => false);
  let finish = () => {};
  const done = new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => settle(false), traversalTimeoutMs);
    function settle(arrived: boolean) {
      window.clearTimeout(timer);
      pendingTraversal = null;
      resolve(arrived);
    }
    finish = () => settle(true);
  });
  pendingTraversal = { done, finish };
  window.history.go(delta);
  return done;
}

function rearm(guard: ActiveGuard) {
  window.clearTimeout(guard.outcomeTimer);
  guard.outcomeTimer = undefined;
  if (activeGuard !== guard || guard.phase !== "released" || leavingDocument) return;
  if (!isGuardedPage(guard)) return;
  allowUnloadUntil = 0;
  guard.phase = "arming";
  void armGuard(guard);
}

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  neutraliseStaleEntry();
  installStateGate();
  window.addEventListener("popstate", handlePopState, { capture: true });
  window.addEventListener("beforeunload", handleBeforeUnload, { capture: true });
  // A page restored from the back/forward cache did not leave after all.
  window.addEventListener("pageshow", () => {
    leavingDocument = false;
  });
}

function handlePopState(event: PopStateEvent) {
  if (!event.isTrusted) return;
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

/** Decides once per trusted popstate whether this module answers it; the router then never sees it. */
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
  if (!guard) return false;
  if (guard.phase === "asking") {
    // Another back press while the question is open: the answer decides where the page goes.
    guard.traversalHref = window.location.href;
    return true;
  }
  if (guard.phase === "released") {
    // Something happened after a confirmed step; rearm checks the address again only when the page asks.
    window.clearTimeout(guard.outcomeTimer);
    guard.outcomeTimer = undefined;
    return false;
  }
  if (guard.phase !== "armed") return false;
  const state = currentState();
  // Onto the guard's own sentinel or another entry of the page (a fragment entry): the page stays.
  if (state[baseKey] !== guard.token && (state[sentinelKey] === guard.token || isGuardedPage(guard))) return false;
  guard.phase = "asking";
  guard.traversalHref = window.location.href;
  // The browser restores the destination's scroll position after popstate (probe: Chromium 148, WebKit 26.4), so
  // this is still where the user was.
  guard.scroll = { x: window.scrollX, y: window.scrollY };
  void guard.check().then(
    (canLeave) => answerTraversal(guard, canLeave),
    () => answerTraversal(guard, false),
  );
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
}

/** Cancel: the router never left the page, so the browser must stand on the page's entry with the sentinel on top. */
function restoreSentinel(guard: ActiveGuard, current: HistoryRecord) {
  if (current[baseKey] === guard.token) {
    // One step back: the sentinel goes on again (the push drops the old one from the forward stack).
    pushSentinelOverBase(guard);
    restoreScroll(guard);
    return;
  }
  // A longer jump (long-press history menu, a second back press) left the browser on another page's entry.
  const delta = distanceToSentinel(guard);
  if (delta === undefined) {
    // Without the Navigation API the distance is unknown: this entry becomes the page's base, the entry it held and
    // the ones the jump passed over are lost.
    pushSentinelOverBase(guard);
    restoreScroll(guard);
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
    if (currentState()[sentinelKey] !== guard.token || !isGuardedPage(guard)) {
      pushSentinelOverBase(guard);
    } else {
      guard.phase = "armed";
    }
    restoreScroll(guard);
  });
}

function restoreScroll(guard: ActiveGuard) {
  window.scrollTo(guard.scroll.x, guard.scroll.y);
}

function distanceToSentinel(guard: ActiveGuard) {
  const index = historyIndex();
  if (index === undefined || guard.sentinelIndex === undefined || index >= guard.sentinelIndex) return undefined;
  return guard.sentinelIndex - index;
}

function navigationApi(): NavigationLike | undefined {
  return (window as unknown as { navigation?: NavigationLike }).navigation;
}

function historyIndex(): number | undefined {
  const index = navigationApi()?.currentEntry?.index;
  return typeof index === "number" && index >= 0 ? index : undefined;
}

/**
 * Steps from the base to the entry before the page: one, plus any entries right below it with the same URL. Those are
 * guard entries an earlier document left (a reload while armed); a single step would land on the page again.
 * Chromium 148 reports `sameDocument: true` for them after a reload (probe 2026-11-03), so the URL is the only test.
 */
function stepsBeforePage(guard: ActiveGuard) {
  const index = historyIndex();
  const entries = index === undefined ? undefined : navigationApi()?.entries?.();
  if (index === undefined || !entries) return 1;
  let steps = 1;
  while (index - steps >= 0) {
    const entry = entries[index - steps];
    if (!entry?.url || withoutHash(entry.url) !== withoutHash(guard.url)) break;
    steps += 1;
  }
  return index - steps >= 0 ? steps : 1;
}

/** Confirm: takes the step the user asked for from wherever the swallowed traversals left the browser. */
function leaveTo(guard: ActiveGuard, current: HistoryRecord) {
  // The page's own beforeunload would ask a second time when the previous entry is another document.
  allowUnloadUntil = Date.now() + unloadAllowanceMs;
  if (current[baseKey] === guard.token) {
    // One step back: the sentinel is already gone, so the entry before the page is one more step.
    const steps = stepsBeforePage(guard);
    if (steps === 1) window.history.back();
    else window.history.go(-steps);
    // Back on the tab's first entry does nothing: no traversal, no unload. The guard then comes back.
    guard.outcomeTimer = window.setTimeout(() => rearm(guard), confirmedBackOutcomeMs);
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
  restoreScroll(guard);
}

/** The current entry carries guard keys of an earlier document of this tab: it becomes a plain page entry. */
function neutraliseStaleEntry() {
  const current = currentState();
  const token = current[baseKey] ?? current[sentinelKey] ?? current[releasedKey];
  if (token === undefined || ownTokens.has(String(token))) return;
  window.history.replaceState(withoutGuardKeys(current), "", window.location.href);
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (Date.now() < allowUnloadUntil) {
    leavingDocument = true;
    event.stopImmediatePropagation();
  }
}

function isGuardedPage(guard: ActiveGuard) {
  return withoutHash(window.location.href) === withoutHash(guard.url);
}

function withoutHash(href: string) {
  const hashAt = href.indexOf("#");
  return hashAt === -1 ? href : href.slice(0, hashAt);
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
