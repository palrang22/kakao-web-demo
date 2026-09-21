# Google Cloud 연계 앱 인프라 세팅 가이드

> **이 문서를 읽는 에이전트에게**
> 이 문서는 2025년에 실제 운영된 레퍼런스 프로젝트(`veo-dashboard`)의 인프라 구성을 분석해서, 재사용 가능한 형태로 일반화한 핸드오프 문서입니다.
> 원본은 Google Veo(영상 생성)를 썼지만, 이 문서는 **"Google Cloud API를 호출하는 컨테이너 웹앱"** 전반에 적용되도록 작성했습니다. Gemini, Vision, Speech-to-Text, Document AI, Imagen 등 어떤 API든 인증·배포 구조는 동일합니다.
>
> **작성 시점: 2026-08-26.** 모델 ID, 리전별 지원 여부, 가격, 쿼터는 자주 바뀝니다. 코드에 박기 전에 반드시 공식 문서에서 재확인하세요.
>
> 이 문서에서 가장 중요한 섹션은 **§2 인증**과 **§5 배포 대상 선택**입니다. 나머지는 필요할 때 참조하세요.

---

## 0. TL;DR — 30초 요약

| 항목 | 권장안 |
|---|---|
| 인증 | **서비스 계정 JSON 키를 쓰지 마세요.** 런타임에 서비스 계정을 attach하고 ADC가 자동으로 집게 하세요 |
| 로컬 개발 | `gcloud auth application-default login` |
| 컨테이너 | 멀티스테이지 Dockerfile + 비root 유저. 시스템 바이너리 의존성(ffmpeg 등) 있으면 base 스테이지에 |
| 배포 | **기본은 Cloud Run.** 로컬 디스크/장시간 백그라운드 작업이 있으면 GCE VM. |
| 이미지 저장소 | Artifact Registry (Container Registry는 폐기됨) |
| DB | Cloud Run이면 Cloud SQL, VM이면 Postgres 컨테이너 동봉도 OK |
| 시크릿 | Secret Manager. 최소한 `.env`는 절대 커밋 금지 |
| 제일 먼저 할 일 | **쿼터 확인 + 예산 알림 설정** |

---

## 1. 레퍼런스 프로젝트 구조

### 1.1 스택

```
Next.js 15 (App Router, 프론트+API Routes 한 몸) — TypeScript, React 19
Bun (런타임 및 패키지 매니저)
PostgreSQL 16 (컨테이너)
shadcn/ui + Tailwind CSS v4
@google/genai (Vertex AI SDK), @google-cloud/storage
ffmpeg (시스템 바이너리, 미디어 후처리용)
Docker Compose 3서비스 → GCE VM → GCP HTTPS Load Balancer
```

### 1.2 요청 흐름 (장시간 AI 작업의 전형)

```
브라우저 ──POST /api/jobs──────────→ DB에 pending 레코드 생성, ID 반환
        ──POST /api/start-work────→ 백그라운드 작업만 띄우고 즉시 202 응답
        ──GET  /api/jobs?ids=...──→ 3초 폴링으로 상태 갱신 (진행중인 것만)
                                     │
                      서버 백그라운드 ├─ Google API 호출 (LRO: 수 분 소요)
                                     ├─ LRO 폴링 (지수 백오프 + jitter + 429 처리)
                                     ├─ 결과물을 GCS에서 다운로드
                                     ├─ ffmpeg 후처리
                                     └─ DB 상태 업데이트 → 폴링이 감지
```

**핵심 교훈: Google의 생성형 AI API는 대부분 LRO(Long-Running Operation)입니다.** HTTP 요청-응답 한 사이클 안에서 끝내려 하면 게이트웨이 타임아웃에 걸립니다. 반드시 "즉시 응답 + 상태 폴링" 구조로 가세요.

### 1.3 상태 머신

DB의 `status` 컬럼 하나로 전 구간을 추적합니다. UI 진행률·색상도 이 값에서 파생됩니다.

```
pending → (전처리) → (API 호출중) → (후처리) → completed
                                              ↘ error
```

이 패턴은 그대로 베껴 쓸 만합니다. 상태 문자열과 UI 표시 정보를 한 파일(`constants.ts`)에 모아두면 프론트/백엔드가 같은 소스를 공유합니다.

---

## 2. 인증 — 가장 중요한 섹션

### 2.1 두 갈래 길: API 키 vs Vertex AI

Google의 AI API에 접근하는 방법은 근본적으로 두 가지이고, **이 선택이 인프라 전체를 결정합니다.**

| | **Gemini API (AI Studio)** | **Vertex AI** |
|---|---|---|
| 인증 | `GEMINI_API_KEY` 문자열 | 서비스 계정 / ADC |
| 셋업 난이도 | 5초 | GCP 프로젝트 + IAM + 결제 계정 |
| 프로덕션 적합성 | 프로토타입용 | ✅ 정식 |
| 쿼터 상향 | 제한적 | 가능 (신청 필요) |
| VPC / 감사로그 / 데이터 거버넌스 | ❌ | ✅ |
| 다른 GCP 서비스(GCS, Cloud SQL) 연계 | 별도 인증 필요 | **동일 자격증명 재사용** |

**행사/부스/사내 도구 수준이면 Vertex AI를 권합니다.** 이유는 쿼터보다도 "GCS·DB·로깅까지 자격증명 하나로 끝난다"는 점이 큽니다.

