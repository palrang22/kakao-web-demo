/**
 * 시연 영상 촬영용 모드 — 켜면 모델을 호출하지 않고 public/demo/ 의 준비된 결과를 보여준다.
 *
 * - `/settings` 토글로 켜고 끈다 (localStorage, 이 브라우저에만 적용). URL 쿼리를 쓰지 않는
 *   이유는 주소창이 녹화에 찍히기 때문이다.
 * - ⚠️ 부스 PC 에서 켜 둔 채로 두면 방문객도 가짜 결과를 보게 된다. 촬영 후 반드시 끌 것.
 */
const STORAGE_KEY = "demo-mode";

export function isDemoMode(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDemoMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장 실패는 무시 — 토글이 안 먹는 것으로 드러난다
  }
}

/** 생성 대기 시간 — 편집에서 빨리감기 할 전제 (public/demo/*\/guide.md) */
export const DEMO_MOTION_WAIT_MS = 20_000;
export const DEMO_LOOK_WAIT_MS = 10_000;

export const DEMO_MOTION = {
  /** 첫 생성 결과 */
  first: { src: "/demo/motion-studio/10sec.mp4", totalSeconds: 10 },
  /** "이어서 늘리기" 결과 (앞 10초 포함 20초짜리) */
  extended: { src: "/demo/motion-studio/20sec.mp4", totalSeconds: 20 },
};

export const DEMO_LOOK_SRC = "/demo/look-studio/look.png";

/** 03 — 웹캠 대신 루프 재생할 인물 영상 */
export const DEMO_VOICE_VIDEO = "/demo/visual-studio/visual-studio-demo.mp4";
/** 인물 영상 재생 속도 — 10초짜리라 느리게 돌려 루프가 덜 티 나게 한다 */
export const DEMO_VOICE_VIDEO_RATE = 0.7;

/** QR 이 실제로 그려지도록 절대 URL 로 만든다 (촬영용이라 스캔 결과는 중요하지 않다) */
export function demoAbsoluteUrl(path: string): string {
  return new URL(path, location.origin).href;
}

/**
 * 03 관상가 대본 — public/demo/visual-studio/guide.md 가 단일 소스다. 음성 없이 자막만 흘린다.
 * 한 줄에 한 발화. "관상가 …" 는 관상가, "나 …" 는 손님. 빈 줄·그 밖의 줄은 무시한다.
 */
export const DEMO_VOICE_SCRIPT_SRC = "/demo/visual-studio/guide.md";

export type DemoVoiceLine = {
  role: "user" | "model";
  text: string;
  /** 이 줄이 시작되기 전 쉬는 시간 */
  pauseMs: number;
};

const SPEAKERS: { prefix: string; role: DemoVoiceLine["role"] }[] = [
  { prefix: "관상가", role: "model" },
  { prefix: "나", role: "user" },
];

export async function loadDemoVoiceScript(): Promise<DemoVoiceLine[]> {
  const res = await fetch(DEMO_VOICE_SCRIPT_SRC);
  if (!res.ok) throw new Error(`시연 대본을 불러오지 못했습니다 (${DEMO_VOICE_SCRIPT_SRC})`);
  const lines: DemoVoiceLine[] = [];
  for (const raw of (await res.text()).split(/\r?\n/)) {
    const line = raw.trim();
    const hit = SPEAKERS.find((s) => line.startsWith(`${s.prefix} `));
    if (!hit) continue;
    lines.push({
      role: hit.role,
      text: line.slice(hit.prefix.length).trim(),
      // 첫 인사는 연결 직후 조금 여유를 두고, 손님 답은 관상가 말이 끝나고 한 박자 뒤에
      pauseMs: lines.length === 0 ? 1500 : hit.role === "user" ? 1400 : 1000,
    });
  }
  if (!lines.length) throw new Error(`시연 대본이 비어 있습니다 (${DEMO_VOICE_SCRIPT_SRC})`);
  return lines;
}

/** 관상가 자막이 한 글자씩 나오는 속도 */
export const DEMO_VOICE_CHAR_MS = 55;
