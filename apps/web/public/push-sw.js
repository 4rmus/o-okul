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

self.addEventListener("push", (event) => {
  event.waitUntil(withBindingLock(async () => {
    let data;
    try { data = event.data ? event.data.json() : undefined; } catch { return; }
    const binding = await currentBinding();
    // Old jobs, legacy payloads, logout, and storage failure all fail closed.
    if (!binding?.owner || !binding.deviceId || data?.deviceId !== binding.deviceId) return;
    const title = typeof data.title === "string" && data.title ? data.title : "o-okul";
    const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
    await self.registration.showNotification(title, { data: { url, deviceId: binding.deviceId } });
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(withBindingLock(async () => {
    const binding = await currentBinding();
    if (!binding?.owner || event.notification.data?.deviceId !== binding.deviceId) return;
    const url = event.notification.data?.url;
    await self.clients.openWindow(typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/");
  }));
});
