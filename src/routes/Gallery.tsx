import { useCallback, useEffect, useMemo, useState, type AnimationEvent } from "react";
import { ArrowIcon } from "../components/Icons.tsx";
import { openErrorReport } from "../lib/errorReport.ts";
import "../styles/studio.css";

/**
 * Media Gallery (§4) — 부스에서 사람들이 만든 01·02 결과물이 슬라이드쇼로 넘어간다.
 * 좌하단 레일의 갤러리 아이콘 → 관리자 비밀번호(`AdminGate`) 통과 후 진입.
 *
 * 소스는 배포 버킷(`gs://.../output`). `GET /api/gallery` 가 서명 URL + 생성시각을
 * 최신순으로 준다. 부스 운영 중 새 결과가 쌓이므로 주기적으로 다시 불러온다.
 * 현재 보고 있는 항목은 인덱스가 아니라 오브젝트 경로로 추적한다 — 목록이
 * 갱신돼도(새 결과 추가·삭제) 화면이 튀지 않게.
 */
type GalleryItem = {
  object: string;
  type: "image" | "video";
  url: string;
  createdAt: number;
};

const POLL_MS = 45_000;
const IMAGE_MS = 5_000;
/** 영상은 onEnded 로 넘어가지만, 로드 실패 등으로 안 끝날 때를 위한 안전장치 */
const VIDEO_FALLBACK_MS = 40_000;
/** 마우스가 멈추면 하단 바를 숨기기까지 */
const BAR_HIDE_MS = 3_000;

