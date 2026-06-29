import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import type { SelfPurgeResult, TenantSelectionOption, TenantSelectionRequiredResponse } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { tenantStoreToken, type TenantStore } from "../tenant/tenant-store.js";
import { hashTcIdentity, normalizeTcIdentity } from "../student/tc-identity.js";
import { IdentityResolver } from "./identity-resolver.js";
import {
  createLoginAttemptLimiter,
  loginAttemptKey,
  loginAttemptLimiterToken,
  type LoginAttemptLimiterStore,
} from "./login-attempt-limiter.js";
import {
  type PasswordResetStore,
  passwordResetStoreToken,
} from "./password-reset-store.js";
import { authSessionStoreToken, type SessionStore } from "./session-store.js";
import { TokenService, type AccessTokenPayload, type TokenPair } from "./token-service.js";
import { type AuthUser, type AuthUserStore, authUserStoreToken, hashPassword, verifyPassword } from "./auth-user-store.js";
import {
  createLoginMfaChallenge,
  createTotpEnrollmentDraft,
  encryptAdminMfaSecret,
  hashRecoveryCode,
  isAdminMfaRole,
  type LoginMfaChallenge,
  resolveAdminMfaMode,
  resolveEncryptedTotpCounter,
  resolveTotpCounter,
  verifyAdminMfaToken,
} from "./totp-mfa.js";

export type { SelfPurgeResult };

export interface PasswordResetRequestResult {
  status: "ISSUED" | "IGNORED";
  resetToken?: string;
  expiresAt?: string;
}

export interface PasswordResetConfirmResult {
  resetAt: string;
}

export interface TotpSetupResult {
  secret: string;
  keyUri: string;
  setupToken: string;
  setupExpiresAt: string;
  recoveryCodes: string[];
}

export interface TotpSetupConfirmResult {
  enabledAt: string;
  recoveryCodesRemaining: number;
}

export interface TotpStatusResult {
  mode: "off" | "optional" | "required";
  enabled: boolean;
  enabledAt?: string;
  recoveryCodesRemaining: number;
}

export interface TotpDisableResult {
  disabledAt: string;
}

export interface TotpVerificationInput {
  totpCode?: string;
  recoveryCode?: string;
}

export interface LoginCredentials {
  tenantSlug?: string;
  nationalId: string;
  password: string;
}

export interface TenantSelectionInput {
  selectionToken: string;
  tenantId: string;
}

@Injectable()
export class AuthService {
  private readonly tokens: TokenService;
  private readonly loginAttempts: LoginAttemptLimiterStore;

  constructor(
    @Inject(authUserStoreToken) private readonly users: AuthUserStore,
    @Inject(authSessionStoreToken) private readonly sessions: SessionStore,
    @Inject(passwordResetStoreToken) private readonly passwordResets: PasswordResetStore,
    private readonly identities: IdentityResolver,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() @Inject(loginAttemptLimiterToken) loginAttempts?: LoginAttemptLimiterStore,
    @Optional() @Inject(tenantStoreToken) private readonly tenants?: TenantStore,
  ) {
    this.tokens = new TokenService(this.sessions, process.env.JWT_ACCESS_SECRET ?? "test-access-secret");
    this.loginAttempts = loginAttempts ?? createLoginAttemptLimiter();
  }

  async login(credentials: LoginCredentials, clientIp?: string): Promise<TokenPair | LoginMfaChallenge | TenantSelectionRequiredResponse>;
  async login(credentials: LoginCredentials, clientIp = "unknown"): Promise<TokenPair | LoginMfaChallenge | TenantSelectionRequiredResponse> {
    const resolved = await this.resolveLoginUser(credentials, clientIp);
    const attemptKey = resolved.attemptKey;
    await this.loginAttempts.assertAllowed(attemptKey);

    const users = resolved.users.filter((user) => verifyPassword(credentials.password, user.passwordHash));
    if (users.length === 0) {
      await this.loginAttempts.recordFailure(attemptKey);
      throw new UnauthorizedException("LOGIN_FAILED");
    }

    await this.loginAttempts.recordSuccess(attemptKey);
    if (users.length > 1) {
      return this.createTenantSelectionChallenge(users);
    }

    const user = users[0];
    if (!user) throw new UnauthorizedException("LOGIN_FAILED");
    return this.issueLoginForUser(user);
  }

