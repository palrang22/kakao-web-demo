# PLAN.md — SM AI Day 부스 · 앞으로 할 일

> ⚠️ **DEPRECATED (2026-09-21).** 이 문서는 SM AI Day 부스(2026-09-14) 준비 당시의 작업 목록이다.
> 이 레포는 이제 카카오 AI 돛 Summit 26(2026-09-29, BPEX 부산)용으로 리브랜딩됐고,
> 이 문서는 더 이상 "앞으로 할 일"이 아니라 **과거 변경 이력 확인용 참고 자료**로만 남긴다.
> 새로운 할 일은 여기에 추가하지 말 것 — 필요하면 새 문서를 만든다.

> 최종 갱신: **2026-09-10** — `minling-ai-day-project` 로 프로젝트 이전하며 갱신.
> 배경·GCP 설정·디자인 토큰·비용·함정은 `CLAUDE.md`. 이 문서는 **부스(2026-09-14) 전까지 할 일**만 담는다.

## 현재 상태

- 스튜디오 3종: UI·실호출 검증 완료 (2026-08-26).
- **2026-09-10 프로젝트 이전** `kktae-demo` → `minling-ai-day-project` (둘 다 공용 프로젝트).
  Cloud Build 재배포 + 새 SA(`smproject-ai-runner`, 단수) + 새 버킷(`smproject-sh2`) +
  IAP 커스텀 OAuth 재구성 + 스튜디오 3종·갤러리 실호출 재검증까지 완료. 상세는 `CLAUDE.md` §GCP 설정.
- 남은 작업: §QR 서명 URL 배포본 확인 → §1(콘서트·레드카펫 에셋) → §공통(호출 상한·킬 스위치) → 구 프로젝트 정리.

---

## QR 공유 (서명 URL) — 최우선

`DownloadQr` 가 `url` 없으면 "QR 다운로드는 준비 중이에요" 만 띄운다. 이걸 푼다. 갤러리(§4)도 서명 URL 사용.

### 배경 (권한 문제 아님)

- `server/gcs.ts` `createSignedUrl` → `getSignedUrl({ version: 'v4', action: 'read' })`.
  V4 read 서명은 **GCS API 를 안 부른다** — 순수 서명 + (키 없을 때) IAM `signBlob`.
  → **버킷 권한(`storage.*`)과 무관.** 업로드가 되는 것과 별개.
- 로컬 `Cannot sign data without 'client_email'` = `pnpm dev` 가 사용자 개인 ADC 로 도는데
  개인 계정엔 서명 주체가 없어 `signBlob` 경로를 못 탄다.

### 권한

- 배포 런타임 SA `smproject-ai-runner@minling-ai-day-project.iam.gserviceaccount.com` 에
  `roles/iam.serviceAccountTokenCreator` (self-bind) — **이거 하나.** → ✅ 완료 (2026-09-10, 이전하며 재설정)
- `iamcredentials.googleapis.com` API 가 켜져 있어야 `signBlob` 이 먹는다 → ✅ 이전 시 enable 함.

### 코드 (2026-09-07) ✅

- **impersonation** — `server/gcs.ts` `GCS_SIGNER_SA` 환경변수가 있으면 그 SA 를 impersonate 해서 서명
  (`google-auth-library` `Impersonated`). 없으면 기본 ADC. 배포에선 비워두면 런타임 SA 로 직접 서명.
  `.env.local` 에 설정함. `.env.example` 문서화. `pnpm add google-auth-library@9.15.1`.
- **오류 노출** — `createSignedUrl` 이 `{ url, error }` 를 돌려준다. 서명 실패 시 원본 에러가
  `downloadError` 로 잡(job)·tryon 응답까지 흐르고, `DownloadQr` 팝오버가 "준비 중이에요" 대신
  **[🔎 오류 보기]** 버튼을 띄운다 → `src/lib/errorReport.ts` 로 새 탭에 원문 표시
  (`ErrorBanner` 의 "에러코드 확인하기" 와 같은 유틸, 공유로 분리).

