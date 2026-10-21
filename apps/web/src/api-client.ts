import { QueryClient } from "@tanstack/react-query";
import type {
  AuthResponse,
  ActivePersona,
  IdentityInvitationAcceptRequest,
  IdentityInvitationAcceptResponse,
  LoginRequest,
  LoginResponse,
  MePasswordChangeRequest,
  MePasswordChangeResponse,
  MfaChallengeResponse,
  MfaEnrollmentRequiredResponse,
  PasswordResetAcceptedResponse,
  PasswordResetConfirmRequest,
  PasswordResetConfirmResponse,
  PasswordResetRequest,
  StudentPortalActivationRequest,
  StudentPortalActivationResponse,
  TenantSelectionRequiredResponse,
  TenantLoginContextResponse,
} from "@o-okul/shared-types";

declare const process: { env: Record<string, string | undefined> };

interface ApiEnvelope<T, TMeta = ListMeta> {
  data: T;
  meta?: TMeta;
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListResult<TItem> {
  data: TItem[];
  meta: ListMeta;
}

export interface CursorListMeta {
  limit: number;
  nextCursor?: string;
  previousCursor?: string;
  /** Filtered row count, on lists whose screens show a total. */
  total?: number;
}

export interface CursorListResult<TItem> {
  data: TItem[];
  meta: CursorListMeta;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class MfaRequiredError extends Error {
  constructor(readonly challenge: MfaChallengeResponse) {
    super("MFA_REQUIRED");
  }
}

export class MfaEnrollmentRequiredError extends Error {
  constructor(readonly challenge: MfaEnrollmentRequiredResponse) {
    super("MFA_ENROLLMENT_REQUIRED");
  }
}

export class TenantSelectionRequiredError extends Error {
  constructor(readonly challenge: TenantSelectionRequiredResponse) {
    super("TENANT_SELECTION_REQUIRED");
  }
}

export const apiUrl = "";
export const apiBaseUrl = "/api/v1";

export function withQueryParams(path: string, values: object): string {
  const separator = path.indexOf("?");
  const pathname = separator >= 0 ? path.slice(0, separator) : path;
  const rawQuery = separator >= 0 ? path.slice(separator + 1) : "";
  const query = new URLSearchParams(rawQuery);
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value) query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}

let activeAuth: AuthResponse | null = null;
let refreshPromise: Promise<AuthResponse> | null = null;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

export async function login(body: LoginRequest): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    body: JSON.stringify(body),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("LOGIN_FAILED");
  }

  const result = await readData<LoginResponse>(response);
  if (isMfaChallengeResponse(result)) {
    throw new MfaRequiredError(result);
  }
  if (isMfaEnrollmentRequiredResponse(result)) {
    throw new MfaEnrollmentRequiredError(result);
  }
  if (isTenantSelectionRequiredResponse(result)) {
    throw new TenantSelectionRequiredError(result);
  }

  return rememberAuth(result);
}

export async function getTenantLoginContext(): Promise<TenantLoginContextResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/tenant-context`, { credentials: "same-origin" });
  if (!response.ok) throw new Error("TENANT_HOST_UNKNOWN");
  return readData<TenantLoginContextResponse>(response);
}

export async function changePassword(accessToken: string, input: MePasswordChangeRequest, expected: { userId: string; sessionId: string; membershipVersion: number }): Promise<MePasswordChangeResponse> {
  const response = await authenticatedFetchOnce(accessToken, expected, `${apiBaseUrl}/me/password`, {
    body: JSON.stringify(input), headers: { "content-type": "application/json" }, method: "POST",
  });
  if (!response.ok) throw new ApiRequestError("PASSWORD_CHANGE_FAILED", response.status, await readErrorCode(response));
  const result = await readData<MePasswordChangeResponse>(response);
  if (!result || typeof result.changedAt !== "string" || !Number.isFinite(Date.parse(result.changedAt))) throw new Error("PASSWORD_CHANGE_UNVERIFIED");
  return result;
}

export function clearAuthForSession(expected: { userId: string; sessionId: string; membershipVersion: number }): boolean {
  if (activeAuth && (activeAuth.session.userId !== expected.userId || activeAuth.session.id !== expected.sessionId || activeAuth.session.membershipVersion !== expected.membershipVersion)) return false;
  activeAuth = null;
  queryClient.clear();
  return true;
}

export async function requestPasswordReset(input: PasswordResetRequest): Promise<PasswordResetAcceptedResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/password-reset/request`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("PASSWORD_RESET_REQUEST_FAILED");
  return readData<PasswordResetAcceptedResponse>(response);
}

