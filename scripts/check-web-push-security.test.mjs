import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const auth = (userId, accessToken = `token-${userId}`) => ({ accessToken, session: { id: `session-${userId}`, tenantId: "tenant", userId, roles: ["GUARDIAN"], membershipVersion: 1, activePersona: "GUARDIAN", status: "ACTIVE" } });

function browser() {
  const state = { binding: undefined, notifications: [], windows: [], unsubscribes: 0, unavailable: false, unsubscribeResult: true };
  let lock = Promise.resolve();
  const locks = { request(_name, run) { const next = lock.catch(() => {}).then(run); lock = next; return next; } };
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      if (state.unavailable) { request.onerror?.(); return; }
      request.result = {
        createObjectStore() {}, close() {}, transaction() {
          const transaction = { objectStore: () => ({
            get() { const result = { result: state.binding }; queueMicrotask(() => transaction.oncomplete?.()); return result; },
            put(value) { state.binding = value; queueMicrotask(() => transaction.oncomplete?.()); },
          }) };
          return transaction;
        },
      };
      request.onsuccess?.();
    });
    return request;
  } };
  const registration = {
    getNotifications: async () => state.notifications,
    pushManager: { getSubscription: async () => ({ unsubscribe: async () => { state.unsubscribes++; return state.unsubscribeResult; } }) },
    showNotification: async (title, options) => { state.notifications.push({ title, ...options, closed: false, close() { this.closed = true; } }); },
  };
  const navigator = { locks, serviceWorker: { getRegistration: async () => registration } };
  const context = vm.createContext({ console, TextEncoder, URL, URLSearchParams, Headers, Request, Response, crypto: webcrypto, navigator, indexedDB, queueMicrotask, process: { env: {} }, document: { cookie: "csrfToken=fixture" } });
  function load(path, imports = {}) {
    const commonjs = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    vm.runInContext(`(function(require, module, exports) { ${commonjs}\n})`, context)(
      (name) => name in imports ? imports[name] : require(name), module, module.exports,
    );
    return module.exports;
  }
  const lifecycle = load("apps/web/src/web-push-lifecycle.ts");
  const api = load("apps/web/src/api-client.ts", { "./web-push-lifecycle.js": lifecycle, "@tanstack/react-query": { QueryClient: class { clear() {} } } });
  const handlers = {};
  context.self = { location: new URL("https://school.example/push-sw.js"), navigator, registration, clients: { claim: async () => {}, openWindow: async (url) => state.windows.push(url) }, skipWaiting: async () => {}, addEventListener: (name, handler) => { handlers[name] = handler; } };
  vm.runInContext(readFileSync("apps/web/public/push-sw.js", "utf8"), context);
  function dispatch(name, data) { let work; handlers[name]({ ...data, waitUntil: (promise) => { work = promise; } }); return work; }
  return { state, lifecycle, api, navigator, registration, dispatch, response(next) { context.fetch = async () => new Response(JSON.stringify({ data: next })); }, failFetch() { context.fetch = async () => { throw new Error("offline"); }; } };
}

test("same-user renewal preserves opt-in and registers with the current token, logout fails offline with push already off", async () => {
  const b = browser(), first = auth("a");
  b.response(first); await b.api.refreshSession();
  assert.equal(b.state.unsubscribes, 1); // Unknown legacy subscription is retired before exposing the session.
  await b.api.registerPushForCurrentSession(first.session, async () => ({ id: "binding-a" }));
  b.response(auth("a", "renewed-token")); await b.api.refreshSession();
  assert.equal(b.state.binding.deviceId, "binding-a");
  assert.equal(b.state.unsubscribes, 1);
  let token;
  await b.api.registerPushForCurrentSession(first.session, async (currentToken) => { token = currentToken; return { id: "binding-a" }; });
  assert.equal(token, "renewed-token");
  b.failFetch();
  await assert.rejects(b.api.logout(), /offline/);
  assert.equal(b.state.binding.owner, null);
  assert.equal(b.state.binding.deviceId, undefined);
  await b.dispatch("push", { data: { json: () => ({ title: "Old account", deviceId: "binding-a" }) } });
  assert.equal(b.state.notifications.length, 0);
});

