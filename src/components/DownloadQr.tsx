import { useEffect, useRef, useState } from "react";
import QRCodeStyling from "qr-code-styling";
import { openErrorReport } from "../lib/errorReport.ts";

/**
 * 결과물의 GCS 서명 URL을 버튼 뒤에 숨겨뒀다가, 누르면 QR로 보여준다.
 * 우리 앱(IAP 뒤)을 거치지 않는 링크라 로그인 없는 부스 방문자도
 * 자기 폰으로 스캔해서 바로 받아갈 수 있다.
 *
 * QR 은 `qr-code-styling` 으로 그린다 — 가운데에 Google Cloud 로고를 얹고
 * 둥근 도트로 브랜드 톤을 맞춘다.
 *
 * ⚠️ 스캔이 최우선이다. 서명 URL 이 700자 안팎이라 모듈이 이미 빽빽하다:
 *  - 표시 크기를 키우고(팝오버 CSS `.qr-canvas`), 2배 해상도로 떠서 또렷하게
 *  - ECL 은 M 으로 낮춰 모듈 수를 줄인다 (로고는 작게 + hideBackgroundDots 로 보완)
 *  - 근본 해결은 URL 단축(짧은 리다이렉트 라우트) — 그때 로고를 더 키울 수 있다
 *
 * url 이 없을 때:
 *  - error 가 있으면 "오류 보기" 로 서버가 준 원본 에러를 새 탭에 띄운다
 *  - error 도 없으면(API 키 모드 등) "준비 중" 안내만
 */

/** 표시는 CSS 에서 320px. 생성은 2배 해상도로 떠서 레티나에서도 또렷하게. */
const QR_RENDER_PX = 640;

/** 로고는 public/ 절대경로. */
const QR_LOGO = "/google-cloud-icon-logo.png";

function buildQr(data: string): QRCodeStyling {
  return new QRCodeStyling({
    width: QR_RENDER_PX,
    height: QR_RENDER_PX,
    type: "canvas",
    data,
    margin: 22,
    image: QR_LOGO,
    // 서명 URL 이 길어(700~850자) 모듈이 빽빽하다. jsQR 로 디코딩 검증한 조합:
    //  - ECL 은 Q — 로고를 얹으면 M 은 복원력이 모자라 아예 안 읽힌다 (검증됨)
    //  - 로고는 22% + hideBackgroundDots — Q 예산 안에 들어옴
    //  - 표시 280~320px 에서 디코딩 성공. 근본 해결은 URL 단축.
    qrOptions: { errorCorrectionLevel: "Q" },
    imageOptions: {
      crossOrigin: "anonymous",
      margin: 4,
      imageSize: 0.22,
      hideBackgroundDots: true,
    },
    dotsOptions: { type: "rounded", color: "#17181c" },
    cornersSquareOptions: { type: "extra-rounded", color: "#17181c" },
    cornersDotOptions: { type: "dot", color: "#1a73e8" },
    backgroundOptions: { color: "#ffffff" },
  });
}

export function DownloadQr({
  url,
  error,
  context = "QR 다운로드",
}: {
  url?: string;
  error?: string | null;
  context?: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"rendering" | "ready" | "failed">(
    "rendering",
  );
  const holderRef = useRef<HTMLDivElement | null>(null);
  const qrRef = useRef<QRCodeStyling | null>(null);

  useEffect(() => {
    const holder = holderRef.current;
    if (!open || !url || !holder) return;

    let cancelled = false;
    setStatus("rendering");
    holder.replaceChildren();

    const qr = buildQr(url);
    qrRef.current = qr;
    qr.append(holder);
    // 캔버스 그리기 + 로고 이미지 로드까지 끝나야 완성이다 — getRawData 로 완료를 잡는다
    qr.getRawData("png")
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
      holder.replaceChildren();
      qrRef.current = null;
    };
  }, [open, url]);

  const saveQr = () => {
    void qrRef.current?.download({ name: "sm-ai-day-qr", extension: "png" });
  };

  return (
    <div className="download-qr">
      <button
        type="button"
        className="qr-toggle result-dl"
        onClick={() => setOpen((o) => !o)}
      >
        📱 QR로 다운로드
      </button>

      {open && (
        <div className="qr-popover">
          {url ? (
            <>
              <div
                className="qr-canvas"
                ref={holderRef}
                role="img"
                aria-label="QR 코드로 다운로드"
                data-status={status}
              />
              {status === "rendering" ? (
                <span className="qr-loading">QR 생성 중…</span>
              ) : (
                <>
                  <span>폰으로 스캔해서 저장</span>
                  <button
                    type="button"
                    className="qr-save banner-detail"
                    onClick={saveQr}
                  >
                    ⬇ QR 이미지 저장
                  </button>
                </>
              )}
            </>
          ) : error ? (
            <div className="qr-fail">
              <span>QR 링크를 만들지 못했어요</span>
              <button
                type="button"
                className="banner-detail"
                onClick={() =>
                  openErrorReport(context, "QR 서명 URL 생성 실패", error)
                }
              >
                🔎 오류 보기
              </button>
            </div>
          ) : (
            <span className="qr-loading">QR 다운로드는 준비 중이에요</span>
          )}
        </div>
      )}
    </div>
  );
}
