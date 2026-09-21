import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import { createApiMiddleware } from './server/api.ts'
import { describeConfig, resolveConfig, type OmniConfig } from './server/config.ts'
import { attachLiveServer } from './server/live.ts'

/**
 * 개발 서버에만 붙는 API 라우트.
 *
 * API 키는 서버 쪽에서만 읽는다 — VITE_ 접두사를 쓰면 번들에 그대로 박혀서
 * 브라우저에 노출되므로 절대 쓰지 않는다.
 */
function omniApiPlugin(config: OmniConfig, outDir: string): PluginOption {
  return {
    name: 'omni-flash-api',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info(`  \x1b[35m➜\x1b[0m  인증: ${describeConfig(config)}`)
      server.middlewares.use(createApiMiddleware(config, outDir))

      // 03 Voice Studio 의 WebSocket 프록시.
      // Vite 의 HMR 소켓과 같은 서버를 쓰므로 경로로만 갈라진다.
      if (server.httpServer) attachLiveServer(server.httpServer, config)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 세 번째 인자를 '' 로 두면 VITE_ 접두사 없는 변수까지 전부 읽는다
  const env = loadEnv(mode, process.cwd(), '')
  const outDir = path.resolve(process.cwd(), 'output')

  return {
    plugins: [react(), omniApiPlugin(resolveConfig(env), outDir)],
  }
})
