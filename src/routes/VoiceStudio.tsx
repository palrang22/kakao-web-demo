import { useCallback, useEffect, useRef, useState } from "react";
import { PcmPlayer, fromBase64, startMicCapture } from "../lib/audio.ts";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import {
  DEMO_VOICE_CHAR_MS,
  DEMO_VOICE_VIDEO,
  DEMO_VOICE_VIDEO_RATE,
  isDemoMode,
  loadDemoVoiceScript,
} from "../lib/demo.ts";
import "../styles/studio.css";

type Health = {
  ready: boolean;
  mode: "vertex" | "apikey" | "unconfigured";
  detail: string;
};

type Phase = "idle" | "connecting" | "live";

type Line = {
  id: number;
  role: "user" | "model";
  text: string;
  /** 마지막으로 이어붙인 조각 — 같은 조각이 또 오는지 보려고 남겨둔다 */
  last: string;
};

type ServerMessage =
  | { type: "ready" }
  | { type: "audio"; data: string }
  | { type: "interrupted" }
  | { type: "turnComplete" }
  | { type: "activity"; state: "start" | "end" }
  | {
      type: "transcript";
      role: "user" | "model";
      text: string;
      /** 말하는 중의 임시 추정 자막 — 계속 고쳐진다 */
      interim?: boolean;
      /** 이 발화의 확정 자막이 끝났다 */
      done?: boolean;
    }
  | { type: "error"; message: string; detail?: string }
  | { type: "ended"; message: string };

/** 재생 커서에 맞춰 풀어놓을 자막 조각. endTurn 은 "이 줄은 여기서 끝" 표시 */
type CaptionItem = { at: number; text?: string; endTurn?: boolean };

