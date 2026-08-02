import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import { encryptSecretDeliveryPayload } from "@o-okul/db";
import type { ActivePersona, MeProfileResponse, MeSessionRecord, MeSessionRevokeAllResponse, MfaEnrollmentRequiredResponse, MfaStepUpPurpose, MfaStepUpResponse, SelfPurgeResult, TenantSelectionOption, TenantSelectionRequiredResponse } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { licenseTermStoreToken, type LicenseTermStore } from "../license/license-term-store.js";
import { tenantStoreToken, type TenantStore } from "../tenant/tenant-store.js";
import { IdentityResolver } from "./identity-resolver.js";
import {
  createLoginAttemptLimiter,
  loginAttemptKey,
  loginAttemptLimiterToken,
  mfaAttemptKey,
  type LoginAttemptLimiterStore,
} from "./login-attempt-limiter.js";
import {
  type PasswordResetStore,
  passwordResetStoreToken,
} from "./password-reset-store.js";
import { passwordPolicyViolation } from "./password-policy.js";
import { authSessionStoreToken, type SessionStore } from "./session-store.js";
import { missingBoundSubjectRole } from "./subject-binding.js";
import type { SessionClientContext } from "./session-client-context.js";
import { TokenService, type AccessTokenPayload, type TokenPair } from "./token-service.js";
import {
  type AuthUser,
  type AuthUserStore,
  authUserStoreToken,
  hashPasswordAsync,
  passwordHashNeedsRehash,
  verifyPasswordAsync,
} from "./auth-user-store.js";
import {
  createLoginMfaChallenge,
  createAdminMfaStepUpProof,
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
}