### 남은 것

- [ ] **배포본 QR 확인** — `minling-ai-day-project` 배포에서 Look Studio 1회 →
      QR 버튼이 뜨는지 / Cloud Run 로그에 `서명 URL 생성 실패` 없는지.
      런타임 SA self-bind(`serviceAccountTokenCreator`)로 `GCS_SIGNER_SA` 없이 동작해야 함.
  - `PERMISSION_DENIED ... signBlob` → self-bind 재확인.
  - `Cannot sign data without 'client_email'` → Cloud Run 에 SA attach 안 됨(`--service-account` 확인).
- [ ] **로컬 QR**(선택) — `kseungh@mz.co.kr` 이 `smproject-ai-runner` SA 에
      `roles/iam.serviceAccountTokenCreator` 를 가지면 `pnpm dev` + `GCS_SIGNER_SA` impersonate 로도 확인 가능.
      Owner 권한이 있으니 직접 부여 가능하지만, 배포본에서 확인되면 급하지 않음.

---

## 배포 IAM — 정리 (2026-09-10, `minling-ai-day-project` 기준)

앱이 쓰는 GCP: **Vertex(`@google/genai`) + GCS(`@google-cloud/storage`) 둘뿐.**

런타임 SA `smproject-ai-runner@minling-ai-day-project.iam.gserviceaccount.com` 보유
(공용 프로젝트라 프로젝트 레벨 `Editor` 안 주고 최소권한으로):

| 필요 | 부여한 역할 | 상태 |
|---|---|---|
| Vertex 3종 호출 | 콘솔 표기 "Agent Platform User" (`aiplatform.user` 계열) | ✅ 실호출 확인 (2026-09-10) |
| 버킷 업로드/다운로드/목록/삭제 | `roles/storage.objectAdmin` — **버킷 `smproject-sh2` 한정** | ✅ 실호출 확인 |
| 서명 URL (`signBlob`) — QR·갤러리 | `roles/iam.serviceAccountTokenCreator` (self-bind) | ✅ 바인딩 완료 (배포본 QR 확인은 §QR) |

배포용(런타임 아님): 기본 compute SA `926665583116-compute@developer.gserviceaccount.com` 에
`roles/cloudbuild.builds.builder` — `gcloud run deploy --source` 빌드용. 조직 정책상 자동 부여가
꺼져 있어 수동으로 줬다.

### 이전 시 확인 완료

- [x] `aiplatform.googleapis.com` / `run` / `storage` / `artifactregistry` / `cloudbuild` /
      `iap` / `iamcredentials` API enable
- [x] Cloud Run 이 `smproject-ai-runner` SA 로 돎 (`--service-account` 지정)
- [x] `IAP_AUDIENCE` = `/projects/926665583116/locations/asia-northeast3/services/smprojects-sh`
- [x] IAP 커스텀 OAuth(External 동의 화면) + `domain:mz.co.kr` → `roles/iap.httpsResourceAccessor`
- [x] 비로그인 → 구글 로그인 벽 / `@mz.co.kr` 통과 확인

---

## 0. 이름 변경 — 취소 (2026-09-07)

한 번 Short-Form Studio / AI Closet / Face-Reading AI 로 바꿨다가 **사용자가 원복**.
**기존 이름 유지**: Motion Studio (`/video`) / Look Studio (`/image`) / Voice Studio (`/audio`).
(참고: `docs/consensus/2026-09-07-plan-open-decisions.md` D1·D2 는 취소 처리.)

---

## 1. Motion Studio (`/video`) — 숏폼

**흐름:** [인물 선택] + [컨셉 선택] 2단계. 컨셉 버튼 → 정제 프롬프트 자동 채움(D3) +
그 컨셉의 배경·옷이 붙는다. 옷이 2벌 이상이면 컨셉 칸에서 고른다 (합의 `motion-studio-outfit` D1).

