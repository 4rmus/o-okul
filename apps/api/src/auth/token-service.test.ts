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
