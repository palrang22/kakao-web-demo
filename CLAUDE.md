# CLAUDE.md

## 이 프로젝트가 뭔가

**카카오 AI 돛 Summit 26 부스**(2026-09-29, 부산 BPEX)에서 시연할 Google Cloud AI 체험 웹앱.
원래 SM Entertainment AI Day 부스용으로 만든 웹앱을 카카오 행사용으로 리브랜딩한 것이다
(일회성 데모 — 레포도 새로 팠다). 우리는 GCP MSP 의 **Google Cloud presales** 입장이다.

사용자는 presales 신입이고, **GCP 기능을 폭넓게 써보는 것 자체가 목적 중 하나다.**
"가장 빠른 길"보다 GCP 네이티브 방식(Vertex AI, GCS, IAP, Cloud Run)을 우선한다.

체험 3종을 한 웹페이지에 담는다:

| # | 스튜디오 | 라우트 | 모델/API | 강조색 | 상태 |
|---|---|---|---|---|---|
| 01 Video | **Motion Studio** | `/video` | `gemini-omni-1.1-flash-preview` | 브랜드 인디고 (`--brand`) | 🟢 실호출 성공 |
| 02 Image | **Look Studio** | `/image` | `virtual-try-on-001` (Vertex 전용, `us-central1`) | 브랜드 블루 (`--brand-2`) | 🟢 실호출 성공 |
| 03 Audio | **Voice Studio** | `/audio` | `gemini-live-2.5-flash` (WS 프록시) | 인디고·블루 혼합 (`--brand-3`) | 🟢 실호출 성공 |

세 스튜디오 모두 UI·실호출 검증 완료 (2026-08-26, SM 부스 기준). `PLAN.md` 는 그 당시 작업
목록이라 **deprecated** — 지금은 과거 이력 확인용으로만 본다.

행사일은 **2026-09-29 (화)**, 장소는 **BPEX(부산)**. 스튜디오 이름(Motion/Look/Voice Studio)은
원래 시안에서 온 것이라 임의로 바꾸지 말 것(2026-09-07 에 변경 시도했다가 사용자가 원복 — 기존 이름 유지).

### 체험자 · 컨셉 방향

