import { describe, expect, it } from "vitest";
import type { AuthUser, AuthUserStore } from "../auth/auth-user-store.js";
import type { SessionStore } from "../auth/session-store.js";
import type { RequestContext } from "../context/request-context.js";
import { AccountPiiPurgeService, hasOtherIdentity } from "./account-pii-purge.service.js";

const admin = { userId: "admin", tenantId: "tenant-a", roles: ["TENANT_ADMIN"] } as unknown as RequestContext;

function user(overrides: Partial<AuthUser>): AuthUser {
  return { id: "user-1", tenantId: "tenant-a", email: "veli@example.test", name: "Veli", roles: ["GUARDIAN"], membershipVersion: 1, ...overrides } as AuthUser;
}

function harness(stored: AuthUser | undefined) {
  const purged: string[] = [];
  const revoked: string[] = [];
  const audits: Array<{ action: string; actorUserId?: string; diff?: unknown }> = [];
  const users = {
    findById: async () => stored,
    purgePii: async (id: string) => { purged.push(id); return { ...stored!, membershipVersion: 2 }; },
  } as unknown as AuthUserStore;
  const sessions = { revokeByUser: async (id: string) => { revoked.push(id); } } as unknown as SessionStore;
  const audit = { record: async (entry: { action: string; actorUserId?: string; diff?: unknown }) => { audits.push(entry); } };
  return { service: new AccountPiiPurgeService(users, sessions, audit as never), purged, revoked, audits };
}

describe("AccountPiiPurgeService (DEC-20261016-01)", () => {
  it("tek kimlikli bağlı hesabı anonimleştirir, oturumları kapatır ve audit'e ham veri yazmaz", async () => {
    const { service, purged, revoked, audits } = harness(user({}));
    await expect(service.purgeLinkedAccount(admin, "user-1", "GUARDIAN")).resolves.toBe("PURGED");
    expect(purged).toEqual(["user-1"]);
    expect(revoked).toEqual(["user-1"]);
    expect(audits).toEqual([expect.objectContaining({ action: "kvkk.user_pii_purged", actorUserId: "admin" })]);
    expect(JSON.stringify(audits)).not.toContain("veli@example.test");
  });

  it("başka kimlik taşıyan, başka kurumdaki, zaten silinmiş veya bağsız hesaba dokunmaz", async () => {
    const cases: Array<[AuthUser | undefined, string | undefined, "GUARDIAN" | "TEACHER", string]> = [
      [user({ roles: ["GUARDIAN", "TEACHER"] }), "user-1", "GUARDIAN", "KEPT_OTHER_IDENTITY"],
      [user({ roles: ["TEACHER"], membership: { staffRole: "TENANT_ADMIN" } as never }), "user-1", "TEACHER", "KEPT_OTHER_IDENTITY"],
      [user({ roles: ["GUARDIAN"], membership: { hasTeacherPersona: true } as never }), "user-1", "GUARDIAN", "KEPT_OTHER_IDENTITY"],
      [user({ tenantId: "tenant-b" }), "user-1", "GUARDIAN", "NONE"],
      [user({ purgedAt: "2026-10-01T00:00:00.000Z" }), "user-1", "GUARDIAN", "NONE"],
      [undefined, "user-1", "GUARDIAN", "NONE"],
      [user({}), undefined, "GUARDIAN", "NONE"],
    ];
    for (const [stored, userId, subject, outcome] of cases) {
      const { service, purged, revoked, audits } = harness(stored);
      await expect(service.purgeLinkedAccount(admin, userId, subject)).resolves.toBe(outcome);
      expect({ purged, revoked, audits }).toEqual({ purged: [], revoked: [], audits: [] });
    }
  });

  it("öğretmen tek kimlikliyse silinir, öğrenci veya veli kimliği de taşıyorsa korunur", () => {
    expect(hasOtherIdentity({ roles: ["TEACHER"], membership: { hasTeacherPersona: true } as never }, "TEACHER")).toBe(false);
    expect(hasOtherIdentity({ roles: ["TEACHER", "GUARDIAN"] }, "TEACHER")).toBe(true);
    expect(hasOtherIdentity({ roles: ["TEACHER"], membership: { hasStudentPersona: true } as never }, "TEACHER")).toBe(true);
  });
});