export interface PasswordResetRequestInput {
  tenantSlug: string;
  loginName: string;
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
  tenantSlug: string;
  loginName: string;
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
    @Optional() @Inject(licenseTermStoreToken) private readonly licenseTerms?: LicenseTermStore,
  ) {
    this.tokens = new TokenService(this.sessions, getAccessSecret());
    this.loginAttempts = loginAttempts ?? createLoginAttemptLimiter();
  }

  async login(credentials: LoginCredentials, clientIp?: string, clientContext?: SessionClientContext): Promise<TokenPair | LoginMfaChallenge | MfaEnrollmentRequiredResponse | TenantSelectionRequiredResponse>;
  async login(credentials: LoginCredentials, clientIp = "unknown", clientContext: SessionClientContext = {}): Promise<TokenPair | LoginMfaChallenge | MfaEnrollmentRequiredResponse | TenantSelectionRequiredResponse> {
    const resolved = await this.resolveLoginUser(credentials, clientIp);
    const attemptKey = resolved.attemptKey;
    await this.loginAttempts.assertAllowed(attemptKey);

    const passwordMatches = await Promise.all(resolved.users.map(async (user) => ({
      user,
      matches: await verifyPasswordAsync(credentials.password, user.passwordHash),
    })));
    const users = passwordMatches.filter(({ matches }) => matches).map(({ user }) => user);
    if (users.length === 0) {
      await this.loginAttempts.recordFailure(attemptKey);
      throw new UnauthorizedException("LOGIN_FAILED");
    }

    await this.loginAttempts.recordSuccess(attemptKey);
    await Promise.all(users.filter((user) => passwordHashNeedsRehash(user.passwordHash)).map(async (user) => {
      const passwordHash = await hashPasswordAsync(credentials.password);
      await this.users.rehashPassword(user.tenantId, user.id, user.passwordHash, passwordHash);
    }));
    if (users.length > 1) {
      return this.createTenantSelectionChallenge(users);
    }

    const user = users[0];
    if (!user) throw new UnauthorizedException("LOGIN_FAILED");
    return this.issueLoginForUser(user, clientContext);
  }

  async selectTenant(input: TenantSelectionInput, clientContext: SessionClientContext = {}): Promise<TokenPair | LoginMfaChallenge | MfaEnrollmentRequiredResponse> {
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
    if (!tenant || !await this.licenseAllowsLogin(selectedUser.tenantId)) {
      throw new UnauthorizedException("LOGIN_FAILED");
    }
    return this.issueLoginForUser(selectedUser, clientContext);
  }

  private async createTenantSelectionChallenge(users: AuthUser[]): Promise<TenantSelectionRequiredResponse> {
    const options: TenantSelectionOption[] = [];
    for (const user of users) {
      const tenant = await this.tenants?.findById(user.tenantId);
      if (tenant && await this.licenseAllowsLogin(user.tenantId)) {
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

  private async issueLoginForUser(user: AuthUser, clientContext: SessionClientContext): Promise<TokenPair | LoginMfaChallenge | MfaEnrollmentRequiredResponse> {
    if (this.shouldRequireTotpEnrollment(user)) {
      const draft = createTotpEnrollmentDraft(user.email ?? user.id, user.id, user.membershipVersion);
      await this.auditLogs?.record({
        tenantId: user.tenantId === "system" ? undefined : user.tenantId,
        actorUserId: user.id,
        entityType: "Auth",
        entityId: user.id,
        action: "auth.totp_enrollment_required",
        diff: { recoveryCodesIssued: draft.recoveryCodes.length },
      });
      return {
        status: "MFA_ENROLLMENT_REQUIRED",
        secret: draft.secret,
        keyUri: draft.keyUri,
        setupToken: draft.setupToken,
        setupExpiresAt: draft.setupExpiresAt,
        recoveryCodes: draft.recoveryCodes,
      };
    }
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

    return this.issueTokenPairForUser(user, "auth.login", { roles: user.roles, mustChangePassword: Boolean(user.mustChangePassword) }, { clientContext });
  }

  async verifyTotpChallenge(challengeToken: string, input: TotpVerificationInput, clientContext: SessionClientContext = {}): Promise<TokenPair> {
    let payload;
    try {
      payload = verifyAdminMfaToken(challengeToken, "admin-mfa-login");
    } catch {
      throw new UnauthorizedException("MFA_CHALLENGE_INVALID");
    }
    if (!payload.challengeId) {
      throw new UnauthorizedException("MFA_CHALLENGE_INVALID");
    }

    const user = await this.users.findById(payload.userId);
    if (!user || !this.shouldChallengeWithTotp(user)) {
      throw new UnauthorizedException("MFA_CHALLENGE_INVALID");
    }

    const method = await this.verifySecondFactorWithAttemptLimit(user, input, "login", "MFA_CHALLENGE_LOCKED");
    return this.issueTokenPairForUser(user, "auth.login_mfa_verified", {
      roles: user.roles,
      method,
      mustChangePassword: Boolean(user.mustChangePassword),
    }, { clientContext });
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

    const draft = createTotpEnrollmentDraft(user.email ?? user.id, user.id, user.membershipVersion);
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
    const currentUser = await this.requireCurrentUser(context);
    if (payload.membershipVersion !== currentUser.membershipVersion) {
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

  async confirmRequiredTotpEnrollment(setupToken: string, totpCode: string, clientContext: SessionClientContext = {}): Promise<TokenPair> {
    if (resolveAdminMfaMode() !== "required") {
      throw new UnauthorizedException("MFA_SETUP_TOKEN_INVALID");
    }
    let payload;
    try {
      payload = verifyAdminMfaToken(setupToken, "admin-mfa-setup");
    } catch {
      throw new UnauthorizedException("MFA_SETUP_TOKEN_INVALID");
    }
    if (!payload.secret || !payload.recoveryCodeHashes?.length) {
      throw new UnauthorizedException("MFA_SETUP_TOKEN_INVALID");
    }
    const currentUser = await this.users.findById(payload.userId);
    if (
      !currentUser ||
      !isAdminMfaRole(currentUser.roles) ||
      payload.membershipVersion !== currentUser.membershipVersion ||
      currentUser.totpEnabledAt ||
      currentUser.totpSecretEncrypted
    ) {
      throw new UnauthorizedException("MFA_SETUP_TOKEN_INVALID");
    }
    const counter = resolveTotpCounter(payload.secret, totpCode);
    if (!counter) {
      throw new UnauthorizedException("MFA_CODE_INVALID");
    }
    const enabledAt = new Date().toISOString();
    const user = await this.users.enableTotp({
      userId: payload.userId,
      secretEncrypted: encryptAdminMfaSecret(payload.secret),
      enabledAt,
      recoveryCodeHashes: payload.recoveryCodeHashes,
      lastUsedCounter: counter,
    });
    if (!user) throw new UnauthorizedException("MFA_SETUP_TOKEN_INVALID");
    await this.sessions.revokeByUser(user.id);
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.totp_enrollment_completed",
      diff: { recoveryCodesRemaining: user.totpRecoveryCodeHashes?.length ?? 0 },
    });
    return this.issueTokenPairForUser(user, "auth.login_mfa_enrolled", {
      roles: user.roles,
      mustChangePassword: Boolean(user.mustChangePassword),
    }, { clientContext });
  }

  async disableTotp(context: RequestContext, input: TotpVerificationInput): Promise<TotpDisableResult> {
    this.assertAdminMfaManageable(context);
    const currentUser = await this.requireCurrentUser(context);
    await this.verifySecondFactorWithAttemptLimit(currentUser, input, "disable", "MFA_SECOND_FACTOR_LOCKED");
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

  async createMfaStepUp(
    context: RequestContext,
    purpose: MfaStepUpPurpose,
    input: TotpVerificationInput,
  ): Promise<MfaStepUpResponse> {
    this.assertAdminMfaManageable(context);
    const currentUser = await this.requireCurrentUser(context);
    if (!context.sessionId || context.membershipVersion !== currentUser.membershipVersion) {
      throw new UnauthorizedException("MFA_STEP_UP_CONTEXT_INVALID");
    }
    const method = await this.verifySecondFactorWithAttemptLimit(
      currentUser,
      input,
      `step-up:${purpose}`,
      "MFA_SECOND_FACTOR_LOCKED",
    );
    const proof = createAdminMfaStepUpProof({
      userId: context.userId,
      sessionId: context.sessionId,
      membershipVersion: context.membershipVersion,
      purpose,
    });
    await this.auditLogs?.record({
      tenantId: currentUser.tenantId === "system" ? undefined : currentUser.tenantId,
      actorUserId: currentUser.id,
      entityType: "Auth",
      entityId: currentUser.id,
      action: "auth.mfa_step_up_verified",
      diff: { method, purpose },
    });
    return { ...proof, purpose };
  }

  private async issueTokenPairForUser(user: {
    id: string;
    tenantId: string;
    roles: string[];
    membershipVersion: number;
    mustChangePassword?: boolean;
    membership?: AuthUser["membership"];
  }, auditAction: string, auditDiff: Record<string, unknown>, options: {
    activePersona?: ActivePersona;
    replaceSessionId?: string;
    clientContext?: SessionClientContext;
  } = {}): Promise<TokenPair> {
    const persona = resolvePersonaSessionContext(user, options.activePersona);
    if (user.membership && !persona) {
      throw new UnauthorizedException(options.activePersona ? "PERSONA_NOT_AVAILABLE" : "PERSONA_CONTEXT_INVALID");
    }
    const roles = persona?.roles ?? user.roles;
    const subject = await this.identities.resolve({
      userId: user.id,
      tenantId: user.tenantId,
      roles,
    });
    if (missingBoundSubjectRole({ roles, subjectType: subject?.subjectType, subjectId: subject?.subjectId })) {
      throw new UnauthorizedException("SUBJECT_CONTEXT_MISSING");
    }
    const tokenInput = {
      sub: user.id,
      tenantId: user.tenantId,
      membershipId: persona?.membershipId,
      activePersona: persona?.activePersona,
      roles,
      membershipVersion: user.membershipVersion,
      mustChangePassword: Boolean(user.mustChangePassword),
      subjectType: subject?.subjectType,
      subjectId: subject?.subjectId,
      deviceLabel: options.clientContext?.deviceLabel,
      clientIpPrefix: options.clientContext?.clientIpPrefix,
    };
    const tokenPair = options.replaceSessionId
      ? await this.tokens.issueReplacing(options.replaceSessionId, tokenInput)
      : await this.tokens.issue(tokenInput);
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: auditAction,
      diff: { ...auditDiff, roles, activePersona: persona?.activePersona },
    });
    return { ...tokenPair, mustChangePassword: Boolean(user.mustChangePassword) };
  }

  async switchPersona(context: RequestContext, activePersona: ActivePersona, clientContext: SessionClientContext = {}): Promise<TokenPair> {
    if (!context.tenantId || !context.sessionId || !context.activePersona) {
      throw new UnauthorizedException("PERSONA_SWITCH_UNAVAILABLE");
    }
    if (context.activePersona === activePersona) {
      throw new BadRequestException("PERSONA_ALREADY_ACTIVE");
    }
    const user = await this.requireCurrentUser(context);
    const persona = resolvePersonaSessionContext(user, activePersona);
    if (!persona) throw new BadRequestException("PERSONA_NOT_AVAILABLE");

    return this.issueTokenPairForUser(user, "auth.persona_switched", {
      fromPersona: context.activePersona,
      toPersona: activePersona,
      membershipId: persona.membershipId,
    }, {
      activePersona,
      replaceSessionId: context.sessionId,
      clientContext,
    });
  }

  async listCurrentSessions(context: RequestContext): Promise<MeSessionRecord[]> {
    const user = await this.requireCurrentUser(context);
    const tenantId = context.tenantId ?? (user.tenantId === "system" ? "system" : undefined);
    if (!tenantId || user.tenantId !== tenantId) {
      throw new UnauthorizedException("SESSION_INVENTORY_UNAVAILABLE");
    }
    const sessions = await this.sessions.listActiveByUser(user.id, tenantId);
    return sessions.map((session) => ({
      id: session.id,
      ...(session.activePersona ? { activePersona: session.activePersona } : {}),
      deviceLabel: session.deviceLabel ?? "Bilinmeyen cihaz",
      ...(session.clientIpPrefix ? { clientIpPrefix: session.clientIpPrefix } : {}),
      roles: [...session.roles],
      status: "ACTIVE",
      current: session.id === context.sessionId,
      expiresAt: session.expiresAt.toISOString(),
      lastSeenAt: (session.lastSeenAt ?? session.updatedAt).toISOString(),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    }));
  }

  async getCurrentProfile(context: RequestContext): Promise<MeProfileResponse> {
    const user = await this.requireCurrentUser(context);
    return {
      userId: context.userId,
      tenantId: context.tenantId,
      roles: [...context.roles],
      mustChangePassword: context.mustChangePassword,
      subjectType: context.subjectType,
      subjectId: context.subjectId,
      membershipId: context.membershipId,
      activePersona: context.activePersona,
      availablePersonas: user.membership ? availablePersonasForMembership(user.membership) : undefined,
      capabilities: [...(context.capabilities ?? [])],
      membership: user.membership ? { id: user.membership.id, version: user.membership.version } : undefined,
    };
  }

  async revokeCurrentSession(context: RequestContext, sessionId: string): Promise<void> {
    const user = await this.requireCurrentUser(context);
    const tenantId = context.tenantId ?? (user.tenantId === "system" ? "system" : undefined);
    if (!tenantId || user.tenantId !== tenantId) {
      throw new UnauthorizedException("SESSION_INVENTORY_UNAVAILABLE");
    }
    const revoked = await this.sessions.revokeOwned(sessionId, user.id, tenantId);
    if (!revoked) throw new NotFoundException("SESSION_NOT_FOUND");
    await this.auditLogs?.record({
      tenantId,
      actorUserId: user.id,
      entityType: "AuthSession",
      entityId: sessionId,
      action: "auth.session_revoked",
      diff: { current: sessionId === context.sessionId },
    });
  }

  async revokeAllCurrentSessions(context: RequestContext): Promise<MeSessionRevokeAllResponse> {
    const user = await this.requireCurrentUser(context);
    const tenantId = context.tenantId ?? (user.tenantId === "system" ? "system" : undefined);
    if (!tenantId || user.tenantId !== tenantId) {
      throw new UnauthorizedException("SESSION_INVENTORY_UNAVAILABLE");
    }
    const revokedCount = await this.sessions.revokeAllOwned(user.id, tenantId);
    await this.auditLogs?.record({
      tenantId,
      actorUserId: user.id,
      entityType: "AuthSession",
      entityId: user.id,
      action: "auth.sessions_revoked_all",
      diff: { revokedCount },
    });
    return { revokedCount };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    try {
      const tokenPair = await this.tokens.rotate(refreshToken);
      const user = await this.users.findById(tokenPair.session.userId);
      if (!user || !sessionMatchesCurrentMembership(tokenPair.session, user)) {
        await this.sessions.revoke(tokenPair.session.id);
        throw new Error("REFRESH_MEMBERSHIP_CHANGED");
      }
      if (!await this.licenseAllowsLogin(user.tenantId)) {
        await this.sessions.revoke(tokenPair.session.id);
        throw new Error("REFRESH_LICENSE_INACTIVE");
      }
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

  async requestPasswordReset(input: PasswordResetRequestInput): Promise<PasswordResetRequestResult> {
    const tenantSlug = input.tenantSlug.trim().toLowerCase();
    const loginName = input.loginName.trim().toLowerCase();
    const tenant = tenantSlug === "system" ? { id: "system" } : await this.tenants?.findBySlug(tenantSlug);
    const user = tenant && loginName ? await this.users.findByTenantAndLoginName(tenant.id, loginName) : undefined;
    if (!user?.email) return { status: "IGNORED" };
    const resetToken = createResetToken();
    const expiresAt = nextResetExpiry();
    const reset = await this.passwordResets.issue({
      userId: user.id,
      tokenHash: hashResetToken(resetToken),
      expiresAt,
      resendNotBefore: new Date(Date.now() - passwordResetResendDelayMs).toISOString(),
      delivery: {
        tenantId: user.tenantId === "system" ? undefined : user.tenantId,
        purpose: "PASSWORD_RESET",
        payloadEncrypted: encryptSecretDeliveryPayload({
          channel: "EMAIL",
          to: user.email,
          subject: "O-Okul parola sıfırlama",
          body: `Parolanızı 30 dakika içinde yenilemek için bağlantıyı açın: ${createPasswordResetUrl(resetToken)}`,
        }),
        expiresAt,
      },
    });
    if (!reset) return { status: "IGNORED" };
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.password_reset_requested",
      diff: { deliveryChannel: "EMAIL" },
    });
    return { status: "ISSUED" };
  }

  async confirmPasswordReset(token: string, password: string): Promise<PasswordResetConfirmResult> {
    const resetToken = token.trim();
    if (!resetToken) throw new BadRequestException("TOKEN_REQUIRED");
    assertPasswordPolicy(password);

    const reset = await this.passwordResets.findByTokenHash(hashResetToken(resetToken));
    if (!reset) throw new NotFoundException("PASSWORD_RESET_NOT_FOUND");
    if (reset.status !== "PENDING") throw new BadRequestException("PASSWORD_RESET_NOT_PENDING");
    if (Date.parse(reset.expiresAt) <= Date.now()) throw new BadRequestException("PASSWORD_RESET_EXPIRED");

    const resetAt = new Date().toISOString();
    const consumedReset = await this.passwordResets.markUsed(reset.id, resetAt);
    if (!consumedReset) throw new BadRequestException("PASSWORD_RESET_NOT_PENDING");

    const existingUser = await this.users.findById(reset.userId);
    if (!existingUser) throw new NotFoundException("USER_NOT_FOUND");
    const user = await this.users.updatePassword(reset.userId, await hashPasswordAsync(password), {
      mustChangePassword: false,
      passwordChangedAt: resetAt,
    });
    if (!user) throw new NotFoundException("USER_NOT_FOUND");

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
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("ACCESS_SESSION_EXPIRED");
    }
    if (
      session.userId !== payload.sub ||
      session.tenantId !== payload.tenantId ||
      session.membershipId !== payload.membershipId ||
      session.activePersona !== payload.activePersona ||
      session.membershipVersion !== payload.membershipVersion
    ) {
      throw new UnauthorizedException("ACCESS_SESSION_MISMATCH");
    }
    if (missingBoundSubjectRole({ roles: session.roles, subjectType: session.subjectType, subjectId: session.subjectId })) {
      throw new UnauthorizedException("SUBJECT_CONTEXT_MISSING");
    }
    const user = await this.users.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException("ACCESS_USER_NOT_FOUND");
    }
    if (!sessionMatchesCurrentMembership(session, user)) {
      throw new UnauthorizedException("ACCESS_MEMBERSHIP_CHANGED");
    }

    return {
      ...payload,
      roles: [...session.roles],
      campusScope: user.membership?.scopeMode
        ? { scopeMode: user.membership.scopeMode, campusIds: [...(user.membership.campusIds ?? [])] }
        : undefined,
      subjectType: session.subjectType,
      subjectId: session.subjectId,
      membershipVersion: session.membershipVersion,
      mustChangePassword: Boolean(user.mustChangePassword),
    };
  }

  async changeCurrentPassword(context: RequestContext, currentPassword: string, newPassword: string): Promise<{ changedAt: string }> {
    assertPasswordPolicy(newPassword);
    const user = await this.requireCurrentUser(context);
    if (!await verifyPasswordAsync(currentPassword, user.passwordHash)) {
      throw new UnauthorizedException("CURRENT_PASSWORD_INVALID");
    }

    const changedAt = new Date().toISOString();
    const updated = await this.users.updatePassword(user.id, await hashPasswordAsync(newPassword), {
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
    const tenantSlug = credentials.tenantSlug.trim().toLowerCase();
    const loginName = credentials.loginName.trim().toLowerCase();
    if (!tenantSlug) {
      throw new BadRequestException("TENANT_SLUG_REQUIRED");
    }
    if (!loginName) {
      throw new BadRequestException("LOGIN_IDENTIFIER_REQUIRED");
    }

    const tenant = tenantSlug === "system" ? { id: "system" } : await this.tenants.findBySlug(tenantSlug);
    if (!tenant || !await this.licenseAllowsLogin(tenant.id)) {
      return { users: [], attemptKey: loginAttemptKey(`${tenantSlug}:missing`, clientIp) };
    }
    const loginNameKey = createHash("sha256").update(loginName).digest("base64url");
    return {
      users: compactUser(await this.users.findByTenantAndLoginName(tenant.id, loginName)),
      attemptKey: loginAttemptKey(`${tenant.id}:${loginNameKey}`, clientIp),
    };
  }

  private async licenseAllowsLogin(tenantId: string): Promise<boolean> {
    if (tenantId === "system") return true;
    if (!this.licenseTerms) return true;
    const license = await this.licenseTerms.resolveForTenant(tenantId);
    return license?.mirrorParity === true && (license.state === "ACTIVE" || license.state === "READ_ONLY");
  }

  private shouldChallengeWithTotp(user: { roles: string[]; totpSecretEncrypted?: string; totpEnabledAt?: string }): boolean {
    return resolveAdminMfaMode() !== "off" && isAdminMfaRole(user.roles) && Boolean(user.totpSecretEncrypted && user.totpEnabledAt);
  }

  private shouldRequireTotpEnrollment(user: { roles: string[]; totpSecretEncrypted?: string; totpEnabledAt?: string }): boolean {
    return resolveAdminMfaMode() === "required" && isAdminMfaRole(user.roles) && !Boolean(user.totpSecretEncrypted && user.totpEnabledAt);
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

  private async verifySecondFactorWithAttemptLimit(
    user: {
      id: string;
      totpSecretEncrypted?: string;
      totpEnabledAt?: string;
    },
    input: TotpVerificationInput,
    purpose: string,
    lockedCode: string,
  ): Promise<"totp" | "recovery_code"> {
    const attemptKey = mfaAttemptKey(user.id, purpose);
    try {
      await this.loginAttempts.assertAllowed(attemptKey);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        throw new HttpException(lockedCode, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw error;
    }

    try {
      const method = await this.verifySecondFactor(user, input);
      await this.loginAttempts.recordSuccess(attemptKey);
      return method;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.loginAttempts.recordFailure(attemptKey);
      }
      throw error;
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
  expiresAt.setMinutes(expiresAt.getMinutes() + 30);
  return expiresAt.toISOString();
}

export function createPasswordResetUrl(token: string): string {
  const url = new URL("/parola-sifirla", process.env.WEB_URL ?? "http://localhost:3000");
  url.hash = new URLSearchParams({ token }).toString();
  return url.toString();
}

function compactUser(user: AuthUser | undefined): AuthUser[] {
  return user ? [user] : [];
}

function sessionMatchesCurrentMembership(
  session: {
    tenantId: string;
    membershipId?: string;
    activePersona?: ActivePersona;
    membershipVersion: number;
    roles: readonly string[];
    subjectType?: string;
    subjectId?: string;
  },
  user: Pick<AuthUser, "tenantId" | "membershipVersion" | "roles" | "membership">,
): boolean {
  if (session.tenantId !== user.tenantId || session.membershipVersion !== user.membershipVersion) return false;
  if (user.membership) {
    if (!session.activePersona || session.membershipId !== user.membership.id) return false;
    const persona = resolvePersonaSessionContext(user, session.activePersona);
    if (!persona || !sameRoles(session.roles, persona.roles)) return false;
    if (session.activePersona === "STAFF") return !session.subjectType && !session.subjectId;
    return session.subjectType === session.activePersona && Boolean(session.subjectId);
  }
  if (session.membershipId || session.activePersona) return false;
  return sameRoles(session.roles, user.roles);
}

function resolvePersonaSessionContext(
  user: Pick<AuthUser, "roles" | "membership">,
  requestedPersona?: ActivePersona,
): { membershipId: string; activePersona: ActivePersona; roles: string[] } | null {
  const membership = user.membership;
  if (!membership) return null;
  const available = availablePersonasForMembership(membership);
  const activePersona = requestedPersona ?? available[0];
  if (!activePersona || !available.includes(activePersona)) return null;
  const roles = activePersona === "STAFF"
    ? [membership.staffRole!]
    : [activePersona];
  if (roles.length !== 1) return null;
  return { membershipId: membership.id, activePersona, roles };
}

function availablePersonasForMembership(membership: NonNullable<AuthUser["membership"]>): ActivePersona[] {
  return [
    ...(membership.staffRole ? ["STAFF" as const] : []),
    ...(membership.hasTeacherPersona ? ["TEACHER" as const] : []),
    ...(membership.hasStudentPersona ? ["STUDENT" as const] : []),
  ];
}

function sameRoles(left: readonly string[], right: readonly string[]): boolean {
  const leftRoles = [...new Set(left)].sort();
  const rightRoles = [...new Set(right)].sort();
  return leftRoles.length === rightRoles.length && leftRoles.every((role, index) => role === rightRoles[index]);
}

function assertPasswordPolicy(password: string): void {
  const violation = passwordPolicyViolation(password);
  if (violation) throw new BadRequestException(violation);
}

interface TenantSelectionTokenPayload {
  purpose: "tenant-selection";
  expiresAt: number;
  candidates: Array<{ userId: string; tenantId: string }>;
}

const tenantSelectionTtlMs = 5 * 60 * 1000;
const passwordResetResendDelayMs = 5 * 60 * 1000;

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
  return createHmac("sha256", getTenantSelectionSecret())
    .update(payload)
    .digest("base64url");
}

const defaultTestAccessSecret = "test-access-secret";

function getAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (process.env.NODE_ENV === "production" && (!secret || secret === defaultTestAccessSecret)) {
    throw new Error("JWT_ACCESS_SECRET_REQUIRED");
  }
  return secret ?? defaultTestAccessSecret;
}

function getTenantSelectionSecret(): string {
  const secret = process.env.AUTH_SELECTION_SECRET ?? process.env.JWT_ACCESS_SECRET;
  if (process.env.NODE_ENV === "production" && (!secret || secret === defaultTestAccessSecret)) {
    throw new Error("AUTH_SELECTION_SECRET_REQUIRED");
  }
  return secret ?? defaultTestAccessSecret;
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
