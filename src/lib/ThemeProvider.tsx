import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  INITIAL_THEME,
  THEME_STORAGE_KEY,
  ThemeContext,
  type Theme,
} from "./theme.ts";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(INITIAL_THEME);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // 저장 실패는 무시 — 이번 세션에만 적용된다
    }
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((prev) => (prev === "dark" ? "light" : "dark")),
    [],
  );

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
