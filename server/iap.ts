import type { IncomingHttpHeaders } from 'node:http'
import { createRemoteJWKSet, jwtVerify } from 'jose'

/**
 * IAP(Identity-Aware Proxy) 서명 검증.
 *
 * IAP 통과 요청에는 헤더 세 개가 붙는다. 앞의 두 개는 스푸핑 가능하고
 * `X-Goog-IAP-JWT-Assertion` 만 서명이 있어서 신뢰할 수 있다 (CLAUDE.md 참고):
 *   X-Goog-Authenticated-User-Email
 *   X-Goog-Authenticated-User-Id
 *   X-Goog-IAP-JWT-Assertion        ← 이것만 검증한다
 *
 * IAP 는 Cloud Run 에 직접 붙인다 (로드밸런서 없음, 2026 GA).
 * 이 방식의 audience 포맷은 로드밸런서 방식(backendServices/...)과 다르다:
 *   /projects/PROJECT_NUMBER/locations/REGION/services/SERVICE_NAME
 *
 * IAP_AUDIENCE 가 없으면(로컬 개발 등, IAP 뒤가 아님) 항상 null 을 반환한다 — no-op.
 */

const JWKS = createRemoteJWKSet(new URL('https://www.gstatic.com/iap/verify/public_key-jwk'))

export type IapIdentity = { email: string }

export async function getIapIdentity(headers: IncomingHttpHeaders): Promise<IapIdentity | null> {
  const audience = process.env.IAP_AUDIENCE
  if (!audience) return null

  const token = headers['x-goog-iap-jwt-assertion']
  if (typeof token !== 'string') return null

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: 'https://cloud.google.com/iap',
      audience,
    })
    return typeof payload.email === 'string' ? { email: payload.email } : null
  } catch {
    // 서명 불일치, 만료, audience 불일치 등 — 호출부가 차단 여부를 결정하므로 여기선 조용히 null
    return null
  }
}
