# syntax=docker/dockerfile:1

# ── deps ────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
RUN corepack enable
# 소스보다 먼저 복사해야 소스만 바뀌었을 때 install 을 건너뛴다
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── builder ─────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ── runner ──────────────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

# Cloud Run 은 /tmp 만 쓰기 가능하다 (게다가 메모리다)
ENV OUTPUT_DIR=/tmp/output

# 루트로 돌리지 않는다. node 이미지에 이미 있는 계정
USER node

# Cloud Run 이 PORT 를 주입한다. 이건 로컬 실행용 기본값
ENV PORT=8080
EXPOSE 8080

CMD ["node", "dist-server/index.js"]