`@google/genai` SDK는 이 스위치를 환경변수 하나로 제공합니다:

```ts
// 레퍼런스 프로젝트의 실제 코드
const ai = new GoogleGenAI({
  vertexai: process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true',
  project:  process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.GOOGLE_CLOUD_LOCATION,
});
```

`vertexai: true`면 API 키를 넘기는 자리가 **아예 없습니다.** 인증은 전부 ADC가 처리합니다.

### 2.2 ADC (Application Default Credentials) 이해하기

Google 클라이언트 라이브러리는 자격증명을 아래 순서로 **자동 탐색**합니다. 코드는 어느 경우에도 동일합니다.

```
1. GOOGLE_APPLICATION_CREDENTIALS 환경변수가 가리키는 JSON 파일
2. gcloud auth application-default login 으로 만든 로컬 캐시
   (~/.config/gcloud/application_default_credentials.json)
3. 실행 중인 GCP 리소스에 attach된 서비스 계정
   (메타데이터 서버 169.254.169.254 에서 단기 토큰 자동 획득)
4. Workload Identity Federation (외부 IdP → GCP 토큰 교환)
```

**이 자동 탐색 덕분에 "로컬은 2번, 프로덕션은 3번"으로 코드 변경 없이 갈 수 있습니다.** 이게 핵심 설계 포인트입니다.

### 2.3 4가지 방식 비교 — 무엇을 고를까

| 방식 | 키 파일 | 만료 | 추천도 | 용도 |
|---|---|---|---|---|
| **SA JSON 키 파일** | 있음 | 없음(영구) | ❌ 지양 | 레거시, GCP 외부에서 불가피할 때만 |
| **VM/Cloud Run에 SA attach** | 없음 | 자동 회전 | ✅ **기본값** | GCP 위에서 도는 모든 것 |
| **Workload Identity Federation** | 없음 | 단기 토큰 | ✅ | GKE, GitHub Actions, 외부 클라우드 |
| **API 키** | - | 없음 | ⚠️ | 프로토타입, Gemini API 한정 |

> 2026년 현재 Google은 서비스 계정 키 생성을 **조직 정책(Organization Policy)으로 기본 차단하는 방향**으로 계속 조여오고 있습니다. 새 프로젝트에서 JSON 키로 시작하는 건 나중에 강제 마이그레이션당할 부채를 지는 겁니다.

### 2.4 레퍼런스 프로젝트가 한 방식 (= 따라하지 말 것)

호스트의 JSON 키 파일을 컨테이너에 볼륨 마운트하는 방식이었습니다:

```yaml
# compose.yaml
environment:
  - GOOGLE_APPLICATION_CREDENTIALS=/app/credentials/application_default_credentials.json
volumes:
  - ./credentials/application_default_credentials.json:/app/credentials/application_default_credentials.json
```

```gitignore
credentials/   # .gitignore에 반드시
```

동작은 하지만 영구 유효한 키가 디스크에 굴러다닙니다. **아래 2.5로 대체하세요.**

### 2.5 ✅ 권장 방식 — 키 파일 없애기

**서비스 계정 생성 + 최소 권한 부여:**

```bash
PROJECT_ID=my-project
gcloud config set project $PROJECT_ID

gcloud iam service-accounts create app-runtime \
  --display-name="App runtime SA"

SA="app-runtime@${PROJECT_ID}.iam.gserviceaccount.com"

# 필요한 것만 골라서 붙이세요 (최소 권한 원칙)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA}" --role="roles/aiplatform.user"        # Vertex AI 호출
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA}" --role="roles/storage.objectAdmin"    # GCS 읽기/쓰기
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA}" --role="roles/cloudsql.client"        # Cloud SQL (쓸 경우)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA}" --role="roles/secretmanager.secretAccessor"  # Secret Manager
```

**런타임에 attach:**

```bash
# Cloud Run
gcloud run deploy my-app --service-account=$SA ...

# Compute Engine
gcloud compute instances create my-vm \
  --service-account=$SA --scopes=cloud-platform ...

# GKE (Workload Identity Federation)
kubectl annotate serviceaccount my-ksa \
  iam.gke.io/gcp-service-account=$SA
```

이렇게 하면 `GOOGLE_APPLICATION_CREDENTIALS`와 볼륨 마운트를 **compose/manifest에서 삭제**할 수 있습니다. 애플리케이션 코드는 한 줄도 안 바뀝니다.

**로컬 개발:**

```bash
gcloud auth application-default login
# 이후 앱을 그냥 실행하면 ADC 2번 경로로 인증됨
```

### 2.6 CI/CD 인증 (GitHub Actions 등)

여기서도 JSON 키를 GitHub Secrets에 넣지 마세요. **Workload Identity Federation**으로 GitHub의 OIDC 토큰을 GCP 토큰과 교환합니다:

```yaml
- uses: google-github-actions/auth@v2
  with:
    workload_identity_provider: projects/123/locations/global/workloadIdentityPools/gh/providers/gh-provider
    service_account: deployer@my-project.iam.gserviceaccount.com
```

### 2.7 앱 자체 인증은 별개 문제

GCP 인증과 **"우리 앱의 사용자 인증"은 완전히 다른 층위**입니다. 레퍼런스 프로젝트는 후자가 사실상 없었습니다:

