import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  loginRequest,
  logoutRequest,
  setAuthFailureHandler,
  setClientToken,
} from "../api/client";

interface AuthState {
  accessToken: string | null;
  username: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Keep the API client's module-level token in sync with React state.
  useEffect(() => {
    setClientToken(accessToken);
  }, [accessToken]);

  // On mount, try a silent refresh (one round-trip returns both token + username).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (!cancelled && response.ok) {
          const body = (await response.json()) as {
            access_token: string;
            username: string;
          };
          setClientToken(body.access_token);
          setAccessToken(body.access_token);
          setUsername(body.username);
        }
      } catch {
        // No refresh cookie or network error — fall through to logged-out state.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Register the auth-failure callback: clearing state makes ProtectedRoute redirect.
  useEffect(() => {
    setAuthFailureHandler(() => {
      setAccessToken(null);
      setUsername(null);
    });
    return () => setAuthFailureHandler(null);
  }, []);

  const login = useCallback(async (u: string, p: string) => {
    const body = await loginRequest(u, p);
    setAccessToken(body.access_token);
    setUsername(body.username);
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    setAccessToken(null);
    setUsername(null);
  }, []);

  const value: AuthState = {
    accessToken,
    username,
    isLoading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
