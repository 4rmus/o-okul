import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionRecord, SessionStore } from "./session-store.js";

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  roles: string[];
  sessionId: string;
  membershipVersion: number;
  iat: number;
  exp: number;
  mustChangePassword?: boolean;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  session: SessionRecord;
  mustChangePassword?: boolean;
}

export class TokenService {
  private readonly accessTokenTtlMs: number;
  private readonly refreshTokenTtlMs: number;

  constructor(
    private readonly store: SessionStore,
    private readonly accessSecret: string,
    options: { accessTokenTtlMs?: number; refreshTokenTtlMs?: number } = {},
  ) {
    this.accessTokenTtlMs = options.accessTokenTtlMs ?? resolveAccessTokenTtlMs();
    this.refreshTokenTtlMs = options.refreshTokenTtlMs ?? resolveRefreshTokenTtlMs();
  }

  async issue(input: Omit<AccessTokenPayload, "sessionId" | "iat" | "exp">): Promise<TokenPair> {
    const refreshToken = createRefreshToken();
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlMs);
    const session = await this.store.create({
      userId: input.sub,
      tenantId: input.tenantId,
      roles: input.roles,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      refreshToken,
      membershipVersion: input.membershipVersion,
      expiresAt,
    });

    return {
      accessToken: this.signAccessToken({ ...input, sessionId: session.id }),
      refreshToken,
      session,
    };
  }

  async rotate(refreshToken: string): Promise<TokenPair> {
    const session = await this.store.findByRefreshToken(refreshToken);
    if (!session) {
      const consumedFamily = await this.store.findConsumedTokenFamily(refreshToken);
      if (consumedFamily) {
        await this.store.markFamilyCompromised(consumedFamily);
        throw new Error("REFRESH_TOKEN_REUSE_DETECTED");
      }
      throw new Error("REFRESH_TOKEN_INVALID");
    }

    if (session.status !== "ACTIVE") {
      await this.store.markFamilyCompromised(session.tokenFamilyId);
      throw new Error("REFRESH_TOKEN_REUSE_DETECTED");
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new Error("REFRESH_TOKEN_EXPIRED");
    }

    const nextRefreshToken = createRefreshToken();
    const updated = await this.store.updateRefreshToken(session.id, nextRefreshToken, new Date(Date.now() + this.refreshTokenTtlMs));

    return {
      accessToken: this.signAccessToken({
        sub: updated.userId,
        tenantId: updated.tenantId,
        roles: updated.roles,
        sessionId: updated.id,
        membershipVersion: updated.membershipVersion,
        subjectType: updated.subjectType,
        subjectId: updated.subjectId,
      }),
      refreshToken: nextRefreshToken,
      session: updated,
    };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const [encodedPayload, signature] = token.split(".");
    if (!encodedPayload || !signature) {
      throw new Error("ACCESS_TOKEN_INVALID");
    }

    const expected = sign(encodedPayload, this.accessSecret);
    if (!safeEqual(signature, expected)) {
      throw new Error("ACCESS_TOKEN_INVALID");
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AccessTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
      throw new Error("ACCESS_TOKEN_EXPIRED");
    }
    return payload;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.store.revoke(sessionId);
  }

  async revokeMembership(userId: string, tenantId: string, membershipVersion: number): Promise<void> {
    await this.store.revokeByMembership(userId, tenantId, membershipVersion);
  }

  async revokeUser(userId: string): Promise<void> {
    await this.store.revokeByUser(userId);
  }

  private signAccessToken(payload: Omit<AccessTokenPayload, "iat" | "exp">): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const encodedPayload = Buffer.from(JSON.stringify({
      ...payload,
      iat: nowSeconds,
      exp: nowSeconds + Math.ceil(this.accessTokenTtlMs / 1000),
    })).toString("base64url");
    return `${encodedPayload}.${sign(encodedPayload, this.accessSecret)}`;
  }
}

export function resolveRefreshTokenTtlMs(): number {
  return parseDurationMs(process.env.REFRESH_TOKEN_TTL, 30 * 24 * 60 * 60 * 1000);
}

function resolveAccessTokenTtlMs(): number {
  return parseDurationMs(process.env.ACCESS_TOKEN_TTL, 15 * 60 * 1000);
}

function parseDurationMs(value: string | undefined, fallbackMs: number): number {
  const raw = value?.trim();
  if (!raw) return fallbackMs;
  const match = raw.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!match) throw new Error("AUTH_TOKEN_TTL_INVALID");
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  const ttlMs = amount * multiplier;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("AUTH_TOKEN_TTL_INVALID");
  return ttlMs;
}

function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
