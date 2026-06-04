import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdentityResolver } from "./identity-resolver.js";
import { LoginAttemptLimiter, loginAttemptKey } from "./login-attempt-limiter.js";
import {
  type PasswordResetStore,
  passwordResetStoreToken,
} from "./password-reset-store.js";
import { authSessionStoreToken, type SessionStore } from "./session-store.js";
import { TokenService, type AccessTokenPayload, type TokenPair } from "./token-service.js";
import { type AuthUserStore, authUserStoreToken, hashPassword, verifyPassword } from "./auth-user-store.js";

export interface SelfPurgeResult {
  userId: string;
  tenantId?: string;
  purgedAt: string;
}

export interface PasswordResetRequestResult {
  status: "ISSUED" | "IGNORED";
  resetToken?: string;
  expiresAt?: string;
}

export interface PasswordResetConfirmResult {
  resetAt: string;
}

@Injectable()
export class AuthService {
  private readonly tokens: TokenService;
  private readonly loginAttempts = new LoginAttemptLimiter();

  constructor(
    @Inject(authUserStoreToken) private readonly users: AuthUserStore,
    @Inject(authSessionStoreToken) private readonly sessions: SessionStore,
    @Inject(passwordResetStoreToken) private readonly passwordResets: PasswordResetStore,
    private readonly identities: IdentityResolver,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {
    this.tokens = new TokenService(this.sessions, process.env.JWT_ACCESS_SECRET ?? "test-access-secret");
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const attemptKey = loginAttemptKey(email);
    this.loginAttempts.assertAllowed(attemptKey);

    const user = await this.users.findByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      this.loginAttempts.recordFailure(attemptKey);
      throw new UnauthorizedException("LOGIN_FAILED");
    }

    this.loginAttempts.recordSuccess(attemptKey);
    const subject = await this.identities.resolve({
      userId: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
    });
    const tokenPair = await this.tokens.issue({
      sub: user.id,
      tenantId: user.tenantId,
      roles: user.roles,
      membershipVersion: user.membershipVersion,
      subjectType: subject?.subjectType,
      subjectId: subject?.subjectId,
    });
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.login",
      diff: { roles: user.roles },
    });
    return tokenPair;
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    try {
      return await this.tokens.rotate(refreshToken);
    } catch (error) {
      throw new UnauthorizedException(error instanceof Error ? error.message : "REFRESH_FAILED");
    }
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.sessions.findByRefreshToken(refreshToken);
    if (session) {
      await this.tokens.revoke(session.id);
    }
  }

  async requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      throw new BadRequestException("EMAIL_REQUIRED");
    }

    const user = await this.users.findByEmail(normalizedEmail);
    if (!user) {
      return { status: "IGNORED" };
    }

    await this.passwordResets.revokePendingForUser(user.id);
    const resetToken = createResetToken();
    const expiresAt = nextResetExpiry();
    await this.passwordResets.create({
      userId: user.id,
      tokenHash: hashResetToken(resetToken),
      expiresAt,
    });
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.password_reset_requested",
      diff: { email: user.email },
    });
    return { status: "ISSUED", resetToken, expiresAt };
  }

  async confirmPasswordReset(token: string, password: string): Promise<PasswordResetConfirmResult> {
    const resetToken = token.trim();
    if (!resetToken) throw new BadRequestException("TOKEN_REQUIRED");
    if (!password || password.length < 8) throw new BadRequestException("PASSWORD_MIN_8_REQUIRED");

    const reset = await this.passwordResets.findByTokenHash(hashResetToken(resetToken));
    if (!reset) throw new NotFoundException("PASSWORD_RESET_NOT_FOUND");
    if (reset.status !== "PENDING") throw new BadRequestException("PASSWORD_RESET_NOT_PENDING");
    if (Date.parse(reset.expiresAt) <= Date.now()) throw new BadRequestException("PASSWORD_RESET_EXPIRED");

    const user = await this.users.updatePassword(reset.userId, hashPassword(password, `reset-${reset.id}`));
    if (!user) throw new NotFoundException("USER_NOT_FOUND");

    const resetAt = new Date().toISOString();
    await this.passwordResets.markUsed(reset.id, resetAt);
    await this.sessions.revokeByUser(user.id);
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.password_reset_confirmed",
      diff: { userId: user.id },
    });
    return { resetAt };
  }

  async purgeCurrentUserPii(context: RequestContext): Promise<SelfPurgeResult> {
    const user = await this.users.findById(context.userId);
    if (!user) {
      throw new NotFoundException("USER_NOT_FOUND");
    }

    const hadEmail = user.email.length > 0;
    const hadName = user.name.length > 0;
    const purgedAt = new Date().toISOString();
    const purged = await this.users.purgePii(user.id, {
      email: `purged-${user.id}@example.invalid`,
      name: "Anonim Kullanici",
      purgedAt,
    });
    if (!purged) {
      throw new NotFoundException("USER_NOT_FOUND");
    }
    await this.tokens.revokeUser(user.id);

    await this.auditLogs?.record({
      tenantId: context.tenantId ?? undefined,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "kvkk.user_pii_purged",
      diff: {
        fieldsPurged: ["email", "name"],
        before: { emailPresent: hadEmail, namePresent: hadName },
      },
    });

    return {
      userId: user.id,
      tenantId: context.tenantId ?? undefined,
      purgedAt,
    };
  }

  verifyAccessToken(accessToken: string): AccessTokenPayload {
    try {
      return this.tokens.verifyAccessToken(accessToken);
    } catch {
      throw new UnauthorizedException("ACCESS_TOKEN_INVALID");
    }
  }
}

export function createResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function nextResetExpiry(): string {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1);
  return expiresAt.toISOString();
}
