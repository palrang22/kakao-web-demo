import { useCallback, useEffect, useRef, useState } from "react";
import { DownloadQr } from "../components/DownloadQr.tsx";
import { PersonPicker } from "../components/PersonPicker.tsx";
import {
  attachmentFromUrl,
  readAsAttachment,
  type Attachment,
} from "../lib/image.ts";
import { CONCEPTS, type Concept } from "../lib/concepts.ts";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import "../styles/studio.css";

type JobStatus = "queued" | "running" | "completed" | "error";

type Job = {
  id: string;
  status: JobStatus;
  stage: string;
  createdAt: number;
  completedAt?: number;
  videoUrl?: string;
  downloadUrl?: string;
  downloadError?: string;
  interactionId?: string;
  /** 장면 확장 체인 전체 길이(초). 서버가 계산해서 내려준다 */
  totalSeconds?: number;
  error?: string;
  errorDetail?: string;
};

/** 생성 결과 한 건 = 프롬프트 하나 + 그 결과 영상 */
type Turn = {
  interactionId: string;
  prompt: string;
  videoUrl: string;
  downloadUrl?: string;
  downloadError?: string;
  /** 이 영상까지의 누적 길이(초) */
  totalSeconds: number;
};

type Health = {
  ready: boolean;
  mode: "vertex" | "apikey" | "unconfigured";
  detail: string;
  /** 서버가 실제로 호출하는 모델 ID. Vertex 와 API 키가 서로 다르다 */
  model?: string;
};

const ASPECT_RATIOS = ["16:9", "9:16"] as const;
/** 입력 이미지 장수 상한 — server/api.ts 의 MAX_IMAGES 와 같은 값 */
const MAX_IMAGES = 10;
/**
 * 장면 확장 상한. Omni 1.1 은 previous_interaction_id 로 앞 영상에 이어 붙이는데
 * 한 체인의 누적 길이가 40초를 넘을 수 없다 (한 번에 3~10초씩).
 */
const MAX_TOTAL_SECONDS = 40;
const MIN_DURATION = 3;
const RESOLUTIONS = ["360p", "720p", "1080p"] as const;

/**
 * 해상도별 초당 단가(USD).
 *
 * 출력 토큰이 해상도마다 다르다 — 360p 1,931 / 720p 5,792 / 1080p 8,688 토큰/초.
 * 720p 실측가 $0.10/초를 기준으로 토큰 비율만큼 환산한 값이다.
 * 정확한 청구액은 콘솔에서 확인할 것. 4k(17,376 토큰/초, 약 $0.30)는 부스에서
 * 비용이 튀므로 선택지에 넣지 않았다.
 */
const PRICE_PER_SECOND: Record<string, number> = {
  "360p": 0.033,
  "720p": 0.1,
  "1080p": 0.15,
};

const priceFor = (resolution: string, seconds: number) =>
  seconds * (PRICE_PER_SECOND[resolution] ?? 0.1);

/** 길이 슬라이더 라벨 — 확장 모드면 붙인 뒤 총 길이도 같이 보여준다 */
function extendSuffix(extendFrom: Turn | null, duration: number): string {
  if (!extendFrom) return `길이 ${duration}초`;
  return `길이 ${duration}초 (총 ${extendFrom.totalSeconds + duration}초)`;
}