- 사용자 식별 = 이메일 텍스트 입력란 (검증 없음)
- 관리자 기능 = `ADMIN_SECRET_KEY` 환경변수와 요청 본문 문자열을 단순 비교
- CORS = `Access-Control-Allow-Origin: *`

행사용 단기 앱이면 이 수준도 현실적인 선택이지만, **인터넷에 노출되면 누구나 당신의 GCP 크레딧을 태울 수 있다**는 뜻입니다. 최소한 다음 중 하나는 넣으세요:

- Cloud Run + **IAP(Identity-Aware Proxy)** 또는 `--no-allow-unauthenticated`
- 간단한 비밀번호 게이트 + **레이트 리밋**
- 사용자당/전체 일일 호출 상한을 앱 레벨에서 카운트

#### 2.7.1 Cloud Run 직결 IAP (로드밸런서 불필요) — 실측 (2026-08-27)

Cloud Run은 로드밸런서 없이 서비스에 IAP를 직접 붙일 수 있다 (콘솔 → Cloud Run 서비스 →
Security 탭 → IAP 토글). 배포는 `--no-allow-unauthenticated`로 하고, IAP가 자동으로
자기 서비스 에이전트에 Cloud Run Invoker 권한을 붙여준다.

**JWT 검증 audience 포맷이 로드밸런서 방식과 다르다** — 이걸로 한 번 헤맨다:

```
로드밸런서 뒤   /projects/PROJECT_NUMBER/global/backendServices/BACKEND_SERVICE_ID
Cloud Run 직결  /projects/PROJECT_NUMBER/locations/REGION/services/SERVICE_NAME
```

검증 코드는 `google-auth-library`(무겁고, 이미 SDK의 전이 의존성이라 pnpm 엄격 레이아웃에서
직접 못 씀 — `ws`와 같은 함정) 대신 `jose`로 가볍게 처리 가능:

```ts
const JWKS = createRemoteJWKSet(new URL('https://www.gstatic.com/iap/verify/public_key-jwk'))
const { payload } = await jwtVerify(token, JWKS, {
  issuer: 'https://cloud.google.com/iap',
  audience: process.env.IAP_AUDIENCE, // 위 포맷
})
```

`X-Goog-IAP-JWT-Assertion` 헤더만 서명이 있다. `X-Goog-Authenticated-User-Email` /
`-User-Id`는 스푸핑 가능하니 인가 판단에 쓰지 말 것.

