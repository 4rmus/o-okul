import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SessionRecord, SessionStore } from "./session-store.js";

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  roles: string[];
  sessionId: string;
  membershipVersion: number;
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
  constructor(
    private readonly store: SessionStore,
    private readonly accessSecret: string,
  ) {}

  async issue(input: Omit<AccessTokenPayload, "sessionId">): Promise<TokenPair> {
    const refreshToken = createRefreshToken();
    const session = await this.store.create({
      userId: input.sub,
      tenantId: input.tenantId,
      roles: input.roles,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      refreshToken,
      membershipVersion: input.membershipVersion,
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

    const nextRefreshToken = createRefreshToken();
    const updated = await this.store.updateRefreshToken(session.id, nextRefreshToken);

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

    return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AccessTokenPayload;
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

  private signAccessToken(payload: AccessTokenPayload): string {
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encodedPayload}.${sign(encodedPayload, this.accessSecret)}`;
  }
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