export function Gallery() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [note, setNote] = useState<string | null>(null);
  /** 서버가 준 원본 에러 전문 — "오류 보기" 가 새 탭에 띄운다 */
  const [detail, setDetail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [currentObject, setCurrentObject] = useState<string | null>(null);
  const [barShown, setBarShown] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** 삭제 확인 중인 오브젝트 경로 (null 이면 확인창 닫힘) */
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);

  // 진입 시 1회 + 부스 운영 중 쌓이는 새 결과를 위해 주기적으로 다시 불러온다
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch("/api/gallery")
        .then((r) => r.json())
        .then(
          (data: {
            items?: GalleryItem[];
            note?: string;
            detail?: string;
            error?: string;
          }) => {
            if (!alive) return;
            setItems(data.items ?? []);
            // 400 이면 { error, detail }, 정상인데 비었으면 { note, detail? }
            setNote(data.note ?? data.error ?? null);
            setDetail(data.detail ?? null);
            setLoaded(true);
          },
        )
        .catch((err: unknown) => {
          if (!alive) return;
          setNote("갤러리 목록을 불러오지 못했습니다.");
          setDetail(err instanceof Error ? (err.stack ?? err.message) : String(err));
          setLoaded(true);
        });
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // 저장해 둔 오브젝트가 목록에서 사라졌으면(삭제 등) 첫 항목으로 떨어진다.
  // 인덱스 동기화 effect 없이 렌더 시점에 계산한다.
  const current = useMemo(
    () =>
      (currentObject && items.find((i) => i.object === currentObject)) ||
      items[0] ||
      null,
    [items, currentObject],
  );
  const pos = current ? items.findIndex((i) => i.object === current.object) : -1;

  // 크로스페이드용 레이어 스택. 항상 [떠나는 것?, 현재] 최대 2장.
  // 현재가 바뀌면 새 레이어를 앞에 얹고, 전환이 끝나면(settle) 뒤 레이어를 버린다.
  // current 변화에 맞춰 렌더 중 조정 — effect 안 setState 를 피한다 (React 권장 패턴).
  const [layers, setLayers] = useState<GalleryItem[]>([]);
  const [shownObject, setShownObject] = useState<string | null>(null);
  if (current && current.object !== shownObject) {
    setShownObject(current.object);
    setLayers((prev) => {
      const last = prev[prev.length - 1];
      if (last?.object === current.object) return prev;
      return last ? [last, current] : [current];
    });
  }
  const settle = useCallback((e: AnimationEvent) => {
    // 레이어 자신의 크로스페이드가 끝났을 때만 — 안쪽 미디어의 켄번스는 무시
    if (e.target !== e.currentTarget) return;
    setLayers((prev) => prev.slice(-1));
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (items.length < 2) return;
      const at = current ? items.findIndex((i) => i.object === current.object) : 0;
      const to = (at + dir + items.length) % items.length;
      setCurrentObject(items[to]?.object ?? null);
    },
    [items, current],
  );
  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  // 자동 넘김 — 이미지 5초, 영상은 onEnded(+ 안전 타임아웃). 삭제 확인 중엔 멈춘다.
  useEffect(() => {
    if (items.length < 2 || !current || confirmTarget) return;
    const ms = current.type === "image" ? IMAGE_MS : VIDEO_FALLBACK_MS;
    const t = setTimeout(next, ms);
    return () => clearTimeout(t);
  }, [current, items.length, next, confirmTarget]);

  // 마우스를 움직이면 하단 바가 올라오고, 멈추면 다시 숨는다
  useEffect(() => {
    let t: number | undefined;
    const onMove = () => {
      setBarShown(true);
      window.clearTimeout(t);
      t = window.setTimeout(() => setBarShown(false), BAR_HIDE_MS);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.clearTimeout(t);
    };
  }, []);

  async function confirmDelete() {
    const removed = confirmTarget;
    if (!removed || deleting) return;
    const at = items.findIndex((i) => i.object === removed);
    setDeleting(true);
    try {
      await fetch(`/api/gallery?object=${encodeURIComponent(removed)}`, {
        method: "DELETE",
      });
      const rest = items.filter((i) => i.object !== removed);
      setItems(rest);
      setCurrentObject(rest[Math.min(Math.max(at, 0), rest.length - 1)]?.object ?? null);
    } catch {
      // 무시 — 다음 폴링에서 반영된다
    } finally {
      setDeleting(false);
      setConfirmTarget(null);
    }
  }

  return (
    <main className="studio gallery">
      {!loaded ? (
        <div className="gallery-msg">
          <p>불러오는 중…</p>
        </div>
      ) : !items.length ? (
        <div className="gallery-msg">
          <p>아직 전시할 사진·영상이 없습니다.</p>
          {note && <p className="gallery-note">{note}</p>}
          {detail && (
            <button
              type="button"
              className="banner-detail"
              onClick={() =>
                openErrorReport(
                  "Media Gallery",
                  note ?? "갤러리 로드 실패",
                  detail,
                )
              }
            >
              🔎 오류 보기
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="gallery-stage">
            {layers.map((item, i) => {
              const front = i === layers.length - 1;
              return (
                <div
                  key={item.object}
                  className={`gallery-layer ${front ? "front" : "back"}`}
                  onAnimationEnd={front ? settle : undefined}
                >
                  {item.type === "video" ? (
                    <video
                      className="gallery-media"
                      src={item.url}
                      autoPlay
                      muted
                      playsInline
                      onEnded={front ? next : undefined}
                      onError={front ? next : undefined}
                    />
                  ) : (
                    <img
                      className="gallery-media"
                      src={item.url}
                      alt=""
                      onError={front ? next : undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {items.length > 1 && (
            <>
              <button
                type="button"
                className={barShown ? "gallery-nav prev on" : "gallery-nav prev"}
                onClick={prev}
                aria-label="이전"
              >
                <ArrowIcon />
              </button>
              <button
                type="button"
                className={barShown ? "gallery-nav next on" : "gallery-nav next"}
                onClick={next}
                aria-label="다음"
              >
                <ArrowIcon />
              </button>
            </>
          )}

          <div className={barShown ? "gallery-bar on" : "gallery-bar"}>
            <span className="gallery-count">
              {pos + 1} / {items.length}
            </span>
            <span className="gallery-kind">
              {current?.type === "video" ? "영상 · Motion" : "이미지 · Look"}
            </span>
            <span className="gallery-when">
              {current?.createdAt
                ? new Date(current.createdAt).toLocaleString("ko-KR")
                : ""}
            </span>
            <button
              type="button"
              className="gallery-del"
              onClick={() => current && setConfirmTarget(current.object)}
              disabled={deleting}
            >
              삭제
            </button>
          </div>

          {confirmTarget && (
            <div
              className="gallery-confirm"
              role="dialog"
              aria-modal="true"
              onClick={() => !deleting && setConfirmTarget(null)}
            >
              <div
                className="gallery-confirm-card"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="gallery-confirm-title">정말 삭제하시겠습니까?</p>
                <p className="gallery-confirm-sub">
                  한 번 삭제된 미디어는 복구되지 않습니다.
                </p>
                <div className="gallery-confirm-actions">
                  <button
                    type="button"
                    className="gallery-confirm-yes"
                    onClick={() => void confirmDelete()}
                    disabled={deleting}
                  >
                    {deleting ? "삭제 중…" : "예"}
                  </button>
                  <button
                    type="button"
                    className="gallery-confirm-no"
                    onClick={() => setConfirmTarget(null)}
                    disabled={deleting}
                  >
                    취소
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