### 구조 ✅ 완료 (2026-09-07)

- [x] `PersonPicker` → `src/components/PersonPicker.tsx` 로 추출, Motion·Look 공유. LookStudio 로컬 복사본 제거.
- [x] `src/lib/concepts.ts` — `CONCEPTS` (놀이공원 / 콘서트 / 레드카펫).
      `{ id, label, prompt, refImages?: string[], outfits?: string[], aspectRatio? }`.
      `prompt` 는 **사용자 작성 — 건드리지 않음.**
- [x] `MotionStudio.tsx` — 일반 모드 = `[PersonPicker] + [ConceptPicker]` (`.slots` 2열). 확장 모드는 기존 `사진 추가` 유지.
      기본값 **9:16 · 720p · 10초** (D4). 해상도·길이 컨트롤 그대로.
- [x] `ConceptPicker` — 컨셉 선택 시 배경(`refImages`) 로드 + 옷(`outfits`): 1벌 자동 / 2벌+ 는 썸네일 그리드에서 선택.
- [x] 생성 요청 `images = [인물, 옷, ...배경들].filter(Boolean)`. 서버 변경 없음.
- [x] 놀이공원은 사용자가 넣은 `motion-studio/amusement-park/` 파일로 연결. 브라우저 확인 완료.

### 남은 것

- [ ] **콘서트 · 레드카펫 에셋** — `red-carpet/` 는 채워짐, `concert/` 는 `concert-hall` 만 있음.
      배경·옷 파일을 PNG 로 넣고 `pnpm optimize:samples` (→ webp) 후 `concepts.ts` 의
      `refImages` / `outfits` 배열에 `.webp` 경로 추가.
      (파일 명명: 배경 `*-background`, 옷 `g-*` / `b-*` 등 — 사용자 규칙)
- [ ] ⚠️ **실호출 검증 안 됨** — 인물 + 옷 + 배경 여러 장을 넣었을 때 의도대로 나오는지.
      컨셉별 1회 360p 테스트 필요 (비용 — 사용자 확인 후).

---

## 2. Look Studio (`/image`) — 옷 입히기 · ✅ 완료 (2026-09-07)

- [x] **샘플 의상** — 폴더별 섹션(`public/samples/look-studio/<섹션>/`), 세로 스크롤. 데이터는 `src/lib/garments.ts` `GARMENT_SECTIONS`.
- [x] **최대 2벌** — `Picked[]` 상태, 서버로 `products` 배열 전송 (`products.slice(0,2)` 이미 지원). `직접 올리기`도 유지.
- [x] **인물 선택** — 공유 `PersonPicker` (웹캠 촬영 포함).
- [x] "이 사진으로 계속하기" 체이닝 유지.
- [ ] 문구/라벨은 사용자가 조정 (`garments.ts`, `LookStudio.tsx`).

### 참고

- `virtual-try-on-001` 은 상의/하의/원피스만. 가방·모자·소품 불가 (`CLAUDE.md`).
- Vertex 전용, `us-central1` 리전 (`server/tryon.ts` 가 `locationOverride` 로 처리 중).

---

## 3. 스튜디오 이름 — 변경 안 함 (§0)

Motion / Look / Voice Studio 그대로.

---

## 4. Media Gallery (신규) — ✅ 코드 완료 (2026-09-07) · 배포본 실동작 확인 대기

**목표:** 지금까지 사람들이 만든 **01·02 의 사진·영상**이 슬라이드쇼로 넘어가는 화면. (03 Voice Studio 는 제외 — D7)
좌하단 레일 메뉴에서 갤러리 아이콘 → **관리자 비밀번호** 통과 후 진입.

### 접근 ✅

