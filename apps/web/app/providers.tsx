"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthResponse, LoginRequest, MePasswordChangeRequest } from "@o-okul/shared-types";
import {
  changePassword as requestChangePassword,
  login as requestLogin,
  logout as requestLogout,
  queryClient,
  refreshSession,
  selectTenant as requestSelectTenant,
  verifyMfa as requestVerifyMfa,
} from "../src/api-client.js";
import { QueryClientProvider } from "@tanstack/react-query";

interface AuthStore {
  auth: AuthResponse | null;
  isBootstrapping: boolean;
  login(credentials: LoginRequest): Promise<void>;
  selectTenant(selectionToken: string, tenantId: string): Promise<void>;
  changePassword(input: MePasswordChangeRequest): Promise<void>;
  verifyMfa(challengeToken: string, input: { totpCode?: string; recoveryCode?: string }): Promise<void>;
  logout(): Promise<void>;
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
      async changePassword(input) {
        if (!auth) throw new Error("AUTH_REQUIRED");
        await requestChangePassword(auth.accessToken, input);
        setAuth(await refreshSession());
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
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
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
