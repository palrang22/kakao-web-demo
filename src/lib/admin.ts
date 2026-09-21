/**
 * 관리자 게이트 공유 로직 — `/settings` 와 `/gallery` 가 함께 쓴다.
 *
 * ⚠️ 이 비밀번호는 브라우저에서만 검사한다. 번들을 열면 그대로 보이므로
 * 보안 장치가 아니라 "실수로 들어가는 것"을 막는 덮개다 (CLAUDE.md §접근 제어).
 * 진짜 접근 제어는 IAP(도메인 제한) + 서버 쪽 검사가 맡는다.
 */
export const ADMIN_PASSWORD = "aprk12!";
const SESSION_KEY = "sm-admin";

/** 렌더 중 sessionStorage 를 읽지 않으려고 최초 1회만 확인할 때 쓴다 */
export function readAdminUnlocked(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

/** 비밀번호 통과 시 세션에 표시 — 실패해도 이번 화면은 열어준다 */
export function markAdminUnlocked(): void {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // 저장 실패는 무시
  }
}