⚠️ **WebSocket 업그레이드 요청에는 IAP가 JWT 헤더를 안 붙이는 경우가 보고돼 있다**
(Google Issue Tracker #238496778). WS 경로를 이 헤더로 fail-closed 시키면 정상 사용자도
막힐 수 있으니, 배포 후 실제로 헤더가 오는지 먼저 확인하고 나서 강제 검증 여부를 정할 것.

---

## 3. 환경변수 레이아웃

레퍼런스 프로젝트의 구성을 정리한 것입니다. 이 그룹핑을 그대로 쓰면 됩니다.

```bash
# ── Google Cloud ────────────────────────────────
GOOGLE_CLOUD_PROJECT=my-project-id
GOOGLE_CLOUD_LOCATION=us-central1        # API가 지원하는 리전인지 확인
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_OUTPUT_GCS_URI=gs://my-bucket/output   # 결과물이 GCS 경유일 때
# GOOGLE_APPLICATION_CREDENTIALS=...     # ← attach 방식이면 불필요

# ── Database ────────────────────────────────────
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=app_db
POSTGRES_USER=app_user
POSTGRES_PASSWORD=...                    # → Secret Manager 권장
DATABASE_URL=postgresql://...

# ── App ─────────────────────────────────────────
NEXT_PUBLIC_BASE_URL=http://localhost:3000   # 서버→자기 자신 API 호출에 필요
ADMIN_SECRET_KEY=...                     # → Secret Manager 권장
NODE_ENV=production

# ── 동시성 제한 (실제로 코드에서 읽어야 함!) ────
MAX_CONCURRENT_API_CALLS=2
MAX_CONCURRENT_FFMPEG=3

# ── Docker 바인드 마운트 권한 (§4.3 참조) ───────
UID=1000
GID=1000
```

> ⚠️ **레퍼런스 프로젝트의 실제 버그:** `MAX_CONCURRENT_*` 세 개가 `.env.example`과 `compose.yaml`에 정의돼 있지만 **소스 어디에서도 읽지 않았습니다** (`grep` 결과 0건). 환경변수를 선언했으면 반드시 코드에서 소비하는지 확인하세요. 이런 "장식용 환경변수"는 "동시성 제어가 되고 있다"는 착각을 만들고, 트래픽이 몰릴 때 그대로 터집니다.

**Secret Manager 사용법:**

```bash
echo -n "my-password" | gcloud secrets create db-password --data-file=-

# Cloud Run에서 환경변수로 주입
gcloud run deploy my-app --set-secrets=POSTGRES_PASSWORD=db-password:latest
```

---

## 4. Docker 구성

### 4.1 Dockerfile — 멀티스테이지 템플릿

```dockerfile
# ── base: 시스템 의존성 ──────────────────────────
FROM oven/bun:1-alpine AS base
RUN apk add --no-cache ffmpeg && rm -rf /var/cache/apk/*
#   ↑ 시스템 바이너리가 필요하면 여기. npm 패키지(fluent-ffmpeg 등)는
#     대부분 그냥 래퍼라서 실제 바이너리가 없으면 런타임에 조용히 실패합니다.

# ── deps: 의존성만 (레이어 캐시 극대화) ──────────
FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── builder: 빌드 ───────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN bun run build

# ── runner: 최종 이미지 ─────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000

ARG UID=1000
ARG GID=1000
RUN addgroup -g $GID -S appgroup && adduser -u $UID -S appuser -G appgroup

# Next.js standalone 출력을 쓰면 이미지가 훨씬 작아집니다
# (next.config.ts 에 output: "standalone")
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

RUN mkdir -p /app/data && chown -R appuser:appgroup /app
USER appuser:appgroup

EXPOSE 3000
CMD ["bun", "server.js"]
```

**왜 이렇게 하는가:**

| 결정 | 이유 |
|---|---|
| 멀티스테이지 | 소스코드·빌드툴이 최종 이미지에 안 남음. 부수 효과로 **credentials 같은 파일도 최종 이미지에서 배제됨** |
| `deps` 스테이지 분리 | 소스만 바뀌었을 때 `bun install` 재실행 안 함 → 빌드 시간 대폭 단축 |
| 시스템 패키지는 `base`에 | builder와 runner 양쪽에서 공유 |
| 비root 유저 | 컨테이너 탈출 시 피해 축소. 많은 조직에서 필수 정책 |
| `standalone` 출력 | `node_modules` 전체를 복사하지 않아 이미지가 수백 MB 줄어듦 |

> ⚠️ **레퍼런스 프로젝트의 실제 버그 2건:**
> 1. `COPY package.json bun.lockb ./` — 레포에는 `bun.lock`(텍스트)만 있고 `bun.lockb`(바이너리)가 없어서 **빌드가 실패합니다.** Bun이 lockfile 포맷을 바꾼 뒤 Dockerfile을 안 고친 케이스.
> 2. `next.config.ts`에 `output: "standalone"`을 켜놓고 Dockerfile은 `.next/standalone`을 안 씁니다. `node_modules`를 통째로 복사해서 이미지가 불필요하게 큽니다.

### 4.2 docker-compose.yaml — 로컬/VM 공용

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=${POSTGRES_DB:-app_db}
      - POSTGRES_USER=${POSTGRES_USER:-app_user}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-changeme}
      - POSTGRES_INITDB_ARGS=--encoding=UTF-8
    volumes:
      - postgres-data:/var/lib/postgresql/data   # named volume
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-app_user}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    restart: unless-stopped

  app:
    build:
      context: .
      args:
        UID: ${UID:-1000}
        GID: ${GID:-1000}
    user: "${UID:-1000}:${GID:-1000}"
    ports: ["3000:3000"]
    environment:
      - GOOGLE_CLOUD_PROJECT=${GOOGLE_CLOUD_PROJECT}
      - GOOGLE_CLOUD_LOCATION=${GOOGLE_CLOUD_LOCATION:-us-central1}
      - GOOGLE_GENAI_USE_VERTEXAI=true
      - DATABASE_URL=${DATABASE_URL}
    volumes:
      - ./data/output:/app/data/output    # 결과물을 호스트에서 바로 꺼내려면 바인드 마운트
    depends_on:
      postgres:
        condition: service_healthy        # ← 중요, 아래 설명
    restart: unless-stopped

volumes:
  postgres-data:
```

**설계 포인트:**

- **`condition: service_healthy`** — 앱이 시작하자마자 `CREATE TABLE IF NOT EXISTS`를 날리는 구조라면, DB가 완전히 뜨기 전에 앱이 붙으면 크래시합니다. 단순 `depends_on`으로는 부족합니다.
- **볼륨 두 갈래** — DB는 named volume(성능/이식성), 사용자 결과물은 **바인드 마운트**(호스트에서 바로 접근 가능). 행사 후 산출물을 꺼내야 한다면 후자가 맞습니다.
- **`restart: unless-stopped`** — VM 재부팅 후 자동 복구.

### 4.3 ⚠️ UID/GID 함정 (리눅스에서 반드시 겪음)

컨테이너가 **바인드 마운트된 호스트 디렉토리에 파일을 쓸 때**, 컨테이너 유저의 UID와 호스트 유저의 UID가 다르면 호스트에서 그 파일을 읽지도 지우지도 못하게 됩니다.

```bash
# .env 에 호스트 유저 UID/GID를 넣어두세요
echo "UID=$(id -u)" >> .env
echo "GID=$(id -g)" >> .env
```

Dockerfile의 `ARG UID/GID` + compose의 `user:`가 이걸 맞춰주는 장치입니다.
**macOS의 Docker Desktop은 알아서 처리해줘서 로컬에서는 문제가 안 보이다가, 리눅스 VM에 올리는 순간 터집니다.** 반드시 배포 환경에서 검증하세요.

### 4.4 .dockerignore / .gitignore

```
# .dockerignore
node_modules
.next
.git
.env*
credentials/          # ← 빌드 컨텍스트에 자격증명이 들어가지 않도록
*.log
```

```
# .gitignore
.env*
!.env.example
credentials/
/data/output/
```

> 레퍼런스 프로젝트는 `.dockerignore`에 `credentials/`가 **없었습니다.** 멀티스테이지 덕에 최종 이미지에는 안 남았지만, builder 레이어에는 키가 들어갔습니다. 빌드 캐시를 공유하는 환경이라면 유출 경로가 됩니다.

---

## 5. 배포 대상 선택 — Cloud Run / GCE / GKE

### 5.1 결정 트리

```
컨테이너화 가능한가?
├─ 아니오 → Compute Engine
└─ 예
   ├─ 로컬 디스크에 영구 저장이 필요한가?
   │  ├─ 예 → GCS로 바꿀 수 있는가?
   │  │       ├─ 예 → Cloud Run
   │  │       └─ 아니오 → Compute Engine
   │  └─ 아니오 ↓
   ├─ HTTP 응답 이후에도 도는 백그라운드 작업이 있는가?
   │  ├─ 예 → Cloud Run(always-on CPU) 또는 Cloud Tasks/Jobs로 분리
   │  └─ 아니오 ↓
   ├─ 서비스가 10개 이상 / 팀이 여럿 / K8s 고유 기능이 필요한가?
   │  ├─ 예 → GKE (Autopilot)
   │  └─ 아니오 → ✅ Cloud Run