  async selectTenant(input: TenantSelectionInput): Promise<TokenPair | LoginMfaChallenge> {
    let payload: TenantSelectionTokenPayload;
    try {
      payload = verifyTenantSelectionToken(input.selectionToken);
    } catch {
      throw new UnauthorizedException("LOGIN_FAILED");
    }

    const candidate = payload.candidates.find((item) => item.tenantId === input.tenantId);
    if (!candidate) {
      throw new UnauthorizedException("LOGIN_FAILED");
    }
    const selectedUser = await this.users.findById(candidate.userId);
    if (!selectedUser || selectedUser.tenantId !== input.tenantId) {
      throw new UnauthorizedException("LOGIN_FAILED");
    }
    const tenant = await this.tenants?.findById(selectedUser.tenantId);
    if (!tenant) {
      throw new UnauthorizedException("LOGIN_FAILED");
    }
    return this.issueLoginForUser(selectedUser);
  }

  private async createTenantSelectionChallenge(users: AuthUser[]): Promise<TenantSelectionRequiredResponse> {
    const options: TenantSelectionOption[] = [];
    for (const user of users) {
      const tenant = await this.tenants?.findById(user.tenantId);
      if (tenant) {
        options.push({ tenantId: tenant.id, name: tenant.name, slug: tenant.slug });
      }
    }
    if (options.length < 2) {
      throw new UnauthorizedException("LOGIN_FAILED");
    }

    const { selectionToken, expiresAt } = createTenantSelectionToken(
      users
        .filter((user) => options.some((option) => option.tenantId === user.tenantId))
        .map((user) => ({ userId: user.id, tenantId: user.tenantId })),
    );
    return { status: "TENANT_SELECTION_REQUIRED", selectionToken, expiresAt, tenants: options };
  }

  private async issueLoginForUser(user: AuthUser): Promise<TokenPair | LoginMfaChallenge> {
    if (this.shouldChallengeWithTotp(user)) {
      await this.auditLogs?.record({
        tenantId: user.tenantId === "system" ? undefined : user.tenantId,
        actorUserId: user.id,
        entityType: "Auth",
        entityId: user.id,
        action: "auth.login_mfa_required",
        diff: { roles: user.roles, methods: ["totp", "recovery_code"] },
      });
      return createLoginMfaChallenge(user.id);
    }

    return this.issueTokenPairForUser(user, "auth.login", { roles: user.roles, mustChangePassword: Boolean(user.mustChangePassword) });
  }

  async verifyTotpChallenge(challengeToken: string, input: TotpVerificationInput): Promise<TokenPair> {
    let payload;
    try {
      payload = verifyAdminMfaToken(challengeToken, "admin-mfa-login");
    } catch {
      throw new UnauthorizedException("MFA_CHALLENGE_INVALID");
    }

    const user = await this.users.findById(payload.userId);
    if (!user || !this.shouldChallengeWithTotp(user)) {
      throw new UnauthorizedException("MFA_CHALLENGE_INVALID");
    }

    const method = await this.verifySecondFactor(user, input);
    return this.issueTokenPairForUser(user, "auth.login_mfa_verified", {
      roles: user.roles,
      method,
      mustChangePassword: Boolean(user.mustChangePassword),
    });
  }

