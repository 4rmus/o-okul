import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresNotificationDeviceTokenStore } from "./notification-device-store.js";

const appUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_TEST_URL;
const adminUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_ADMIN_URL;
if (process.env.ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("NOTIFICATION_DEVICE_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(/_test$/u.test(url.pathname) || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
}
const run = appUrl && adminUrl ? describe : describe.skip;

run("Postgres browser push ownership with RLS and concurrent registrations", () => {
  const admin = new pg.Pool({ connectionString: adminUrl });
  const app = new pg.Pool({ connectionString: appUrl, max: 8 });
  const store = new PostgresNotificationDeviceTokenStore(app);
  const tenants = [randomUUID(), randomUUID()];
  const userA = randomUUID(), userB = randomUUID(), otherUser = randomUUID();
  const token = JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/fixture", keys: { p256dh: "p256dh", auth: "auth" } });
  const context = (tenantId: string, userId: string) => ({ tenantId, userId, roles: ["GUARDIAN"], bypassRls: false });
  const register = (userId: string, tenantId = tenants[0]!) => runWithRequestContext(context(tenantId, userId), () => store.upsert({ tenantId, userId, provider: "web-push", token, lastSeenAt: new Date().toISOString() }));

  beforeAll(async () => {
    for (const tenantId of tenants) await admin.query(`INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt") VALUES ($1, 'Push fixture', $1, now())`, [tenantId]);
    for (const [userId, tenantId] of [[userA, tenants[0]], [userB, tenants[0]], [otherUser, tenants[1]]]) await admin.query(`INSERT INTO "User" ("id", "tenantId", "name", "passwordHash", "updatedAt") VALUES ($1, $2, 'Push fixture', 'FIXTURE', now())`, [userId, tenantId]);
    // Pre-migration duplicates remain disabled and hashless; the exact canonical token can be re-opted in safely.
    for (const userId of [userA, userB]) await admin.query(`INSERT INTO "NotificationDeviceToken" ("id", "tenantId", "userId", "provider", "token", "lastSeenAt", "disabledAt", "updatedAt") VALUES ($1, $2, $3, 'web-push', $4, now(), now(), now())`, [randomUUID(), tenants[0], userId, token]);
  });
  afterAll(async () => {
    await admin.query(`DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])`, [tenants]);
    await Promise.all([admin.end(), app.end()]);
  });

  it("concurrent legacy claims produce one active binding; active transfers invalidate queued IDs", async () => {
    const claims = await Promise.all(Array.from({ length: 12 }, (_, index) => register(index % 2 ? userA : userB)));
    const rows = await admin.query<{ id: string; userId: string }>(`SELECT "id", "userId" FROM "NotificationDeviceToken" WHERE "tenantId" = $1 AND "disabledAt" IS NULL`, [tenants[0]]);
    expect(rows.rows).toHaveLength(1);
    expect(new Set(claims.map((claim) => claim.id)).size).toBeGreaterThan(1);
    const prior = rows.rows[0]!;
    const nextOwner = prior.userId === userA ? userB : userA;
    const transferred = await register(nextOwner);
    expect(transferred.id).not.toBe(prior.id);
    expect(await register(nextOwner)).toMatchObject({ id: transferred.id });
    expect((await admin.query(`SELECT "id" FROM "NotificationDeviceToken" WHERE "id" = ANY($1::text[]) AND "disabledAt" IS NULL`, [[prior.id]])).rows).toEqual([]);
    const disabled = await runWithRequestContext(context(tenants[0]!, prior.userId), () => store.disable(tenants[0]!, prior.userId, prior.id, new Date().toISOString()));
    expect(disabled).toBeUndefined();
    const other = await register(otherUser, tenants[1]!);
    expect(other.tenantId).toBe(tenants[1]);
    const scoped = await runWithRequestContext(context(tenants[0]!, nextOwner), () => store.listActiveByUsers(tenants[0]!, [nextOwner, otherUser]));
    expect(scoped.map((row) => row.id)).toEqual([transferred.id]);
    await runWithRequestContext(context(tenants[0]!, nextOwner), () => store.disable(tenants[0]!, nextOwner, transferred.id, new Date().toISOString()));
    expect((await register(nextOwner)).id).not.toBe(transferred.id);
  });
});