export async function confirmPasswordReset(input: PasswordResetConfirmRequest): Promise<PasswordResetConfirmResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/password-reset/confirm`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("PASSWORD_RESET_CONFIRM_FAILED");
  return readData<PasswordResetConfirmResponse>(response);
}

export async function acceptIdentityInvitation(input: IdentityInvitationAcceptRequest): Promise<IdentityInvitationAcceptResponse> {
  const response = await fetch(`${apiBaseUrl}/identity-invitations/accept`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new ApiRequestError("IDENTITY_INVITATION_ACCEPT_FAILED", response.status, await readErrorCode(response));
  return readData<IdentityInvitationAcceptResponse>(response);
}

export async function activateStudentPortal(input: StudentPortalActivationRequest): Promise<StudentPortalActivationResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/activate`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("STUDENT_PORTAL_ACTIVATION_FAILED");
  return readData<StudentPortalActivationResponse>(response);
}

export async function verifyMfa(challengeToken: string, input: { totpCode?: string; recoveryCode?: string }): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/totp/verify`, {
    body: JSON.stringify({
      challengeToken,
      totpCode: input.totpCode,
      recoveryCode: input.recoveryCode,
    }),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("MFA_VERIFY_FAILED");
  }

  return rememberAuth(await readData<AuthResponse>(response));
}

export async function confirmMfaEnrollment(setupToken: string, totpCode: string): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/totp/enrollment/confirm`, {
    body: JSON.stringify({ setupToken, totpCode }),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error("MFA_ENROLLMENT_FAILED");
  return rememberAuth(await readData<AuthResponse>(response));
}

export async function selectTenant(selectionToken: string, tenantId: string): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/login/select`, {
    body: JSON.stringify({ selectionToken, tenantId }),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("TENANT_SELECTION_FAILED");
  }

  const result = await readData<LoginResponse>(response);
  if (isMfaChallengeResponse(result)) {
    throw new MfaRequiredError(result);
  }
  if (isMfaEnrollmentRequiredResponse(result)) {
    throw new MfaEnrollmentRequiredError(result);
  }
  if (isTenantSelectionRequiredResponse(result)) {
    throw new Error("TENANT_SELECTION_FAILED");
  }

  return rememberAuth(result);
}

export async function refreshSession(): Promise<AuthResponse> {
  refreshPromise ??= refreshSessionRequest().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function switchPersona(accessToken: string, activePersona: ActivePersona): Promise<AuthResponse> {
  const response = await authenticatedFetch(accessToken, `${apiBaseUrl}/auth/persona/switch`, {
    body: JSON.stringify({ activePersona }),
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": readCookie("csrfToken") },
    method: "POST",
  });
  if (!response.ok) throw new Error("PERSONA_SWITCH_FAILED");
  return rememberAuth(await readData<AuthResponse>(response));
}

async function refreshSessionRequest(): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/refresh`, {
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": readCookie("csrfToken") },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("REFRESH_FAILED");
  }

  return rememberAuth(await readData<AuthResponse>(response));
}

export async function logout(): Promise<void> {
  await fetch(`${apiBaseUrl}/auth/logout`, {
    credentials: "include",
    headers: { "content-type": "application/json", "x-csrf-token": readCookie("csrfToken") },
    method: "POST",
  });
  activeAuth = null;
  queryClient.clear();
}

// Critical operations may refresh through prior reads, but must never change actor or replay a POST.
export function authenticatedFetchOnce(accessToken: string, expected: { userId: string; sessionId: string; membershipVersion: number }, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (!activeAuth || activeAuth.session.userId !== expected.userId || activeAuth.session.id !== expected.sessionId || activeAuth.session.membershipVersion !== expected.membershipVersion) throw new Error("AUTH_CONTEXT_CHANGED");
  return fetch(input, withAuthorization(init, activeAuth?.accessToken ?? accessToken));
}

export async function authenticatedFetch(accessToken: string, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, withAuthorization(init, activeAuth?.accessToken ?? accessToken));
  if (response.status !== 401) {
    return response;
  }

  try {
    const refreshed = await refreshSession();
    return fetch(input, withAuthorization(init, refreshed.accessToken));
  } catch {
    activeAuth = null;
    queryClient.clear();
    return response;
  }
}

// A POST without its own Idempotency-Key reuses one key per user, URL and body until a 2xx arrives, so a
// double click or a resubmit after a lost response replays on endpoints in the idempotency inventory
// instead of creating a second record. After a success the next identical POST gets a fresh key.
const pendingIdempotencyKeys = new Map<string, string>();

export function idempotencyFingerprint(userId: string, input: RequestInfo | URL, init: RequestInit): string | undefined {
  if ((init.method ?? "GET").toUpperCase() !== "POST" || typeof init.body !== "string") return undefined;
  if (new Headers(init.headers).has("idempotency-key")) return undefined;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return `${userId} ${url} ${init.body}`;
}

function withPendingIdempotencyKey(init: RequestInit, fingerprint: string): RequestInit {
  let key = pendingIdempotencyKeys.get(fingerprint);
  if (!key) {
    key = globalThis.crypto.randomUUID();
    pendingIdempotencyKeys.set(fingerprint, key);
  }
  const headers = new Headers(init.headers);
  headers.set("Idempotency-Key", key);
  return { ...init, headers };
}