test("account switch before opt-in retires the prior subscription and blocks stale tabs", async () => {
  const b = browser(), a = auth("a"), next = auth("b");
  b.response(a); await b.api.refreshSession();
  await b.api.registerPushForCurrentSession(a.session, async () => ({ id: "binding-a" }));
  b.response(next); await b.api.refreshSession();
  assert.equal(b.state.unsubscribes, 2);
  assert.equal(b.state.binding.deviceId, undefined);
  let registered = false;
  await assert.rejects(b.api.registerPushForCurrentSession(a.session, async () => { registered = true; return { id: "stale" }; }), /AUTH_CONTEXT_CHANGED/);
  assert.equal(registered, false);
  await b.dispatch("push", { data: { json: () => ({ title: "Account A", deviceId: "binding-a" }) } });
  assert.equal(b.state.notifications.length, 0);
  await b.api.registerPushForCurrentSession(next.session, async () => ({ id: "binding-b" }));
  await b.dispatch("push", { data: { json: () => ({ title: "Account B", deviceId: "binding-b", url: "/veli/duyurular" }) } });
  assert.equal(b.state.notifications.length, 1);
  await b.dispatch("push", { data: { json: () => ({ title: "Legacy message" }) } });
  await b.dispatch("notificationclick", { notification: { data: { deviceId: "binding-a", url: "/veli/odemeler" }, close() {} } });
  assert.equal(b.state.notifications.length, 1);
  assert.equal(b.state.windows.length, 0);
});

test("a separate tab's owner change blocks registration even while this tab retains the old auth", async () => {
  const b = browser(), a = auth("a");
  b.response(a); await b.api.refreshSession();
  await b.api.registerPushForCurrentSession(a.session, async () => ({ id: "binding-a" }));
  await b.lifecycle.reconcileWebPushOwner(auth("b").session);
  let registered = false;
  await assert.rejects(b.api.registerPushForCurrentSession(a.session, async () => { registered = true; return { id: "stale-a" }; }), /AUTH_CONTEXT_CHANGED/);
  assert.equal(registered, false);
  assert.equal(b.state.binding.deviceId, undefined);
});

test("logout serializes with display already in flight, closes it, and suppresses later pushes", async () => {
  const b = browser(), a = auth("a");
  b.response(a); await b.api.refreshSession();
  await b.api.registerPushForCurrentSession(a.session, async () => ({ id: "binding-a" }));
  const started = deferred(), release = deferred(), original = b.registration.showNotification;
  b.registration.showNotification = async (...args) => { started.resolve(); await release.promise; return original(...args); };
  const push = b.dispatch("push", { data: { json: () => ({ title: "Account A", deviceId: "binding-a" }) } });
  await started.promise;
  const logout = b.lifecycle.reconcileWebPushOwner(null);
  release.resolve();
  await Promise.all([push, logout]);
  assert.equal(b.state.notifications.length, 1);
  assert.equal(b.state.notifications[0].closed, true);
  assert.equal(b.state.binding.owner, null);
  await b.dispatch("push", { data: { json: () => ({ title: "Account A late", deviceId: "binding-a" }) } });
  assert.equal(b.state.notifications.length, 1);
});

test("unsubscribe failure leaves binding off and blocks a new owner; server logout still runs", async () => {
  const b = browser(), a = auth("a");
  b.response(a); await b.api.refreshSession();
  await b.api.registerPushForCurrentSession(a.session, async () => ({ id: "binding-a" }));
  b.state.unsubscribeResult = false;
  await assert.rejects(b.lifecycle.reconcileWebPushOwner(auth("b").session), /WEB_PUSH_CLEANUP_FAILED/);
  assert.equal(b.state.binding.owner, null);
  b.response({}); await b.api.logout();
  assert.equal(b.state.binding.owner, null);
});

