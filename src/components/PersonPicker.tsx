import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  attachmentFromBase64,
  attachmentFromUrl,
  readAsAttachment,
  type Attachment,
} from "../lib/image.ts";

/**
 * 인물 입력 위젯 — [샘플에서 고르기] / [사진 찍기] / [파일 업로드].
 * Look Studio(02)·Motion Studio(01) 가 공유한다.
 */

/** 샘플 인물 — 파일은 public/samples/human/<id>.webp 에 둔다 (3열 × 2행) */
const SAMPLE_PEOPLE = [
  { id: "woman_1", label: "여성 1" },
  { id: "woman_2", label: "여성 2" },
  { id: "woman_3", label: "여성 3" },
  { id: "man_1", label: "남성 1" },
  { id: "man_2", label: "남성 2" },
  { id: "man_3", label: "남성 3" },
] as const;

const sampleSrc = (id: string) => `/samples/human/${id}.webp`;

/** 샘플 인물을 3×2 그리드로 크게 보여주는 팝업 */
function SampleModal({
  onPick,
  onClose,
}: {
  onPick: (a: Attachment) => void;
  onClose: () => void;
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function choose(id: string, label: string) {
    setErr(null);
    setLoadingId(id);
    try {
      onPick(await attachmentFromUrl(sampleSrc(id), `${label}.webp`));
    } catch {
      setErr(`${label} 샘플을 불러오지 못했습니다 — public/samples/human/${id}.webp 를 확인하세요`);
      setLoadingId(null);
    }
  }

  return createPortal(
    <div className="sample-modal" onClick={onClose}>
      <div
        className="sample-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-label="샘플 인물 선택"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sample-modal-head">
          <h2>샘플 인물 선택</h2>
          <button
            type="button"
            className="sample-modal-close"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="sample-grid">
          {SAMPLE_PEOPLE.map((s) => (
            <button
              key={s.id}
              type="button"
              className="sample-cell"
              onClick={() => void choose(s.id, s.label)}
              disabled={loadingId !== null}
            >
              <img
                src={sampleSrc(s.id)}
                alt={s.label}
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.visibility = "hidden";
                }}
              />
              <span>{loadingId === s.id ? "불러오는 중…" : s.label}</span>
            </button>
          ))}
        </div>
        {err && <p className="person-cam-error">{err}</p>}
      </div>
    </div>,
    document.body,
  );
}

export function PersonPicker({
  value,
  onPick,
  onClear,
  disabled,
}: {
  value: Attachment | null;
  onPick: (a: Attachment) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [view, setView] = useState<"idle" | "camera">("idle");
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pickFile(file: File) {
    setCamError(null);
    try {
      onPick(await readAsAttachment(file));
    } catch (err) {
      setCamError(err instanceof Error ? err.message : "사진을 읽지 못했습니다");
    }
  }

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // 언마운트 시 카메라 정리
  useEffect(() => stopCamera, [stopCamera]);

  // 카메라 뷰로 바뀌면 <video> 가 이제 마운트됐으니 스트림을 붙인다
  useEffect(() => {
    if (view !== "camera") return;
    const video = videoRef.current;
    if (video && streamRef.current) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => {});
    }
  }, [view]);

  async function openCamera() {
    setCamError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError("이 브라우저에서는 카메라를 쓸 수 없습니다 (HTTPS 필요)");
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      setView("camera");
    } catch (err) {
      setCamError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "카메라 권한이 거부되었습니다"
          : "카메라를 열지 못했습니다",
      );
    }
  }

  function closeCamera() {
    stopCamera();
    setView("idle");
  }

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.92);
    onPick(
      attachmentFromBase64(url.slice(url.indexOf(",") + 1), "image/jpeg", "촬영.jpg"),
    );
    closeCamera();
  }

  if (value) {
    return (
      <div className="slot filled">
        <span className="slot-label">인물</span>
        <img src={value.preview} alt="선택한 인물" />
        <button
          type="button"
          className="slot-clear"
          onClick={onClear}
          disabled={disabled}
          aria-label="인물 제거"
        >
          ✕
        </button>
      </div>
    );
  }

  if (view === "camera") {
    return (
      <div className="slot">
        <span className="slot-label">인물 — 촬영</span>
        <video ref={videoRef} className="slot-cam" autoPlay playsInline muted />
        <div className="slot-cam-actions">
          <button type="button" className="shoot" onClick={capture}>
            촬영
          </button>
          <button type="button" onClick={closeCamera}>
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slot">
      <span className="slot-label">인물</span>
      <div className="person-choices">
        <button
          type="button"
          className="person-choice"
          onClick={() => setSamplesOpen(true)}
          disabled={disabled}
        >
          <span className="ico">👥</span>
          샘플에서 고르기
        </button>
        <button
          type="button"
          className="person-choice"
          onClick={() => void openCamera()}
          disabled={disabled}
        >
          <span className="ico">📷</span>
          사진 찍기
        </button>
        <button
          type="button"
          className="person-choice"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          <span className="ico">＋</span>
          파일 업로드
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pickFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {camError && <p className="person-cam-error">{camError}</p>}
      {samplesOpen && (
        <SampleModal
          onClose={() => setSamplesOpen(false)}
          onPick={(a) => {
            onPick(a);
            setSamplesOpen(false);
          }}
        />
      )}
    </div>
  );
}
