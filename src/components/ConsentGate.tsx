import { useId, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

type Props = {
  /** capture: 사진·영상이 저장되고 갤러리에 전시됨 / live: 저장되지 않음 */
  variant: "capture" | "live";
  /** 스튜디오 강조색 — video / image / audio */
  kind: "video" | "image" | "audio";
  children: ReactNode;
};

/**
 * 스튜디오 진입 전 동의 게이트.
 *
 * 부스 방문자는 매번 새로 온다고 보고, **진입할 때마다** 띄운다 (합의 D5 — 세션 기억 없음).
 * 라우트 element 를 이걸로 감싸면 라우트가 마운트될 때마다 `consented` 가 false 로 시작한다.
 * 동의 전에는 children(스튜디오)을 렌더하지 않는다 — 웹캠 등이 미리 켜지는 걸 막는다.
 */
export function ConsentGate({ variant, kind, children }: Props) {
  const [consented, setConsented] = useState(false);
  const [checked, setChecked] = useState(false);
  const navigate = useNavigate();
  const titleId = useId();

  if (consented) return <>{children}</>;

  return (
    <div className={`consent-scrim ${kind}`}>
      <div
        className="consent-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>체험 전 안내</h2>

        {variant === "capture" ? (
          <div className="consent-body">
            <p>
              이 체험에서 촬영하거나 올린 사진, 그리고 만들어진 이미지·영상은
              부스의 <b>미디어 갤러리 화면에 전시</b>됩니다.
            </p>
            <p>
              <b>행사가 끝나면(2026-09-29) 모든 사진·영상은 폐기</b>됩니다. 갤러리
              화면에서 본인 결과를 직접 삭제할 수도 있습니다.
            </p>
          </div>
        ) : (
          <div className="consent-body">
            <p>
              이 체험은 웹캠으로 <b>얼굴을 촬영</b>하고 마이크로{" "}
              <b>음성을 인식</b>해 실시간으로 AI가 답합니다.
            </p>
            <p>
              영상과 음성은 <b>저장되지 않으며</b>, 세션이 끝나면 어떤 데이터도
              남지 않습니다.
            </p>
          </div>
        )}

        <label className="consent-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>위 내용을 확인했으며 동의합니다</span>
        </label>

        <div className="consent-actions">
          <button
            type="button"
            className="consent-cancel"
            onClick={() => navigate("/")}
          >
            취소
          </button>
          <button
            type="button"
            className="consent-go"
            disabled={!checked}
            onClick={() => setConsented(true)}
          >
            동의하고 시작
          </button>
        </div>
      </div>
    </div>
  );
}
