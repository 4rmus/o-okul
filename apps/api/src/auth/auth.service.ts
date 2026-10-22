import { runVerifiedTenantMutation } from "../context/tenant-mutation-activity.js";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import { encryptSecretDeliveryPayload } from "@o-okul/db";
import type { ActivePersona, MeProfileResponse, MeSessionRecord, MeSessionRevokeAllResponse, MfaEnrollmentRequiredResponse, MfaStepUpPurpose, MfaStepUpResponse, TenantLifecycleMfaTarget, TenantCleanResetMfaTarget, TenantDeviceRestoreMfaTarget, TenantPurgeExportMfaTarget, TenantAdminMfaResetTarget, TenantLoginContextResponse, TenantSelectionOption, TenantSelectionRequiredResponse } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { licenseTermStoreToken, type LicenseTermStore } from "../license/license-term-store.js";
import { tenantStoreToken, type TenantStore } from "../tenant/tenant-store.js";
import { tenantWebUrl } from "../http/tenant-origin.js";
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
  type AdminMfaStepUpBinding,
  type LoginMfaChallenge,
  resolveAdminMfaMode,
  resolveEncryptedTotpCounter,
  resolveTotpCounter,
  verifyAdminMfaResetStepUpProof,
  verifyAdminMfaToken,
} from "./totp-mfa.js";
import { isSystemAdmin } from "../rbac/roles.js";
import { apiLogger } from "../observability/logging.js";
import { recordSecuritySideEffectFailure } from "../observability/security-side-effect-counters.js";
import {
  createReenrollmentCode,
  hashReenrollmentCode,
  isReenrollmentExpired,
  reenrollmentCodeValidityMs,
  reenrollmentResetVersion,
  verifyReenrollmentCode,
} from "./mfa-reenrollment-code.js";
import { type MfaSecurityNoticeKind, type MfaSecurityNoticeStore, mfaSecurityNoticeStoreToken } from "./mfa-security-notice.js";


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

