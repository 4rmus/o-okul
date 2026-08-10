import { randomBytes } from "node:crypto";
import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpException, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import type {
  AuthRefreshRequest,
  AuthResponse,
  LoginRequest,
  LoginResponse,
  MfaEnrollmentRequiredResponse,
  MfaStepUpRequest,
  MfaStepUpResponse,
  PasswordResetAcceptedResponse,
  PasswordResetConfirmRequest,
  PasswordResetConfirmResponse,
  PasswordResetRequest,
  PersonaSwitchRequest,
  Session,
  TenantSelectionRequest,
  TenantSelectionRequiredResponse,
  TenantLoginContextResponse,
  TotpChallengeVerifyRequest,
  TotpDisableRequest,
  TotpDisableResponse,
  TotpEnrollmentConfirmRequest,
  TotpSetupConfirmRequest,
  TotpSetupConfirmResponse,
  TotpSetupResponse,
  TotpStatusResponse,
} from "@o-okul/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { resolveClientIp } from "../http/trusted-proxy.js";
import { assertSessionTenantMatchesHost, resolveTenantSlugFromRequest, TenantHostError } from "../http/tenant-host.js";
import { optionalTrimmedString, requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { Roles } from "../rbac/roles.decorator.js";
import { AuthService } from "./auth.service.js";
import { passwordMaxLength, passwordMinLength, passwordPolicyViolation } from "./password-policy.js";
import { sessionClientContext } from "./session-client-context.js";
import type { LoginMfaChallenge } from "./totp-mfa.js";
import { resolveRefreshTokenTtlMs, type TokenPair } from "./token-service.js";

const loginBodySchema = z.object({
  tenantSlug: optionalTrimmedString,
  loginName: requiredTrimmedString,
  password: requiredTrimmedString,
}).strict() satisfies z.ZodType<LoginRequest>;
const tenantSelectionBodySchema = z.object({
  selectionToken: requiredTrimmedString,
  tenantId: requiredTrimmedString,
}).strict() satisfies z.ZodType<TenantSelectionRequest>;
const refreshBodySchema = z.preprocess((value) => value ?? {}, z.object({}).strict()) satisfies z.ZodType<AuthRefreshRequest>;
const personaSwitchBodySchema = z.object({
  activePersona: z.enum(["STAFF", "TEACHER", "STUDENT"]),
}).strict() satisfies z.ZodType<PersonaSwitchRequest>;
const passwordResetRequestBodySchema = z.object({
  tenantSlug: optionalTrimmedString,
  loginName: requiredTrimmedString,
}).strict() satisfies z.ZodType<PasswordResetRequest>;
const passwordResetConfirmBodySchema = z.object({
  password: z.string().min(passwordMinLength).max(passwordMaxLength).refine((value) => !passwordPolicyViolation(value), {
    message: "PASSWORD_COMMON_REJECTED",
  }),
  token: requiredTrimmedString,
}).strict() satisfies z.ZodType<PasswordResetConfirmRequest>;
const totpChallengeVerifyBodySchema = z.object({
  challengeToken: requiredTrimmedString,
  totpCode: optionalTrimmedString,
  recoveryCode: optionalTrimmedString,
}).strict().refine((value) => Boolean(value.totpCode || value.recoveryCode), {
  message: "TOTP kodu veya recovery code zorunlu.",
  path: ["totpCode"],
}) satisfies z.ZodType<TotpChallengeVerifyRequest>;
const totpSetupConfirmBodySchema = z.object({
  setupToken: requiredTrimmedString,
  totpCode: requiredTrimmedString,
}).strict() satisfies z.ZodType<TotpSetupConfirmRequest>;
const totpEnrollmentConfirmBodySchema = totpSetupConfirmBodySchema satisfies z.ZodType<TotpEnrollmentConfirmRequest>;
const totpDisableBodySchema = z.object({
  totpCode: optionalTrimmedString,
  recoveryCode: optionalTrimmedString,
}).strict().refine((value) => Boolean(value.totpCode || value.recoveryCode), {
  message: "TOTP kodu veya recovery code zorunlu.",
  path: ["totpCode"],
}) satisfies z.ZodType<TotpDisableRequest>;
const mfaStepUpBodySchema = z.object({
  purpose: z.enum(["OWNER_ADMIN_CHANGE"]),
  totpCode: optionalTrimmedString,
  recoveryCode: optionalTrimmedString,
}).strict().refine((value) => Boolean(value.totpCode || value.recoveryCode), {
  message: "TOTP kodu veya recovery code zorunlu.",
  path: ["totpCode"],
}) satisfies z.ZodType<MfaStepUpRequest>;

type RefreshBody = AuthRefreshRequest;

const refreshCookieName = "refreshToken";
const csrfCookieName = "csrfToken";
const refreshCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/api/v1/auth",
  maxAge: resolveRefreshTokenTtlMs(),
};
const csrfCookieOptions = {
  sameSite: "strict" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
};

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @HttpCode(200)
  async login(
    @Body(zodBody(loginBodySchema)) body: LoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const clientIp = resolveClientIp(request);
    const result = await this.auth.login({
      ...body,
      tenantSlug: tenantSlugForRequest(request, body.tenantSlug),
    }, clientIp, sessionClientContext(request.header("user-agent"), clientIp));
    if (isLoginMfaChallenge(result) || isMfaEnrollmentRequired(result) || isTenantSelectionRequired(result)) {
      return result;
    }

    await this.assertIssuedSessionHost(request, result);
    response.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return toAuthResponse(result);
  }

  @Get("tenant-context")
  tenantContext(@Req() request: Request): Promise<TenantLoginContextResponse> {
    return this.auth.tenantLoginContext(tenantSlugForRequest(request, undefined));
  }

  @Post("login/select")
  @HttpCode(200)
  async selectTenant(
    @Body(zodBody(tenantSelectionBodySchema)) body: TenantSelectionRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.selectTenant(body, requestSessionClientContext(request));
    if (isLoginMfaChallenge(result) || isMfaEnrollmentRequired(result)) {
      return result;
    }

    await this.assertIssuedSessionHost(request, result);
    response.cookie(refreshCookieName, result.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return toAuthResponse(result);
  }

  @Post("totp/verify")
  @HttpCode(200)
  async verifyTotpChallenge(
    @Body(zodBody(totpChallengeVerifyBodySchema)) body: TotpChallengeVerifyRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const tokenPair = await this.auth.verifyTotpChallenge(body.challengeToken, {
      totpCode: body.totpCode,
      recoveryCode: body.recoveryCode,
    }, requestSessionClientContext(request));
    await this.assertIssuedSessionHost(request, tokenPair);
    response.cookie(refreshCookieName, tokenPair.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return toAuthResponse(tokenPair);
  }

  @Post("totp/enrollment/confirm")
  @HttpCode(200)
  async confirmRequiredTotpEnrollment(
    @Body(zodBody(totpEnrollmentConfirmBodySchema)) body: TotpEnrollmentConfirmRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const tokenPair = await this.auth.confirmRequiredTotpEnrollment(body.setupToken, body.totpCode, requestSessionClientContext(request));
    await this.assertIssuedSessionHost(request, tokenPair);
    response.cookie(refreshCookieName, tokenPair.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return toAuthResponse(tokenPair);
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Body(zodBody(refreshBodySchema)) _body: RefreshBody,
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers("x-csrf-token") csrfHeader: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    assertCsrfToken(cookieHeader, csrfHeader);
    const tokenPair = await this.auth.refresh(readRefreshCookie(cookieHeader));
    await this.assertIssuedSessionHost(request, tokenPair);
    response.cookie(refreshCookieName, tokenPair.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return toAuthResponse(tokenPair);
  }

  @Post("persona/switch")
  @HttpCode(200)
  @Roles("TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF", "TEACHER", "STUDENT")
  async switchPersona(
    @Body(zodBody(personaSwitchBodySchema)) body: PersonaSwitchRequest,
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers("x-csrf-token") csrfHeader: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    assertCsrfToken(cookieHeader, csrfHeader);
    const tokenPair = await this.auth.switchPersona(getRequestContext(), body.activePersona, requestSessionClientContext(request));
    response.cookie(refreshCookieName, tokenPair.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return toAuthResponse(tokenPair);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Body(zodBody(refreshBodySchema)) _body: RefreshBody,
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers("x-csrf-token") csrfHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertCsrfToken(cookieHeader, csrfHeader);
    await this.auth.logout(readRefreshCookie(cookieHeader));
    response.clearCookie(refreshCookieName, refreshCookieOptions);
    response.clearCookie(csrfCookieName, csrfCookieOptions);
  }

  @Post("password-reset/request")
  @HttpCode(200)
  async requestPasswordReset(
    @Body(zodBody(passwordResetRequestBodySchema)) body: PasswordResetRequest,
    @Req() request: Request,
  ): Promise<PasswordResetAcceptedResponse> {
    await this.auth.requestPasswordReset({
      ...body,
      tenantSlug: tenantSlugForRequest(request, body.tenantSlug),
    });
    return { status: "ACCEPTED" };
  }

  @Post("password-reset/confirm")
  @HttpCode(200)
  confirmPasswordReset(
    @Body(zodBody(passwordResetConfirmBodySchema)) body: PasswordResetConfirmRequest,
  ): Promise<PasswordResetConfirmResponse> {
    return this.auth.confirmPasswordReset(body.token, body.password);
  }

  @Get("totp/status")
  @Roles("SYSTEM_ADMIN")
  totpStatus(): Promise<TotpStatusResponse> {
    return this.auth.getTotpStatus(getRequestContext());
  }

  @Post("totp/setup")
  @HttpCode(200)
  @Roles("SYSTEM_ADMIN")
  createTotpSetup(): Promise<TotpSetupResponse> {
    return this.auth.createTotpSetup(getRequestContext());
  }

  @Post("totp/confirm")
  @HttpCode(200)
  @Roles("SYSTEM_ADMIN")
  confirmTotpSetup(
    @Body(zodBody(totpSetupConfirmBodySchema)) body: TotpSetupConfirmRequest,
  ): Promise<TotpSetupConfirmResponse> {
    return this.auth.confirmTotpSetup(getRequestContext(), body.setupToken, body.totpCode);
  }

  @Post("totp/disable")
  @HttpCode(200)
  @Roles("SYSTEM_ADMIN")
  disableTotp(@Body(zodBody(totpDisableBodySchema)) body: TotpDisableRequest): Promise<TotpDisableResponse> {
    return this.auth.disableTotp(getRequestContext(), {
      totpCode: body.totpCode,
      recoveryCode: body.recoveryCode,
    });
  }

  @Post("step-up")
  @HttpCode(200)
  @Roles("SYSTEM_ADMIN")
  createMfaStepUp(@Body(zodBody(mfaStepUpBodySchema)) body: MfaStepUpRequest): Promise<MfaStepUpResponse> {
    return this.auth.createMfaStepUp(getRequestContext(), body.purpose, {
      totpCode: body.totpCode,
      recoveryCode: body.recoveryCode,
    });
  }

  private async assertIssuedSessionHost(request: Request, tokenPair: TokenPair): Promise<void> {
    const tenantSlug = await this.auth.tenantSlugForTenantId(tokenPair.session.tenantId);
    try {
      assertSessionTenantMatchesHost(request, { tenantId: tokenPair.session.tenantId, tenantSlug });
    } catch (error) {
      await this.auth.logout(tokenPair.refreshToken);
      if (error instanceof TenantHostError) throw new HttpException(error.message, error.status);
      throw error;
    }
  }
}

function tenantSlugForRequest(request: Request, supplied: string | undefined): string {
  try {
    return resolveTenantSlugFromRequest(request, supplied);
  } catch (error) {
    if (error instanceof TenantHostError) throw new HttpException(error.message, error.status);
    throw error;
  }
}

function readRefreshCookie(cookieHeader: string | undefined): string {
  return readCookie(cookieHeader, refreshCookieName);
}

function assertCsrfToken(cookieHeader: string | undefined, csrfHeader: string | undefined): void {
  const csrfCookie = readCookie(cookieHeader, csrfCookieName);
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    throw new ForbiddenException("CSRF_TOKEN_INVALID");
  }
}

function readCookie(cookieHeader: string | undefined, name: string): string {
  const cookie = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : "";
}

function createCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

function toAuthResponse(tokenPair: TokenPair): AuthResponse {
  return {
    accessToken: tokenPair.accessToken,
    session: toPublicSession(tokenPair.session, tokenPair.mustChangePassword),
  };
}

function toPublicSession(session: TokenPair["session"], mustChangePassword = false): Session {
  return {
    id: session.id,
    userId: session.userId,
    tenantId: session.tenantId,
    ...(session.membershipId ? { membershipId: session.membershipId } : {}),
    ...(session.activePersona ? { activePersona: session.activePersona } : {}),
    roles: [...session.roles],
    membershipVersion: session.membershipVersion,
    status: session.status,
    ...(mustChangePassword ? { mustChangePassword: true } : {}),
    ...(session.subjectType ? { subjectType: session.subjectType } : {}),
    ...(session.subjectId ? { subjectId: session.subjectId } : {}),
  };
}

function isLoginMfaChallenge(value: unknown): value is LoginMfaChallenge {
  return Boolean(value && typeof value === "object" && "status" in value && value.status === "MFA_REQUIRED");
}

function isMfaEnrollmentRequired(value: unknown): value is MfaEnrollmentRequiredResponse {
  return Boolean(value && typeof value === "object" && "status" in value && value.status === "MFA_ENROLLMENT_REQUIRED");
}

function isTenantSelectionRequired(value: unknown): value is TenantSelectionRequiredResponse {
  return Boolean(value && typeof value === "object" && "status" in value && value.status === "TENANT_SELECTION_REQUIRED");
}

function requestSessionClientContext(request: Request) {
  return sessionClientContext(request.header("user-agent"), resolveClientIp(request));
}
