/*
 * @anansi/ui — theme provider (dark/light mode switch via `document.documentElement.dataset.theme`).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useIsomorphicLayoutEffect } from "../lib/hooks.js";

export type Theme = "dark" | "light";
type ThemeCtx = { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void };
const ThemeContext = createContext<ThemeCtx | null>(null);

export function ThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = "anansi-theme",
}: {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  // useLayoutEffect (not useEffect): applies the stored theme before the browser
  // paints the first client-rendered frame, avoiding a flash of the wrong theme
  // when a returning visitor's stored preference differs from `defaultTheme`.
  useIsomorphicLayoutEffect(() => {
    const stored = (typeof localStorage !== "undefined" &&
      localStorage.getItem(storageKey)) as Theme | null;
    if (stored === "dark" || stored === "light") setThemeState(stored);
  }, [storageKey]);

  useIsomorphicLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      /* ignore (private browsing / storage disabled) */
    }
  }, [theme, storageKey]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    []
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