function liveUrl(): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/api/live`;
}

/** 웹캠 프레임 전송 주기 — 관상은 얼굴이 거의 정지라 2초면 충분하다 (프레임마다 과금) */
const FRAME_INTERVAL_MS = 2000;
const FRAME_WIDTH = 512;

/** 세션이 열리기 전에 손님이 한 말을 담아두는 한도 — 청크 128ms 기준 약 10초 */
const MIC_BUFFER_MAX = 80;

/** 이 시간 안에 서버의 ready 가 안 오면 실패로 본다 */
const CONNECT_TIMEOUT_MS = 20000;

/** 구두점·공백을 뺀 비교용 형태 — "어 여동생 있어?" 와 "어, 여동생 있어?" 를 같게 본다 */
function squash(text: string): string {
  return text.replace(/[\s.,!?~…·'"]/g, "");
}

/**
 * 자막 조각을 줄에 이어붙인 결과. 바뀔 게 없으면 null.
 *
 * Live API 는 같은 발화를 다듬어서 다시 보낸다 (구두점이 붙거나 단어가 바뀐다).
 * 오는 대로 이어붙이면 "안녕하세요.안녕하세요." 처럼 두 번 말한 것으로 보인다.
 *
 * 중복 판정은 "줄 전체" 또는 "직전 조각"과만 비교한다. 누적된 줄의 꼬리와
 * 비교하면 같은 낱말을 다시 쓰는 멀쩡한 조각("…이마는")까지 삼킨다.
 */
function mergeTranscript(line: Line, next: string): string | null {
  const a = squash(line.text);
  const b = squash(next);
  if (!b) return null;
  if (!a) return next;
  if (a === b) return next; // 같은 말의 다듬어진 판 → 통째로 교체
  if (b.startsWith(a)) return next; // 누적본이 통째로 다시 옴 → 교체
  if (b === squash(line.last)) return null; // 직전 조각이 그대로 또 옴
  return line.text + next; // 정상 증분
}

export function VoiceStudio() {
  /** 시연 모드 — 웹캠 대신 준비된 영상, Live 대신 대본 자막 (진입 시 1회 판정) */
  const [demo] = useState(isDemoMode);
  const [health, setHealth] = useState<Health | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  /** 말하는 중의 임시 자막 — 확정되면 lines 로 넘어간다 */
  const [interim, setInterim] = useState("");
  /** 관상가가 말하는 중 (재생 중) */
  const [speaking, setSpeaking] = useState(false);
  /** 서버가 손님 목소리를 잡고 있는 중 */
  const [hearing, setHearing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 서버가 준 원본 에러 전문 — 새 탭에서 보여준다 */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [chatText, setChatText] = useState("");

  const socketRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const stopMicRef = useRef<(() => void) | null>(null);
  const lineIdRef = useRef(0);

  const previewRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  /**
   * 지금 이어 쓰는 중인 줄의 id — 역할별로 따로 잡는다.
   * 손님 자막과 관상가 자막은 서로 끼어들며 오므로(순서 보장 없음) 마지막 줄 하나만
   * 보고 이어붙이면 한쪽 말이 다른 쪽 줄에 섞인다. null 이면 다음 조각이 새 줄을 연다.
   */
  const openLineRef = useRef<{ user: number | null; model: number | null }>({
    user: null,
    model: null,
  });
  // half-duplex — AI가 말하는(재생 중인) 동안엔 마이크를 서버로 안 보낸다 (스피커 에코 차단)
  const micOpenRef = useRef(true);
  const reopenTimerRef = useRef<number | null>(null);
  const pendingTextRef = useRef<string | null>(null);
  /** 서버의 ready 를 받았는가 — 그 전까지 마이크는 버퍼로 간다 */
  const readyRef = useRef(false);
  const micBufferRef = useRef<string[]>([]);
  const connectTimerRef = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const sendFrameRef = useRef<(() => void) | null>(null);
  /**
   * 관상가 자막은 소리보다 먼저 도착한다 (모델이 실시간보다 빨리 생성한다).
   * 그대로 띄우면 손님이 대사를 미리 읽고 먼저 답해버린다. 그래서 도착한 조각을
   * 여기 담아두고 재생 커서가 그 지점에 닿을 때 한 줄씩 푼다.
   */
  const captionQueueRef = useRef<CaptionItem[]>([]);
  const captionTimerRef = useRef<number | null>(null);
  /** 다음 자막 조각이 담당하는 소리가 시작되는 시각(초, AudioContext 기준) */
  const captionCursorRef = useRef(0);
  /** 시연 대본 재생 회차 — stop() 이 올리면 진행 중인 대본이 멈춘다 */
  const demoRunRef = useRef(0);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: Health) => setHealth(d))
      .catch(() =>
        setHealth({
          ready: false,
          mode: "unconfigured",
          detail: "서버에 연결하지 못했습니다",
        }),
      );
  }, []);

  // 페이지에 들어오면 웹캠을 바로 켠다 (미리보기만 — 전송은 시작 버튼 이후).
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        camStreamRef.current = stream;
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
          void previewRef.current.play().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setCamError("웹캠을 열 수 없습니다. 음성만으로도 진행됩니다.");
      });

    return () => {
      cancelled = true;
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    };
  }, [demo]);

  const stop = useCallback(() => {
    demoRunRef.current += 1;
    if (frameTimerRef.current !== null) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (reopenTimerRef.current !== null) {
      clearTimeout(reopenTimerRef.current);
      reopenTimerRef.current = null;
    }
    if (connectTimerRef.current !== null) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
    if (captionTimerRef.current !== null) {
      clearTimeout(captionTimerRef.current);
      captionTimerRef.current = null;
    }
    captionQueueRef.current = [];
    captionCursorRef.current = 0;
    micOpenRef.current = true;
    readyRef.current = false;
    micBufferRef.current = [];

    sendFrameRef.current = null;
    stopMicRef.current?.();
    stopMicRef.current = null;

    playerRef.current?.close();
    playerRef.current = null;

    socketRef.current?.close();
    socketRef.current = null;

    pendingTextRef.current = null;
    openLineRef.current = { user: null, model: null };
    setSpeaking(false);
    setHearing(false);
    setInterim("");
    setPhase("idle");
  }, []);

  // 페이지를 떠날 때 세션을 반드시 정리한다 (웹캠은 위 effect 가 따로 정리)
  useEffect(() => stop, [stop]);

  // 관상가 자막까지 들어오면서 줄이 빨리 쌓인다 — 항상 마지막 줄이 보이게 한다
  useEffect(() => {
    const box = transcriptRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [lines, interim]);

  /** 한 발화의 자막 조각들은 합쳐서 한 줄로, 턴이 바뀌면 새 줄로 시작한다 */
  function appendTranscript(role: "user" | "model", text: string) {
    const openId = openLineRef.current[role];

    if (openId === null) {
      lineIdRef.current += 1;
      const id = lineIdRef.current;
      openLineRef.current[role] = id;
      setLines((prev) => [...prev, { id, role, text, last: text }]);
      return;
    }

    setLines((prev) => {
      const index = prev.findIndex((line) => line.id === openId);
      if (index === -1) return prev;
      const merged = mergeTranscript(prev[index], text);
      if (merged === null || merged === prev[index].text) return prev;
      const next = [...prev];
      next[index] = { ...prev[index], text: merged, last: text };
      return next;
    });
  }

  /**
   * 웹캠 프레임을 다운스케일해서 JPEG 로 보낸다.
   *
   * 관상가가 말하는 동안에는 보내지 않는다. 두 가지 이유다.
   *  - 프레임은 지워지지 않고 계속 쌓인다(장당 258토큰). 관상가 발화 중의 프레임은
   *    판단에 쓰이지도 않으면서 비용과 문맥만 먹는다.
   *  - 쌓인 장수가 많을수록 "지금 손으로 가렸다"가 전체 중 한 장으로 묻힌다.
   *    듣는 동안에만 보내면 최근 몇 장이 곧 지금 자세가 된다.
   */
  function startFrameStreaming(socket: WebSocket) {
    const sendFrame = () => {
      const video = previewRef.current;
      if (!video || !video.videoWidth || socket.readyState !== WebSocket.OPEN) return;
      if (!micOpenRef.current) return;

      const canvas = document.createElement("canvas");
      canvas.width = FRAME_WIDTH;
      canvas.height = Math.round(video.videoHeight * (FRAME_WIDTH / video.videoWidth));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const url = canvas.toDataURL("image/jpeg", 0.6);
      socket.send(
        JSON.stringify({ type: "video", data: url.slice(url.indexOf(",") + 1) }),
      );
    };

    sendFrameRef.current = sendFrame;
    sendFrame();
    frameTimerRef.current = window.setInterval(sendFrame, FRAME_INTERVAL_MS);
  }

  function sendChat() {
    const text = chatText.trim();
    if (!text) return;
    setChatText("");

    // 채팅은 그 자체로 완결된 한 턴이다 — 줄을 새로 열고 바로 닫는다
    openLineRef.current.user = null;
    appendTranscript("user", text);
    openLineRef.current.user = null;

    if (readyRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "text", text }));
    } else {
      // 아직 세션이 준비되지 않았으면 담아뒀다가 ready 가 오면 보낸다
      pendingTextRef.current = text;
      if (phase === "idle") void start();
    }
  }

  /**
   * 시연 모드 — 서버 없이 guide.md 대본을 순서대로 흘린다 (음성 없음).
   * 관상가 줄은 실제 자막처럼 한 글자씩, 손님 줄은 "듣고 있습니다" 뒤에 한 번에 뜬다.
   */
  async function runDemo() {
    const run = ++demoRunRef.current;
    const alive = () => demoRunRef.current === run;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    setError(null);
    setNotice(null);
    setLines([]);
    setInterim("");
    setPhase("connecting");
    let script;
    try {
      [script] = await Promise.all([loadDemoVoiceScript(), wait(1200)]);
    } catch (err) {
      if (!alive()) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
      return;
    }
    if (!alive()) return;
    setPhase("live");

    for (const line of script) {
      await wait(line.pauseMs);
      if (!alive()) return;
      lineIdRef.current += 1;
      const id = lineIdRef.current;

      if (line.role === "user") {
        setHearing(true);
        await wait(900);
        if (!alive()) return;
        setHearing(false);
        setLines((prev) => [...prev, { id, role: "user", text: line.text, last: "" }]);
        continue;
      }

      setSpeaking(true);
      setLines((prev) => [...prev, { id, role: "model", text: "", last: "" }]);
      for (let i = 1; i <= line.text.length; i++) {
        await wait(DEMO_VOICE_CHAR_MS);
        if (!alive()) return;
        const text = line.text.slice(0, i);
        setLines((prev) => prev.map((l) => (l.id === id ? { ...l, text } : l)));
      }
      setSpeaking(false);
    }
  }

  async function start() {
    if (phase !== "idle") return;
    if (demo) {
      void runDemo();
      return;
    }
    setError(null);
    setNotice(null);
    setLines([]);
    setInterim("");
    setSpeaking(false);
    setHearing(false);
    openLineRef.current = { user: null, model: null };
    captionQueueRef.current = [];
    captionCursorRef.current = 0;
    micOpenRef.current = true;
    readyRef.current = false;
    micBufferRef.current = [];
    setPhase("connecting");

    const player = new PcmPlayer();
    playerRef.current = player;

    try {
      // 버튼 클릭(사용자 제스처) 안에서 열어야 자동재생 정책에 막히지 않는다
      await player.unlock();

      const socket = new WebSocket(liveUrl());
      socketRef.current = socket;

      /**
       * 큐 맨 앞 조각의 소리가 재생될 시각까지 기다렸다가 하나씩 푼다.
       * 조각의 at 은 단조증가하므로 앞에서부터 순서대로 나간다.
       */
      const pumpCaptions = () => {
        if (captionTimerRef.current !== null) return;
        const item = captionQueueRef.current[0];
        if (!item) return;

        const delay = Math.max(0, (item.at - player.now()) * 1000);
        captionTimerRef.current = window.setTimeout(() => {
          captionTimerRef.current = null;
          captionQueueRef.current.shift();
          if (item.text) appendTranscript("model", item.text);
          // 줄 닫기도 같이 미뤄야 한다 — 먼저 닫아버리면 늦게 풀린 조각이 새 줄을 연다
          if (item.endTurn) openLineRef.current.model = null;
          pumpCaptions();
        }, delay);
      };

      const clearCaptions = () => {
        if (captionTimerRef.current !== null) {
          clearTimeout(captionTimerRef.current);
          captionTimerRef.current = null;
        }
        captionQueueRef.current = [];
        captionCursorRef.current = 0;
      };

      // 재생 꼬리가 끝나면 마이크를 다시 연다. extra = turnComplete 후엔 짧게,
      // AI가 아직 말하는 중이면 넉넉히(turnComplete 신호가 안 와도 언젠간 열리도록).
      const scheduleMicReopen = (extraMs: number) => {
        if (reopenTimerRef.current !== null) clearTimeout(reopenTimerRef.current);
        reopenTimerRef.current = window.setTimeout(() => {
          micOpenRef.current = true;
          reopenTimerRef.current = null;
          setSpeaking(false);
          // 관상가가 말을 마쳤다. turnComplete 이 늦게 오거나 아예 안 오는 경우가
          // 있어서(SDK 주석: 모델이 재생 끝나기를 기다리느라 지연된다) 줄 닫기를
          // 거기에만 맡기면, 다음 턴의 자막이 앞 줄에 그대로 이어붙는다.
          openLineRef.current.model = null;
          // 말이 끝난 직후 자세가 판단 근거다 — 다음 주기를 기다리지 말고 지금 한 장 보낸다
          sendFrameRef.current?.();
          // 서버는 이 신호를 받고서야 침묵을 센다
          // (turnComplete 는 생성이 끝난 시점일 뿐, 소리는 아직 나오는 중이다).
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "playbackDone" }));
          }
        }, player.remainingMs() + extraMs);
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(String(event.data)) as ServerMessage;
        switch (msg.type) {
          case "ready": {
            // 여기서부터가 진짜 대화 가능 시점이다. 소켓만 열린 상태에서 live 로
            // 바꾸면, 아직 모델이 붙기 전이라 첫 인사가 허공에 흩어진다.
            readyRef.current = true;
            if (connectTimerRef.current !== null) {
              clearTimeout(connectTimerRef.current);
              connectTimerRef.current = null;
            }
            // 연결되는 동안 손님이 한 말을 이제 한꺼번에 올린다
            for (const data of micBufferRef.current) {
              socket.send(JSON.stringify({ type: "audio", data }));
            }
            micBufferRef.current = [];

            startFrameStreaming(socket);
            setPhase("live");

            if (pendingTextRef.current) {
              socket.send(
                JSON.stringify({ type: "text", text: pendingTextRef.current }),
              );
              pendingTextRef.current = null;
            }
            break;
          }
          case "audio":
            player.play(fromBase64(msg.data));
            // AI가 말하는 동안엔 마이크를 닫는다 (스피커 에코가 유령 입력으로 들어가는 것 방지).
            // audioStreamEnd 는 보내지 않는다 — "마이크가 꺼졌다"는 신호라 매 턴 오디오
            // 스트림이 끊겼다 다시 열리고, 그게 턴이 두 번 잡히는 원인이 된다.
            micOpenRef.current = false;
            setSpeaking(true);
            setHearing(false);
            scheduleMicReopen(5000);
            break;
          case "interrupted":
            // 예약된 소리를 버렸으니, 그 소리에 붙어 있던 자막도 같이 버린다
            player.flush();
            clearCaptions();
            openLineRef.current.model = null;
            if (reopenTimerRef.current !== null) {
              clearTimeout(reopenTimerRef.current);
              reopenTimerRef.current = null;
            }
            micOpenRef.current = true;
            setSpeaking(false);
            break;
          case "activity":
            // 서버가 손님 목소리를 잡았다/놓았다 — 마이크가 살아 있다는 유일한 확증
            setHearing(msg.state === "start");
            if (msg.state === "start") {
              // 새 발화가 시작됐다 — 손님 줄을 새로 연다 (관상가 줄은 그대로)
              openLineRef.current.user = null;
            } else {
              setInterim("");
            }
            break;
          case "transcript":
            if (msg.role === "model") {
              // 이 조각의 소리는 "직전 조각의 소리가 끝난 지점"에서 시작한다.
              // 지금까지 예약된 소리의 끝(endTime)이 곧 이 조각의 끝이다.
              captionQueueRef.current.push({
                at: Math.max(player.now(), captionCursorRef.current),
                text: msg.text,
              });
              captionCursorRef.current = player.endTime();
              pumpCaptions();
            } else if (msg.interim) {
              setInterim(msg.text);
            } else {
              // 손님 말은 이미 끝난 말이다 — 늦출 이유가 없다
              setInterim("");
              appendTranscript(msg.role, msg.text);
            }
            break;
          case "turnComplete":
            // 턴 경계 — 손님 줄은 바로 닫고, 관상가 줄은 남은 자막을 다 푼 뒤에 닫는다
            openLineRef.current.user = null;
            captionQueueRef.current.push({ at: player.endTime(), endTurn: true });
            pumpCaptions();
            setInterim("");
            scheduleMicReopen(250);
            break;
          case "error":
            setError(msg.message);
            setErrorDetail(msg.detail ?? null);
            stop();
            break;
          case "ended":
            setNotice(msg.message);
            stop();
            break;
        }
      };

      socket.onerror = () => {
        setError("음성 서버에 연결하지 못했습니다");
        setErrorDetail(
          "WebSocket 연결 실패 — /api/live\n" +
            "dev 서버가 떠 있는지, Live 프록시가 살아 있는지 확인하세요.",
        );
        stop();
      };
      socket.onclose = () => stop();

      connectTimerRef.current = window.setTimeout(() => {
        if (readyRef.current) return;
        setError("연결 시간이 초과되었습니다");
        setErrorDetail(
          `${CONNECT_TIMEOUT_MS / 1000}초 안에 Live 세션이 열리지 않았습니다 — /api/live\n` +
            "서버 로그에서 ai.live.connect 오류를 확인하세요.",
        );
        stop();
      }, CONNECT_TIMEOUT_MS);

      // 소켓 연결을 기다리지 않고 마이크를 먼저 연다. 세션이 열리기 전의 발화는
      // 버퍼에 쌓였다가 ready 와 함께 올라가므로, 연결 텀에 한 인사가 사라지지 않는다.
      stopMicRef.current = await startMicCapture((data) => {
        if (!micOpenRef.current) return;
        const live = socketRef.current;
        if (readyRef.current && live?.readyState === WebSocket.OPEN) {
          live.send(JSON.stringify({ type: "audio", data }));
          return;
        }
        const buffer = micBufferRef.current;
        buffer.push(data);
        if (buffer.length > MIC_BUFFER_MAX) buffer.shift();
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "마이크를 사용할 수 없습니다. 브라우저 권한을 확인해 주세요.",
      );
      setErrorDetail(err instanceof Error ? (err.stack ?? null) : String(err));
      stop();
    }
  }

  const micClass = [
    "mic",
    phase,
    speaking ? "speaking" : "",
    hearing ? "hearing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="studio audio">
      <header className="studio-header">
        <div className="panel-head">
          <span className="t">03 — Audio</span>
          <span className="c">Model — gemini-live-2.5-flash</span>
        </div>
        <h1>Voice Studio</h1>
        <p>실시간으로 대화하며 관상을 봐 주는 AI 관상가를 만나보세요</p>
      </header>

      {health && !health.ready && (
        <div className="banner banner-warn">
          <strong>인증이 설정되지 않았습니다.</strong> {health.detail}
        </div>
      )}

      {error && (
        <ErrorBanner
          message={error}
          detail={errorDetail}
          context="03 Voice Studio"
          onClose={() => {
            setError(null);
            setErrorDetail(null);
          }}
        />
      )}

      {notice && (
        <div className="banner banner-warn">
          {notice}
          <button
            type="button"
            className="banner-close"
            onClick={() => setNotice(null)}
          >
            ✕
          </button>
        </div>
      )}

      <section className="composer">
        <div className="voice-cam-wrap">
          {demo ? (
            // 시연 모드 — 세션이 열린 뒤에야 인물 영상이 뜬다 (실제로는 웹캠이 먼저 켜지지만
            // 촬영에서는 "시작 → 연결 → 화면 등장" 순서가 더 잘 읽힌다)
            phase === "live" ? (
              <video
                className="voice-cam demo"
                src={DEMO_VOICE_VIDEO}
                autoPlay
                loop
                playsInline
                muted
                onLoadedMetadata={(e) => {
                  e.currentTarget.defaultPlaybackRate = DEMO_VOICE_VIDEO_RATE;
                  e.currentTarget.playbackRate = DEMO_VOICE_VIDEO_RATE;
                }}
              />
            ) : (
              phase === "idle" && (
                <span className="voice-cam-empty">시작하면 카메라가 켜집니다</span>
              )
            )
          ) : (
            <video ref={previewRef} className="voice-cam" autoPlay playsInline muted />
          )}
          {phase === "connecting" && (
            <span className="voice-cam-badge pending">관상가를 부르는 중…</span>
          )}
          {phase === "live" && <span className="voice-cam-badge">● 관상 보는 중</span>}
        </div>
        {camError && <p className="person-cam-error">{camError}</p>}

        <div className={micClass}>
          <button
            type="button"
            className="mic-button"
            onClick={() => (phase === "idle" ? void start() : stop())}
            disabled={!demo && health?.ready === false}
          >
            {phase === "connecting" ? (
              <span className="spinner" aria-hidden />
            ) : phase === "live" ? (
              "■"
            ) : (
              "●"
            )}
          </button>
          <span className="mic-state">
            {phase === "idle" && "눌러서 관상 보기 시작"}
            {phase === "connecting" && "관상가를 부르는 중…"}
            {phase === "live" && speaking && "관상가가 말하는 중 — 잠시만 기다려 주세요"}
            {phase === "live" && !speaking && hearing && "듣고 있습니다…"}
            {phase === "live" &&
              !speaking &&
              !hearing &&
              (lines.length > 0
                ? "손님 차례입니다 — 편하게 대답해 주세요"
                : "관상가가 곧 말을 겁니다…")}
          </span>
          {phase === "idle" && (
            <span className="hint-note">
              버튼을 누르고 얼굴을 화면에 맞추면, 관상가가 먼저 말을 겁니다
            </span>
          )}
          {phase === "connecting" && (
            <span className="hint-note">
              지금 말을 거셔도 됩니다 — 연결되는 동안 한 말도 그대로 전달됩니다
            </span>
          )}
          {phase === "live" && (
            <span className="hint-note">세션은 5분 후 자동 종료됩니다</span>
          )}
        </div>

        <form
          className="chat-row"
          onSubmit={(e) => {
            e.preventDefault();
            sendChat();
          }}
        >
          <input
            type="text"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="채팅으로 물어보기 (예: 제 재물운은 어때요?)"
            disabled={health?.ready === false}
          />
          <button
            type="submit"
            disabled={!chatText.trim() || health?.ready === false}
          >
            보내기
          </button>
        </form>

        {(lines.length > 0 || interim) && (
          <div className="transcript" ref={transcriptRef}>
            {lines.map((line) => (
              <p key={line.id} className={`line ${line.role}`}>
                <span className="who">
                  {line.role === "user" ? "나" : "관상가"}
                </span>
                {line.text}
              </p>
            ))}
            {interim && (
              <p className="line user interim">
                <span className="who">나</span>
                {interim}
              </p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
