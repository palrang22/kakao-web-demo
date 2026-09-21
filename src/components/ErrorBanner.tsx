import { openErrorReport } from "../lib/errorReport.ts";

/**
 * 스튜디오 3종 공용 에러 배너.
 *
 * 화면에는 짧은 메시지만 띄우고, 원본 에러 전문은 "에러코드 확인하기" 로
 * 새 탭에 연다 (`src/lib/errorReport.ts`). 부스 화면에 스택 트레이스를
 * 늘어놓지 않으면서도 문제가 났을 때 바로 원인을 볼 수 있게 하려는 것이다.
 */

type Props = {
  /** 화면에 보여줄 한 줄 메시지 */
  message: string;
  /** 서버가 내려준 원본 에러 전문. 없으면 버튼을 숨긴다 */
  detail?: string | null;
  /** 어느 스튜디오에서 났는지 — 새 탭 제목에 쓴다 */
  context: string;
  onClose: () => void;
};

export function ErrorBanner({ message, detail, context, onClose }: Props) {
  return (
    <div className="banner banner-error">
      <strong>오류</strong> {message}
      {detail && (
        <button
          type="button"
          className="banner-detail"
          onClick={() => openErrorReport(context, message, detail)}
        >
          🔎 에러코드 확인하기
        </button>
      )}
      <button type="button" className="banner-close" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