```

### 5.2 비교표

| | **Cloud Run** | **Compute Engine** | **GKE** |
|---|---|---|---|
| 운영 부담 | 거의 없음 | VM 관리(패치, 디스크) | 클러스터 업그레이드, 노드풀, 네트워킹 |
| 스케일 | 0 → N 자동 | 수동/MIG | HPA/CA |
| 유휴 비용 | **0원** (scale-to-zero) | 항상 과금 | 노드 항상 과금 |
| 로컬 디스크 | 임시 (컨테이너 죽으면 소멸) | ✅ 영구 디스크 | PV 필요 |
| 백그라운드 작업 | ⚠️ 기본은 응답 후 CPU 스로틀 → **always-on CPU 설정 필요** | ✅ 자유 | ✅ 자유 |
| 요청 타임아웃 | 최대 60분 | 무제한 | 무제한 |
| GPU | ✅ 지원 | ✅ | ✅ |
| 인증 통합 | SA attach 1줄 | SA attach 1줄 | Workload Identity Federation |
| 커스텀 도메인/HTTPS | 자동 | LB 또는 Caddy 직접 | Ingress + cert-manager |

### 5.3 유형별 권장

**① 일반 웹앱 + Google API 호출 (대부분의 경우)**
→ **Cloud Run.** 이게 2026년 기본값입니다. 유휴 시 0원이고, HTTPS·도메인·오토스케일이 공짜로 따라옵니다.

```bash
gcloud run deploy my-app \
  --source .                                   \
  --region us-central1                         \
  --service-account=$SA                        \
  --set-env-vars GOOGLE_GENAI_USE_VERTEXAI=true \
  --set-secrets POSTGRES_PASSWORD=db-password:latest \
  --min-instances 0 --max-instances 10
```

Cloud Run으로 갈 때 반드시 조정할 것:
- **DB는 Cloud SQL로** (컨테이너 Postgres 불가). Cloud SQL 커넥터 또는 유닛 소켓 사용
- **파일 저장은 GCS로.** 로컬 디스크는 인스턴스 재활용 시 사라집니다. GCS FUSE 볼륨 마운트로 버킷을 파일시스템처럼 붙일 수도 있습니다(컨테이너 수정 불필요, 단 메모리를 캐시로 씀)
- **백그라운드 작업이 있으면** `--cpu-boost` 및 **always-on CPU**(`--no-cpu-throttling`) 설정. 기본값은 응답 전송 즉시 CPU가 throttle돼서 `setTimeout`/비동기 작업이 얼어붙습니다
- 더 깔끔한 방법: 무거운 작업은 **Cloud Tasks + 별도 Cloud Run 서비스** 또는 **Cloud Run Jobs**로 분리

**② 로컬 디스크 + 장시간 인프로세스 작업이 있는 앱 (레퍼런스 프로젝트 유형)**
→ **Compute Engine VM + Docker Compose.**

```bash
gcloud compute instances create app-vm \
  --machine-type=e2-standard-2 \
  --boot-disk-size=100GB \
  --service-account=$SA --scopes=cloud-platform \
  --tags=http-server,https-server
```

- 디스크는 넉넉하게. 생성물이 쌓이는데 정리 로직이 없는 앱이 흔합니다
- 컨테이너 이미지를 pull 해서 `docker compose up -d`
- 단기 행사라면 **로컬 노트북에서 동일 Compose로 돌리는 백업 플랜**을 준비해두면 좋습니다 (현장 네트워크가 불안정한 경우 대비)

**③ GKE는 언제 쓰는가**
→ **솔직히 대부분의 프로젝트는 쓸 필요 없습니다.** 다음 중 하나라도 해당될 때만 고려하세요:

- 마이크로서비스가 10개 이상이고 서비스 간 통신 정책이 필요
- StatefulSet, DaemonSet, CRD, 서비스 메시 같은 K8s 고유 기능이 필요
- 여러 팀이 하나의 플랫폼을 공유
- GPU 노드풀을 세밀하게 스케줄링해야 함
- 이미 사내 표준이 K8s임

**클러스터 업그레이드·노드풀 사이징·K8s 네트워킹·RBAC이라는 상시 운영 비용을 감당할 만한 이유가 있어야 정당화됩니다.** 웹앱 하나 띄우려고 GKE를 고르는 건 명백한 오버엔지니어링입니다.

그래도 쓴다면 **Autopilot 모드**(노드 관리 없음) + **Workload Identity Federation**(JSON 키 없음)이 기본 조합입니다:

```bash
gcloud container clusters create-auto my-cluster --region us-central1
# WIF는 Autopilot에서 기본 활성화
```

---

## 6. 이미지 빌드 & 배포 파이프라인

### 6.1 Artifact Registry (Container Registry는 폐기됨)

```bash
REGION=us-central1
REPO=apps

