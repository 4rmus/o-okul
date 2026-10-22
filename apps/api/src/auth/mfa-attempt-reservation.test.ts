import { HttpException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthUser, AuthUserStore } from "./auth-user-store.js";
import { AuthService } from "./auth.service.js";
import type { IdentityResolver } from "./identity-resolver.js";
import {
  LoginAttemptLimiter,
  RedisLoginAttemptLimiter,
  SocketRedisCommandClient,
  releaseAttemptScript,
  reserveAttemptScript,
  type LoginAttemptLimiterStore,
  type RedisCommandClient,
  type RedisReply,
} from "./login-attempt-limiter.js";
import { hashReenrollmentCode } from "./mfa-reenrollment-code.js";
import { InMemoryPasswordResetStore } from "./password-reset-store.js";
import { InMemorySessionStore } from "./session-store.js";
import { createTotpCodeForTest, createTotpEnrollmentDraft, encryptAdminMfaSecret } from "./totp-mfa.js";
import { parseRedisUrl } from "../config/env.js";

// Review P2-1: the attempt is reserved before the secret is compared. Count how many parallel requests actually reach
// the comparison; the real implementations still decide.
const reached = vi.hoisted(() => ({ reenrollment: 0, totp: 0 }));
vi.mock("./mfa-reenrollment-code.js", async (original) => {
  const actual = await original<typeof import("./mfa-reenrollment-code.js")>();
  return { ...actual, verifyReenrollmentCode: (...args: Parameters<typeof actual.verifyReenrollmentCode>) => { reached.reenrollment += 1; return actual.verifyReenrollmentCode(...args); } };
});
vi.mock("./totp-mfa.js", async (original) => {
  const actual = await original<typeof import("./totp-mfa.js")>();
  return { ...actual, resolveEncryptedTotpCounter: (...args: Parameters<typeof actual.resolveEncryptedTotpCounter>) => { reached.totp += 1; return actual.resolveEncryptedTotpCounter(...args); } };
});

const parallel = 50;
const budget = 5;
// Set to a throwaway Redis (e.g. redis://127.0.0.1:6390/15) to run the same checks against a real server.
const realRedisUrl = process.env.LOGIN_ATTEMPT_LIMITER_REDIS_TEST_URL;

const limiters: Array<[string, () => LoginAttemptLimiterStore]> = [
  ["in-memory", () => new LoginAttemptLimiter(budget, 60_000)],
  ["Redis (interleaving fake client)", () => new RedisLoginAttemptLimiter(new InterleavingFakeRedis(), budget, 60_000)],
  ...(realRedisUrl ? [["Redis (real server)", () => new RedisLoginAttemptLimiter(new SocketRedisCommandClient(parseRedisUrl(realRedisUrl), 2_000), budget, 60_000)] as [string, () => LoginAttemptLimiterStore]] : []),
];

const previousMode = process.env.ADMIN_MFA_MODE;
afterEach(() => {
  reached.reenrollment = 0;
  reached.totp = 0;
  if (previousMode === undefined) delete process.env.ADMIN_MFA_MODE; else process.env.ADMIN_MFA_MODE = previousMode;
});

