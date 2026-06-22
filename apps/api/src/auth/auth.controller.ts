import { randomBytes } from "node:crypto";
import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import type {
  AuthRefreshRequest,
  AuthResponse,
  LoginRequest,
  LoginResponse,
  PasswordResetAcceptedResponse,
  PasswordResetConfirmRequest,
  PasswordResetConfirmResponse,
  PasswordResetRequest,
  Session,
  TotpChallengeVerifyRequest,
  TotpDisableRequest,
  TotpDisableResponse,
  TotpSetupConfirmRequest,
  TotpSetupConfirmResponse,
  TotpSetupResponse,
  TotpStatusResponse,
} from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { Roles } from "../rbac/roles.decorator.js";
import { AuthService } from "./auth.service.js";
import type { LoginMfaChallenge } from "./totp-mfa.js";
import type { TokenPair } from "./token-service.js";

const loginBodySchema = z.object({
  email: z.string().trim().email(),
  password: requiredTrimmedString,
}).strict() satisfies z.ZodType<LoginRequest>;
const refreshBodySchema = z.preprocess((value) => value ?? {}, z.object({
  refreshToken: optionalTrimmedString,
}).strict()) satisfies z.ZodType<AuthRefreshRequest>;
const passwordResetRequestBodySchema = z.object({
  email: z.string().trim().email(),
}).strict() satisfies z.ZodType<PasswordResetRequest>;
const passwordResetConfirmBodySchema = z.object({
  password: z.string().min(8),
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
const totpDisableBodySchema = z.object({
  totpCode: optionalTrimmedString,
  recoveryCode: optionalTrimmedString,
}).strict().refine((value) => Boolean(value.totpCode || value.recoveryCode), {
  message: "TOTP kodu veya recovery code zorunlu.",
  path: ["totpCode"],
}) satisfies z.ZodType<TotpDisableRequest>;

type RefreshBody = AuthRefreshRequest;

const refreshCookieName = "refreshToken";
const csrfCookieName = "csrfToken";
const refreshCookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.COOKIE_SECURE === "true",
  path: "/api/v1/auth",
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
    const tokenPair = await this.auth.login(body.email, body.password, resolveClientIp(request));
    if (isLoginMfaChallenge(tokenPair)) {
      return tokenPair;
    }

    response.cookie(refreshCookieName, tokenPair.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return toAuthResponse(tokenPair);
  }

  @Post("totp/verify")
  @HttpCode(200)
  async verifyTotpChallenge(
    @Body(zodBody(totpChallengeVerifyBodySchema)) body: TotpChallengeVerifyRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const tokenPair = await this.auth.verifyTotpChallenge(body.challengeToken, {
      totpCode: body.totpCode,
      recoveryCode: body.recoveryCode,
    });
    response.cookie(refreshCookieName, tokenPair.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return toAuthResponse(tokenPair);
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Body(zodBody(refreshBodySchema)) body: RefreshBody,
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers("x-csrf-token") csrfHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    assertCsrfToken(cookieHeader, csrfHeader);
    const tokenPair = await this.auth.refresh(body?.refreshToken ?? readRefreshCookie(cookieHeader));
    response.cookie(refreshCookieName, tokenPair.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return toAuthResponse(tokenPair);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Body(zodBody(refreshBodySchema)) body: RefreshBody,
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers("x-csrf-token") csrfHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertCsrfToken(cookieHeader, csrfHeader);
    await this.auth.logout(body?.refreshToken ?? readRefreshCookie(cookieHeader));
    response.clearCookie(refreshCookieName, refreshCookieOptions);
    response.clearCookie(csrfCookieName, csrfCookieOptions);
  }

  @Post("password-reset/request")
  @HttpCode(200)
  async requestPasswordReset(
    @Body(zodBody(passwordResetRequestBodySchema)) body: PasswordResetRequest,
  ): Promise<PasswordResetAcceptedResponse> {
    await this.auth.requestPasswordReset(body.email);
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
  @Roles("SYSTEM_ADMIN", "TENANT_ADMIN")
  totpStatus(): Promise<TotpStatusResponse> {
    return this.auth.getTotpStatus(getRequestContext());
  }

  @Post("totp/setup")
  @HttpCode(200)
  @Roles("SYSTEM_ADMIN", "TENANT_ADMIN")
  createTotpSetup(): Promise<TotpSetupResponse> {
    return this.auth.createTotpSetup(getRequestContext());
  }

  @Post("totp/confirm")
  @HttpCode(200)
  @Roles("SYSTEM_ADMIN", "TENANT_ADMIN")
  confirmTotpSetup(
    @Body(zodBody(totpSetupConfirmBodySchema)) body: TotpSetupConfirmRequest,
  ): Promise<TotpSetupConfirmResponse> {
    return this.auth.confirmTotpSetup(getRequestContext(), body.setupToken, body.totpCode);
  }

  @Post("totp/disable")
  @HttpCode(200)
  @Roles("SYSTEM_ADMIN", "TENANT_ADMIN")
  disableTotp(@Body(zodBody(totpDisableBodySchema)) body: TotpDisableRequest): Promise<TotpDisableResponse> {
    return this.auth.disableTotp(getRequestContext(), {
      totpCode: body.totpCode,
      recoveryCode: body.recoveryCode,
    });
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
    session: toPublicSession(tokenPair.session),
  };
}

function toPublicSession(session: TokenPair["session"]): Session {
  return {
    id: session.id,
    userId: session.userId,
    tenantId: session.tenantId,
    roles: [...session.roles],
    membershipVersion: session.membershipVersion,
    status: session.status,
    ...(session.subjectType ? { subjectType: session.subjectType } : {}),
    ...(session.subjectId ? { subjectId: session.subjectId } : {}),
  };
}

function isLoginMfaChallenge(value: unknown): value is LoginMfaChallenge {
  return Boolean(value && typeof value === "object" && "status" in value && value.status === "MFA_REQUIRED");
}

function resolveClientIp(request: Request): string {
  const forwardedFor = request.headers["x-forwarded-for"];
  const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const forwardedIp = firstForwarded?.split(",")[0]?.trim();
  if (forwardedIp) return forwardedIp;

  const realIp = request.headers["x-real-ip"];
  if (Array.isArray(realIp)) return realIp[0] ?? "unknown";
  return realIp?.trim() || request.ip || request.socket.remoteAddress || "unknown";
}