test("storage or lock support failures never create or display a subscription binding", async () => {
  const b = browser(), a = auth("a");
  b.state.unavailable = true;
  b.response(a); await b.api.refreshSession();
  assert.equal(b.state.unsubscribes, 1);
  await assert.rejects(b.api.registerPushForCurrentSession(a.session, async () => ({ id: "binding-a" })), /WEB_PUSH_STORAGE_UNAVAILABLE/);
  await b.dispatch("push", { data: { json: () => ({ title: "Account A", deviceId: "binding-a" }) } });
  assert.equal(b.state.notifications.length, 0);
  b.state.unavailable = false;
  await b.lifecycle.reconcileWebPushOwner(a.session);
  delete b.navigator.locks;
  await assert.rejects(b.api.registerPushForCurrentSession(a.session, async () => ({ id: "binding-a" })), /WEB_PUSH_UNSUPPORTED/);
  await b.dispatch("push", { data: { json: () => ({ title: "Account A", deviceId: "binding-a" }) } });
  assert.equal(b.state.notifications.length, 0);
});

test("device opt-out retires this binding, preserves other-device actions and permits a fresh opt-in", async () => {
  const b = browser(), a = auth("a");
  b.response(a); await b.api.refreshSession();
  await b.api.registerPushForCurrentSession(a.session, async () => ({ id: "binding-a" }));
  await b.lifecycle.retireWebPushBinding("another-device");
  assert.equal(b.state.binding.deviceId, "binding-a");
  await b.lifecycle.retireWebPushBinding("binding-a");
  assert.equal(b.state.binding.deviceId, undefined);
  assert.ok(b.state.binding.owner);
  await b.dispatch("push", { data: { json: () => ({ title: "Old binding", deviceId: "binding-a" }) } });
  assert.equal(b.state.notifications.length, 0);
  await b.api.registerPushForCurrentSession(a.session, async () => ({ id: "new-binding-a" }));
  assert.equal(b.state.binding.deviceId, "new-binding-a");
});

test("matching-device pushes and clicks reject separator and control-character navigation escapes", async () => {
  const b = browser(), a = auth("a");
  b.response(a); await b.api.refreshSession();
  await b.api.registerPushForCurrentSession(a.session, async () => ({ id: "binding-a" }));
  for (const url of ["/\\outside.example/path", "//outside.example/path", "/\n/outside.example/path", "/\r/outside.example/path", "/\t/outside.example/path", "/\u0000outside.example/path", "/\u001foutside.example/path", "/\u007foutside.example/path", "\n//outside.example/path", "https://outside.example/path", "javascript:alert(1)"]) {
    await b.dispatch("push", { data: { json: () => ({ title: "Notice", deviceId: "binding-a", url }) } });
    assert.equal(b.state.notifications.at(-1).data.url, "/", `push URL ${JSON.stringify(url)}`);
    // Independently validate notification data, including notifications created before this fix.
    await b.dispatch("notificationclick", { notification: { data: { deviceId: "binding-a", url }, close() {} } });
    assert.equal(b.state.windows.at(-1), "/", `click URL ${JSON.stringify(url)}`);
    assert.equal(new URL(b.state.windows.at(-1), "https://school.example").origin, "https://school.example");
  }
});

test("matching-device pushes and clicks retain valid internal paths, queries and fragments", async () => {
  const b = browser(), a = auth("a");
  b.response(a); await b.api.refreshSession();
  await b.api.registerPushForCurrentSession(a.session, async () => ({ id: "binding-a" }));
  for (const url of ["/", "/veli/duyurular", "/veli/duyurular?notice=42&view=unread#details", "/veli/duyurular?next=https%3A%2F%2Foutside.example%2Fpath#notice"]) {
    await b.dispatch("push", { data: { json: () => ({ title: "Notice", deviceId: "binding-a", url }) } });
    assert.equal(b.state.notifications.at(-1).data.url, url);
    await b.dispatch("notificationclick", { notification: b.state.notifications.at(-1) });
    assert.equal(b.state.windows.at(-1), url);
  }
});
