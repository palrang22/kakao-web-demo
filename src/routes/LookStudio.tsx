import { useEffect, useRef, useState } from "react";
import { DownloadQr } from "../components/DownloadQr.tsx";
import { PersonPicker } from "../components/PersonPicker.tsx";
import {
  attachmentFromBase64,
  attachmentFromUrl,
  readAsAttachment,
  type Attachment,
} from "../lib/image.ts";
import {
  GARMENT_SECTIONS,
  MAX_GARMENTS,
  type Garment,
} from "../lib/garments.ts";
import { ErrorBanner } from "../components/ErrorBanner.tsx";
import "../styles/studio.css";

type Health = {
  ready: boolean;
  mode: "vertex" | "apikey" | "unconfigured";
  detail: string;
};

type ResultImage = {
  data: string;
  mimeType: string;
  downloadUrl?: string;
  downloadError?: string;
};

/** 선택한 의상 한 벌. key 로 샘플 중복 선택·해제를 판단한다 (샘플=garment id, 업로드=`upload:<id>`) */
type Picked = { key: string; att: Attachment };

const dataUrl = (img: ResultImage) => `data:${img.mimeType};base64,${img.data}`;

/** 선택한 의상 미리보기 (0~2벌) — 인물 옆 칸 */
function ChosenGarments({
  picked,
  onRemove,
  disabled,
}: {
  picked: Picked[];
  onRemove: (key: string) => void;
  disabled: boolean;
}) {
  return (
    <div className={picked.length ? "slot filled" : "slot"}>
      <span className="slot-label">의상 · {picked.length}/{MAX_GARMENTS}</span>
      {picked.length === 0 ? (
        <p className="garment-empty">
          아래에서 의상을 고르세요
          <br />
          <span>상의·하의·원피스 중 한 벌</span>
        </p>
      ) : (
        <div className="garment-chosen-grid" data-count={picked.length}>
          {picked.map((p) => (
            <div key={p.key} className="garment-chosen-item">
              <img src={p.att.preview} alt={p.att.name} />
              <button
                type="button"
                className="slot-clear"
                onClick={() => onRemove(p.key)}
                disabled={disabled}
                aria-label={`${p.att.name} 제거`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 샘플 의상 고르기 — 폴더별 섹션, 세로 스크롤, 최대 2벌 + 직접 올리기 */
function GarmentPicker({
  selectedKeys,
  full,
  onToggle,
  onUpload,
  disabled,
}: {
  selectedKeys: Set<string>;
  full: boolean;
  onToggle: (g: Garment) => void;
  onUpload: (file: File) => void;
  disabled: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="garment-picker">
      <div className="garment-picker-head">
        <span>샘플 의상에서 고르기</span>
        <button
          type="button"
          className="garment-upload"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || full}
        >
          ＋ 직접 올리기
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
      </div>

      {full && <p className="garment-note">한 벌만 선택할 수 있어요. 바꾸려면 선택을 해제하세요</p>}

      <div className="garment-scroll">
        {GARMENT_SECTIONS.map((sec) => (
          <section key={sec.id} className="garment-section">
            <h4>{sec.label}</h4>
            <div className="garment-grid">
              {sec.items.map((g) => {
                const on = selectedKeys.has(g.id);
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={on ? "garment-cell on" : "garment-cell"}
                    onClick={() => {
                      setErr(null);
                      onToggle(g);
                    }}
                    disabled={disabled || (!on && full)}
                    aria-pressed={on}
                    title={g.label}
                  >
                    <img
                      src={g.src}
                      alt={g.label}
                      loading="lazy"
                      decoding="async"
                      onError={() =>
                        setErr(`${g.label} 이미지를 불러오지 못했습니다 (${g.src})`)
                      }
                    />
                    {on && <span className="garment-check">✓</span>}
                    <span className="garment-label">{g.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {err && <p className="person-cam-error">{err}</p>}
    </div>
  );
}

export function LookStudio() {
  const [health, setHealth] = useState<Health | null>(null);
  const [person, setPerson] = useState<Attachment | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [results, setResults] = useState<ResultImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** 서버가 준 원본 에러 전문 — 새 탭에서 보여준다 */
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const composerRef = useRef<HTMLElement>(null);

  const selectedKeys = new Set(picked.map((p) => p.key));
  const full = picked.length >= MAX_GARMENTS;
  const ready = Boolean(person) && picked.length >= 1 && !busy;

  function removeGarment(key: string) {
    setPicked((prev) => prev.filter((p) => p.key !== key));
  }

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

  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [busy]);

  /** 샘플 의상 토글 — 이미 선택돼 있으면 해제, 아니면 (2벌 미만일 때) 추가 */
  async function toggleGarment(g: Garment) {
    if (picked.some((p) => p.key === g.id)) {
      removeGarment(g.id);
      return;
    }
    if (picked.length >= MAX_GARMENTS) return;
    try {
      const att = await attachmentFromUrl(g.src, g.label);
      setPicked((prev) =>
        prev.some((p) => p.key === g.id) || prev.length >= MAX_GARMENTS
          ? prev
          : [...prev, { key: g.id, att }],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function uploadGarment(file: File) {
    if (picked.length >= MAX_GARMENTS) return;
    try {
      const att = await readAsAttachment(file);
      setPicked((prev) =>
        prev.length >= MAX_GARMENTS
          ? prev
          : [...prev, { key: `upload:${att.id}`, att }],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setErrorDetail(err instanceof Error ? (err.stack ?? null) : String(err));
    }
  }

  /** 방금 만든 결과를 인물 사진으로 되돌려, 그 위에 다른 옷을 이어서 입힌다 */
  function continueFrom(img: ResultImage) {
    setPerson(attachmentFromBase64(img.data, img.mimeType, "직전 결과.png"));
    setPicked([]);
    setResults([]);
    setError(null);
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submit() {
    if (!person || picked.length < 1 || busy) return;
    setError(null);
    setElapsed(0);
    setBusy(true);

    try {
      // 01번과 달리 LRO 가 아니라 동기 호출이다 — 잡 폴링 없이 응답을 기다린다
      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person: { data: person.data, mimeType: person.mimeType },
          products: picked.map((p) => ({
            data: p.att.data,
            mimeType: p.att.mimeType,
          })),
        }),
      });

      const data = (await res.json()) as {
        images?: ResultImage[];
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.images?.length) {
        setErrorDetail(data.detail ?? null);
        throw new Error(data.error ?? "요청이 거부되었습니다");
      }
      setResults(data.images);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="studio image">
      <header className="studio-header">
        <div className="panel-head">
          <span className="t">02 — Image</span>
          <span className="c">Model — virtual-try-on-001</span>
        </div>
        <h1>Look Studio</h1>
        <p>샘플 인물이나 내 사진에 원하는 의상을 입혀보세요</p>
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
          context="02 Look Studio"
          onClose={() => {
            setError(null);
            setErrorDetail(null);
          }}
        />
      )}

      {results.length > 0 && (
        <section className="results">
          <p className="results-hint">
            완성된 착장이에요. 마음에 들면 이 결과에 다른 옷을 이어서 입혀볼 수 있어요.
          </p>
          {results.map((img, i) => (
            <article key={i} className="result">
              <img src={dataUrl(img)} alt={`합성 결과 ${i + 1}`} />
              <div className="turn-actions">
                <button
                  type="button"
                  className="continue-btn"
                  onClick={() => continueFrom(img)}
                >
                  ↩ 이 사진으로 계속하기
                </button>
                <a
                  className="result-dl"
                  href={dataUrl(img)}
                  download={`look-${i + 1}.png`}
                >
                  ⬇ 내 PC에 다운로드
                </a>
                <DownloadQr
                  url={img.downloadUrl}
                  error={img.downloadError}
                  context="02 Look Studio · QR"
                />
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="composer" ref={composerRef}>
        <div className="slots">
          <PersonPicker
            value={person}
            onPick={setPerson}
            onClear={() => setPerson(null)}
            disabled={busy}
          />
          <span className="slot-plus" aria-hidden="true">+</span>
          <ChosenGarments
            picked={picked}
            onRemove={removeGarment}
            disabled={busy}
          />
        </div>

        <GarmentPicker
          selectedKeys={selectedKeys}
          full={full}
          onToggle={(g) => void toggleGarment(g)}
          onUpload={(f) => void uploadGarment(f)}
          disabled={busy}
        />

        <div className="controls">
          <button
            type="button"
            className="primary"
            onClick={() => void submit()}
            disabled={!ready}
          >
            {busy ? "합성 중…" : "입혀보기"}
          </button>
        </div>

        {busy && (
          <div className="progress">
            <span className="spinner" />
            <span>이미지 합성 중</span>
            <span className="elapsed">{elapsed}초 경과</span>
          </div>
        )}
      </section>
    </main>
  );
}