gcloud artifacts repositories create $REPO \
  --repository-format=docker --location=$REGION

# Docker 인증 (1회)
gcloud auth configure-docker ${REGION}-docker.pkg.dev

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/my-app:$(git rev-parse --short HEAD)"
docker build -t $IMAGE .
docker push $IMAGE
```

> `gcloud auth configure-docker`가 권장입니다. 레퍼런스 프로젝트는 `gcloud auth print-access-token | docker login`을 썼는데, 이건 **1시간짜리 임시 OAuth 토큰**이라 매번 다시 해야 합니다. (앱 런타임 인증과는 무관한 별개 절차입니다.)

**태그는 `latest` 말고 커밋 해시로.** `latest`는 롤백이 불가능하고, 어떤 코드가 떠 있는지 추적할 수 없습니다. 레퍼런스 프로젝트는 `IMAGE_TAG=latest` 고정이었습니다.

### 6.2 Cloud Build로 빌드 자동화 (선택)

로컬 머신에서 `docker build` 하면 아키텍처 불일치(Apple Silicon → x86 VM)로 터지는 일이 흔합니다. Cloud Build를 쓰면 이 문제가 사라집니다:

```yaml
# cloudbuild.yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args: ['build', '-t', '${_IMAGE}', '.']
  - name: gcr.io/cloud-builders/docker
    args: ['push', '${_IMAGE}']
images: ['${_IMAGE}']
```

로컬에서 빌드해야 한다면 최소한 `docker build --platform linux/amd64`를 붙이세요.

---

## 7. 네트워킹 · 도메인 · HTTPS

### 7.1 선택지

| 방법 | 난이도 | 비용 | 적합 |
|---|---|---|---|
| **Cloud Run 기본 도메인** | 0 | 무료 | 내부용/데모 |
| **Cloud Run + 커스텀 도메인 매핑** | 낮음 | 무료 | ✅ 대부분 |
| **VM + Caddy** | 낮음 | 무료 | ✅ VM 배포 시 |
| **GCP HTTPS Load Balancer** | 높음 | 시간당 과금 | 멀티리전, Cloud Armor 필요 시 |

레퍼런스 프로젝트는 **HTTPS LB**를 썼습니다 (`next.config.ts`의 `allowedDevOrigins`에 LB IP 2개, 커스텀 도메인, `/health` 엔드포인트가 그 증거). 부스 하나 돌리는 데는 과했습니다.

**VM에 배포한다면 Caddy가 압도적으로 간단합니다** — Let's Encrypt 인증서를 자동 발급/갱신합니다:

```
# Caddyfile
app.example.com {
    reverse_proxy localhost:3000
}
```

### 7.2 헬스체크 엔드포인트는 무조건 만드세요

LB, Cloud Run, K8s 프로브 전부 이걸 씁니다. 캐시 금지 헤더 필수:

```ts
// app/health/route.ts
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
  )
}
export async function HEAD() {
  return new Response(null, { status: 200 })
}
```

`HEAD`도 같이 구현하세요 — 일부 헬스체커는 HEAD만 보냅니다.

### 7.3 CORS

레퍼런스 프로젝트는 미들웨어에서 `Access-Control-Allow-Origin: *`를 전역으로 뿌렸습니다. 프론트와 API가 **같은 도메인(Next.js 한 몸)**이면 애초에 CORS가 필요 없습니다. 습관적으로 `*`를 넣지 마세요.

---

## 8. 데이터 저장 전략

| 데이터 | Cloud Run | GCE VM |
|---|---|---|
| 관계형 데이터 | **Cloud SQL** | Cloud SQL 또는 Postgres 컨테이너 |
| 사용자 업로드/생성물 | **GCS** (필수) | 로컬 디스크 또는 GCS |
| 캐시/세션 | Memorystore(Redis) | Redis 컨테이너 |
| 시크릿 | **Secret Manager** | Secret Manager |

**Google AI API의 산출물은 GCS를 경유하는 경우가 많습니다.** (대용량 결과물은 응답 본문이 아니라 버킷에 씁니다.) 그럴 땐 **API를 호출하는 리전과 버킷 리전을 반드시 일치**시키세요. 다르면 느리고 egress 비용이 붙습니다.

```bash
gcloud storage buckets create gs://my-output --location=us-central1

# 생성물 자동 삭제 (디스크/비용 관리)
cat > lifecycle.json <<'EOF'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}
EOF
gcloud storage buckets update gs://my-output --lifecycle-file=lifecycle.json
```

**DB 마이그레이션:** 레퍼런스 프로젝트는 앱 부팅 시 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`를 직접 날렸습니다. 단일 인스턴스에선 동작하지만 **여러 인스턴스가 동시에 뜨면 레이스가 납니다.** Cloud Run처럼 오토스케일되는 환경이라면 Prisma Migrate, Drizzle Kit 같은 도구를 쓰거나 마이그레이션을 별도 Job으로 분리하세요.