export async function apiRequest<T>(accessToken: string, input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const fingerprint = idempotencyFingerprint(activeAuth?.session.userId ?? "", input, init);
  const response = await authenticatedFetch(accessToken, input, fingerprint ? withPendingIdempotencyKey(init, fingerprint) : init);
  if (fingerprint && response.ok) pendingIdempotencyKeys.delete(fingerprint);
  if (!response.ok) {
    throw new ApiRequestError("API_REQUEST_FAILED", response.status, await readErrorCode(response));
  }
  if (response.status === 204) return undefined as T;

  return readData<T>(response);
}

export async function apiListRequest<TItem>(
  accessToken: string,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<ListResult<TItem>> {
  const response = await authenticatedFetch(accessToken, input, init);
  if (!response.ok) {
    throw new ApiRequestError("API_LIST_REQUEST_FAILED", response.status, await readErrorCode(response));
  }

  const envelope = await readEnvelope<TItem[]>(response);
  return {
    data: envelope.data,
    meta: envelope.meta ?? {
      total: envelope.data.length,
      page: 1,
      limit: envelope.data.length,
      totalPages: envelope.data.length === 0 ? 0 : 1,
    },
  };
}

export async function apiCursorListRequest<TItem>(
  accessToken: string,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<CursorListResult<TItem>> {
  const response = await authenticatedFetch(accessToken, input, init);
  if (!response.ok) {
    throw new ApiRequestError("API_CURSOR_LIST_REQUEST_FAILED", response.status, await readErrorCode(response));
  }

  const envelope = await readEnvelope<TItem[], CursorListMeta>(response);
  return {
    data: envelope.data,
    meta: envelope.meta ?? { limit: envelope.data.length },
  };
}

/**
 * Follows `meta.nextCursor` until the filtered cursor list is exhausted. Only for narrow, bounded filters
 * (for example one subject type's pending invitations); screen lists page with `apiCursorListRequest`.
 * If the API refuses a cursor mid-walk (400 *_CURSOR_INVALID), the walk restarts once from the first page.
 */
export async function apiCursorListAll<TItem>(
  accessToken: string,
  url: string,
  init: RequestInit = {},
  maxPages = 50,
): Promise<TItem[]> {
  try {
    return await walkCursorList<TItem>(accessToken, url, init, maxPages);
  } catch (error) {
    if (!(error instanceof ApiRequestError && error.status === 400 && /_CURSOR_INVALID$/u.test(error.code ?? ""))) throw error;
    return walkCursorList<TItem>(accessToken, url, init, maxPages);
  }
}

async function walkCursorList<TItem>(accessToken: string, url: string, init: RequestInit, maxPages: number): Promise<TItem[]> {
  const items: TItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const pageUrl = new URL(url, "http://cursor.invalid");
    if (cursor) pageUrl.searchParams.set("cursor", cursor);
    const result = await apiCursorListRequest<TItem>(
      accessToken,
      url.startsWith("http") ? pageUrl.toString() : `${pageUrl.pathname}${pageUrl.search}`,
      init,
    );
    items.push(...result.data);
    cursor = result.meta.nextCursor;
    if (!cursor) return items;
  }
  throw new ApiRequestError("API_CURSOR_LIST_TOO_LARGE", 0);
}

export async function checkHealth(): Promise<"ok" | "limited"> {
  const [healthResponse, readyResponse] = await Promise.all([
    fetch(`${apiUrl}/health`),
    fetch(`${apiUrl}/health/ready`),
  ]);

  return healthResponse.ok && readyResponse.ok ? "ok" : "limited";
}

function withAuthorization(init: RequestInit, accessToken: string): RequestInit {
  return {
    ...init,
    headers: {
      ...toHeaderRecord(init.headers),
      authorization: `Bearer ${accessToken}`,
    },
  };
}

function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
}

function rememberAuth(auth: AuthResponse): AuthResponse {
  activeAuth = auth;
  return auth;
}

function isMfaChallengeResponse(value: LoginResponse): value is MfaChallengeResponse {
  return "status" in value && value.status === "MFA_REQUIRED";
}

function isMfaEnrollmentRequiredResponse(value: LoginResponse): value is MfaEnrollmentRequiredResponse {
  return "status" in value && value.status === "MFA_ENROLLMENT_REQUIRED";
}

function isTenantSelectionRequiredResponse(value: LoginResponse): value is TenantSelectionRequiredResponse {
  return "status" in value && value.status === "TENANT_SELECTION_REQUIRED";
}

function readCookie(name: string): string {
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
}

export async function readData<T>(response: Response): Promise<T> {
  return (await readEnvelope<T>(response)).data;
}

export function apiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && error.status === 403) {
    return "Bu işlem için yetkiniz yok.";
  }
  if (error instanceof ApiRequestError && error.status === 401) {
    return "Oturum doğrulanamadı. Lütfen tekrar giriş yapın.";
  }
  return fallback;
}

async function readEnvelope<T, TMeta = ListMeta>(response: Response): Promise<ApiEnvelope<T, TMeta>> {
  return (await response.json()) as ApiEnvelope<T, TMeta>;
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { error?: { code?: string } };
    return body.error?.code;
  } catch {
    return undefined;
  }
}