체험자는 **AI 돛 Summit 26 부스를 방문하는 참관객**이다 (SM 부스 시절의 "20~30대 SM 엔터
직원" 전제는 더 이상 적용되지 않는다 — 특정 회사 직원이 아니라 행사 참관객 전반). 세 스튜디오
모두 이 층이 **"이런 것도 된다고?"** 하고 놀랄 만한 데모여야 한다. "동작한다"가 아니라
"내 관심사에 이게 꽂힌다"를 목표로 기능을 디벨롭한다.

- **02 Look Studio — 옷 입혀보기.** 인물(샘플 사진 또는 웹캠 촬영)에 의상을 합성한다.
  `virtual-try-on-001` 은 상의/하의/원피스만 지원 — 가방·모자·소품은 안 됨.
  `public/samples/look-studio/` 샘플 의상은 SM 시절 그대로(콘서트·레드카펫 등) 유지하기로
  결정됨(2026-09-21) — **레드카펫/시상식 컨셉 이미지만 사용자가 직접 나중에 교체 예정.**
  다른 샘플은 그대로 두고, 시상식 계열 파일을 임의로 건드리지 말 것.
- **03 Voice Studio — AI 관상가.** 웹캠으로 얼굴을 보여주면 관상가 아주머니 페르소나가
  영상을 보면서 실시간 음성으로 관상을 봐준다 (컨셉은 `PLAN.md` §03, 참고용). Gemini Live 의
  영상+음성 동시 처리를 그대로 보여주는 컨셉.
- **01 Motion Studio** 도 같은 기준으로 시나리오를 잡을 것. `public/samples/motion-studio/`
  도 마찬가지로 유지 — 위와 동일하게 시상식 계열만 사용자가 직접 교체.

## 스택 · 명령어

Vite + React 19 + TypeScript, pnpm.

```bash
pnpm dev           # 개발 서버 (Vite + API 라우트 + Live WS 미들웨어)
pnpm build         # tsc -b && vite build && pnpm build:server
pnpm build:server  # tsconfig.server.json — server/ 를 dist-server/ 로 emit
pnpm start         # node dist-server/index.js — 배포와 동일한 프로덕션 서버
pnpm lint          # eslint
pnpm optimize:samples  # public/samples/**/*.png → webp (긴 변 1536px). 원본은 samples-original/ 에 백업 후 삭제
```

변경 후에는 `pnpm build`와 `pnpm lint`를 돌려서 통과하는지 확인할 것.

## GCP 설정 (이미 되어 있음 — 다시 만들지 말 것)

> 2026-09-22 에 **카카오 전용 프로젝트를 새로 파서 배포·IAP 까지 전부 마쳤다.**
> 아래 값은 2026-09-23 에 `gcloud` 로 실제 리소스를 읽어 확인한 것이다.
> SM 시절 인프라(`minling-ai-day-project` / `smproject-*`)는 이 앱과 무관하다 — 맨 아래 참고.

```
프로젝트  kakao-ai-summit-26-20260921   (이 앱 전용. 프로젝트 번호 120385871992)
계정      kseungh@mz.co.kr              (회사 계정. 이 프로젝트에선 Owner)
인증      Vertex AI + ADC               (API 키 아님)
리전      global                        (Vertex 호출 리전. Cloud Run 배포 리전(asia-northeast3)과 다름)
버킷      gs://kakao-demo-web-bucket/output   (asia-northeast3, UBLA + public access prevention 적용)
Cloud Run kakao-web-demo (asia-northeast3)
URL       https://kakao-web-demo-vkpvjhgm4a-du.a.run.app   (IAP 뒤 — 로그인 없이는 안 열린다)
```

- 버킷에 **자동 삭제(lifecycle) 규칙은 없다** — 의도된 것(합의 D6). 부스 결과물은 행사 종료 후
  스태프가 수동으로 비운다. 동의 팝업이 약속한 내용이라 체크리스트 항목이다.
- **런타임 서비스 계정** `kakao-ai-runner@kakao-ai-summit-26-20260921.iam.gserviceaccount.com`
  (표시 이름 "kakao web demo service account"). 실제 보유 역할:
  - `roles/aiplatform.user` — 프로젝트 레벨. Vertex 호출용
  - `roles/iam.serviceAccountTokenCreator` — 프로젝트 레벨. 서명 URL(signBlob)용
  - `roles/storage.objectAdmin` — **버킷 `kakao-demo-web-bucket` 한정** 바인딩 (프로젝트 레벨 아님)
- **소스 배포용** 기본 compute SA `120385871992-compute@developer.gserviceaccount.com` 은
  `roles/cloudbuild.builds.builder` + `roles/editor` 를 갖고 있다. `gcloud run deploy --source` 가
  이 SA 로 Cloud Build 를 돌린다.
- 로컬 `pnpm dev` 는 개인 ADC 를 쓴다. Vertex·스토리지는 바로 되고, 서명 URL 만
  `GCS_SIGNER_SA`(`.env.local`) impersonate 경로 — 내 계정이 위 SA 에 token creator 를 가져야
  동작한다 (배포본에선 SA 자신이 갖고 있으므로 불필요).
- 이 프로젝트는 **이 앱 전용**이라 SM 때 같은 "공용 프로젝트 주의" 제약은 없다. 다만
  `firebase-adminsdk-fbsvc@...` SA 와 `run-sources-...` 버킷(Cloud Build 소스 업로드용)은
  우리가 만든 게 아니니 건드리지 말 것.
- **폐기된 과거 인프라** (사용자가 직접 정리): `minling-ai-day-project`(SM AI Day —
  `smproject-ai-runner` / `gs://smproject-sh2` / Cloud Run `smprojects-sh`),
  그 이전 `kktae-demo` ← `gcp-a-presales-ge-20260521`. 이 값들을 이 앱 문서·코드에 쓰지 말 것.

## 접근 제어 — IAP

**`@mz.co.kr` 도메인 계정만 진입 가능.** 주소를 치면 바로 구글 로그인 화면이 떠야 한다.
로그인한 사람은 기능을 자유롭게 쓸 수 있다.

- **Cloud Run 에 IAP 를 직접** 건다 (2026 GA. 로드밸런서 불필요)
- 허용 대상: 역할 `roles/iap.httpsResourceAccessor` 에 `domain:mz.co.kr` **+ `domain:google.com`**
  (2026-09-23 실측). `google.com` 도메인은 의도한 것이 아니면 콘솔에서 빼는 게 맞다 — 부스 전 확인 항목.
- 앱 안에서 로그인 기능을 따로 만들지 말 것. IAP 가 이미 인증을 끝낸다.
- **OAuth 클라이언트는 커스텀(직접 만든 것)이다.** 프로젝트의 조직 도메인이 `mz.co.kr` 이
  아니라서 동의 화면을 **External** 로 두고 OAuth 2.0 클라이언트 ID 를 직접 만들어 IAP 에
  연결했다 (Google-managed 클라이언트는 Internal 동의 화면에서만 됨). 리디렉션 URI 는
  `https://iap.googleapis.com/v1/oauth/clientIds/<CLIENT_ID>:handleRedirect`.
  - OAuth 브랜드: `kakao ai summit 2026` (지원 이메일 `kseungh@mz.co.kr`)
  - 클라이언트: `IAP-kakao-web-demo`
    (`120385871992-2mn17rju39ujtppq13uedb02dttiq0gc.apps.googleusercontent.com`)
- IAP 서비스 에이전트 `service-120385871992@gcp-sa-iap.iam.gserviceaccount.com` 이 Cloud Run
  서비스에 `roles/run.invoker` 를 갖는다 — IAP 만 백엔드를 호출할 수 있게 하는 연결 고리다.
- `server/iap.ts` 검증용 `IAP_AUDIENCE` (Cloud Run env, 이미 주입돼 있음):
  `/projects/120385871992/locations/asia-northeast3/services/kakao-web-demo`

IAP 통과 후 요청에 붙는 헤더:

```
X-Goog-Authenticated-User-Email : accounts.google.com:kseungh@mz.co.kr
X-Goog-Authenticated-User-Id    : accounts.google.com:<id>
X-Goog-IAP-JWT-Assertion        : <서명된 JWT>
```

앞의 두 개는 스푸핑 가능하다. **신뢰해야 할 것은 `X-Goog-IAP-JWT-Assertion` 서명 검증 결과다.**
사용자별 호출 상한·로깅에 이 신원을 쓴다.

### 관리자 화면 (`/settings`·`/gallery`) 비번 게이트

`src/lib/admin.ts` 의 `ADMIN_PASSWORD = "aprk12!"` (`AdminGate` 컴포넌트가 검사, `/settings`·`/gallery`
공유) — **브라우저에서만 비교하고 번들에 평문으로 들어간다. 이건 의도된 것이니 서버로 옮기지 말 것.**
보안 장치가 아니라 "실수로 들어가는 것"을 막는 덮개일 뿐이고, `VITE_` 든 아니든 env 로 옮겨도
클라이언트가 검증하는 한 노출은 똑같다. 실질 접근 제어는 위 IAP 도메인 제한이 한다.

- 킬 스위치·레이트리밋처럼 **정말 막아야 하는 인가 판단**은 `server/iap.ts` 의
  `getIapIdentity()` (IAP JWT 검증) 로 하고, 비번 게이트에 얹지 않는다.

> **GCP 콘솔 작업은 사용자가 직접 한다.** 코드/CLI 로 리소스를 만들지 말고,
> 콘솔에서 뭘 눌러야 하는지 절차를 알려줄 것.

## 아키텍처

```
server/index.ts         프로덕션 서버 (Cloud Run). dist/ 정적 + /api/* + Live WS 를 한 프로세스로.
                        PORT 존중, 0.0.0.0 바인딩, /health(GET·HEAD), SPA 폴백, 경로 탈출 방어
server/api.ts           API 라우트 + 인메모리 잡 스토어. dev(vite.config.ts)·배포(index.ts) 양쪽이 이 미들웨어를 공유.
                        /api/gallery (GET 목록 · DELETE 삭제) + /api/gallery/media (GCS 프록시 스트리밍, 서명 URL 안 씀) = §4
server/config.ts        인증 방식 판별 (Vertex AI ↔ API 키, 환경변수 한 줄로 전환)
server/client.ts        인증 모드별 SDK 클라이언트 생성 (locationOverride 로 모델별 리전 분기)
server/omni.ts          01 Motion Studio. Omni Flash 래퍼 + GCS/Files API 다운로드
server/tryon.ts         02 Look Studio. recontextImage 래퍼 (Vertex 전용, us-central1). 동기 호출
server/live.ts          03 Voice Studio. 브라우저 ⇄ 우리 WS ⇄ ai.live.connect() 프록시
server/gcs.ts           GCS 헬퍼 (omni 다운로드 / tryon 업로드·서명 URL / gallery 목록·삭제·프록시 스트리밍)
server/iap.ts           X-Goog-IAP-JWT-Assertion 서명 검증 (jose). IAP_AUDIENCE 없으면 no-op
server/errors.ts        SDK 에러 원문 추출 ("에러코드 확인하기" 용)
vite.config.ts          dev 서버에 위 미들웨어 + Live WS 를 마운트 (apply: 'serve')

src/App.tsx             라우터 + 셸. 허브에서만 .main-split (2열) 적용. 스튜디오는 ConsentGate, /gallery 는 AdminGate 로 감쌈
src/components/Rail.tsx 좌측 64px 레일 (NavLink 활성 상태) + 테마 토글 + 갤러리·관리자 진입
src/components/ConsentGate.tsx  스튜디오 진입 전 동의 모달 (매 진입마다, 합의 D5)
src/components/AdminGate.tsx    관리자 비번 게이트 래퍼 (/settings·/gallery 공유). 로직은 src/lib/admin.ts
src/components/PersonPicker.tsx  인물 입력 (샘플/촬영/업로드) — 01·02 공유
src/components/Icons.tsx 시안에서 가져온 라인 아이콘
src/lib/admin.ts       관리자 비번(aprk12!)·세션 판정 — §접근 제어 참고 (클라이언트 전용 덮개)
src/lib/theme.ts, ThemeProvider.tsx  테마 플레이스홀더 (라이트 고정, 토글 UI는 없앴다 — §디자인 시스템 참고)
src/lib/image.ts, audio.ts  이미지 읽기 / PCM 캡처·재생 유틸. image.ts `shrink()` 는 모델로 보내기 전 긴 변 1920px 로 줄이고, PNG/JPEG 가 아니면(=샘플 webp) 크기와 무관하게 JPEG 로 재인코딩 (함정 7)
src/lib/errorReport.ts  원본 에러를 새 탭에 띄우는 유틸 (ErrorBanner·DownloadQr 공유)
src/lib/concepts.ts    01 컨셉 (버튼 → prompt 자동 채움 + 배경 refImages + 옷 outfits). 시나리오는 시안, 프롬프트 문구는 Omni 1.1 prompt guide 에 맞춰 작성 (규칙은 파일 상단 주석 — 영어·<IMAGE_REF_N> 태그·타임코드)
src/lib/demo.ts        시연 영상 촬영용 모드. /settings 토글(localStorage) → 세 스튜디오가 모델 대신 public/demo/ 결과를 보여줌. 03 대본은 public/demo/visual-studio/guide.md 를 읽는다. ⚠️ 부스 운영 전 반드시 끌 것
src/lib/garments.ts    02 샘플 의상 (폴더별 섹션). public/samples/look-studio/
src/routes/Hub.tsx      랜딩 — 히어로 + 스튜디오 3개 카드
src/routes/MotionStudio.tsx  01 (Omni Flash, 잡 폴링) — 인물+컨셉 선택, 확장 모드는 사진 추가
src/routes/LookStudio.tsx    02 (Virtual Try-On, 동기) — 인물 + 샘플 의상 최대 2벌
src/routes/VoiceStudio.tsx   03 (Gemini Live, WebSocket)
src/routes/Settings.tsx      관리자 화면 (/settings). AdminGate 로 감쌈 — §접근 제어 참고
src/routes/Gallery.tsx       §4 Media Gallery (/gallery). 01·02 결과 슬라이드쇼, /api/gallery 폴링. AdminGate 뒤
src/routes/ComingSoon.tsx    미사용. 컷라인 대비로 남겨둠
src/styles/hub.css      시안 CSS. 디자인 토큰(:root)이 여기 있다
src/styles/studio.css   스튜디오 UI. 위 토큰으로 재매핑해서 톤을 맞춘다

scripts/optimize-samples.mjs  public/samples/**/*.png → webp (긴 변 1536px, sharp). 원본은 samples-original/ 로 백업 후 삭제. `pnpm optimize:samples`
Dockerfile              멀티스테이지 (deps → builder → runner). CMD node dist-server/index.js
public/                 로고 (kakao-logo-*.png, Google Cloud SVG) + samples/ (webp, 절대경로로 참조). 원본 PNG 백업은 samples-original/ (.gitignore)
docs/design/            원본 HTML 시안 (빌드 미포함)
docs/GCP-INFRA-GUIDE.md 선배 프로젝트 인프라 가이드
```

### 디자인 시스템 — 카카오 리브랜딩 (2026-09-21)

`src/styles/hub.css` 의 `:root` 가 단일 소스다. 색을 새로 만들지 말고 토큰을 쓸 것.
아래 브랜드·중립 색은 전부 **공식 행사 사이트 `kakaoaisail.org` 에서 실측**한 값이다
(2026-09-21, `getComputedStyle` 로 직접 확인) — 임의로 바꾸지 말 것.

```
--brand   #191A9B   포인트 컬러(인디고) — kakaoaisail.org 실측값 rgb(25,25,155)와 거의 동일
--brand-2 #325CFF   보조 포인트(블루) — kakaoaisail.org 에 이 값 그대로 존재
--brand-3 #517AFB   블루의 밝은 변형 — 역시 실사이트에서 그대로 발견
--brand-on #ffffff  브랜드 색 위에 얹는 글자
--ink   #ffffff / --ink-2 #F5F5F5 / --ink-3 #EAF2FF   배경 계열(화이트 + 옅은 블루 틴트 카드)
--paper #191919 / --fog rgba(25,25,25,.55) / --fog-2 rgba(25,25,25,.75)   텍스트 계열
--line #DDDDDD / --line-2 #CCCCCC   경계선
--g-blue --g-red --g-yellow --g-green   Google 브랜드 색(라이트 배경용 진한 변형). studio.css
                                          내부 캡처 화면 전용 — hub.css 쪽 강조색은 --brand 계열로
                                          옮겼으니 새로 쓰지 말 것
```

**폰트**: 사용자가 지정한 "카카오큰글씨" = `KakaoBigSans` (헤드라인용), 짝인 `KakaoSmallSans`
(본문용)도 같은 출처에서 받아 함께 쓴다. 둘 다 `kakaoaisail.org/resources/fonts/` 에서 받은
공식 웹폰트 파일을 `public/fonts/` 에 넣고 `src/index.css` 에 `@font-face` 로 등록했다
(`--sans-kakao`, `--sans-kakao-body` 토큰, Pretendard 로 폴백). body 기본 폰트는
`--sans-kakao-body`, `<h1>`은 `--sans-kakao` — 새 텍스트 스타일을 추가할 때 이 규칙을 따를 것.

`.reveal.d1~d6` 는 순차 등장 애니메이션. JS 없이 CSS 만으로 동작하고
`prefers-reduced-motion` 대응도 들어 있다.

**테마**: **라이트 고정.** 다크 모드는 없다 — 사용자가 명시적으로 다크 모드를 만들지 말라고
했다. `ThemeProvider`/`useTheme` 코드 자체는 남아 있지만 Rail 의 토글 버튼은 없앴으므로
사실상 도달 불가능한 경로다 (완전히 걷어내진 않았다 — 필요하면 물어보고 정리할 것).
`index.html` 인라인 스크립트는 `data-theme='dark'` 를 무조건 박아 넣는데, 이건 과거 다크
기본값의 흔적이라 이름만 `dark` 지 실제 색은 위 라이트 토큰을 따른다 — 헷갈리면 `theme.ts` 참고.

로고는 `public/kakao-logo-yellow.png`(Rail·Hub 파트너) 워드마크를 쓴다. 원래 있던
SM CI 로고 SVG 6개는 리브랜딩 과정에서(이동 중 파일 잠금 이슈로) 유실됐고, 코드 어디서도
더 이상 참조하지 않는다.

**허브 2열 레이아웃**: `.main-split` 은 `900px` 이하에서만 1열로. 그 위(13" 노트북 포함)는
좌우 패딩을 `clamp()` 로 줄여 2열 유지.

### 잡(job) 구조를 쓰는 이유

영상 생성은 수 분짜리 LRO다. HTTP 요청 하나로 기다리면 타임아웃에 걸린다.
`POST /api/generate` 는 즉시 `jobId` 만 반환하고 프론트가 `GET /api/jobs/:id` 를 폴링한다.
`docs/GCP-INFRA-GUIDE.md` §1.2 의 패턴. 01 만 이 구조다 — 02 는 동기 호출(`/api/tryon`),
03 은 WebSocket(`/api/live`) 이라 잡 스토어를 쓰지 않는다.

### 배포

정적 파일 + API + Live WS 를 한 프로세스에서 서빙하는 실제 서버(`server/index.ts`)와
`Dockerfile` 이 있다. **카카오 전용 프로젝트에 배포 완료 + IAP 설정 + 스튜디오 3종·갤러리
배포본 실호출 검증까지 완료** (2026-09-22, 리비전 `kakao-web-demo-00001-25l`).

- `pnpm build` 가 `dist/`(프론트) + `dist-server/`(서버)를 만든다. `pnpm start` 로 로컬에서
  배포와 동일하게 띄울 수 있다.
- **재배포** (평소엔 이거면 된다). 서비스가 이미 있으면 `gcloud run deploy` 는 지정하지 않은
  설정(SA·스케일·env·concurrency…)을 **현재 리비전에서 그대로 승계**한다:
  ```
  gcloud run deploy kakao-web-demo --source . \
    --project kakao-ai-summit-26-20260921 --region asia-northeast3
  ```
  `--source .` 가 `Dockerfile` 로 빌드(buildpacks 아님) → Artifact Registry
  `cloud-run-source-deploy`(asia-northeast3) → 배포.
- **서비스를 처음부터 다시 만들 때만** 아래 전체 플래그가 필요하다 (2026-09-22 첫 배포 구성):
  ```
  gcloud run deploy kakao-web-demo --source . \
    --project kakao-ai-summit-26-20260921 --region asia-northeast3 \
    --service-account kakao-ai-runner@kakao-ai-summit-26-20260921.iam.gserviceaccount.com \
    --no-allow-unauthenticated \
    --min-instances 1 --max-instances 1 \
    --concurrency 80 --cpu 1 --memory 512Mi --timeout 300 --cpu-boost \
    --set-env-vars GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=kakao-ai-summit-26-20260921,GOOGLE_CLOUD_LOCATION=global,GOOGLE_CLOUD_OUTPUT_GCS_URI=gs://kakao-demo-web-bucket/output,IAP_AUDIENCE=/projects/120385871992/locations/asia-northeast3/services/kakao-web-demo
  ```
  ⚠️ `--set-env-vars` 는 환경변수 **전체 교체**다. 일부만 고칠 땐
  `gcloud run services update ... --update-env-vars` 를 쓸 것 — 안 그러면 `IAP_AUDIENCE` 가 날아가
  `server/iap.ts` 가 no-op 이 된다.
- **인스턴스 1개 고정**(`--min/max-instances 1`)은 의도된 것 — `server/api.ts` 의 인메모리 잡
  스토어(01 폴링)가 인스턴스 간 공유가 안 된다. 트래픽 없어도 1개가 상시 과금됨.
- 남은 검증: **GCS 서명 URL(QR 다운로드)** 이 런타임 SA 의 token creator 역할로 실제 동작하는지
  (Look Studio 1회). 갤러리는 서명 URL 대신 프록시 스트리밍이라 이 권한과 무관하게 이미 동작한다.
- IAP 는 배포된 서비스에 직접 걸려 있고 `IAP_AUDIENCE` 도 주입돼 있다. 지금 코드는 라우트 차단
  없이 로깅만 — 실제 인가 판단(킬 스위치·레이트리밋)은 이 신원으로 나중에 붙인다.

### 인증 모드 전환

`server/config.ts` 가 `GOOGLE_GENAI_USE_VERTEXAI` 를 보고 갈라진다.
호출 코드(`interactions.create(...)`)는 어느 쪽이든 동일하다.
나중에 다른 GCP 프로젝트로 옮겨도 환경변수만 바꾸면 된다.

## 함정 (실제로 겪은 것들)

1. **리전은 `global`.** `us-central1` 같은 단일 리전은 Omni Flash 가 거부한다
   (`global` / `us` / `eu` 만 지원). 메타데이터 조회는 단일 리전에서도 200이 떠서 헷갈린다.
2. **Vertex 에서 `delivery: 'uri'` 는 `gcs_uri` 가 필수다.** API 키 방식은 Files API 가
   대신 받아주지만 Vertex 는 본인 버킷을 요구한다.
3. **API 키를 클라이언트에 노출하지 말 것.** `VITE_` 접두사를 붙이면 번들에 박힌다.
   서버 쪽에서만 읽는다.
4. **Omni 1.1 은 모델 ID 가 인증 모드마다 다르다.** Vertex 는 `gemini-omni-1.1-flash-preview`,
   Gemini API 키는 `gemini-omni-1.1-flash` 다. 블로그·AI Studio 문서에는 후자만 적혀 있어서
   그대로 베끼면 Vertex 에서 404 가 난다. `server/omni.ts` 의 `omniModelFor()` 가 갈라준다.
5. **SDK 타입이 공식 문서보다 정확하다.** 문서는 `generationConfig.videoConfig` (camelCase)
   라고 써 있지만 실제 타입은 `generation_config.video_config` (snake_case) 다.
   파라미터를 추측하지 말고 `node_modules/@google/genai/dist/genai.d.ts` 를 grep 할 것.
6. **영상 확장에 `previous_interaction_id` 를 쓰지 말 것.** Vertex 는 이 값을 에러 없이
   무시해서, 앞 영상과 무관한 새 영상이 나오는데도 정상처럼 보인다 (문서의 멀티턴 확장
   예시는 Gemini API 키 기준이다). 앞 영상의 `gs://` 를 `document` 입력으로 직접 넣어야
   한다. 확인은 응답 `usage.input_tokens_by_modality` 에 `video` 가 잡히는지로 한다.
7. **`virtual-try-on-001` 등 Vertex 이미지 API 는 PNG/JPEG 만 문서상 보장한다.** 샘플 이미지는
   `.webp` 로 최적화돼 있으므로(로딩 속도), `src/lib/image.ts` `shrink()` 가 모델로 보내기 전
   webp 를 항상 canvas → JPEG 로 재인코딩한다. webp 를 그대로 payload 에 실으면 Try-On 이
   거부할 수 있다. Omni(Gemini 계열)는 webp 를 받지만 일관성을 위해 같은 경로를 쓴다.

## 비용 — 중요

**회사 결제 계정으로 청구된다.** 사용자는 비용에 민감하고, 불필요한 지출을 하지 말라는
지시를 받은 상태다.

- Omni 1.1 Flash: 해상도별 출력 토큰이 다르다 (360p 1,931 / 720p 5,792 / 1080p 8,688 / 4k 17,376 토큰/초).
  720p 기준 **1초당 $0.10** (5초 = $0.50), 1080p 는 그 1.5배.
  UI 는 360p·720p·1080p 를 노출한다 — 4k 는 부스에서 비용이 튀므로 열지 않았다.
  360p 는 초안·테스트용으로 유용하다 (720p 의 약 1/3).
- 실제 생성 호출을 하기 전에 사용자에게 확인받을 것. 테스트로 임의 생성 금지.
- 설정 확인·메타데이터 조회·타입체크는 무료. 여기까지는 자유롭게 해도 된다.
- 부스는 방문자가 반복해서 누르는 환경이다. **호출 상한과 킬 스위치가 필수**
  (`docs/GCP-INFRA-GUIDE.md` §2.7, §10.2, §10.3).

## 작업 스타일

- 파라미터·API 형태를 **추측하지 말 것.** SDK 타입 정의나 공식 문서로 확인하고 쓴다.
- GCP 리소스를 임의로 만들지 말 것. 필요하면 먼저 물어본다.
- 주석과 UI 문구는 한국어. 코드 식별자는 영어.
- 검증하지 않은 것을 "됐다"고 말하지 말 것. 못 돌려본 경로는 그렇다고 명시한다.

## 결정 · 합의 — `docs/consensus/`

대화 중 **사용자 결정이 필요한 사항**이 나오면 `PLAN.md` 에 "미정"으로 남기지 말고
`docs/consensus/<YYYY-MM-DD>-<주제>.md` 파일을 새로 만든다.

- 질문마다 선택지를 **A / B / C …** 로 정리하고 추천안을 표시한다.
- 각 항목에 `**답변:**` 빈 줄을 둔다. 사용자가 거기 적으면 그대로 코드·`PLAN.md`·`CLAUDE.md` 에 반영한다.
- 파일 상단에 진행 상태(`미해결 (n/m)` → `해결됨 · 날짜`)를 적는다.
- `PLAN.md` 본문에는 **확정된 내용만.** 미정 항목은 `합의 D3` 처럼 합의 파일 ID 로 링크만 건다.
- 사용자는 이 파일들을 보고 답하고, 나는 그 답을 바로 읽어 반영한다.

## 참고

- `PLAN.md` — 부스 전까지 할 일 (확정된 것만)
- `docs/consensus/` — 사용자 결정 대기/완료 목록 (위 §결정·합의)
- `docs/GCP-INFRA-GUIDE.md` — 선배 프로젝트(`veo-dashboard`)를 분석한 인프라 가이드.
  §2 인증, §5 배포 대상, §9 장시간 작업, §12 안티패턴이 특히 유용하다.
  단 **"선배가 한 것"과 "이렇게 해라"가 섞여 있으니** 구분해서 읽을 것.