import { Link } from "react-router-dom";
import {
  ArrowIcon,
  AudioIcon,
  ImageIcon,
  VideoIcon,
} from "../components/Icons.tsx";

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
        <div className="hero-top reveal d1">
          <img
            className="eyebrow-logo"
            src="/header-logo-dot.svg"
            alt="Kakao AI 돛 Summit 26"
          />
          <div className="partners">
            <img className="kakao" src="/kakao-logo-yellow.png" alt="Kakao" />
            <span className="x">×</span>
            <img
              className="gc"
              src="/Google_Cloud_icon.svg"
              alt="Google Cloud"
            />
          </div>
        </div>

        <div className="hero-body">
          <h1 className="pitch reveal d2">
            미래를 <span className="out">향해</span>,
            <br />
            <span className="out">가능성</span>의 항해
          </h1>
          <div className="meta reveal d4">
            <div>
              <b>2026.09.29</b>Tue
            </div>
            <div>
              <b>BPEX</b>Busan
            </div>
            <div>
              <b>3 Studios</b>Video · Image · Audio
            </div>
          </div>
        </div>

        <div className="sail-deco reveal d5" aria-hidden="true">
          <img className="sail-route" src="/sail-route.svg" alt="" />
          <img className="sail-boat" src="/sailing-boat-white.png" alt="" />
        </div>

        <div className="footline reveal d5">
          <span>Powered by</span>
          <img src="/Google_Cloud_icon.svg" alt="Google Cloud" />
          <span style={{ letterSpacing: ".14em" }}>Google Cloud</span>
        </div>
      </section>

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