- [x] 새 라우트 `/gallery`, `src/routes/Gallery.tsx`.
- [x] `src/components/Rail.tsx` 좌하단(관리자 아이콘 위)에 `GalleryIcon` 추가 (`Icons.tsx` 에 신규).
- [x] **관리자 게이트 추출** — `src/lib/admin.ts`(비번·세션) + `src/components/AdminGate.tsx`(래퍼).
      `Settings.tsx` 도 이걸 쓰도록 리팩터. `/gallery` 는 `App.tsx` 에서 `<AdminGate>` 로 감쌈. 비번 `aprk12!` 그대로.

### 서버 ✅ (GCS 버킷 목록 조회 — 재시작·재배포와 무관하게 부스 하루 종일 누적)

- [x] `GET /api/gallery` — `gs://smproject-sh2/output` 나열. `contentType` → 경로(`/looks/` = 이미지) 순으로 타입 분류.
      각 항목 `url` 은 **서버 프록시 경로** `/api/gallery/media?object=…` + 생성시각, 최신순, 최대 80개.
- [x] `GET /api/gallery/media?object=<경로>` — GCS 에서 바로 스트리밍(Range 지원). **서명 URL 안 씀.**
      갤러리는 관리자가 IAP + AdminGate 뒤에서만 보므로 IAP 우회 서명 URL 이 불필요 → `signBlob` 권한과
      무관하게 로컬·배포 모두 동작. (서명 URL 이 꼭 필요한 건 IAP 밖에서 열리는 QR 다운로드뿐)
- [x] `DELETE /api/gallery?object=<경로>` — `output/` 밖은 거부, 버킷에서 해당 오브젝트 삭제.
- [x] `server/gcs.ts` 에 `listObjects` / `deleteObject` / `statObject` / `objectReadStream` 추가.
- 목록·프록시·삭제 모두 ADC(Editor)로 동작. 로컬 dev 도 버킷에 결과물이 있으면 그대로 보인다.

### 프론트 ✅ (슬라이드쇼)

- [x] 사진 **5초**, 영상은 `onEnded` 로 다음(+ 40초 안전 타임아웃).
- [x] **크로스페이드 전환** (2026-09-08 개편) — 이전/현재 두 레이어를 겹쳐 페이드(0.9s) + 살짝 스케일 세틀.
      정지 이미지엔 12초짜리 초저속 켄번스 드리프트(영상 제외). `prefers-reduced-motion` 이면 0.3s 단순 페이드.
      레이어 스택은 `Gallery.tsx` 가 렌더 중 조정(effect 안 setState 회피), 전환 끝나면 뒤 레이어 폐기.
- [x] **마우스 움직이면 하단 바** 슬라이드업(3초 후 숨김). `n/총계` · 종류 · 생성시각 · **[삭제]** → `DELETE /api/gallery` 후 목록에서 제거.
- [x] 45초 폴링. 보던 항목은 인덱스가 아니라 오브젝트 경로로 추적해 갱신 시 화면이 안 튄다.
- [x] **로컬 dev 확인** (2026-09-08) — 실제 버킷 데이터로 크로스페이드·영상 재생·수동 넘김·삭제 동작, 콘솔 에러 없음.
- [ ] **배포본 확인** — 프록시로 이미지/영상이 실제로 뜨는지, 삭제가 버킷에 반영되는지.

### 개인정보

- 갤러리는 관리자만 **여는** 화면이지만, 열려 있으면 부스 방문객에게 **얼굴이 계속 노출**된다.
  → §공통 의 **동의 팝업(매 진입)** 이 전제. 삭제 버튼은 즉시 회수 수단.
- 자동 삭제 규칙 없음 (D6) — **행사 종료 후 스태프가 버킷을 직접 비운다.** 체크리스트에 넣을 것.

---

## 5. 기본 다크 모드 — ✅ 완료 (2026-09-07)

- [x] `src/lib/theme.ts` `readInitialTheme()` — `prefers-color-scheme` 분기 삭제. 저장값 없으면 `"dark"`.
- [x] `index.html` 인라인 스크립트 — `matchMedia` 분기 삭제. 저장값 없으면 `"dark"`.
- [x] 두 곳 주석 정리. `useLogo`·토글 로직은 그대로.

