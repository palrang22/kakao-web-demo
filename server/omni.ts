import type { GoogleGenAI } from '@google/genai'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from './client.ts'
import type { OmniConfig } from './config.ts'
import { createSignedUrl, downloadFromGcs } from './gcs.ts'

/**
 * Gemini Omni 1.1 Flash (2026-08-27 출시).
 *
 * 모델 ID 가 인증 모드마다 다르다. 2026-09-04 퍼블리셔 모델 메타데이터로 확인:
 *   gemini-omni-1.1-flash-preview → 200 (launchStage PUBLIC_PREVIEW, global 전용)
 *   gemini-omni-1.1-flash         → 404. 이쪽은 Gemini API(키 방식) 의 ID 다
 * 블로그와 AI Studio 문서는 뒤엣것만 적어 두었으니 그대로 베끼면 Vertex 에서 깨진다.
 * 03 Voice Studio 의 liveModelFor 와 같은 구조다.
 */
export const MODEL_ID_VERTEX = 'gemini-omni-1.1-flash-preview'
export const MODEL_ID_APIKEY = 'gemini-omni-1.1-flash'

export function omniModelFor(config: OmniConfig): string {
  return config.mode === 'vertex' ? MODEL_ID_VERTEX : MODEL_ID_APIKEY
}

export type ImageInput = { data: string; mimeType: string }

export type GenerateOptions = {
  prompt: string
  images?: ImageInput[]
  aspectRatio?: string
  resolution?: string
  durationSeconds?: number
  previousInteractionId?: string
  /**
   * 이어 붙일 원본 영상의 gs:// 경로.
   * api.ts 가 previousInteractionId 로 조회해서 채워준다.
   */
  extendFromVideoUri?: string
}

export type GenerateResult = {
  interactionId: string
  fileName: string
  /** IAP 를 거치지 않는 GCS 서명 URL — QR 다운로드용. 서명 실패 시 없음. */
  downloadUrl?: string
  /** 서명 실패 시 원인 전문 — 클라이언트 "오류 보기" 용 */
  downloadError?: string
  /** 결과 영상의 gs:// 경로. 이걸 다음 확장 요청의 입력으로 넣는다 */
  videoGcsUri?: string
}

/** 진행 단계를 호출자(잡 스토어)에게 알려주는 콜백 */
export type StageReporter = (stage: string) => void

// LRO 폴링 파라미터 — docs/GCP-INFRA-GUIDE.md §9.1 의 권장값
const POLL_INITIAL_MS = 3_000
const POLL_MAX_MS = 30_000
const POLL_FACTOR = 1.5
const POLL_TIMEOUT_MS = 15 * 60 * 1000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** File.state 는 SDK 버전에 따라 문자열이거나 { name } 객체다. 둘 다 받아준다. */
function readState(state: unknown): string {
  if (typeof state === 'string') return state
  if (state && typeof state === 'object' && 'name' in state) {
    return String((state as { name: unknown }).name)
  }
  return 'UNKNOWN'
}

/**
 * background interaction 이 끝날 때까지 폴링한다.
 *
 * 동기 호출(background 없이 await)로는 생성이 220초를 넘기면 Google 쪽에서
 * `500 Internal error encountered.` 가 떨어진다 — 2026-09-04 에 10초 영상으로
 * 227초·223초 두 번 재현했다. 입력이 달라도(사진 3장 → 1장) 실패 시각이 4초
 * 차이라 무작위 오류가 아니라 서버측 데드라인으로 보인다.
 *
 * background: true 로 만들면 create 가 즉시 id 를 주고 실제 생성은 뒤에서 돈다.
 * docs/GCP-INFRA-GUIDE.md §9 의 LRO 패턴이 이 구간에도 적용되는 셈이다.
 */
const TERMINAL_STATUS = new Set([
  'completed',
  'failed',
  'cancelled',
  'incomplete',
  'budget_exceeded',
])

async function waitForInteraction(ai: GoogleGenAI, id: string, onStage?: StageReporter) {
  const startedAt = Date.now()
  let delay = POLL_INITIAL_MS
  let current = await ai.interactions.get(id)

  while (!TERMINAL_STATUS.has(current.status)) {
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      // 남겨두면 계속 돌 수 있으므로 취소를 시도한다
      try {
        await ai.interactions.cancel(id)
      } catch {
        // 이미 끝났거나 취소가 안 되는 상태면 무시
      }
      throw new Error('15분 안에 영상이 준비되지 않아 중단했습니다')
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    onStage?.(`영상 생성 중 (${elapsed}초, ${current.status})`)

    await sleep(delay + Math.random() * 1000)
    delay = Math.min(delay * POLL_FACTOR, POLL_MAX_MS)
    current = await ai.interactions.get(id)
  }

  return current
}