export interface TotpAdminResetResult {
  resetAt: string;
  reenrollmentCode: string;
  reenrollmentExpiresAt: string;
  notificationQueued: boolean;
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
    @Optional() @Inject(mfaSecurityNoticeStoreToken) private readonly mfaNotices?: MfaSecurityNoticeStore,
  ) {
    this.tokens = new TokenService(this.sessions, getAccessSecret());
    this.loginAttempts = loginAttempts ?? createLoginAttemptLimiter();
  }

  async login(credentials: LoginCredentials, clientIp?: string, clientContext?: SessionClientContext): Promise<TokenPair | LoginMfaChallenge | MfaEnrollmentRequiredResponse | TenantSelectionRequiredResponse>;
  async login(credentials: LoginCredentials, clientIp = "unknown", clientContext: SessionClientContext = {}): Promise<TokenPair | LoginMfaChallenge | MfaEnrollmentRequiredResponse | TenantSelectionRequiredResponse> {
    const resolved = await this.resolveLoginUser(credentials, clientIp);
    const attemptKey = resolved.attemptKey;
    // The attempt is counted before the password is checked, so parallel guesses cannot outrun the budget.
    await this.reserveAttempt(attemptKey, "LOGIN_LOCKED");

    let users: AuthUser[];
    try {
      const passwordMatches = await Promise.all(resolved.users.map(async (user) => ({
        user,
        matches: await verifyPasswordAsync(credentials.password, user.passwordHash),
      })));
      users = passwordMatches.filter(({ matches }) => matches).map(({ user }) => user);
    } catch (error) {
      await this.releaseAttempt(attemptKey);
      throw error;
    }
    if (users.length === 0) {
      // The reserved attempt stays counted as the failure.
      throw new UnauthorizedException("LOGIN_FAILED");
    }

    await this.loginAttempts.recordSuccess(attemptKey);
    await Promise.all(users.filter((user) => passwordHashNeedsRehash(user.passwordHash)).map(async (user) => {
      const passwordHash = await hashPasswordAsync(credentials.password);
      await this.users.rehashPassword(user.tenantId, user.id, user.passwordHash, passwordHash, user.membershipVersion);
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
    if (!selectedUser || selectedUser.tenantId !== input.tenantId || selectedUser.membershipVersion !== candidate.membershipVersion) {
      throw new UnauthorizedException("LOGIN_FAILED");
    }
    const tenant = await this.tenants?.findById(selectedUser.tenantId);
    if (!tenant || tenant.lifecycleVersion !== candidate.lifecycleVersion || !await this.licenseAllowsLogin(selectedUser.tenantId)) {
      throw new UnauthorizedException("LOGIN_FAILED");
    }
    return this.issueLoginForUser(selectedUser, clientContext);
  }

  private async createTenantSelectionChallenge(users: AuthUser[]): Promise<TenantSelectionRequiredResponse> {
    const options: TenantSelectionOption[] = [];
    const candidates: TenantSelectionTokenPayload["candidates"] = [];
    for (const user of users) {
      const tenant = await this.tenants?.findById(user.tenantId);
      if (tenant && await this.licenseAllowsLogin(user.tenantId)) {
        options.push({ tenantId: tenant.id, name: tenant.name, slug: tenant.slug });
        candidates.push({ userId: user.id, tenantId: user.tenantId, membershipVersion: user.membershipVersion, lifecycleVersion: tenant.lifecycleVersion });
      }
    }
    if (options.length < 2) {
      throw new UnauthorizedException("LOGIN_FAILED");
    }

    const { selectionToken, expiresAt } = createTenantSelectionToken(
      candidates,
    );
    return { status: "TENANT_SELECTION_REQUIRED", selectionToken, expiresAt, tenants: options };
  }

  private async issueLoginForUser(user: AuthUser, clientContext: SessionClientContext): Promise<TokenPair | LoginMfaChallenge | MfaEnrollmentRequiredResponse> {
    if (this.shouldRequireTotpEnrollment(user)) {
      // DEC-20261021-01: after a SYSTEM_ADMIN reset the password alone no longer opens enrollment material once the
      // 24-hour window is over, and inside it the confirm step also asks for the one-time code.
      const reenrollmentPending = Boolean(user.totpReenrollmentCodeHash);
      if (reenrollmentPending && isReenrollmentExpired(user.totpReenrollmentExpiresAt)) {
        await this.recordReenrollmentExpired(user, "login");
        throw new UnauthorizedException("MFA_RESET_EXPIRED");
      }
      const draft = createTotpEnrollmentDraft(user.email ?? user.id, user.id, user.membershipVersion);
      await this.auditLogs?.record({
        tenantId: user.tenantId === "system" ? undefined : user.tenantId,
        actorUserId: user.id,
        entityType: "Auth",
        entityId: user.id,
        action: "auth.totp_enrollment_required",
        diff: { recoveryCodesIssued: draft.recoveryCodes.length, ...(reenrollmentPending ? { reenrollmentCodeRequired: true } : {}) },
      });
      return {
        status: "MFA_ENROLLMENT_REQUIRED",
        secret: draft.secret,
        keyUri: draft.keyUri,
        setupToken: draft.setupToken,
        setupExpiresAt: draft.setupExpiresAt,
        recoveryCodes: draft.recoveryCodes,
        ...(reenrollmentPending ? { reenrollmentCodeRequired: true as const } : {}),
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
      return createLoginMfaChallenge(user.id, user.membershipVersion);
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
    if (!payload.challengeId || !Number.isInteger(payload.membershipVersion) || payload.membershipVersion! < 1) {
      throw new UnauthorizedException("MFA_CHALLENGE_INVALID");
    }

    const user = await this.users.findById(payload.userId);
    if (!user || payload.membershipVersion !== user.membershipVersion || !this.shouldChallengeWithTotp(user)) {
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
    const user = await this.requireOriginalUser(context);
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
    const currentUser = await this.requireOriginalUser(context);
    if (payload.membershipVersion !== currentUser.membershipVersion) {
      throw new UnauthorizedException("MFA_SETUP_TOKEN_INVALID");
    }
    // A pending SYSTEM_ADMIN re-enrollment is completed only through the login enrollment step with its code.
    if (currentUser.totpReenrollmentCodeHash) {
      throw new UnauthorizedException("MFA_REENROLLMENT_CODE_REQUIRED");
    }

    const counter = resolveTotpCounter(payload.secret, totpCode);
    if (!counter) {
      throw new UnauthorizedException("MFA_CODE_INVALID");
    }

    const enabledAt = new Date().toISOString();
    const user = await this.users.enableTotp({
      userId: context.userId,
      source: { tenantId: currentUser.tenantId, membershipVersion: currentUser.membershipVersion },
      secretEncrypted: encryptAdminMfaSecret(payload.secret),
      enabledAt,
      recoveryCodeHashes: payload.recoveryCodeHashes,
      lastUsedCounter: counter,
    });
    if (!user) throw new NotFoundException("USER_NOT_FOUND");
    await this.sessions.revokeByUser(context.userId, { tenantId: currentUser.tenantId, membershipVersion: currentUser.membershipVersion });
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

  async confirmRequiredTotpEnrollment(setupToken: string, totpCode: string, clientContext: SessionClientContext = {}, options: { reenrollmentCode?: string } = {}): Promise<TokenPair> {
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
    const reenrollmentCodeHash = currentUser.totpReenrollmentCodeHash
      ? await this.verifyReenrollmentCodeWithAttemptLimit(currentUser, currentUser.totpReenrollmentCodeHash, options.reenrollmentCode)
      : null;
    const counter = resolveTotpCounter(payload.secret, totpCode);
    if (!counter) {
      throw new UnauthorizedException("MFA_CODE_INVALID");
    }
    const enabledAt = new Date().toISOString();
    // "First wins": the statement also requires the exact pending re-enrollment hash verified above and clears it.
    const user = await this.users.enableTotp({
      userId: payload.userId,
      source: { tenantId: currentUser.tenantId, membershipVersion: currentUser.membershipVersion },
      secretEncrypted: encryptAdminMfaSecret(payload.secret),
      enabledAt,
      recoveryCodeHashes: payload.recoveryCodeHashes,
      lastUsedCounter: counter,
      reenrollmentCodeHash,
    });
    if (!user) throw new UnauthorizedException("MFA_SETUP_TOKEN_INVALID");
    await this.sessions.revokeByUser(user.id, { tenantId: currentUser.tenantId, membershipVersion: currentUser.membershipVersion });
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.totp_enrollment_completed",
      diff: { recoveryCodesRemaining: user.totpRecoveryCodeHashes?.length ?? 0, ...(reenrollmentCodeHash ? { reenrollmentCodeUsed: true } : {}) },
    });
    if (reenrollmentCodeHash) await this.queueMfaNotice("MFA_REENROLLED", user);
    return this.issueTokenPairForUser(user, "auth.login_mfa_enrolled", {
      roles: user.roles,
      mustChangePassword: Boolean(user.mustChangePassword),
    }, { clientContext });
  }

  async disableTotp(context: RequestContext, input: TotpVerificationInput): Promise<TotpDisableResult> {
    this.assertAdminMfaManageable(context);
    const currentUser = await this.requireOriginalUser(context);
    await this.verifySecondFactorWithAttemptLimit(currentUser, input, "disable", "MFA_SECOND_FACTOR_LOCKED");
    const user = await this.users.disableTotp(context.userId, { tenantId: currentUser.tenantId, membershipVersion: currentUser.membershipVersion });
    if (!user) throw new NotFoundException("USER_NOT_FOUND");
    await this.sessions.revokeByUser(context.userId, { tenantId: currentUser.tenantId, membershipVersion: currentUser.membershipVersion });
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

  async resetTotpBySystemAdmin(context: RequestContext, target: { tenantId: string; userId: string }, stepUpToken?: string): Promise<TotpAdminResetResult> {
    this.assertSystemStepUpContext(context);
    if (!stepUpToken || !context.sessionId || context.membershipVersion === undefined) {
      throw new UnauthorizedException("MFA_STEP_UP_REQUIRED");
    }
    let expectedMembershipVersion: number;
    try {
      expectedMembershipVersion = verifyAdminMfaResetStepUpProof(stepUpToken, {
        userId: context.userId, sessionId: context.sessionId, membershipVersion: context.membershipVersion,
        target: { tenantId: target.tenantId, userId: target.userId },
      });
    } catch {
      throw new UnauthorizedException("MFA_STEP_UP_INVALID");
    }
    // In optional mode MFA is not required at login and the login enrollment step (the only place the code is
    // accepted) is closed, so a pending code could never be used and would block self-service setup (dev only).
    if (resolveAdminMfaMode() === "optional") throw new ConflictException("MFA_RESET_REQUIRES_REQUIRED_MODE");
    const user = await this.users.findById(target.userId);
    // ponytail: control-plane reset is limited to tenant OWNER/ADMIN; SYSTEM_ADMIN recovery stays out of band.
    if (!user || target.tenantId === "system" || user.tenantId !== target.tenantId || isSystemAdmin(user.roles) || !isAdminMfaRole(user.roles)) {
      throw new NotFoundException("MFA_RESET_TARGET_NOT_FOUND");
    }
    // The proof was issued for this account version. Any reset (including one made with this same proof) bumps it,
    // so a replayed proof cannot silently replace the code the system admin just read out; "Yeni kod üret" asks for
    // a fresh step-up instead.
    if (user.membershipVersion !== expectedMembershipVersion) throw new ConflictException("MFA_RESET_TARGET_STALE");
    // A pending (or expired) re-enrollment can be re-issued: the new code replaces the earlier one.
    const reissue = !(user.totpSecretEncrypted && user.totpEnabledAt);
    if (reissue && !user.totpReenrollmentCodeHash) throw new BadRequestException("MFA_NOT_ENABLED");
    // The update is conditional on the proof's version: of two concurrent requests with one proof, one wins.
    const source = { tenantId: user.tenantId, membershipVersion: expectedMembershipVersion };
    // DEC-20261021-01: the reset statement itself bumps the version to source + 1; the code is bound to that reset.
    const reenrollmentCode = createReenrollmentCode();
    const reenrollmentExpiresAt = new Date(Date.now() + reenrollmentCodeValidityMs).toISOString();
    const reset = await this.users.disableTotp(user.id, source, {
      codeHash: hashReenrollmentCode({ userId: user.id, tenantId: user.tenantId, resetVersion: expectedMembershipVersion + 1 }, reenrollmentCode),
      expiresAt: reenrollmentExpiresAt,
    });
    if (!reset) throw new ConflictException("MFA_RESET_TARGET_STALE");
    // A revoke failure still fails the request (as before): the system admin then repeats the reset with a fresh
    // step-up, which issues a new code and revokes again, instead of being told sessions were closed when they were not.
    await this.sessions.revokeByUser(user.id, source);
    // From here on the code must reach the system admin: audit and notice failures are logged and counted instead.
    const resetAt = new Date().toISOString();
    const notificationQueued = await this.queueMfaNotice("MFA_RESET_BY_SUPPORT", user);
    await this.recordResetAuditAfterCommit(user, () => this.auditLogs?.record({
      tenantId: user.tenantId,
      actorUserId: context.userId,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.totp_reset_by_system_admin",
      diff: { resetAt, sessionsRevoked: true, reenrollmentCodeIssued: true, reenrollmentExpiresAt, reissued: reissue, notificationQueued },
    }));
    return { resetAt, reenrollmentCode, reenrollmentExpiresAt, notificationQueued };
  }

  /**
   * The reset audit row is written after the reset committed (the auth store has no shared transaction with the audit
   * store). A failure is logged with ids and a fixed code only (never the code, the address or the driver message)
   * and counted for alerting, and the reset response still carries the one-time code.
   */
  private async recordResetAuditAfterCommit(user: Pick<AuthUser, "id" | "tenantId">, step: () => Promise<unknown> | undefined): Promise<void> {
    try {
      await step();
    } catch {
      recordSecuritySideEffectFailure("mfa_reset_audit");
      apiLogger.error({ tenantId: user.tenantId, userId: user.id, errorCode: "MFA_RESET_AUDIT_FAILED" }, "mfa_reset_audit_not_recorded");
    }
  }

  /** The reset already committed: a notice that cannot be queued is logged without PII and never fails the caller. */
  private async queueMfaNotice(kind: MfaSecurityNoticeKind, user: Pick<AuthUser, "id" | "tenantId" | "email">): Promise<boolean> {
    if (!user.email) return false;
    if (!this.mfaNotices) {
      recordSecuritySideEffectFailure("mfa_notice_enqueue");
      apiLogger.warn({ tenantId: user.tenantId, userId: user.id, kind, errorCode: "MFA_NOTICE_STORE_MISSING" }, "mfa_security_notice_not_queued");
      return false;
    }
    try {
      const tenantName = user.tenantId === "system" ? undefined : (await this.tenants?.findById(user.tenantId))?.name;
      await this.mfaNotices.enqueue({ kind, to: user.email, tenantName });
      return true;
    } catch (error) {
      const errorCode = error instanceof Error && /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : "MFA_NOTICE_ENQUEUE_FAILED";
      recordSecuritySideEffectFailure("mfa_notice_enqueue");
      apiLogger.warn({ tenantId: user.tenantId, userId: user.id, kind, errorCode }, "mfa_security_notice_not_queued");
      return false;
    }
  }

  private async verifyReenrollmentCodeWithAttemptLimit(user: AuthUser, storedHash: string, code: string | undefined): Promise<string> {
    if (isReenrollmentExpired(user.totpReenrollmentExpiresAt)) {
      await this.recordReenrollmentExpired(user, "enrollment_confirm");
      throw new UnauthorizedException("MFA_RESET_EXPIRED");
    }
    // Bound to this reset, not to the current membership version: a password reset cannot refresh the budget.
    const attemptKey = mfaAttemptKey(user.id, "reenrollment", user.tenantId, reenrollmentResetVersion(storedHash) ?? user.membershipVersion);
    // Reserved before the code is compared: parallel guesses get 429 once five attempts are in flight or spent.
    await this.reserveAttempt(attemptKey, "MFA_REENROLLMENT_LOCKED");
    const missing = !code?.trim();
    if (missing || !verifyReenrollmentCode(storedHash, { userId: user.id, tenantId: user.tenantId }, code)) {
      // The reserved attempt stays counted as the failure.
      await this.auditLogs?.record({
        tenantId: user.tenantId === "system" ? undefined : user.tenantId,
        actorUserId: user.id,
        entityType: "Auth",
        entityId: user.id,
        action: "auth.totp_reenrollment_code_rejected",
        diff: { reason: missing ? "missing" : "invalid" },
      });
      throw new UnauthorizedException(missing ? "MFA_REENROLLMENT_CODE_REQUIRED" : "MFA_REENROLLMENT_CODE_INVALID");
    }
    await this.loginAttempts.recordSuccess(attemptKey);
    return storedHash;
  }

  private async recordReenrollmentExpired(user: AuthUser, stage: "login" | "enrollment_confirm"): Promise<void> {
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.totp_reenrollment_expired",
      diff: { stage, expiredAt: user.totpReenrollmentExpiresAt },
    });
  }

  async createMfaStepUp(
    context: RequestContext,
    purpose: MfaStepUpPurpose,
    input: TotpVerificationInput,
    target?: TenantLifecycleMfaTarget | TenantCleanResetMfaTarget | TenantDeviceRestoreMfaTarget | TenantPurgeExportMfaTarget | TenantAdminMfaResetTarget,
  ): Promise<MfaStepUpResponse> {
    this.assertAdminMfaManageable(context);
    this.assertSystemStepUpContext(context);
    const currentUser = await this.requireCurrentUser(context);
    if (currentUser.tenantId !== "system" || !isSystemAdmin(currentUser.roles)) {
      throw new UnauthorizedException("MFA_STEP_UP_CONTEXT_INVALID");
    }
    if (!context.sessionId || context.membershipVersion !== currentUser.membershipVersion) {
      throw new UnauthorizedException("MFA_STEP_UP_CONTEXT_INVALID");
    }
    let proofTarget: AdminMfaStepUpBinding["target"] = target;
    if (purpose === "TENANT_LIFECYCLE_CHANGE" || purpose === "TENANT_CLEAN_RESET" || purpose === "TENANT_DEVICE_RESTORE" || purpose === "TENANT_PURGE_EXPORT") {
      // A purge handover export binds the institution only: exactly { tenantId }.
      if (!target || typeof target.tenantId !== "string" || !target.tenantId || target.tenantId === "system" || (purpose === "TENANT_PURGE_EXPORT" ? Object.keys(target).length !== 1 : !("expectedLifecycleVersion" in target) || (purpose === "TENANT_DEVICE_RESTORE" ? !("operationId" in target) || !/^[a-f0-9]{32}$/.test(target.operationId) || !/^[a-f0-9]{64}$/.test(target.archiveDigest) : purpose === "TENANT_LIFECYCLE_CHANGE" ? !("status" in target) || !["ACTIVE", "SUSPENDED"].includes(target.status) : !("preset" in target) || !["CLEAN_SETUP_V1", "LICENSE_EXPIRY_PURGE_V1"].includes(target.preset) || !/^[a-f0-9]{64}$/.test(target.preflightDigest)) ||
        !Number.isInteger(target.expectedLifecycleVersion) || target.expectedLifecycleVersion < 0 || target.expectedLifecycleVersion > 2147483646)) {
        throw new BadRequestException("MFA_STEP_UP_TARGET_INVALID");
      }
      const session = await this.sessions.findById(context.sessionId);
      if (!session || session.status !== "ACTIVE" || session.expiresAt.getTime() <= Date.now() ||
        session.userId !== currentUser.id || session.tenantId !== "system" || currentUser.tenantId !== "system" ||
        !isAdminMfaRole(currentUser.roles) || session.membershipVersion !== context.membershipVersion) {
        throw new UnauthorizedException("MFA_STEP_UP_CONTEXT_INVALID");
      }
    } else if (purpose === "OWNER_ADMIN_CHANGE") {
      // The reset proof names exactly one tenant account; it cannot reset a second account or a system account.
      if (!target || Object.keys(target).sort().join(",") !== "tenantId,userId" || !("userId" in target) ||
        typeof target.tenantId !== "string" || !target.tenantId || target.tenantId === "system" || typeof target.userId !== "string" || !target.userId) {
        throw new BadRequestException("MFA_STEP_UP_TARGET_INVALID");
      }
      // The server binds the proof to the account's current version (the admin-accounts list already shows these
      // accounts to the system admin, so the lookup reveals nothing new); the reset consumes that version.
      const resetTarget = await this.users.findById(target.userId);
      if (!resetTarget || resetTarget.tenantId !== target.tenantId || isSystemAdmin(resetTarget.roles) || !isAdminMfaRole(resetTarget.roles)) {
        throw new NotFoundException("MFA_RESET_TARGET_NOT_FOUND");
      }
      proofTarget = { tenantId: target.tenantId, userId: target.userId, expectedMembershipVersion: resetTarget.membershipVersion };
    } else if (target) {
      throw new BadRequestException("MFA_STEP_UP_TARGET_INVALID");
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
      ...(proofTarget ? { target: proofTarget } : {}),
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
    if (this.auditLogs) {
    const snapshot = user.tenantId === "system" ? undefined : await this.tenants?.findForAdmin(user.tenantId);
    await runVerifiedTenantMutation({ tenantId: user.tenantId, lifecycleVersion: snapshot?.lifecycleVersion!, kind: "HTTP_MUTATION", actor: { userId: tokenPair.session.userId, sessionId: tokenPair.session.id, membershipVersion: tokenPair.session.membershipVersion } }, async () => this.auditLogs!.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: auditAction,
      diff: { ...auditDiff, roles, activePersona: persona?.activePersona },
    }));
    }
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
      availablePersonas: user.membership ? availablePersonasForUser(user) : undefined,
      capabilities: [...(context.capabilities ?? [])],
      membership: user.membership ? { id: user.membership.id, version: user.membership.version } : undefined,
    };
  }

  async revokeCurrentSession(context: RequestContext, sessionId: string): Promise<void> {
    const user = await this.requireOriginalUser(context);
    const tenantId = context.tenantId ?? (user.tenantId === "system" ? "system" : undefined);
    if (!tenantId || user.tenantId !== tenantId) {
      throw new UnauthorizedException("SESSION_INVENTORY_UNAVAILABLE");
    }
    const revoked = await this.sessions.revokeOwned(sessionId, user.id, tenantId, user.membershipVersion);
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
    const user = await this.requireOriginalUser(context);
    const tenantId = context.tenantId ?? (user.tenantId === "system" ? "system" : undefined);
    if (!tenantId || user.tenantId !== tenantId) {
      throw new UnauthorizedException("SESSION_INVENTORY_UNAVAILABLE");
    }
    const revokedCount = await this.sessions.revokeAllOwned(user.id, tenantId, user.membershipVersion);
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

  async tenantSlugForTenantId(tenantId: string): Promise<string | undefined> {
    if (tenantId === "system") return "system";
    return (await this.tenants?.findById(tenantId))?.slug;
  }

  async tenantLoginContext(tenantSlug: string): Promise<TenantLoginContextResponse> {
    if (tenantSlug === "system") return { slug: "system", name: "O-Okul Sistem Yönetimi" };
    const tenant = await this.tenants?.findBySlug(tenantSlug);
    if (!tenant || tenant.status !== "ACTIVE") throw new NotFoundException("TENANT_HOST_UNKNOWN");
    return { slug: tenant.slug, name: tenant.name, logoUrl: tenant.logoUrl };
  }

  async requestPasswordReset(input: PasswordResetRequestInput): Promise<PasswordResetRequestResult> {
    const tenantSlug = input.tenantSlug.trim().toLowerCase();
    const loginName = input.loginName.trim().toLowerCase();
    const tenant = tenantSlug === "system" ? { id: "system" } : await this.tenants?.findBySlug(tenantSlug);
    const user = tenant && loginName ? await this.users.findByTenantAndLoginName(tenant.id, loginName) : undefined;
    if (!user?.email) return { status: "IGNORED" };
    const resetToken = createResetToken();
    const expiresAt = nextResetExpiry();
    let reset;
    try { reset = await this.passwordResets.issue({
      userId: user.id,
      expectedMembershipVersion: user.membershipVersion,
      tokenHash: hashResetToken(resetToken),
      expiresAt,
      resendNotBefore: new Date(Date.now() - passwordResetResendDelayMs).toISOString(),
      delivery: {
        tenantId: user.tenantId === "system" ? undefined : user.tenantId,
        sourceScope: user.tenantId === "system" ? "SYSTEM" : "TENANT",
        tenantLifecycleVersion: tenant && "lifecycleVersion" in tenant ? tenant.lifecycleVersion : undefined,
        purpose: "PASSWORD_RESET",
        payloadEncrypted: encryptSecretDeliveryPayload({
          channel: "EMAIL",
          to: user.email,
          subject: "O-Okul parola sıfırlama",
          body: `Parolanızı 30 dakika içinde yenilemek için bağlantıyı açın: ${createPasswordResetUrl(resetToken, tenantSlug)}`,
        }),
        expiresAt,
      },
    }); } catch (error) {
      if (error instanceof Error && error.message === "TENANT_ACTIVITY_STALE") return { status: "IGNORED" };
      throw error;
    }
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

    const existingUser = await this.users.findById(reset.userId);
    if (!existingUser) throw new NotFoundException("USER_NOT_FOUND");
    const resetAt = new Date().toISOString();
    const passwordHash = await hashPasswordAsync(password);
    return runVerifiedTenantMutation({ tenantId: reset.tenantId ?? existingUser.tenantId, lifecycleVersion: reset.tenantLifecycleVersion!, kind: "AUTH_MUTATION", referenceId: `password-reset:${reset.id}`, source: { type: "PASSWORD_RESET", id: reset.id, tokenHash: hashResetToken(resetToken), membershipVersion: reset.userMembershipVersion } }, async () => {
    const user = await this.passwordResets.confirm(reset.id, resetAt, async (transaction) => {
      const updated = await this.users.updatePasswordForReset(reset.userId, passwordHash, {
        source: { tenantId: reset.tenantId ?? existingUser.tenantId, membershipVersion: reset.userMembershipVersion! },
        mustChangePassword: false,
        passwordChangedAt: resetAt,
      }, transaction);
      if (!updated) throw new NotFoundException("USER_NOT_FOUND");
      await this.sessions.revokeByUser(existingUser.id, transaction);
      return existingUser;
    });
    if (!user) throw new BadRequestException("PASSWORD_RESET_NOT_PENDING");
    await this.auditLogs?.record({
      tenantId: user.tenantId === "system" ? undefined : user.tenantId,
      actorUserId: user.id,
      entityType: "Auth",
      entityId: user.id,
      action: "auth.password_reset_confirmed",
      diff: { userId: user.id },
    });
    return { resetAt };
    });
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
      // The campus scope belongs to the staff/teacher membership; a guardian persona sees its own linked students.
      campusScope: user.membership?.scopeMode && session.activePersona !== "GUARDIAN"
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
    const user = await this.requireOriginalUser(context);
    if (!await verifyPasswordAsync(currentPassword, user.passwordHash)) {
      throw new UnauthorizedException("CURRENT_PASSWORD_INVALID");
    }

    const changedAt = new Date().toISOString();
    const updated = await this.users.updatePassword(user.id, await hashPasswordAsync(newPassword), {
      source: { tenantId: user.tenantId, membershipVersion: user.membershipVersion },
      mustChangePassword: false,
      passwordChangedAt: changedAt,
    });
    if (!updated) throw new NotFoundException("USER_NOT_FOUND");
    await this.sessions.revokeByUser(user.id, { tenantId: user.tenantId, membershipVersion: user.membershipVersion });
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

  // Step-up proofs stay bound to the system tenant: tenant OWNER/ADMIN MFA covers login only.
  private assertSystemStepUpContext(context: RequestContext): void {
    if (!isSystemAdmin(context.roles) || (context.tenantId ?? "system") !== "system") {
      throw new UnauthorizedException("MFA_STEP_UP_CONTEXT_INVALID");
    }
  }

  private async requireOriginalUser(context: RequestContext) {
    const user = await this.requireCurrentUser(context);
    if (user.tenantId !== (context.tenantId ?? "system") || !Number.isInteger(context.membershipVersion) || context.membershipVersion !== user.membershipVersion) throw new UnauthorizedException("AUTH_MUTATION_SOURCE_STALE");
    return user;
  }

  private async requireCurrentUser(context: RequestContext) {
    const user = await this.users.findById(context.userId);
    if (!user) throw new NotFoundException("USER_NOT_FOUND");
    return user;
  }

  private async verifySecondFactor(user: {
    id: string; tenantId: string; membershipVersion: number;
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
      const marked = await this.users.markTotpCounterUsed(user.id, counter, { tenantId: user.tenantId, membershipVersion: user.membershipVersion });
      if (!marked) {
        throw new UnauthorizedException("MFA_CODE_REUSED");
      }
      return "totp";
    }

    if (input.recoveryCode?.trim()) {
      const consumed = await this.users.consumeTotpRecoveryCode(user.id, hashRecoveryCode(input.recoveryCode), { tenantId: user.tenantId, membershipVersion: user.membershipVersion });
      if (!consumed) {
        throw new UnauthorizedException("MFA_RECOVERY_CODE_INVALID");
      }
      return "recovery_code";
    }

    throw new UnauthorizedException("MFA_CODE_REQUIRED");
  }

  private async verifySecondFactorWithAttemptLimit(
    user: {
      id: string; tenantId: string; membershipVersion: number;
      totpSecretEncrypted?: string;
      totpEnabledAt?: string;
    },
    input: TotpVerificationInput,
    purpose: string,
    lockedCode: string,
  ): Promise<"totp" | "recovery_code"> {
    const attemptKey = mfaAttemptKey(user.id, purpose, user.tenantId, user.membershipVersion);
    await this.reserveAttempt(attemptKey, lockedCode);

    let method: "totp" | "recovery_code";
    try {
      method = await this.verifySecondFactor(user, input);
    } catch (error) {
      // A rejected factor keeps the reserved attempt as the failure; any other error hands it back.
      if (!(error instanceof UnauthorizedException)) await this.releaseAttempt(attemptKey);
      throw error;
    }
    await this.loginAttempts.recordSuccess(attemptKey);
    return method;
  }

  /** Counts the attempt atomically before a secret is verified; a spent budget becomes `lockedCode` (429). */
  private async reserveAttempt(attemptKey: string, lockedCode: string): Promise<void> {
    try {
      await this.loginAttempts.reserveAttempt(attemptKey);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        throw new HttpException(lockedCode, HttpStatus.TOO_MANY_REQUESTS);
      }
      throw error;
    }
  }

  /** Best effort: if the limiter is down the attempt simply stays counted (fail closed). */
  private async releaseAttempt(attemptKey: string): Promise<void> {
    try {
      await this.loginAttempts.releaseAttempt(attemptKey);
    } catch {
      // The caller rethrows its own error.
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

export function createPasswordResetUrl(token: string, tenantSlug?: string): string {
  const url = tenantSlug
    ? tenantWebUrl("/parola-sifirla", tenantSlug)
    : new URL("/parola-sifirla", process.env.WEB_URL ?? "http://localhost:3000");
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
  const available = availablePersonasForUser(user);
  const activePersona = requestedPersona ?? available[0];
  if (!activePersona || !available.includes(activePersona)) return null;
  const roles = activePersona === "STAFF"
    ? [membership.staffRole!]
    : [activePersona];
  if (roles.length !== 1) return null;
  return { membershipId: membership.id, activePersona, roles };
}

function availablePersonasForUser(user: Pick<AuthUser, "roles" | "membership">): ActivePersona[] {
  const membership = user.membership;
  if (!membership) return [];
  return [
    ...(membership.staffRole ? ["STAFF" as const] : []),
    ...(membership.hasTeacherPersona ? ["TEACHER" as const] : []),
    ...(membership.hasStudentPersona ? ["STUDENT" as const] : []),
    // KV-3b: the GUARDIAN membership row sits beside the canonical one and opens as its own persona (last, so login
    // still defaults to the staff/teacher workspace).
    ...(!membership.hasStudentPersona && user.roles.includes("GUARDIAN") ? ["GUARDIAN" as const] : []),
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
  candidates: Array<{ userId: string; tenantId: string; membershipVersion: number; lifecycleVersion: number }>;
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
  if (payload.purpose !== "tenant-selection" || (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) || !Array.isArray(payload.candidates) || payload.candidates.length === 0 || payload.candidates.some((candidate) => !candidate || typeof candidate.userId !== "string" || !candidate.userId || typeof candidate.tenantId !== "string" || !candidate.tenantId || !Number.isInteger(candidate.membershipVersion) || candidate.membershipVersion < 1 || !Number.isInteger(candidate.lifecycleVersion) || candidate.lifecycleVersion < 0)) {
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