---

## 6. 13" 노트북 레이아웃 — ✅ 코드 완료 (2026-09-07) · 실기 확인 대기

- [x] 2열 붕괴 브레이크포인트 `1080px` → **`900px`** (`.main-split` + 히어로 테두리 스왑 미디어쿼리 둘 다).
- [x] `.main-split` → `grid-template-columns: minmax(0,1.05fr) minmax(340px,1fr)`.
- [x] `.hero` / `.panel` / `.mod` 의 좌우 패딩·gap 을 `clamp()` 로 (폭 좁아지면 자연스레 축소).
- [x] **실기 확인** — 사용자 13" 노트북에서 2열 유지되는지. (빌드는 통과, 브라우저 리사이즈 확인은 사용자/스크린샷)
- [x] (별건) 샘플 이미지 최적화 — 2026-09-08 완료. ↓ §7 참고.

---

## 7. 샘플 이미지 최적화 — ✅ 완료 (2026-09-08)

`public/samples/` 가 PNG 31개 · 183MB (장당 5~9MB, ~1536×2752) 라 배포본에서 피커 그리드
로딩이 느렸다. `shrink()` 는 모델 payload 만 줄이지 그리드 표시는 원본을 그대로 받는다.

- [x] `scripts/optimize-samples.mjs` (`pnpm optimize:samples`) — sharp 로 긴 변 1536px · webp q82.
      원본은 저장소 루트 `samples-original/` 에 백업(`.gitignore`) 후 `.png` 삭제. **183MB → 2.9MB (−99%).**
- [x] 경로 참조 `.png` → `.webp` — `garments.ts` · `concepts.ts` · `PersonPicker.tsx`.
- [x] `src/lib/image.ts` `shrink()` — PNG/JPEG 가 아니면 크기와 무관하게 canvas → JPEG 재인코딩.
      Vertex Try-On 이 webp 를 거부할 수 있어 모델 경로는 항상 JPEG 로 정규화 (`CLAUDE.md` 함정 7).
- [x] `PersonPicker` 썸네일 `loading="lazy" decoding="async"`.
- [x] `server/index.ts` — `/samples/*` 도 `immutable` 장기 캐시 (부스 재방문 시 재다운로드 방지).
- 새 샘플을 넣을 때: PNG 로 `public/samples/<폴더>/` 에 두고 `pnpm optimize:samples` → 경로 배열에 `.webp` 추가.

---

## 공통 / 부스 준비

### 동의 게이트 — ✅ 완료 (2026-09-07)

- [x] `src/components/ConsentGate.tsx` — 라우트 element 를 감싼다 (`src/App.tsx`).
      동의 체크 → "동의하고 시작", "취소" → 홈. 동의 전엔 스튜디오를 렌더 안 함(웹캠 조기 작동 방지).
- [x] **매 진입마다 표시 (D5)** — 라우트 마운트마다 `consented` 가 false 로 시작. `sessionStorage` 안 씀.
      각 라우트의 `<ConsentGate>` 에 `key`(video/image/audio) 를 줘서 스튜디오 → 스튜디오 이동 시에도
      강제 remount (안 그러면 셋이 트리 같은 위치·타입이라 React 가 상태를 유지해 게이트가 건너뛰어짐).
      브라우저에서 video→image→audio 연속 이동 확인 완료.
- [x] `variant="capture"` (`/video`·`/image`) — "사진·영상이 갤러리에 전시, 행사(2026-09-14) 후 폐기, 직접 삭제 가능".
- [x] `variant="live"` (`/audio`) — "얼굴 촬영·음성 인식, 저장 안 됨, 세션 끝나면 데이터 안 남음".
- [x] 스타일 `src/styles/hub.css` — 스튜디오 강조색 반영(`.consent-scrim.video/image/audio`), reduced-motion 대응.
- ⚠️ `capture` 문구의 "행사 후 폐기" 는 **스태프 수동 삭제** (D6). §부스 체크리스트.

