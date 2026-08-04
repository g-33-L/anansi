/*
 * Session bootstrap. Fetches /console/me once on mount; exposes the current
 * principal + active org, a refresh(), and logout(). A 401 leaves `me` null,
 * which the router treats as "show the login screen".
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { ApiError, consoleApi, type Me } from "./api.js";

interface SessionState {
  me: Me | null;
  loading: boolean;
  authError: string | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMe(await consoleApi.me());
      setAuthError(null);
    } catch (e) {
      setMe(null);
      // 401 is the normal "not signed in" case — not a surfaced error.
      setAuthError(e instanceof ApiError && e.status === 401 ? null : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await consoleApi.logout();
    } finally {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ me, loading, authError, refresh, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
