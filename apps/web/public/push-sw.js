// Push display + click only. No fetch handler or cache. No credentials, endpoint or personal data in storage.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function currentBinding() {
  return new Promise((resolve) => {
    const request = indexedDB.open("o-okul-push-binding", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("binding");
    request.onerror = request.onblocked = () => resolve(undefined);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("binding", "readonly");
      const value = transaction.objectStore("binding").get("current");
      transaction.oncomplete = () => { database.close(); resolve(value.result); };
      transaction.onerror = transaction.onabort = () => { database.close(); resolve(undefined); };
    };
  });
}

function withBindingLock(run) {
  return self.navigator?.locks ? self.navigator.locks.request("o-okul-push-binding", run) : Promise.resolve();
}

function sameOriginPushUrl(value) {
  // URL parsers normalize backslashes and strip some controls before resolving the authority.
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/u.test(value)) return "/";
  try {
    return new URL(value, self.location.origin).origin === self.location.origin ? value : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(withBindingLock(async () => {
    let data;
    try { data = event.data ? event.data.json() : undefined; } catch { return; }
    const binding = await currentBinding();
    // Old jobs, legacy payloads, logout, and storage failure all fail closed.
    if (!binding?.owner || !binding.deviceId || data?.deviceId !== binding.deviceId) return;
    const title = typeof data.title === "string" && data.title ? data.title : "o-okul";
    const url = sameOriginPushUrl(data.url);
    await self.registration.showNotification(title, { data: { url, deviceId: binding.deviceId } });
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(withBindingLock(async () => {
    const binding = await currentBinding();
    if (!binding?.owner || event.notification.data?.deviceId !== binding.deviceId) return;
    await self.clients.openWindow(sameOriginPushUrl(event.notification.data?.url));
  }));
});