describe.each(limiters)("attempt reservation with the %s limiter", (_name, createLimiter) => {
  it(`${parallel} parallel reservations: exactly ${budget} pass, the rest are refused, a success clears the key`, async () => {
    const limiter = createLimiter();
    const key = `reservation-${Math.random().toString(36).slice(2)}`;
    const results = await Promise.allSettled(Array.from({ length: parallel }, () => limiter.reserveAttempt(key)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(budget);
    for (const result of results.filter((item): item is PromiseRejectedResult => item.status === "rejected")) {
      expect(result.reason).toBeInstanceOf(HttpException);
      expect((result.reason as HttpException).getStatus()).toBe(429);
    }
    await limiter.recordSuccess(key);
    await expect(limiter.reserveAttempt(key)).resolves.toBeUndefined();
  });

  it("a released attempt is handed back and never leaves a negative balance", async () => {
    const limiter = createLimiter();
    const key = `release-${Math.random().toString(36).slice(2)}`;
    await limiter.releaseAttempt(key);
    for (let attempt = 0; attempt < budget; attempt += 1) await limiter.reserveAttempt(key);
    await expect(limiter.reserveAttempt(key)).rejects.toThrow("LOGIN_LOCKED");
    // The attempt that reached the budget ended without a verdict: one more attempt is allowed, then locked again.
    await limiter.releaseAttempt(key);
    await expect(limiter.reserveAttempt(key)).resolves.toBeUndefined();
    await expect(limiter.reserveAttempt(key)).rejects.toThrow("LOGIN_LOCKED");
    await limiter.recordSuccess(key);
  });

  it(`${parallel} parallel wrong re-enrollment codes: at most ${budget} reach verifyReenrollmentCode`, async () => {
    process.env.ADMIN_MFA_MODE = "required";
    const owner: AuthUser = {
      id: `owner-reservation-${Math.random().toString(36).slice(2)}`, email: "owner-reservation@example.test", name: "Owner", passwordHash: "unused",
      tenantId: "tenant-a", roles: ["TENANT_OWNER"], membershipVersion: 7,
      totpReenrollmentExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    owner.totpReenrollmentCodeHash = hashReenrollmentCode({ userId: owner.id, tenantId: owner.tenantId, resetVersion: 7 }, "1234-5678");
    const enableTotp = vi.fn();
    const auth = service({ findById: vi.fn(async (id: string) => (id === owner.id ? { ...owner } : undefined)), enableTotp }, createLimiter());
    const draft = createTotpEnrollmentDraft(owner.email!, owner.id, owner.membershipVersion);

    const results = await Promise.allSettled(Array.from({ length: parallel }, () =>
      auth.confirmRequiredTotpEnrollment(draft.setupToken, createTotpCodeForTest(draft.secret), {}, { reenrollmentCode: "8765-4321" })));

    expect(reached.reenrollment).toBeLessThanOrEqual(budget);
    expect(reached.reenrollment).toBeGreaterThan(0);
    const reasons = results.map((result) => (result.status === "rejected" ? (result.reason as HttpException).message : "fulfilled"));
    expect(reasons.filter((reason) => reason === "MFA_REENROLLMENT_CODE_INVALID")).toHaveLength(reached.reenrollment);
    expect(reasons.filter((reason) => reason === "MFA_REENROLLMENT_LOCKED")).toHaveLength(parallel - reached.reenrollment);
    expect(enableTotp).not.toHaveBeenCalled();
    // The budget is spent: even the right code is refused until the lock expires.
    await expect(auth.confirmRequiredTotpEnrollment(draft.setupToken, createTotpCodeForTest(draft.secret), {}, { reenrollmentCode: "1234-5678" }))
      .rejects.toThrow("MFA_REENROLLMENT_LOCKED");
  });

  it(`${parallel} parallel wrong second factors on a shared MFA key: at most ${budget} are checked`, async () => {
    process.env.ADMIN_MFA_MODE = "required";
    const secret = createTotpEnrollmentDraft("admin@example.test", "system-admin-reservation", 3).secret;
    const admin: AuthUser = {
      id: `system-admin-reservation-${Math.random().toString(36).slice(2)}`, email: "admin@example.test", name: "Admin", passwordHash: "unused",
      tenantId: "system", roles: ["SYSTEM_ADMIN"], membershipVersion: 3,
      totpSecretEncrypted: encryptAdminMfaSecret(secret), totpEnabledAt: "2026-09-01T00:00:00.000Z", totpRecoveryCodeHashes: [],
    };
    const disableTotp = vi.fn();
    const auth = service({ findById: vi.fn(async (id: string) => (id === admin.id ? { ...admin } : undefined)), disableTotp }, createLimiter());
    const context = { userId: admin.id, tenantId: null, roles: admin.roles, membershipVersion: 3, sessionId: "session", bypassRls: true };
    const wrong = createTotpCodeForTest(secret) === "000000" ? "111111" : "000000";

    const results = await Promise.allSettled(Array.from({ length: parallel }, () => auth.disableTotp(context, { totpCode: wrong })));

    expect(reached.totp).toBeLessThanOrEqual(budget);
    const reasons = results.map((result) => (result.status === "rejected" ? (result.reason as HttpException).message : "fulfilled"));
    expect(reasons.filter((reason) => reason === "MFA_CODE_INVALID")).toHaveLength(reached.totp);
    expect(reasons.filter((reason) => reason === "MFA_SECOND_FACTOR_LOCKED")).toHaveLength(parallel - reached.totp);
    expect(disableTotp).not.toHaveBeenCalled();
  });
});

function service(users: Partial<AuthUserStore>, limiter: LoginAttemptLimiterStore): AuthService {
  return new AuthService(
    users as AuthUserStore,
    new InMemorySessionStore(),
    new InMemoryPasswordResetStore(),
    { resolve: vi.fn(async () => undefined) } as unknown as IdentityResolver,
    { record: vi.fn(async () => undefined) } as never,
    limiter,
  );
}

/**
 * Executes the limiter's commands like Redis would (EVAL scripts run atomically), but yields to the event loop
 * before every command so concurrent callers interleave between commands, as they do over real sockets.
 */
class InterleavingFakeRedis implements RedisCommandClient {
  private readonly values = new Map<string, number>();
  private readonly locks = new Set<string>();

  async command(parts: string[]): Promise<RedisReply> {
    await new Promise((resolve) => setImmediate(resolve));
    if (parts[0] === "DEL") {
      for (const key of parts.slice(1)) { this.values.delete(key); this.locks.delete(key); }
      return parts.length - 1;
    }
    const [command, script, , failures, lock, max] = parts;
    if (command !== "EVAL" || !failures || !lock || !max) throw new Error(`REDIS_COMMAND_UNSUPPORTED:${command}`);
    if (script === reserveAttemptScript) {
      if (this.locks.has(lock)) return -1;
      const count = (this.values.get(failures) ?? 0) + 1;
      this.values.set(failures, count);
      if (count > Number(max)) return -1;
      if (count === Number(max)) this.locks.add(lock);
      return count;
    }
    if (script === releaseAttemptScript) {
      if (!this.values.has(failures)) return 0;
      const count = this.values.get(failures)! - 1;
      if (count <= 0) { this.values.delete(failures); this.locks.delete(lock); return 0; }
      this.values.set(failures, count);
      if (count < Number(max)) this.locks.delete(lock);
      return count;
    }
    throw new Error("REDIS_SCRIPT_UNKNOWN");
  }
}
