import { createContext, useContext } from "react";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "kakao-theme";

/**
 * 저장값이 있으면 그걸, 없으면 무조건 **다크**로 시작한다.
 * OS 설정(prefers-color-scheme)은 보지 않는다 — 부스 화면은 항상 다크가 기본,
 * 라이트는 레일 토글을 눌렀을 때만 (합의 D5 · PLAN.md §5).
 *
 * 모듈 최상단에서 한 번만 읽는다. 컴포넌트 렌더 중에 localStorage 를 읽으면
 * 렌더가 순수하지 않게 되고(react-hooks/purity), 이펙트에서 setState 하면
 * 캐스케이드 렌더가 된다. 둘 다 피하려면 여기가 맞다.
 *
 * index.html 의 인라인 스크립트가 같은 규칙으로 먼저 data-theme 을 칠하므로
 * 첫 페인트에 색이 번쩍이지 않는다.
 */
function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // 시크릿 모드 등에서 접근이 막힐 수 있다
  }
  return "dark";
}

export const INITIAL_THEME = readInitialTheme();

export type ThemeValue = { theme: Theme; toggle: () => void };

export const ThemeContext = createContext<ThemeValue | null>(null);

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme 은 ThemeProvider 안에서만 쓸 수 있습니다");
  return value;
}