/** Files API 가 ACTIVE 가 될 때까지 지수 백오프 + jitter 로 폴링한다. */
async function waitForActive(
  ai: GoogleGenAI,
  name: string,
  onStage?: StageReporter,
): Promise<void> {
  const startedAt = Date.now()
  let delay = POLL_INITIAL_MS

  while (true) {
    const info = await ai.files.get({ name })
    const state = readState(info.state)

    if (state === 'ACTIVE') return
    if (state === 'FAILED') throw new Error('영상 생성에 실패했습니다 (state: FAILED)')

    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error('15분 안에 영상이 준비되지 않아 중단했습니다')
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    onStage?.(`파일 처리 대기 중 (${elapsed}초, state: ${state})`)

    // jitter: 여러 인스턴스가 같은 주기로 때리는 것을 방지
    await sleep(delay + Math.random() * 1000)
    delay = Math.min(delay * POLL_FACTOR, POLL_MAX_MS)
  }
}

export async function generateVideo(
  config: OmniConfig,
  opts: GenerateOptions,
  outDir: string,
  onStage?: StageReporter,
): Promise<GenerateResult> {
  const ai = createClient(config)

  /**
   * 확장은 앞 영상을 document 입력으로 직접 넣는다.
   *
   * ⚠️ previous_interaction_id 는 Vertex 에서 쓰지 말 것. 400 도 안 나고 조용히
   * 무시된다 — 2026-09-04 실측:
   *
   *   previous_interaction_id (짧은 ID / 전체 리소스 경로 둘 다)
   *     → input_tokens_by_modality: [{text: 4}]           video 없음. 새 영상 생성
   *   input: [{type:'document', uri:'gs://…'}, …]
   *     → input_tokens_by_modality: [{text:103},{video:8120}]  앞 영상을 실제로 읽음
   *
   * 문서(docs/gemini_omni_v1.1.md)의 멀티턴 확장 예시는 Gemini API 키 기준이다.
   * CLAUDE.md 함정 4번(모델 ID)과 같은 부류 — Vertex 는 문서와 다르게 동작한다.
   */
  const extending = Boolean(opts.extendFromVideoUri)

  const imageParts = (opts.images ?? []).map((img) => ({
    type: 'image' as const,
    data: img.data,
    mime_type: img.mimeType,
  }))

  /**
   * 확장 신호는 프롬프트가 담당한다.
   *
   * 문서가 명시한다 — "프롬프트에서 동영상이 어떻게 이어지기를 원하는지
   * 설명합니다(예: 'Extend this video' 또는 'Continue the scene: ...')".
   * task='extend' 로 강제할 수도 있지만 문서는 권하지 않는다:
   * "task 필드를 사용하면 모델에 엄격한 제약이 추가되므로 프롬프트에
   * 주로 의존하는 것이 좋습니다". previous_interaction_id 와 동시 사용도 불가.
   *
   * 방문자는 한국어로 이어질 장면만 쓰므로 문서 예시 문구를 앞에 붙인다.
   */
  const extendPrompt = `Continue the scene. ${opts.prompt}`

  /**
   * 확장에도 레퍼런스 이미지를 넣을 수 있다 —
   * docs/gemini_omni_v1.1.md 「Prompts for extending a video」:
   * "Include images and videos as references when extending to help keep your
   *  outputs accurate, or to introduce new characters".
   * 여러 장이면 프롬프트에서 <IMAGE_REF_0> 식으로 지목해야 역할이 전달된다.
   */
  // 이어 붙일 원본 영상. 문서 「Video extension」 의 업로드 영상 확장과 같은 형태다.
  const sourceVideoPart = {
    type: 'document' as const,
    uri: opts.extendFromVideoUri!,
    mime_type: 'video/mp4',
  }

  const input = extending
    ? [sourceVideoPart, ...imageParts, { type: 'text' as const, text: extendPrompt }]
    : imageParts.length
      ? [...imageParts, { type: 'text' as const, text: opts.prompt }]
      : opts.prompt

  onStage?.('모델 호출 중')

  // 720p 10초면 4MB 를 넘기 쉬우므로 가능하면 uri 전송을 쓴다.
  //   - Gemini API 키: Files API 가 받아준다 (gcs_uri 불필요)
  //   - Vertex AI    : 내 GCS 버킷이 있어야 uri 를 쓸 수 있다
  const gcsUri = config.mode === 'vertex' ? config.outputGcsUri : undefined
  const canUseUriDelivery = config.mode !== 'vertex' || Boolean(gcsUri)

  let interaction = await ai.interactions.create({
    model: omniModelFor(config),
    // 뒤에서 돌리고 우리는 폴링한다 — 동기 호출은 220초쯤에서 500 이 난다
    background: true,
    input,
    /**
     * 저장해두지 않으면 다음 턴에서 previous_interaction_id 로 못 부른다 —
     * 문서: "store=false를 설정하면 생성된 동영상을 previous_interaction_id를
     * 사용하여 후속 턴에서 수정할 수 없습니다". 기본값이 문서에 없어 명시한다.
     */
    store: true,
    response_format: extending
      ? {
          /**
           * type 은 Vertex 에서 필수다 — 빼면 400:
           * `The 'type' parameter is required at 'response_format'.`
           * Gemini API 쪽 샘플(블로그·docs)은 생략하는데 Vertex 는 요구한다.
           * 문서 샘플을 그대로 베끼면 안 되는 지점.
           */
          type: 'video',
          // 화면비·길이는 앞 영상을 따라가므로 보내지 않는다.
          // delivery 는 남긴다 — 문서 권장사항: "4MB보다 큰 동영상의 경우
          // response_format에서 delivery='uri'를 사용하여 페이로드 제한을 피하세요".
          resolution: opts.resolution,
          delivery: canUseUriDelivery ? 'uri' : 'inline',
          ...(gcsUri ? { gcs_uri: gcsUri } : {}),
        }
      : {
          type: 'video',
          delivery: canUseUriDelivery ? 'uri' : 'inline',
          ...(gcsUri ? { gcs_uri: gcsUri } : {}),
          aspect_ratio: opts.aspectRatio,
          resolution: opts.resolution,
          duration: opts.durationSeconds ? `${opts.durationSeconds}s` : undefined,
        },
  })

  if (!TERMINAL_STATUS.has(interaction.status)) {
    onStage?.('영상 생성 중')
    interaction = await waitForInteraction(ai, interaction.id, onStage)
  }

  if (interaction.status !== 'completed') {
    const detail = interaction.errors?.length
      ? ` (${interaction.errors.map((e) => JSON.stringify(e)).join(', ')})`
      : ''
    throw new Error(`영상 생성이 끝나지 못했습니다 — status: ${interaction.status}${detail}`)
  }

  const video = interaction.output_video
  if (!video) {
    throw new Error('모델이 영상을 반환하지 않았습니다 (안전 필터에 걸렸을 수 있습니다)')
  }

  await mkdir(outDir, { recursive: true })
  const fileName = `${Date.now()}-${interaction.id}.mp4`
  const filePath = path.join(outDir, fileName)

  let downloadUrl: string | undefined
  let downloadError: string | undefined
  // 다음 확장 요청의 입력이 된다
  const videoGcsUri = video.uri?.startsWith('gs://') ? video.uri : undefined

  if (video.data) {
    // inline 응답 — base64 를 그대로 파일로 떨군다
    onStage?.('영상 저장 중')
    await writeFile(filePath, Buffer.from(video.data, 'base64'))
  } else if (video.uri?.startsWith('gs://')) {
    // Vertex — 결과가 내 GCS 버킷에 쓰여 있다
    const project = config.mode === 'vertex' ? config.project : ''
    onStage?.('GCS 에서 내려받는 중')
    await downloadFromGcs(video.uri, project, filePath)
    // QR 다운로드용 — 우리 앱(IAP 뒤)을 거치지 않는 직행 링크.
    // 버킷에 쓰기/서명 권한이 없는 로컬 dev 등에서는 null + error 가 돌아온다.
    {
      const signed = await createSignedUrl(project, video.uri)
      downloadUrl = signed.url ?? undefined
      downloadError = signed.error
    }
  } else if (video.uri) {
    // Gemini API — Files API 가 ACTIVE 가 될 때까지 기다린 뒤 내려받는다
    const match = /files\/([a-zA-Z0-9_-]+)/.exec(video.uri)
    if (!match) throw new Error(`파일 URI 를 해석하지 못했습니다: ${video.uri}`)
    const name = `files/${match[1]}`

    onStage?.('파일 처리 대기 중')
    await waitForActive(ai, name, onStage)

    onStage?.('영상 내려받는 중')
    await ai.files.download({ file: name, downloadPath: filePath })
  } else {
    throw new Error('응답에 영상 데이터도 URI 도 없습니다')
  }

  return { interactionId: interaction.id, fileName, downloadUrl, downloadError, videoGcsUri }
}
