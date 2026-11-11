import { describe, expect, it } from "vitest";
import { parseWebPushSubscription } from "@o-okul/shared-types";
import { InMemoryNotificationDeviceTokenStore } from "./notification-device-store.js";
import { NotificationDeviceService } from "./notification-device.service.js";

const token = (endpoint: string, extra = {}) => JSON.stringify({ endpoint, keys: { auth: "auth-key", p256dh: "public-key" }, ...extra });
const input = { tenantId: "tenant-a", userId: "a", provider: "web-push", token: token("https://fcm.googleapis.com/fcm/send/device"), lastSeenAt: "2026-11-11T00:00:00.000Z" };

describe("web push trust boundary", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/device", "https://updates.push.services.mozilla.com/wpush/v2/device",
    "https://web.push.apple.com/device", "https://wns2-db5p.notify.windows.com/w/?token=device",
    "https://webpush.notify.windows.com/w/?token=device",
  ])("accepts supported browser service %s", (endpoint) => {
    expect(parseWebPushSubscription(token(endpoint))?.endpoint).toBe(endpoint);
  });

  it.each([
    "http://fcm.googleapis.com/device", "https://fcm.googleapis.com:444/device", "https://user:pass@fcm.googleapis.com/device",
    "https://fcm.googleapis.com.evil.test/device", "https://evil.fcm.googleapis.com/device", "https://evil.web.push.apple.com/device",
    "https://evil.wns2-db5p.notify.windows.com/device", "https://notify.windows.com/device", "https://fcm.googleapis.com./device",
    "https://127.0.0.1/device", "https://[::1]/device", "https://2130706433/device", "https://169.254.169.254/latest/meta-data",
    "https://localhost/device", "https://%66cm.googleapis.com/device", "https://fcm.googleapis.com\\@evil.test/device",
    "https://fcm.googleapis.com/device#fragment", "https://fcm.googleapis.com/\nsecret", "https://api.push.apple.com/device",
  ])("rejects untrusted or ambiguous endpoint %s", (endpoint) => {
    expect(parseWebPushSubscription(token(endpoint))).toBeUndefined();
  });

  it("canonicalizes irrelevant subscription fields and JSON order", () => {
    expect(parseWebPushSubscription(token("https://FCM.GOOGLEAPIS.COM:443/fcm/send/device", { expirationTime: null, ignored: "value" })))
      .toEqual(parseWebPushSubscription(JSON.stringify({ keys: { p256dh: "public-key", auth: "auth-key" }, endpoint: "https://fcm.googleapis.com/fcm/send/device" })));
    for (const malformed of ["null", "[]", "{}", "not-json", token("https://fcm.googleapis.com/device", { keys: { auth: {}, p256dh: "a" } })]) {
      expect(parseWebPushSubscription(malformed)).toBeUndefined();
    }
  });

  it("rejects unsafe web-push at the service boundary while preserving other providers", async () => {
    const service = new NotificationDeviceService(new InMemoryNotificationDeviceTokenStore());
    const context = { tenantId: "tenant-a", userId: "a" } as Parameters<typeof service.registerCurrentUser>[0];
    await expect(service.registerCurrentUser(context, { provider: "web-push", token: token("https://127.0.0.1/private") })).rejects.toThrow("NOTIFICATION_DEVICE_SUBSCRIPTION_INVALID");
    await expect(service.registerCurrentUser(context, { provider: "fcm", token: "opaque-native-token" })).resolves.toMatchObject({ provider: "fcm", token: "opaque-native-token" });
  });
});

describe("exclusive browser ownership", () => {
  it("transfers one endpoint atomically, rotates queued IDs and canonicalizes keys", async () => {
    const store = new InMemoryNotificationDeviceTokenStore();
    const first = await store.upsert(input);
    const second = await store.upsert({ ...input, userId: "b", token: token("https://FCM.GOOGLEAPIS.COM:443/fcm/send/device", { expirationTime: null }) });
    expect(second.id).not.toBe(first.id);
    expect(await store.listActiveByUsers("tenant-a", ["a"])).toEqual([]);
    expect(await store.listByUser("tenant-a", "b")).toEqual([expect.objectContaining({ id: second.id })]);
    const refreshed = await store.upsert({ ...input, userId: "b" });
    expect(refreshed.id).toBe(second.id);
    await store.disable("tenant-a", "b", refreshed.id, input.lastSeenAt);
    const reenabled = await store.upsert({ ...input, userId: "b" });
    expect(reenabled.id).not.toBe(second.id);
  });

  it("concurrent account registrations leave a single owner and old IDs cannot disable it", async () => {
    const store = new InMemoryNotificationDeviceTokenStore();
    const records = await Promise.all(Array.from({ length: 30 }, (_, i) => store.upsert({ ...input, userId: `user-${i}` })));
    const all = await store.listActiveByUsers("tenant-a", records.map((_, i) => `user-${i}`));
    expect(all).toHaveLength(1);
    expect(await store.disable("tenant-a", "user-0", records[0]!.id, input.lastSeenAt)).toBeUndefined();
  });

  it("keeps opaque tokens scoped to their original provider and account", async () => {
    const store = new InMemoryNotificationDeviceTokenStore();
    await store.upsert({ ...input, provider: "fcm", token: "opaque" });
    await store.upsert({ ...input, userId: "b", provider: "fcm", token: "opaque" });
    expect(await store.listActiveByUsers("tenant-a", ["a", "b"])).toHaveLength(2);
  });
});