---

## 9. 장시간 작업 처리 — 이 유형 앱의 핵심 난제

Google 생성형 AI API는 수십 초~수 분이 걸립니다. 레퍼런스 프로젝트에서 배울 점과 고칠 점이 뚜렷한 영역입니다.

### 9.1 ✅ 베낄 만한 것: LRO 폴링 로직

```
지수 백오프 (기본 3초 → 최대 30초, factor 1.5)
+ 랜덤 jitter (최대 1초)     ← 여러 인스턴스가 동시에 때리는 것 방지
+ 429/rate limit 별도 처리   ← 더 긴 백오프 (최대 60초)
+ 연속 에러 카운트 (3회 초과 시 실패 처리)
+ 전체 타임아웃 (15분)
```

이건 직접 짜면 은근히 귀찮은 부분이라 그대로 가져다 쓸 가치가 있습니다.

### 9.2 ⚠️ 고쳐야 할 것: 인메모리 백그라운드 작업

레퍼런스 프로젝트는 재시도를 `setTimeout`으로 처리했습니다. 결과:

- **서버 재시작 → 진행 중이던 작업 전부 유실.** DB에는 `generating` 상태로 영원히 남습니다
- Cloud Run에서는 CPU 스로틀 때문에 아예 동작하지 않습니다
- 인스턴스가 2개 이상이면 어느 인스턴스가 작업을 들고 있는지 알 수 없습니다

**제대로 하려면:**

| 규모 | 방법 |
|---|---|
| 소규모/단일 인스턴스 | DB를 작업 큐로 사용 + 부팅 시 orphan 레코드 복구 로직 |
| 중간 | **Cloud Tasks** (HTTP 푸시 큐, 재시도 내장) |
| 큰 규모 | **Pub/Sub** + Cloud Run Jobs |

최소한 **부팅 시 복구 로직**은 넣으세요: "상태가 진행중인데 마지막 갱신이 N분 전인 레코드 → 실패 처리 또는 재개".

### 9.3 ⚠️ 동시성 제어는 실제로 구현하세요

환경변수만 선언하고 끝내면 안 됩니다. 간단한 세마포어라도 넣으세요:

```ts
class Semaphore {
  private active = 0
  private queue: (() => void)[] = []
  constructor(private max: number) {}
  async acquire() {
    if (this.active < this.max) { this.active++; return }
    await new Promise<void>(r => this.queue.push(r))
    this.active++
  }
  release() {
    this.active--
    this.queue.shift()?.()
  }
}
```

**AI API는 쿼터가 빡빡하고 비쌉니다.** 무제한 동시 호출은 429 폭풍 아니면 요금 폭탄으로 이어집니다.

---

## 10. 비용 · 쿼터 · 운영

### 10.1 🔴 제일 먼저: 쿼터 확인

**생성형 AI API는 기본 쿼터가 매우 낮고, 상향 승인에 며칠이 걸립니다.** 프로젝트 준비에서 가장 흔한 사고 지점입니다.

```
Console → IAM & Admin → Quotas & System Limits
→ 쓸 API로 필터 → 현재 한도 확인 → 필요하면 지금 바로 상향 신청
```

데모/행사 일정이 있다면 **최소 1~2주 전에** 확인하세요.

### 10.2 예산 알림은 필수

```bash
gcloud billing budgets create \
  --billing-account=$BILLING_ACCOUNT \
  --display-name="app-budget" \
  --budget-amount=300USD \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=90
```

인증 없는 공개 앱 + 종량제 AI API 조합은 사고가 나면 규모가 큽니다. 앱 레벨 호출 상한과 예산 알림을 **둘 다** 거세요.

### 10.3 관리자 킬 스위치

레퍼런스 프로젝트의 좋은 아이디어 하나: **DB 설정 테이블에 기능 on/off 플래그**를 두고 관리자 페이지에서 토글.

```sql
CREATE TABLE admin_settings (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 예: ('generation_enabled', 'true', '...')
```

API 핸들러 맨 앞에서 이 값을 확인하고 꺼져 있으면 503을 반환합니다. **크레딧이 소진되거나 오남용이 감지됐을 때 재배포 없이 즉시 차단**할 수 있습니다. 강력히 추천합니다.

### 10.4 백업

레퍼런스 프로젝트는 `pg_dump`를 24시간마다 도는 컨테이너를 하나 더 띄웠습니다 (cron 데몬 없이 `sleep 86400` 무한 루프). 투박하지만 의존성이 0이라 VM 환경에서는 합리적입니다. Cloud SQL을 쓴다면 자동 백업이 기본 제공되니 불필요합니다.

### 10.5 로깅

구조화 로깅(JSON)으로 하면 Cloud Logging에서 필드 검색이 됩니다. 레퍼런스 프로젝트의 `Logger`는 단계별 소요시간을 함께 남겨서 병목 추적이 쉬웠습니다:

```ts
Logger.step('API call completed', { videoId, durationMs: 12400, model })
```

**로그에 프롬프트 전문이나 개인정보를 통째로 남기지 마세요.** 레퍼런스는 `substring(0, 100)`으로 잘라서 남겼습니다.

---

## 11. 셋업 체크리스트