### 호출 상한 · 킬 스위치 (아직 없음 — 부스 필수)

- [ ] 일일/세션 **생성 횟수 상한** (`server/api.ts`). 초과 시 친절한 거부.
- [ ] `/settings` 관리자 화면에 **기능 on/off 킬 스위치** — 서버 상태 플래그, `GET /api/health` 나 별도 엔드포인트로 반영.
- [ ] `server/iap.ts` `getIapIdentity()` 로 **신원별 카운트**(스푸핑 불가한 JWT 기준). 지금은 로깅만.
- [ ] `server/api.ts` 잡 스토어(`Map`) TTL — 부스 하루면 무한 증가.
- 참고: `docs/GCP-INFRA-GUIDE.md` §2.7, §10.2, §10.3.

### 배포 후 검증 (실행 시 과금 — 사용자와 함께)

- [x] `/api/live` WebSocket 이 프로덕션 서버에서 실제로 붙는지 (03).
- [x] GCS 서명 URL — **§QR 참고 (권한 대기 중).**
- [x] `IAP_AUDIENCE` 환경변수가 Cloud Run 서비스에 설정됐는지 (없으면 `iap.ts` 가 신원 미검증).

### 필요한 에셋 (사용자 제공)

- ~~Look Studio 샘플 의상~~ → `public/samples/look-studio/` 에 들어옴. ✅
- **Motion Studio 콘서트·레드카펫 에셋** — `concert/` 는 `concert-hall` 만, `red-carpet/` 는 채워짐.
  놀이공원은 완료. 새 파일은 PNG 로 넣고 `pnpm optimize:samples` 로 webp 변환 (§7).
- **`src/lib/concepts.ts` 프롬프트 문구** — 내 초안 상태, 검토·수정 필요.
- ~~샘플 이미지 최적화~~ → 2026-09-08 완료 (§7). ✅

### 부스 당일/종료 체크리스트

- [ ] 행사 종료 후 `gs://smproject-sh2` 의 체험 결과물 **수동 삭제** (동의 문구가 약속한 내용 — D6).
- [ ] 킬 스위치 동작 확인, 호출 상한 리셋.
- [ ] 구 프로젝트(`kktae-demo`) 정리 — Cloud Run `smprojects-sh`, 버킷 `smproject-sh`,
      SA `smprojects-ai-runner`, Artifact Registry 이미지. **우리가 만든 것만.**

### CLAUDE.md 갱신

- [x] 테마 기본값(다크 고정), 허브 2열 레이아웃 900px — 디자인 시스템 섹션에 추가.
- [x] "버킷 30일 자동 삭제 정책" → "수동 삭제" 로 정정.
- [x] 동의 게이트(`ConsentGate`) — 아키텍처 섹션에 추가.
- [x] `/gallery` 라우트 · `AdminGate` — 아키텍처 섹션에 추가.
- [x] §QR 권한 부여되면 "GCP 설정" 섹션의 대기 항목 갱신.
- [x] 프로젝트 이전(`minling-ai-day-project`) — GCP 설정·접근 제어·배포 섹션 갱신 (2026-09-10).

---

## 미해결 합의

- `docs/consensus/2026-09-08-qr-url-단축.md` (0/1) — QR 에 담을 짧은 URL 방식 (A 2번째 서비스 /
  B GCS 공개 / D LB+커스텀도메인 / C 외부단축). **사용자 답변 대기.**

해결됨: `docs/consensus/2026-09-07-plan-open-decisions.md` (7/7), `2026-09-07-motion-studio-outfit.md`.
새 결정거리가 생기면 `docs/consensus/<날짜>-<주제>.md` 로 만든다 (`CLAUDE.md` §결정·합의).
