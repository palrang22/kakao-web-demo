/** 히어로 배경 장식 — 돛단배 라인 드로잉 + 수평선 물결.
 *  색은 hub.css 의 브랜드 토큰(인디고/블루)을 따르고, 옐로는 마스트 끝 점 하나로만 쓴다. */
export function SailArt() {
  return (
    <div className="hero-art" aria-hidden="true">
      {/* 앰비언트 글로우 — 우상단 블루, 좌하단 딥 인디고 */}
      <span className="glow glow-a" />
      <span className="glow glow-b" />

      {/* 돛단배 (오른쪽 아래에서 화면 밖으로 흘러나가게 크롭) */}
      <svg
        className="art-sail"
        viewBox="0 0 520 700"
        fill="none"
        preserveAspectRatio="xMaxYMax slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="sailFill" x1="250" y1="40" x2="400" y2="610" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity=".13" />
            <stop offset="100%" stopColor="#325CFF" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="jibFill" x1="250" y1="120" x2="150" y2="610" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#517AFB" stopOpacity=".16" />
            <stop offset="100%" stopColor="#517AFB" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sailLine" x1="250" y1="30" x2="400" y2="640" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity=".55" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity=".06" />
          </linearGradient>
        </defs>

        {/* 바람 궤적 — 가늘고 긴 점선 호 */}
        <path
          d="M -40 306 C 130 196, 312 152, 560 118"
          stroke="#FFFFFF"
          strokeOpacity=".13"
          strokeWidth="1.2"
          strokeDasharray="2 9"
          strokeLinecap="round"
        />

        {/* 메인 돛 */}
        <path
          d="M 250 46 C 372 212, 424 420, 398 604 L 250 604 Z"
          fill="url(#sailFill)"
          stroke="url(#sailLine)"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        {/* 앞 돛 */}
        <path
          d="M 250 132 C 186 288, 152 462, 146 604 L 250 604 Z"
          fill="url(#jibFill)"
          stroke="url(#sailLine)"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        {/* 돛 안쪽 결 */}
        <path
          d="M 262 190 C 330 300, 358 450, 352 592"
          stroke="#FFFFFF"
          strokeOpacity=".10"
          strokeWidth="1"
        />
        <path
          d="M 238 240 C 208 350, 190 480, 188 592"
          stroke="#FFFFFF"
          strokeOpacity=".08"
          strokeWidth="1"
        />

        {/* 돛대 + 붐 */}
        <line x1="250" y1="34" x2="250" y2="616" stroke="#FFFFFF" strokeOpacity=".42" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="150" y1="604" x2="408" y2="604" stroke="#FFFFFF" strokeOpacity=".22" strokeWidth="1.2" strokeLinecap="round" />

        {/* 선체 */}
        <path
          d="M 132 616 L 430 616 C 398 668, 190 672, 132 616 Z"
          fill="#FFFFFF"
          fillOpacity=".05"
          stroke="#FFFFFF"
          strokeOpacity=".22"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />

        {/* 유일한 옐로 포인트 — 돛대 끝 작은 깃발 */}
        <path d="M 253 32 L 278 40 L 253 48 Z" fill="#FAE300" fillOpacity=".85" />
      </svg>

      {/* 수평선 물결 — 히어로 폭 전체를 가로지른다 */}
      <svg
        className="art-waves"
        viewBox="0 0 800 120"
        fill="none"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M 0 30 C 150 12, 300 46, 460 26 C 600 9, 700 34, 800 22" stroke="#FFFFFF" strokeOpacity=".16" strokeWidth="1.2" />
        <path d="M 0 66 C 170 48, 320 82, 500 60 C 630 44, 720 66, 800 56" stroke="#517AFB" strokeOpacity=".30" strokeWidth="1.2" />
        <path d="M 0 102 C 200 86, 360 116, 540 96 C 660 82, 740 100, 800 92" stroke="#FFFFFF" strokeOpacity=".08" strokeWidth="1.2" />
      </svg>
    </div>
  );
}
