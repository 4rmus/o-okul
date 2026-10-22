"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ActivePersona, AuthResponse, LoginRequest, MePasswordChangeRequest } from "@o-okul/shared-types";
import {
  changePassword as requestChangePassword,
  clearAuthForSession,
  confirmMfaEnrollment as requestConfirmMfaEnrollment,
  licenseReadOnlyEvent,
  login as requestLogin,
  logout as requestLogout,
  queryClient,
  refreshSession,
  selectTenant as requestSelectTenant,
  switchPersona as requestSwitchPersona,
  verifyMfa as requestVerifyMfa,
} from "../src/api-client.js";
import { QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider, useToast } from "@o-okul/ui";

interface AuthStore {
  auth: AuthResponse | null;
  isBootstrapping: boolean;
  login(credentials: LoginRequest): Promise<void>;
  selectTenant(selectionToken: string, tenantId: string): Promise<void>;
  changePassword(input: MePasswordChangeRequest): Promise<void>;
  confirmMfaEnrollment(setupToken: string, totpCode: string, reenrollmentCode?: string): Promise<void>;
  verifyMfa(challengeToken: string, input: { totpCode?: string; recoveryCode?: string }): Promise<void>;
  logout(): Promise<void>;
  switchPersona(activePersona: ActivePersona): Promise<void>;
}

const AuthContext = createContext<AuthStore | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  useEffect(() => {
    if (!hasCookie("csrfToken")) {
      setAuth(null);
      setIsBootstrapping(false);
      return;
    }

    refreshSession()
      .then(setAuth)
      .catch(() => setAuth(null))
      .finally(() => setIsBootstrapping(false));
  }, []);

  const value = useMemo<AuthStore>(
    () => ({
      auth,
      isBootstrapping,
      async login(credentials: LoginRequest) {
        setAuth(await requestLogin(credentials));
      },
      async selectTenant(selectionToken, tenantId) {
        setAuth(await requestSelectTenant(selectionToken, tenantId));
      },
      async verifyMfa(challengeToken, input) {
        setAuth(await requestVerifyMfa(challengeToken, input));
      },
      async confirmMfaEnrollment(setupToken, totpCode, reenrollmentCode) {
        setAuth(await requestConfirmMfaEnrollment(setupToken, totpCode, reenrollmentCode));
      },
      async changePassword(input) {
        if (!auth) throw new Error("AUTH_REQUIRED");
        const expected = { userId: auth.session.userId, sessionId: auth.session.id, membershipVersion: auth.session.membershipVersion };
        await requestChangePassword(auth.accessToken, input, expected);
        if (clearAuthForSession(expected)) setAuth((current) => current?.session.userId === expected.userId && current.session.id === expected.sessionId && current.session.membershipVersion === expected.membershipVersion ? null : current);
      },
      async switchPersona(activePersona) {
        if (!auth) throw new Error("AUTH_REQUIRED");
        const nextAuth = await requestSwitchPersona(auth.accessToken, activePersona);
        queryClient.clear();
        setAuth(nextAuth);
      },
      async logout() {
        await requestLogout().catch(() => undefined);
        setAuth(null);
      },
    }),
    [auth, isBootstrapping],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={value}>
        <ToastProvider><LicenseReadOnlyNotice />{children}</ToastProvider>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

export function useAuth() {
  const store = useContext(AuthContext);
  if (!store) {
    throw new Error("AUTH_PROVIDER_MISSING");
  }

  return store;
}

function hasCookie(name: string): boolean {
  return document.cookie.split(";").some((part) => part.trim().startsWith(`${name}=`));
}

export const licenseReadOnlyMessage = "Lisans süresi dolduğu için kurum salt okunur: kayıtlar görüntülenebilir, yeni kayıt ve değişiklik için lisansın yenilenmesi gerekir.";

// UAT F-17: one warning per burst of rejected writes (a form may retry or fire several requests).
function LicenseReadOnlyNotice() {
  const { notify } = useToast();
  useEffect(() => {
    let lastShown = 0;
    const onReadOnly = () => {
      if (Date.now() - lastShown < 8000) return;
      lastShown = Date.now();
      notify(licenseReadOnlyMessage, "warning");
    };
    window.addEventListener(licenseReadOnlyEvent, onReadOnly);
    return () => window.removeEventListener(licenseReadOnlyEvent, onReadOnly);
  }, [notify]);
  return null;
}
