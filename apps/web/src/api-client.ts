import { QueryClient } from "@tanstack/react-query";
import type { AuthResponse } from "@uzman-hocam/shared-types";

declare const process: { env: Record<string, string | undefined> };

interface ApiEnvelope<T> {
  data: T;
  meta?: ListMeta;
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

export const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3100";
export const apiBaseUrl = `${apiUrl}/api/v1`;

let activeAuth: AuthResponse | null = null;
let refreshPromise: Promise<AuthResponse> | null = null;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

export async function login(email: string, password: string): Promise<AuthResponse> {
  const response = await fetch(`${apiBaseUrl}/auth/login`, {
    body: JSON.stringify({ email, password }),
    credentials: "include",
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("LOGIN_FAILED");
  }

  return rememberAuth(await readData<AuthResponse>(response));
}

export async function refreshSession(): Promise<AuthResponse> {
  refreshPromise ??= refreshSessionRequest().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
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

export async function authenticatedFetch(accessToken: string, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(input, withAuthorization(init, activeAuth?.accessToken ?? accessToken));
  if (response.status !== 401) {
    return response;
  }

  const refreshed = await refreshSession();
  return fetch(input, withAuthorization(init, refreshed.accessToken));
}

export async function apiRequest<T>(accessToken: string, input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  const response = await authenticatedFetch(accessToken, input, init);
  if (!response.ok) {
    throw new Error("API_REQUEST_FAILED");
  }

  return readData<T>(response);
}

export async function apiListRequest<TItem>(
  accessToken: string,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<ListResult<TItem>> {
  const response = await authenticatedFetch(accessToken, input, init);
  if (!response.ok) {
    throw new Error("API_LIST_REQUEST_FAILED");
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

async function readEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  return (await response.json()) as ApiEnvelope<T>;
}
