import { Link } from "react-router-dom";
import {
  ArrowIcon,
  AudioIcon,
  ImageIcon,
  VideoIcon,
} from "../components/Icons.tsx";
import { SailArt } from "../components/SailArt.tsx";

type Studio = {
  to: string;
  kind: "video" | "image" | "audio";
  en: string;
  title: string;
  desc: string;
  api: string;
  Icon: typeof VideoIcon;
  delay: string;
};

const STUDIOS: Studio[] = [
  {
    to: "/video",
    kind: "video",
    en: "01 — Video",
    title: "Motion Studio",
    desc: "사진 몇 장이 10초 숏폼으로. 내 사진으로 다양한 쇼츠 영상을 만들어보세요.",
    api: "Gemini Omni · 720p · 9:16",
    Icon: VideoIcon,
    delay: "d3",
  },
  {
    to: "/image",
    kind: "image",
    en: "02 — Image",
    title: "Look Studio",
    desc: "내 사진에 무대의상을 입혀보세요. AI가 실제 사진처럼 합성해 줍니다.",
    api: "Virtual Try-On · Image",
    Icon: ImageIcon,
    delay: "d4",
  },
  {
    to: "/audio",
    kind: "audio",
    en: "03 — Audio",
    title: "Voice Studio",
    desc: "AI가 봐주는 나의 관상. 웹캠과 마이크로 얼굴과 목소리를 실시간 분석합니다.",
    api: "Gemini Live · Realtime",
    Icon: AudioIcon,
    delay: "d5",
  },
];

export function Hub() {
  return (
    <>
      <section className="hero">
        {/* 배경 — 돛단배 라인 드로잉 + 물결 */}
        <SailArt />

        {/* 상단 로고 & 행사 키커 */}
        <div className="hero-top reveal d1">
          <img
            className="eyebrow-logo"
            src="/header-logo-dot.svg"
            alt="Kakao AI 돛"
          />
          <span className="hero-kicker">AI 돛 Summit 26</span>
        </div>

        {/* 본문: 캐치프레이즈 → 설명 → 메타 */}
        <div className="hero-body">
          <h1 className="pitch reveal d3">
            <span className="l1">미래를 향해,</span>
            <span className="l2">
              가능성의 항해
              <i className="tip" aria-hidden="true" />
            </span>
          </h1>

          <p className="hero-desc reveal d4">
            생성형 AI 멀티모달 모델을 직접 다뤄보는 인터랙티브 미디어 부스.
            영상·이미지·음성 세 개의 스튜디오가 준비되어 있습니다.
          </p>

          <dl className="hero-meta reveal d5">
            <div className="meta-item">
              <dt>일시</dt>
              <dd>
                2026.09.29 <span className="dim">(화)</span>
              </dd>
            </div>
            <div className="meta-item">
              <dt>장소</dt>
              <dd>부산 BPEX</dd>
            </div>
            <div className="meta-item">
              <dt>체험</dt>
              <dd>3 Studios</dd>
            </div>
          </dl>
        </div>

        {/* 하단 푸터 */}
        <div className="footline reveal d6">
          <span>Powered by</span>
          <img src="/Google_Cloud_icon.svg" alt="Google Cloud" />
          <span className="powered-name">Google Cloud</span>
        </div>
      </section>

      {/* 오른쪽 스튜디오 패널 (유지) */}
      <section className="panel">
        <div className="panel-head reveal d2">
          <span className="t">Studios</span>
          <span className="c">03 / 03</span>
        </div>
        <p className="panel-sub reveal d2">
          체험할 스튜디오를 선택하세요.
        </p>

        <div className="modules">
          {STUDIOS.map(({ to, kind, en, title, desc, api, Icon, delay }) => (
            <Link
              key={to}
              to={to}
              className={`mod ${kind} reveal ${delay}`}
              aria-label={`${title} 진입`}
            >
              <span className="glyph">
                <Icon />
              </span>
              <div className="txt">
                <div className="en">{en}</div>
                <h3>{title}</h3>
                <p>{desc}</p>
                <span className="api">
                  <img src="/Google_Cloud_icon.svg" alt="" />
                  {api}
                </span>
              </div>
              <span className="go">
                <ArrowIcon />
              </span>
            </Link>
          ))}
        </div>

        <div className="panel-foot reveal d6">
          <span className="pill">
            <span className="d" /> All systems ready
          </span>
          <span>KAKAO × GOOGLE CLOUD</span>
        </div>
      </section>
    </>
  );
}