/** 컨셉 선택 — 버튼을 누르면 프롬프트가 채워지고, 참조 이미지가 있으면 함께 첨부된다 */
function ConceptPicker({
  activeId,
  bgImages,
  outfitSrc,
  outfitImage,
  onPick,
  onPickOutfit,
  onClear,
  disabled,
}: {
  activeId: string | null;
  /** 컨셉 배경 참조 이미지들 (미리보기는 첫 장) */
  bgImages: Attachment[];
  /** 선택된 옷 사진 경로 */
  outfitSrc: string | null;
  /** 선택된 옷 이미지 (로드 완료된 것) */
  outfitImage: Attachment | null;
  onPick: (c: Concept) => void;
  onPickOutfit: (src: string) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  if (!activeId) {
    return (
      <div className="slot">
        <span className="slot-label">컨셉</span>
        <div className="person-choices">
          {CONCEPTS.map((c) => (
            <button
              key={c.id}
              type="button"
              className="person-choice"
              onClick={() => onPick(c)}
              disabled={disabled}
            >
              <span className="ico">{c.icon}</span>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const c = CONCEPTS.find((x) => x.id === activeId);
  const outfits = c?.outfits ?? [];

  return (
    <div className="slot filled">
      <span className="slot-label">{c?.label}</span>

      {outfits.length >= 2 ? (
        <div className="concept-outfits">
          <p className="concept-outfits-hint">의상을 선택하세요</p>
          <div className="concept-outfit-grid">
            {outfits.map((src, i) => (
              <button
                key={src}
                type="button"
                className={src === outfitSrc ? "concept-outfit on" : "concept-outfit"}
                onClick={() => onPickOutfit(src)}
                disabled={disabled}
                aria-pressed={src === outfitSrc}
              >
                <img
                  src={src}
                  alt={`옷 ${i + 1}`}
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
                {src === outfitSrc && <span className="garment-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      ) : outfitImage ? (
        <img src={outfitImage.preview} alt="" />
      ) : bgImages[0] ? (
        <img src={bgImages[0].preview} alt={c?.label ?? ""} />
      ) : (
        <p className="garment-empty">
          프롬프트를 채웠어요
          <br />
          <span>컨셉 이미지는 준비되면 함께 적용돼요</span>
        </p>
      )}

      <button
        type="button"
        className="slot-clear"
        onClick={onClear}
        disabled={disabled}
        aria-label="컨셉 해제"
      >
        ✕
      </button>
    </div>
  );
}

export function MotionStudio() {
  const [health, setHealth] = useState<Health | null>(null);
  const [prompt, setPrompt] = useState("");
  const [person, setPerson] = useState<Attachment | null>(null);
  const [conceptId, setConceptId] = useState<string | null>(null);
  /** 컨셉 배경 참조 이미지 (여러 장 가능) */
  const [conceptImages, setConceptImages] = useState<Attachment[]>([]);
  /** 선택한 옷 사진 경로 / 로드된 이미지 */
  const [outfitSrc, setOutfitSrc] = useState<string | null>(null);
  const [outfitImage, setOutfitImage] = useState<Attachment | null>(null);
  /** 확장 모드에서 "새로 등장시킬 대상" 사진 */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [aspectRatio, setAspectRatio] = useState<string>("9:16");
  const [resolution, setResolution] = useState<string>("720p");
  const [duration, setDuration] = useState(10);

  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 서버가 준 원본 에러 전문 — 새 탭에서 보여준다 */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [history, setHistory] = useState<Turn[]>([]);
  /** 값이 있으면 새 영상이 아니라 그 영상을 이어서 늘리는 모드다 */
  const [extendFrom, setExtendFrom] = useState<Turn | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = job?.status === "queued" || job?.status === "running";

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

  // 진행 중일 때만 경과 시간을 센다. job.createdAt 은 폴링 사이에도 안 바뀌므로
  // 의존성으로 써도 인터벌이 매번 재생성되지 않는다.
  const startedAt = job?.createdAt;
  useEffect(() => {
    if (!busy || !startedAt) return;
    const tick = () => setElapsed(Math.round((Date.now() - startedAt) / 1000));
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [busy, startedAt]);

  // 잡 상태 폴링 — 완료/실패면 멈춘다
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`);
        const next = (await res.json()) as Job;
        if (cancelled) return;

        setJob(next);

        if (
          next.status === "completed" &&
          next.videoUrl &&
          next.interactionId
        ) {
          setHistory((prev) => [
            ...prev,
            {
              interactionId: next.interactionId!,
              prompt,
              videoUrl: next.videoUrl!,
              downloadUrl: next.downloadUrl,
              downloadError: next.downloadError,
              totalSeconds: next.totalSeconds ?? 0,
            },
          ]);
          setPrompt("");
          setPerson(null);
          setConceptId(null);
          setConceptImages([]);
          setOutfitSrc(null);
          setOutfitImage(null);
          setAttachments([]);
          setExtendFrom(null);
        } else if (next.status === "error") {
          setError(next.error ?? "알 수 없는 오류");
          setErrorDetail(next.errorDetail ?? null);
        }
      } catch {
        if (!cancelled) {
          setError("서버와 통신하지 못했습니다");
          setErrorDetail("폴링 요청이 실패했습니다. dev 서버가 떠 있는지 확인하세요.");
        }
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job, prompt]);

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const next = await Promise.all(
        Array.from(files)
          .filter((f) => f.type.startsWith("image/"))
          .map(readAsAttachment),
      );
      setAttachments((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorDetail(err instanceof Error ? (err.stack ?? null) : String(err));
    }
  }, []);

  /** 컨셉 버튼 — 프롬프트를 채우고, 배경 이미지·옷을 준비한다 */
  async function pickConcept(c: Concept) {
    setConceptId(c.id);
    setPrompt(c.prompt);
    setConceptImages([]);
    setOutfitSrc(null);
    setOutfitImage(null);
    if (c.aspectRatio) setAspectRatio(c.aspectRatio);

    // 옷이 딱 1벌이면 자동 선택. 2벌 이상은 컨셉 칸에서 고른다.
    const outfits = c.outfits ?? [];
    if (outfits.length === 1) void pickOutfit(outfits[0]);

    // 배경 이미지들을 불러온다. 아직 파일이 없으면 그냥 건너뛴다 (에러 아님).
    const settled = await Promise.allSettled(
      (c.refImages ?? []).map((src) => attachmentFromUrl(src, c.label)),
    );
    setConceptImages(
      settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
    );
  }

  /** 컨셉 칸에서 옷 사진을 고른다 */
  async function pickOutfit(src: string) {
    setOutfitSrc(src);
    try {
      setOutfitImage(await attachmentFromUrl(src, "옷"));
    } catch {
      // 옷 파일이 아직 없으면 경로만 표시 (에러 아님)
      setOutfitImage(null);
    }
  }

  function clearConcept() {
    setConceptId(null);
    setConceptImages([]);
    setOutfitSrc(null);
    setOutfitImage(null);
    setPrompt("");
  }

  /** 확장 모드에서 이번 호출에 쓸 수 있는 최대 길이(초) */
  const remainingSeconds = extendFrom
    ? MAX_TOTAL_SECONDS - extendFrom.totalSeconds
    : 10;
  const maxDuration = Math.min(10, remainingSeconds);

  /** 그 영상을 이어서 늘리는 모드로 전환한다 */
  function startExtend(turn: Turn) {
    setExtendFrom(turn);
    // 앞 장면에 쓴 인물·컨셉은 비운다. 확장에서 넣는 사진은 "새로 등장시킬 대상"이라
    // 역할이 다르다 (문서 「Extending with reference media」).
    setPerson(null);
    setConceptId(null);
    setConceptImages([]);
    setOutfitSrc(null);
    setOutfitImage(null);
    setAttachments([]);
    setPrompt("");
    // 남은 길이보다 긴 값이 슬라이더에 남아 있으면 서버가 거부한다
    setDuration((d) =>
      Math.min(d, Math.min(10, MAX_TOTAL_SECONDS - turn.totalSeconds)),
    );
  }

  async function submit() {
    if (!prompt.trim() || busy) return;
    setError(null);

    // 확장 모드 = 새 캐릭터 사진(attachments).
    // 일반 모드 = 인물 + 옷 + 컨셉 배경 (순서 = 프롬프트 「인물이 옷을 입고 배경에서」).
    const images = extendFrom
      ? attachments
      : [person, outfitImage, ...conceptImages].filter(
          (a): a is Attachment => Boolean(a),
        );

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          images: images.map(({ data, mimeType }) => ({ data, mimeType })),
          aspectRatio,
          resolution,
          durationSeconds: duration,
          // 확장 모드면 앞 영상 뒤에 이어 붙인다
          previousInteractionId: extendFrom?.interactionId,
        }),
      });

      const data = (await res.json()) as {
        jobId?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.jobId) {
        setErrorDetail(data.detail ?? null);
        throw new Error(data.error ?? "요청이 거부되었습니다");
      }

      setJob({
        id: data.jobId,
        status: "queued",
        stage: "대기 중",
        createdAt: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="studio video">
      <header className="studio-header">
        <div className="panel-head">
          <span className="t">01 — Video</span>
          <span className="c">Model — {health?.model ?? "gemini-omni-1.1-flash"}</span>
        </div>
        <h1>Motion Studio</h1>
        <p>
          컨셉을 고르거나 프롬프트를 입력해 3~10초짜리 숏폼 비디오를 생성합니다.<br />생성된 영상은 최대 40초까지 이어 붙일 수 있습니다.
        </p>
      </header>

      {health && !health.ready && (
        <div className="banner banner-warn">
          <strong>인증이 설정되지 않았습니다.</strong> {health.detail}
          <br />
          <code>.env.example</code> 를 참고해 <code>.env.local</code> 을 만든 뒤{" "}
          <code>pnpm dev</code> 를 재시작하세요.
        </div>
      )}

      {error && (
        <ErrorBanner
          message={error}
          detail={errorDetail}
          context="01 Motion Studio"
          onClose={() => {
            setError(null);
            setErrorDetail(null);
          }}
        />
      )}

      {history.length > 0 && (
        <section className="timeline">
          {history.map((turn, i) => (
            <article key={turn.interactionId} className="turn">
              <div className="turn-meta">
                <span className="turn-index">#{i + 1}</span>
                <p>{turn.prompt}</p>
                {turn.totalSeconds > 0 && (
                  <span className="turn-length">
                    {turn.totalSeconds}초 / {MAX_TOTAL_SECONDS}초
                  </span>
                )}
              </div>
              <video
                src={turn.videoUrl}
                controls
                playsInline
                className="turn-video"
              />
              <div className="turn-actions">
                <a href={turn.videoUrl} download>
                  ⬇ 다운로드
                </a>
                {MAX_TOTAL_SECONDS - turn.totalSeconds >= MIN_DURATION ? (
                  <button
                    type="button"
                    className="extend-cta"
                    onClick={() => startExtend(turn)}
                    disabled={busy}
                  >
                    ⏵ 이어서 늘리기
                  </button>
                ) : (
                  <span className="turn-maxed">최대 길이 도달</span>
                )}
                <code>{turn.interactionId}</code>
                <DownloadQr
                  url={turn.downloadUrl}
                  error={turn.downloadError}
                  context="01 Motion Studio · QR"
                />
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="composer">
        {extendFrom && (
          <div className="extend-bar">
            <span>
              <strong>이어서 늘리기</strong> — {extendFrom.totalSeconds}초 영상
              뒤에 붙입니다 (남은 길이 {remainingSeconds}초)
            </span>
            <button type="button" onClick={() => setExtendFrom(null)}>
              ✕ 새 영상으로
            </button>
          </div>
        )}

        {extendFrom ? (
          <>
            <div className="composer-attach">
              <span className="hint">
                이어질 장면을 설명하세요. 사진을 넣으면 새 인물·사물을 등장시킬 수 있습니다
              </span>
              <button
                type="button"
                className="attach-cta"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy || attachments.length >= MAX_IMAGES}
              >
                🖼 사진 추가{" "}
                {attachments.length > 0 && `(${attachments.length}/${MAX_IMAGES})`}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {attachments.length > 0 && (
              <div className="attachments">
                {attachments.map((a) => (
                  <div key={a.id} className="attachment">
                    <img src={a.preview} alt={a.name} />
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((p) => p.filter((x) => x.id !== a.id))
                      }
                      aria-label={`${a.name} 제거`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="slots">
            <PersonPicker
              value={person}
              onPick={setPerson}
              onClear={() => setPerson(null)}
              disabled={busy}
            />
            <span className="slot-plus" aria-hidden="true">+</span>
            <ConceptPicker
              activeId={conceptId}
              bgImages={conceptImages}
              outfitSrc={outfitSrc}
              outfitImage={outfitImage}
              onPick={(c) => void pickConcept(c)}
              onPickOutfit={(src) => void pickOutfit(src)}
              onClear={clearConcept}
              disabled={busy}
            />
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder={extendFrom ? "이어서 어떤 장면이 나올지 설명하세요." : "컨셉을 고르거나, 직접 입력하세요."}
          rows={3}
          disabled={busy}
        />

        <div className="controls">
          <label>
            <span>비율</span>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              /* 확장은 원본 화면비를 따라가므로 고를 수 없다 */
              disabled={busy || Boolean(extendFrom)}
            >
              {ASPECT_RATIOS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>해상도</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              disabled={busy}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="duration">
            <span>
              {extendSuffix(extendFrom, duration)}
            </span>
            <input
              type="range"
              min={MIN_DURATION}
              max={maxDuration}
              value={Math.min(duration, maxDuration)}
              onChange={(e) => setDuration(Number(e.target.value))}
              disabled={busy}
            />
          </label>

          <span className="cost">
            ≈ ${priceFor(resolution, duration).toFixed(2)}
          </span>

          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={busy || !prompt.trim()}
          >
            {busy ? "생성 중…" : extendFrom ? "이어 붙이기" : "생성"}
          </button>
        </div>

        {busy && (
          <div className="progress">
            <span className="spinner" />
            <span>{job?.stage}</span>
            <span className="elapsed">{elapsed}초 경과</span>
          </div>
        )}
      </section>
    </main>
  );
}