**GCP 준비**
- [ ] 프로젝트 생성 + **결제 계정 연결** (이거 없으면 Vertex AI 호출 전부 거부됨)
- [ ] 필요한 API 활성화
      `gcloud services enable aiplatform.googleapis.com storage.googleapis.com artifactregistry.googleapis.com run.googleapis.com`
- [ ] **쿼터 확인 및 상향 신청** ← 리드타임 있음, 제일 먼저
- [ ] 예산 알림 설정
- [ ] 서비스 계정 생성 + 최소 권한 부여
- [ ] GCS 버킷 생성 (API와 **같은 리전**) + 라이프사이클 정책
- [ ] Secret Manager에 비밀값 등록

**로컬 개발**
- [ ] `gcloud auth application-default login`
- [ ] `.env.local` 작성, `.gitignore`에 `.env*` 확인
- [ ] `docker compose up -d postgres` → 앱은 네이티브로 실행 (빠른 반복)
- [ ] 리눅스라면 `.env`에 `UID`/`GID` 설정

**컨테이너**
- [ ] 멀티스테이지 Dockerfile, 비root 유저
- [ ] 시스템 바이너리 의존성 확인 (ffmpeg 등)
- [ ] lockfile 이름이 실제 파일과 일치하는지 확인
- [ ] `.dockerignore`에 `credentials/`, `.env*`
- [ ] `--platform linux/amd64` 또는 Cloud Build 사용

**배포**
- [ ] Artifact Registry 저장소 생성, 커밋 해시 태그로 push
- [ ] 런타임에 서비스 계정 attach (**JSON 키 파일 금지**)
- [ ] `/health` 엔드포인트 (GET + HEAD)
- [ ] HTTPS + 커스텀 도메인
- [ ] 앱 레벨 접근 제어 (최소한 레이트 리밋)
- [ ] 관리자 킬 스위치
- [ ] 재시작 시 orphan 작업 복구 로직

---

## 12. 레퍼런스 프로젝트의 안티패턴 (따라하지 말 것)

작동하는 코드였지만 개선 대상인 항목들입니다. 새 프로젝트에서 반복하지 마세요.

| # | 안티패턴 | 대안 |
|---|---|---|
| 1 | 서비스 계정 JSON 키를 볼륨 마운트 | 런타임에 SA attach (ADC 자동) |
| 2 | `MAX_CONCURRENT_*` 환경변수 선언만 하고 코드에서 미사용 | 세마포어로 실제 구현 |
| 3 | 백그라운드 재시도를 `setTimeout`으로 (재시작 시 유실) | Cloud Tasks 또는 DB 큐 + 복구 로직 |
| 4 | 이미지 태그가 `latest` 고정 | 커밋 해시 태그 |
| 5 | `COPY bun.lockb` — 실제 파일은 `bun.lock` (빌드 실패) | lockfile 이름 검증 |
| 6 | `output: "standalone"` 켜놓고 Dockerfile에서 미사용 | standalone 산출물 복사 |
| 7 | `.dockerignore`에 `credentials/` 누락 | 추가 |
| 8 | CORS `Access-Control-Allow-Origin: *` 전역 적용 | 동일 도메인이면 CORS 불필요 |
| 9 | 사용자 식별이 검증 없는 이메일 텍스트 입력 | 최소한 레이트 리밋, 가능하면 IAP |
| 10 | 앱 부팅 시 DDL 직접 실행 (다중 인스턴스에서 레이스) | 마이그레이션 도구 또는 별도 Job |
| 11 | 생성물이 디스크에 무한 적재, 정리 로직 없음 | GCS + 라이프사이클 정책 |
| 12 | 도메인/IP가 소스에 하드코딩 | 환경변수 |
| 13 | 앱 컨테이너 healthcheck가 주석 처리됨 | 활성화 |
| 14 | 사용하지 않는 named volume, 이전 DB(SQLite) 환경변수 잔재 | 정리 |
| 15 | shadcn/ui 컴포넌트 50개 전체 설치 후 대부분 미사용 | 필요한 것만 |

---

## 13. 참고 링크

- [Best practices for using service accounts securely](https://docs.cloud.google.com/iam/docs/best-practices-service-accounts)
- [Best practices for managing service account keys](https://docs.cloud.google.com/iam/docs/best-practices-for-managing-service-account-keys)
- [Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation)
- [Best practices for using Workload Identity Federation](https://docs.cloud.google.com/iam/docs/best-practices-for-using-workload-identity-federation)
- [Vertex AI 클라이언트 라이브러리](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/libraries)
- [Vertex AI 인증 가이드](https://docs.cloud.google.com/vertex-ai/docs/authentication)
- [Cloud Run: Cloud Storage 볼륨 마운트](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts)
- [Cloud Run CPU 할당 설정 (always-on)](https://oneuptime.com/blog/post/2026-02-17-how-to-configure-cloud-run-cpu-allocation-to-always-on-for-background-processing-workloads/view)
- [Cloud Run vs GKE vs Compute Engine 선택 기준](https://cloudwebschool.com/docs/gcp/compute/choosing-between-cloud-run-gke-and-vms/)
- [GKE Workload Identity Federation 가이드 (2026)](https://computingforgeeks.com/gke-workload-identity-federation-complete-guide/)

---

*작성: 2026-08-26 · 레퍼런스: `veo-dashboard` (2025년 운영) · 모델 ID·가격·쿼터는 반드시 최신 공식 문서에서 재확인할 것*
