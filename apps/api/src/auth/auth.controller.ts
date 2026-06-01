import { randomBytes } from "node:crypto";
import { Body, Controller, ForbiddenException, Headers, HttpCode, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { AuthService } from "./auth.service.js";

interface LoginBody {
  email?: string;
  password?: string;
}

interface RefreshBody {
  refreshToken?: string;
}

interface PasswordResetRequestBody {
  email?: string;
}

interface PasswordResetConfirmBody {
  token?: string;
  password?: string;
}

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
  async login(@Body() body: LoginBody, @Res({ passthrough: true }) response: Response) {
    const tokenPair = await this.auth.login(body.email ?? "", body.password ?? "");
    response.cookie(refreshCookieName, tokenPair.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return { accessToken: tokenPair.accessToken, session: tokenPair.session };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Body() body: RefreshBody,
    @Headers("cookie") cookieHeader: string | undefined,
    @Headers("x-csrf-token") csrfHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertCsrfToken(cookieHeader, csrfHeader);
    const tokenPair = await this.auth.refresh(body?.refreshToken ?? readRefreshCookie(cookieHeader));
    response.cookie(refreshCookieName, tokenPair.refreshToken, refreshCookieOptions);
    response.cookie(csrfCookieName, createCsrfToken(), csrfCookieOptions);
    return { accessToken: tokenPair.accessToken, session: tokenPair.session };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Body() body: RefreshBody,
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
  requestPasswordReset(@Body() body: PasswordResetRequestBody) {
    return this.auth.requestPasswordReset(body.email ?? "");
  }

  @Post("password-reset/confirm")
  @HttpCode(200)
  confirmPasswordReset(@Body() body: PasswordResetConfirmBody) {
    return this.auth.confirmPasswordReset(body.token ?? "", body.password ?? "");
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
