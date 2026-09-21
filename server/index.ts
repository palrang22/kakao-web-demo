import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import path from 'node:path'
import { createApiMiddleware } from './api.ts'
import { describeConfig, resolveConfig } from './config.ts'
import { getIapIdentity } from './iap.ts'
import { attachLiveServer } from './live.ts'

/**
 * 프로덕션 서버 — Cloud Run 용.
 *
 * dev 환경에서는 Vite 가 정적 파일을, vite.config.ts 의 플러그인이 API 를 맡는다.
 * 배포에는 Vite 가 없으므로 이 파일이 셋 다 한 프로세스에서 서빙한다:
 *   1. 빌드된 프론트엔드 (dist/)
 *   2. API 라우트 (/api/*, /output/*)
 *   3. Live WebSocket (/api/live)
 *
 * Cloud Run 규칙 두 가지를 지킨다: PORT 환경변수를 듣고, 0.0.0.0 에 바인딩한다.
 */

const PORT = Number(process.env.PORT ?? 8080)
const STATIC_DIR = path.resolve(process.cwd(), 'dist')

// Cloud Run 의 파일시스템은 /tmp 만 쓰기 가능하다 (그마저도 메모리다)
const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(process.env.OUTPUT_DIR)
  : path.resolve(process.cwd(), 'output')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
}

/** dist/ 밖으로 나가는 경로를 막는다 */
function resolveStatic(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname)
  const target = path.resolve(STATIC_DIR, `.${decoded}`)
  if (target !== STATIC_DIR && !target.startsWith(STATIC_DIR + path.sep)) return null
  return target
}

async function sendFile(res: ServerResponse, filePath: string, immutable: boolean): Promise<boolean> {
  let size: number
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return false
    size = info.size
  } catch {
    return false
  }

  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': size,
    // 해시가 붙은 자산은 영구 캐시, index.html 은 매번 확인
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(filePath).pipe(res)
  return true
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  const target = resolveStatic(pathname)

  if (target) {
    // /assets/index-abc123.js 처럼 해시가 붙은 파일은 불변으로 취급한다.
    // /samples/* 도 파일명이 고정이고 배포 때만 바뀌므로 장기 캐시한다
    // (부스에서 방문자가 반복 접속 — 매번 재다운로드 방지).
    const immutable =
      pathname.startsWith('/assets/') || pathname.startsWith('/samples/')
    if (await sendFile(res, target, immutable)) return
  }

  // SPA 폴백 — /video, /image 같은 클라이언트 라우트는 index.html 이 받는다.
  // 확장자가 있는 요청(없는 이미지 등)은 폴백하지 않고 404 로 끝낸다.
  if (!path.extname(pathname)) {
    if (await sendFile(res, path.join(STATIC_DIR, 'index.html'), false)) return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not found')
}

function main(): void {
  const config = resolveConfig(process.env)
  const api = createApiMiddleware(config, OUTPUT_DIR)

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

    // IAP 신원 로그 (차단 없음 — IAP 가 이미 네트워크 단에서 mz.co.kr 외 트래픽을 막는다).
    // 지금은 로깅용. 킬스위치/레이트리밋을 붙일 때 이 신원으로 인가 판단을 하게 된다.
    if (pathname !== '/health') {
      void getIapIdentity(req.headers).then((identity) => {
        console.log(`[iap] ${req.method} ${pathname} ← ${identity?.email ?? '(미검증)'}`)
      })
    }

    // Cloud Run 헬스체크. HEAD 도 받아야 한다
    if (pathname === '/health') {
      if (req.method === 'HEAD') {
        res.writeHead(200).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, ready: config.mode !== 'unconfigured' }))
      return
    }

    // API 미들웨어는 자기 담당이 아니면 next() 를 부른다 → 정적 파일로 넘어간다
    void api(req, res, () => {
      void serveStatic(res, pathname)
    })
  })

  attachLiveServer(server, config)

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] listening on :${PORT}`)
    console.log(`[server] 인증: ${describeConfig(config)}`)
    console.log(`[server] static: ${STATIC_DIR}`)
    console.log(`[server] output: ${OUTPUT_DIR}`)
  })
}

main()
