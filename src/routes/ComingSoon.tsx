import { Link } from "react-router-dom";
import { ArrowIcon } from "../components/Icons.tsx";

type Props = {
  en: string;
  title: string;
  desc: string;
  api: string;
  /** 모듈 색상 계열 — hub.css 의 .mod.video / .image / .audio 와 같은 규칙을 쓴다 */
  kind: "video" | "image" | "audio";
};

/** 아직 구현하지 않은 스튜디오 자리표시자. PLAN.md 의 Phase 2·3 에서 채운다. */
export function ComingSoon({ en, title, desc, api, kind }: Props) {
  return (
    <section className="panel">
      <div className="panel-head reveal d1">
        <span className="t">{en}</span>
        <span className="c">준비 중</span>
      </div>

      <div className={`soon ${kind} reveal d2`}>
        <h2>{title}</h2>
        <p>{desc}</p>
        <span className="api">
          <img src="/Google_Cloud_icon.svg" alt="" />
          {api}
        </span>
        <p className="soon-note">이 스튜디오는 아직 개발 중입니다.</p>
        <Link to="/" className="soon-back">
          <ArrowIcon /> 홈으로 돌아가기
        </Link>
      </div>
    </section>
  );
}