  async getTotpStatus(context: RequestContext): Promise<TotpStatusResult> {
    this.assertAdminMfaManageable(context);
    const user = await this.requireCurrentUser(context);
    return {
      mode: resolveAdminMfaMode(),
      enabled: Boolean(user.totpSecretEncrypted && user.totpEnabledAt),
      enabledAt: user.totpEnabledAt,
      recoveryCodesRemaining: user.totpRecoveryCodeHashes?.length ?? 0,
    };
  }

  async createTotpSetup(context: RequestContext): Promise<TotpSetupResult> {
    this.assertAdminMfaManageable(context);
    const user = await this.requireCurrentUser(context);
    if (user.totpSecretEncrypted && user.totpEnabledAt) {
      throw new BadRequestException("MFA_ALREADY_ENABLED");
    }

    const draft = createTotpEnrollmentDraft(user.email ?? user.id, user.id);
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.totp_setup_started",
      diff: { recoveryCodesIssued: draft.recoveryCodes.length },
    });
    return {
      secret: draft.secret,
      keyUri: draft.keyUri,
      setupToken: draft.setupToken,
      setupExpiresAt: draft.setupExpiresAt,
      recoveryCodes: draft.recoveryCodes,
    };
  }

  async confirmTotpSetup(context: RequestContext, setupToken: string, totpCode: string): Promise<TotpSetupConfirmResult> {
    this.assertAdminMfaManageable(context);
    let payload;
    try {
      payload = verifyAdminMfaToken(setupToken, "admin-mfa-setup");
    } catch {
      throw new UnauthorizedException("MFA_SETUP_TOKEN_INVALID");
    }
    if (payload.userId !== context.userId || !payload.secret || !payload.recoveryCodeHashes?.length) {
      throw new UnauthorizedException("MFA_SETUP_TOKEN_INVALID");
    }

    const counter = resolveTotpCounter(payload.secret, totpCode);
    if (!counter) {
      throw new UnauthorizedException("MFA_CODE_INVALID");
    }

    const enabledAt = new Date().toISOString();
    const user = await this.users.enableTotp({
      userId: context.userId,
      secretEncrypted: encryptAdminMfaSecret(payload.secret),
      enabledAt,
      recoveryCodeHashes: payload.recoveryCodeHashes,
      lastUsedCounter: counter,
    });
    if (!user) throw new NotFoundException("USER_NOT_FOUND");
    await this.sessions.revokeByUser(context.userId);
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.totp_enabled",
      diff: { recoveryCodesRemaining: user.totpRecoveryCodeHashes?.length ?? 0 },
    });
    return {
      enabledAt,
      recoveryCodesRemaining: user.totpRecoveryCodeHashes?.length ?? 0,
    };
  }

  async disableTotp(context: RequestContext, input: TotpVerificationInput): Promise<TotpDisableResult> {
    this.assertAdminMfaManageable(context);
    const currentUser = await this.requireCurrentUser(context);
    await this.verifySecondFactor(currentUser, input);
    const user = await this.users.disableTotp(context.userId);
    if (!user) throw new NotFoundException("USER_NOT_FOUND");
    await this.sessions.revokeByUser(context.userId);
    const disabledAt = new Date().toISOString();
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.totp_disabled",
      diff: { disabledAt },
    });
    return { disabledAt };
  }

  private async issueTokenPairForUser(user: {
    id: string;
    tenantId: string;
    roles: string[];
    membershipVersion: number;
    mustChangePassword?: boolean;
  }, auditAction: string, auditDiff: Record<string, unknown>): Promise<TokenPair> {
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
      mustChangePassword: Boolean(user.mustChangePassword),
      subjectType: subject?.subjectType,
      subjectId: subject?.subjectId,
    });
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: auditAction,
      diff: auditDiff,
    });
    return { ...tokenPair, mustChangePassword: Boolean(user.mustChangePassword) };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    try {
      const tokenPair = await this.tokens.rotate(refreshToken);
      const user = await this.users.findById(tokenPair.session.userId);
      return { ...tokenPair, mustChangePassword: Boolean(user?.mustChangePassword) };
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
    if (user.tenantId !== "system") {
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
      diff: { emailProvided: true },
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

    const existingUser = await this.users.findById(reset.userId);
    if (!existingUser) throw new NotFoundException("USER_NOT_FOUND");
    if (existingUser.tenantId !== "system") {
      await this.passwordResets.markUsed(reset.id, new Date().toISOString());
      throw new BadRequestException("TENANT_PASSWORD_RESET_FORBIDDEN");
    }

    const user = await this.users.updatePassword(reset.userId, hashPassword(password, `reset-${reset.id}`), {
      mustChangePassword: false,
      passwordChangedAt: new Date().toISOString(),
    });
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

    const hadEmail = (user.email ?? "").length > 0;
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

  async verifyActiveAccessToken(accessToken: string): Promise<AccessTokenPayload> {
    const payload = this.verifyAccessToken(accessToken);
    const session = await this.sessions.findById(payload.sessionId);

    if (!session || session.status !== "ACTIVE") {
      throw new UnauthorizedException("ACCESS_SESSION_INACTIVE");
    }
    if (
      session.userId !== payload.sub ||
      session.tenantId !== payload.tenantId ||
      session.membershipVersion !== payload.membershipVersion
    ) {
      throw new UnauthorizedException("ACCESS_SESSION_MISMATCH");
    }
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException("ACCESS_USER_NOT_FOUND");
    }

    return {
      ...payload,
      roles: [...session.roles],
      subjectType: session.subjectType,
      subjectId: session.subjectId,
      membershipVersion: session.membershipVersion,
      mustChangePassword: Boolean(user.mustChangePassword),
    };
  }

  async changeCurrentPassword(context: RequestContext, currentPassword: string, newPassword: string): Promise<{ changedAt: string }> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException("PASSWORD_MIN_8_REQUIRED");
    }
    const user = await this.requireCurrentUser(context);
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      throw new UnauthorizedException("CURRENT_PASSWORD_INVALID");
    }

    const changedAt = new Date().toISOString();
    const updated = await this.users.updatePassword(user.id, hashPassword(newPassword, `change-${user.id}-${Date.now()}`), {
      mustChangePassword: false,
      passwordChangedAt: changedAt,
    });
    if (!updated) throw new NotFoundException("USER_NOT_FOUND");
    if (context.sessionId) {
      await this.sessions.revokeByUserExcept(user.id, context.sessionId);
    } else {
      await this.sessions.revokeByUser(user.id);
    }
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.password_changed",
      diff: { mustChangePassword: false },
    });
    return { changedAt };
  }

  private async resolveLoginUser(credentials: LoginCredentials, clientIp: string): Promise<{ users: AuthUser[]; attemptKey: string }> {
    if (!this.tenants) {
      throw new BadRequestException("TENANT_STORE_REQUIRED");
    }
    const tenantSlug = credentials.tenantSlug?.trim().toLowerCase();
    const nationalIdInput = credentials.nationalId.trim();
    if (!nationalIdInput) {
      throw new BadRequestException("LOGIN_IDENTIFIER_REQUIRED");
    }
    const nationalIdHash = hashTcIdentity(normalizeTcIdentity(nationalIdInput, "LOGIN_NATIONAL_ID_INVALID"));
    if (!tenantSlug) {
      return {
        users: [
          ...compactUser(await this.users.findByTenantAndNationalIdHash("system", nationalIdHash)),
          ...(await this.users.findByNationalIdHash(nationalIdHash)),
        ],
        attemptKey: loginAttemptKey(`global:${nationalIdHash}`, clientIp),
      };
    }

    const tenant = tenantSlug === "system" ? { id: "system" } : await this.tenants.findBySlug(tenantSlug);
    if (!tenant) {
      return { users: [], attemptKey: loginAttemptKey(`${tenantSlug}:missing`, clientIp) };
    }
    return {
      users: compactUser(await this.users.findByTenantAndNationalIdHash(tenant.id, nationalIdHash)),
      attemptKey: loginAttemptKey(`${tenant.id}:${nationalIdHash}`, clientIp),
    };
  }

  private shouldChallengeWithTotp(user: { roles: string[]; totpSecretEncrypted?: string; totpEnabledAt?: string }): boolean {
    return resolveAdminMfaMode() !== "off" && isAdminMfaRole(user.roles) && Boolean(user.totpSecretEncrypted && user.totpEnabledAt);
  }

  private assertAdminMfaManageable(context: RequestContext): void {
    if (resolveAdminMfaMode() === "off") {
      throw new BadRequestException("ADMIN_MFA_DISABLED");
    }
    if (!isAdminMfaRole(context.roles)) {
      throw new UnauthorizedException("ADMIN_MFA_ADMIN_ROLE_REQUIRED");
    }
  }

  private async requireCurrentUser(context: RequestContext) {
    const user = await this.users.findById(context.userId);
    if (!user) throw new NotFoundException("USER_NOT_FOUND");
    return user;
  }

  private async verifySecondFactor(user: {
    id: string;
    totpSecretEncrypted?: string;
    totpEnabledAt?: string;
  }, input: TotpVerificationInput): Promise<"totp" | "recovery_code"> {
    if (!user.totpSecretEncrypted || !user.totpEnabledAt) {
      throw new UnauthorizedException("MFA_NOT_ENABLED");
    }

    if (input.totpCode?.trim()) {
      const counter = resolveEncryptedTotpCounter(user.totpSecretEncrypted, input.totpCode);
      if (!counter) {
        throw new UnauthorizedException("MFA_CODE_INVALID");
      }
      const marked = await this.users.markTotpCounterUsed(user.id, counter);
      if (!marked) {
        throw new UnauthorizedException("MFA_CODE_REUSED");
      }
      return "totp";
    }

    if (input.recoveryCode?.trim()) {
      const consumed = await this.users.consumeTotpRecoveryCode(user.id, hashRecoveryCode(input.recoveryCode));
      if (!consumed) {
        throw new UnauthorizedException("MFA_RECOVERY_CODE_INVALID");
      }
      return "recovery_code";
    }

    throw new UnauthorizedException("MFA_CODE_REQUIRED");
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

function compactUser(user: AuthUser | undefined): AuthUser[] {
  return user ? [user] : [];
}

interface TenantSelectionTokenPayload {
  purpose: "tenant-selection";
  expiresAt: number;
  candidates: Array<{ userId: string; tenantId: string }>;
}

const tenantSelectionTtlMs = 5 * 60 * 1000;

function createTenantSelectionToken(candidates: TenantSelectionTokenPayload["candidates"]): { selectionToken: string; expiresAt: string } {
  const expiresAt = Date.now() + tenantSelectionTtlMs;
  const payload: TenantSelectionTokenPayload = { purpose: "tenant-selection", expiresAt, candidates };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    selectionToken: `${encodedPayload}.${signTenantSelectionPayload(encodedPayload)}`,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function verifyTenantSelectionToken(token: string): TenantSelectionTokenPayload {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature || !safeEqual(signature, signTenantSelectionPayload(encodedPayload))) {
    throw new Error("TENANT_SELECTION_TOKEN_INVALID");
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as TenantSelectionTokenPayload;
  if (payload.purpose !== "tenant-selection" || payload.expiresAt <= Date.now() || payload.candidates.length === 0) {
    throw new Error("TENANT_SELECTION_TOKEN_INVALID");
  }
  return payload;
}

function signTenantSelectionPayload(payload: string): string {
  return createHmac("sha256", process.env.AUTH_SELECTION_SECRET ?? process.env.JWT_ACCESS_SECRET ?? "test-access-secret")
    .update(payload)
    .digest("base64url");
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
