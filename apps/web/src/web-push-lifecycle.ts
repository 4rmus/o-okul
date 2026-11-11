/** Only opaque ownership hashes and device IDs are persisted, never credentials or subscription endpoints. */
interface PushBinding { owner: string | null; deviceId?: string }
const databaseName = "o-okul-push-binding";
let pending: Promise<unknown> = Promise.resolve();

export function withPushLifecycleLock<T>(run: () => Promise<T>): Promise<T> {
  const next = pending.catch(() => undefined).then(async () => {
    if (typeof navigator !== "undefined" && navigator.locks) return await navigator.locks.request(databaseName, run);
    return await run();
  });
  pending = next;
  return next;
}

export async function pushOwnerKey(owner: { tenantId: string | null; userId: string }): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([owner.tenantId, owner.userId])));
  return Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function reconcileWebPushOwner(owner: { tenantId: string | null; userId: string } | null): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  return withPushLifecycleLock(async () => {
    const key = owner ? await pushOwnerKey(owner) : null;
    let previous: PushBinding | undefined;
    try { previous = await readPushBinding(); } catch { /* Storage denied: unsubscribe below and leave push off. */ }
    if (key && previous?.owner === key) return;
    // Clear first, including when unsubscribe or the logout API subsequently fails/offline.
    await writePushBinding({ owner: null }).catch(() => undefined);
    const registration = await navigator.serviceWorker.getRegistration?.("/");
    if (registration) {
      for (const notification of await registration.getNotifications()) notification.close();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription && !(await subscription.unsubscribe())) throw new Error("WEB_PUSH_CLEANUP_FAILED");
    }
    // If storage is unavailable, signing in still works once the old subscription is invalidated. Opt-in fails closed.
    await writePushBinding({ owner: key }).catch(() => undefined);
  });
}

export async function bindWebPushRegistration<T extends { id: string }>(owner: string, register: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error("WEB_PUSH_UNSUPPORTED");
  return withPushLifecycleLock(async () => {
    if ((await readPushBinding())?.owner !== owner) throw new Error("AUTH_CONTEXT_CHANGED");
    const record = await register();
    if ((await readPushBinding())?.owner !== owner) throw new Error("AUTH_CONTEXT_CHANGED");
    await writePushBinding({ owner, deviceId: record.id });
    return record;
  });
}

/** A remote device's disable action must not unsubscribe this browser. */
export async function retireWebPushBinding(deviceId: string): Promise<void> {
  return withPushLifecycleLock(async () => {
    const binding = await readPushBinding();
    if (!binding || binding.deviceId !== deviceId) return;
    await writePushBinding({ owner: binding.owner });
    const registration = await navigator.serviceWorker.getRegistration?.("/");
    if (!registration) return;
    for (const notification of await registration.getNotifications()) notification.close();
    const subscription = await registration.pushManager.getSubscription();
    if (subscription && !(await subscription.unsubscribe())) throw new Error("WEB_PUSH_CLEANUP_FAILED");
  });
}

function openPushDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("binding"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("WEB_PUSH_STORAGE_UNAVAILABLE"));
    request.onblocked = () => reject(new Error("WEB_PUSH_STORAGE_UNAVAILABLE"));
  });
}

export async function readPushBinding(): Promise<PushBinding | undefined> {
  const database = await openPushDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("binding", "readonly");
    const request = transaction.objectStore("binding").get("current");
    transaction.oncomplete = () => { database.close(); resolve(request.result as PushBinding | undefined); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(new Error("WEB_PUSH_STORAGE_UNAVAILABLE")); };
  });
}

async function writePushBinding(binding: PushBinding): Promise<void> {
  const database = await openPushDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("binding", "readwrite");
    transaction.objectStore("binding").put(binding, "current");
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = transaction.onabort = () => { database.close(); reject(new Error("WEB_PUSH_STORAGE_UNAVAILABLE")); };
  });
}
