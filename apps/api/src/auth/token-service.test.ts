import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemorySessionStore } from "./session-store.js";
import { TokenService } from "./token-service.js";

describe("TokenService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refresh token rotate eder ve eski token tekrar kullanılamaz", async () => {
    const store = new InMemorySessionStore();
    const service = new TokenService(store, "test-secret");
    const issued = await service.issue({
      sub: "user-1",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    });

    const rotated = await service.rotate(issued.refreshToken);

    expect(rotated.refreshToken).not.toBe(issued.refreshToken);
    expect(service.verifyAccessToken(rotated.accessToken).tenantId).toBe("tenant-a");
    await expect(service.rotate(issued.refreshToken)).rejects.toThrow("REFRESH_TOKEN_REUSE_DETECTED");
    await expect(service.rotate(rotated.refreshToken)).rejects.toThrow("REFRESH_TOKEN_REUSE_DETECTED");
  });

  it("paralel refresh rotasyonunda yalnız bir istek kazanır ve token ailesi kompromize olur", async () => {
    const store = new InMemorySessionStore();
    const service = new TokenService(store, "test-secret");
    const issued = await service.issue({
      sub: "user-1",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    });

    const results = await Promise.allSettled([
      service.rotate(issued.refreshToken),
      service.rotate(issued.refreshToken),
    ]);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<TokenService["rotate"]>>> => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toEqual(expect.objectContaining({ message: "REFRESH_TOKEN_REUSE_DETECTED" }));
    await expect(service.rotate(fulfilled[0]!.value.refreshToken)).rejects.toThrow("REFRESH_TOKEN_REUSE_DETECTED");
  });

  it("logout sonrası refresh token reddedilir", async () => {
    const store = new InMemorySessionStore();
    const service = new TokenService(store, "test-secret");
    const issued = await service.issue({
      sub: "user-1",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    });

    await service.revoke(issued.session.id);

    await expect(service.rotate(issued.refreshToken)).rejects.toThrow("REFRESH_TOKEN_REUSE_DETECTED");
  });

  it("rol veya tenant membership değişince eski session iptal edilir", async () => {
    const store = new InMemorySessionStore();
    const service = new TokenService(store, "test-secret");
    const issued = await service.issue({
      sub: "user-1",
      tenantId: "tenant-a",
      roles: ["TEACHER"],
      membershipVersion: 1,
    });

    await service.revokeMembership("user-1", "tenant-a", 2);

    await expect(service.rotate(issued.refreshToken)).rejects.toThrow("REFRESH_TOKEN_REUSE_DETECTED");
  });

  it("subject bilgisini refresh rotation sonrası korur", async () => {
    const store = new InMemorySessionStore();
    const service = new TokenService(store, "test-secret");
    const issued = await service.issue({
      sub: "student-user-a",
      tenantId: "tenant-a",
      roles: ["STUDENT"],
      membershipVersion: 1,
      subjectType: "STUDENT",
      subjectId: "student-a",
    });

    const rotated = await service.rotate(issued.refreshToken);
    const payload = service.verifyAccessToken(rotated.accessToken);

    expect(payload.subjectType).toBe("STUDENT");
    expect(payload.subjectId).toBe("student-a");
  });

  it("persona switch yeni session üretir, üyelik bağını korur ve eski session'ı kapatır", async () => {
    const store = new InMemorySessionStore();
    const service = new TokenService(store, "test-secret");
    const issued = await service.issue({
      sub: "dual-user-a",
      tenantId: "tenant-a",
      membershipId: "membership-a",
      activePersona: "STAFF",
      roles: ["OPERATIONS_STAFF"],
      membershipVersion: 3,
    });

    const switched = await service.issueReplacing(issued.session.id, {
      sub: "dual-user-a",
      tenantId: "tenant-a",
      membershipId: "membership-a",
      activePersona: "TEACHER",
      roles: ["TEACHER"],
      membershipVersion: 3,
      subjectType: "TEACHER",
      subjectId: "teacher-a",
    });

    expect(switched.session.id).not.toBe(issued.session.id);
    expect(service.verifyAccessToken(switched.accessToken)).toMatchObject({
      membershipId: "membership-a",
      activePersona: "TEACHER",
      roles: ["TEACHER"],
    });
    await expect(store.findById(issued.session.id)).resolves.toMatchObject({ status: "REVOKED" });
  });

  it("cihaz bağlamını session kaydında tutar, access token içine koymaz", async () => {
    const store = new InMemorySessionStore();
    const service = new TokenService(store, "test-secret");
    const issued = await service.issue({
      sub: "user-1",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
      deviceLabel: "Safari · macOS",
      clientIpPrefix: "203.0.113.0/24",
    });

    expect(issued.session).toMatchObject({
      deviceLabel: "Safari · macOS",
      clientIpPrefix: "203.0.113.0/24",
    });
    expect(service.verifyAccessToken(issued.accessToken)).not.toHaveProperty("deviceLabel");
    expect(service.verifyAccessToken(issued.accessToken)).not.toHaveProperty("clientIpPrefix");
  });

  it("süresi geçmiş access token'ı reddeder", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new InMemorySessionStore();
    const service = new TokenService(store, "test-secret", { accessTokenTtlMs: 1_000 });
    const issued = await service.issue({
      sub: "user-1",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    });

    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));

    expect(() => service.verifyAccessToken(issued.accessToken)).toThrow("ACCESS_TOKEN_EXPIRED");
  });

  it("süresi geçmiş refresh session'ı rotate etmez", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new InMemorySessionStore();
    const service = new TokenService(store, "test-secret", { refreshTokenTtlMs: 1_000 });
    const issued = await service.issue({
      sub: "user-1",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      membershipVersion: 1,
    });

    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));

    await expect(service.rotate(issued.refreshToken)).rejects.toThrow("REFRESH_TOKEN_EXPIRED");
  });
});
