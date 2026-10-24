// A logout the server did not confirm (403 CSRF, 5xx, network) leaves the refresh cookie alive, and the login page
// would otherwise refresh straight back into that session. The login page therefore receives this plain flag (no
// name, e-mail or session data): its bootstrap retries the server logout instead of resuming the session, and the
// page offers a retry while the logout stays unconfirmed. Plain module so server pages can read the constants too.
export const logoutPendingParam = "cikis";
export const logoutPendingFlag = "tamamlanamadi";
export const logoutPendingMessage = "Çıkış sunucuda tamamlanamadı. Oturumunuz bu tarayıcıda açık kalabilir; tekrar deneyin.";

export function loginPathAfterLogout(loginPath: string, logoutPending: boolean): string {
  return logoutPending ? `${loginPath}?${logoutPendingParam}=${logoutPendingFlag}` : loginPath;
}

export function isLogoutPendingValue(value: unknown): boolean {
  return value === logoutPendingFlag || (Array.isArray(value) && value.includes(logoutPendingFlag));
}

export function hasLogoutPendingFlag(): boolean {
  return new URL(window.location.href).searchParams.get(logoutPendingParam) === logoutPendingFlag;
}

export function clearLogoutPendingFlag(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(logoutPendingParam)) return;
  url.searchParams.delete(logoutPendingParam);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
