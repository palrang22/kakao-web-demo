/**
 * 인증 방식을 환경변수 하나로 전환한다.
 *
 * - GOOGLE_GENAI_USE_VERTEXAI=true  → Vertex AI. 키 문자열이 없고 ADC 가 인증한다.
 *   (로컬은 `gcloud auth application-default login`, GCP 위에서는 attach 된 서비스 계정)
 * - 그 외                           → Gemini API 키
 *
 * docs/GCP-INFRA-GUIDE.md §2.1 이 권한 구조 그대로다. 어느 쪽이든
 * interactions.create(...) 호출부는 한 글자도 바뀌지 않는다.
 */
export type OmniConfig =
  | { mode: 'vertex'; project: string; location: string; outputGcsUri?: string }
  | { mode: 'apikey'; apiKey: string }
  | { mode: 'unconfigured'; reason: string }

export function resolveConfig(env: Record<string, string | undefined>): OmniConfig {
  if (env.GOOGLE_GENAI_USE_VERTEXAI === 'true') {
    const project = env.GOOGLE_CLOUD_PROJECT
    if (!project) {
      return {
        mode: 'unconfigured',
        reason:
          'GOOGLE_GENAI_USE_VERTEXAI=true 인데 GOOGLE_CLOUD_PROJECT 가 비어 있습니다. .env.local 을 확인하세요.',
      }
    }
    return {
      mode: 'vertex',
      project,
      location: env.GOOGLE_CLOUD_LOCATION || 'global',
      // Vertex 에서 delivery:'uri' 를 쓰려면 결과를 받을 내 GCS 버킷이 필요하다.
      // 없으면 inline(base64) 로 떨어지는데, 4MB 를 넘는 영상은 실패할 수 있다.
      outputGcsUri: env.GOOGLE_CLOUD_OUTPUT_GCS_URI || undefined,
    }
  }

  const apiKey = env.GEMINI_API_KEY
  if (!apiKey) {
    return {
      mode: 'unconfigured',
      reason:
        'GEMINI_API_KEY 가 없습니다. .env.local 에 키를 넣거나, Vertex AI 를 쓰려면 GOOGLE_GENAI_USE_VERTEXAI=true 와 GOOGLE_CLOUD_PROJECT 를 설정하세요.',
    }
  }
  return { mode: 'apikey', apiKey }
}

/** 화면에 띄울 한 줄 설명 */
export function describeConfig(config: OmniConfig): string {
  switch (config.mode) {
    case 'vertex':
      return (
        `Vertex AI · ${config.project} · ${config.location}` +
        (config.outputGcsUri ? ` · ${config.outputGcsUri}` : ' · inline (버킷 미설정)')
      )
    case 'apikey':
      return 'Gemini API 키'
    case 'unconfigured':
      return config.reason
  }
}
