import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { generateVideo, omniModelFor, type GenerateOptions } from './omni.ts'
import { generateTryOn, TRYON_MODEL_ID, type TryOnImage, type TryOnOptions } from './tryon.ts'
import { describeConfig, type OmniConfig } from './config.ts'
import { errorDetail } from './errors.ts'
import {
  deleteObject,
  listObjects,
  objectReadStream,
  parseGsUri,
  statObject,
  type GcsObject,
} from './gcs.ts'

export type JobStatus = 'queued' | 'running' | 'completed' | 'error'

export type Job = {
  id: string
  status: JobStatus
  stage: string
  createdAt: number
  completedAt?: number
  videoUrl?: string
  /** IAP 를 거치지 않는 GCS 서명 URL — QR 다운로드용. 서명 실패/미배포 환경이면 없음. */
  downloadUrl?: string
  /** 서명 실패 시 원인 전문 — 클라이언트 "오류 보기" 용 */
  downloadError?: string
  interactionId?: string
  /** 장면 확장 체인 전체 길이(초). 40초 상한 표시에 쓴다 */
  totalSeconds?: number
  error?: string
  /** 원본 에러 전문. "에러코드 확인하기" 가 새 탭에 띄운다 */
  errorDetail?: string
}

const MAX_BODY_BYTES = 25 * 1024 * 1024 // 이미지 몇 장까지는 받아준다
const ALLOWED_ASPECT = new Set(['16:9', '9:16'])
const ALLOWED_RESOLUTION = new Set(['360p', '720p', '1080p'])

/** 입력 이미지 장수 상한. 문서에 명시된 값은 아니고 요청 본문 크기를 감당하려는 우리 기준이다 */
const MAX_IMAGES = 10

/** 장면 확장 누적 상한. Omni 1.1 문서 기준 한 체인은 40초를 넘길 수 없다 */
const MAX_TOTAL_SECONDS = 40

/** 로컬 단일 프로세스 전용 인메모리 잡 스토어. 서버를 재시작하면 사라진다. */
const jobs = new Map<string, Job>()

/**
 * interactionId → 그 영상까지의 누적 길이(초).
 *
 * 장면 확장은 previous_interaction_id 로 앞 영상에 이어 붙이는데, 40초 상한은
 * 체인 전체에 걸린다. 프론트만 믿으면 우회되므로 서버도 같은 판정을 한다.
 * 잡 스토어와 같은 인메모리라 재시작하면 사라진다 — 그때는 확장이 아니라
 * 새 영상으로 시작하게 된다.
 */
const chainSeconds = new Map<string, number>()

/**
 * interactionId → 그 결과 영상의 gs:// 경로.
 *
 * 확장은 원본 영상을 document 입력으로 넣어야 한다. 프론트는 앞 영상의
 * interactionId 만 알고 있으므로, 서버가 여기서 실제 영상 경로로 바꿔준다.
 * chainSeconds 와 같은 인메모리라 재시작하면 사라진다.
 */
const chainVideoUri = new Map<string, string>()

/**
 * Media Gallery (§4) — 배포 버킷(gs://.../output)에 누적된 01·02 결과물을
 * 슬라이드쇼로 보여주는 화면이 쓴다. 서버 재시작·재배포와 무관하게 부스 하루
 * 종일 쌓인 것을 그대로 나열한다 (잡 스토어와 달리 소스가 버킷이다).
 */
const GALLERY_MAX = 80

export type GalleryItem = {
  /** 버킷 기준 오브젝트 경로 — 삭제 요청에 그대로 넘긴다 */
  object: string
  type: 'image' | 'video'
  /** IAP 를 거치지 않는 서명 URL */
  url: string
  /** 생성 시각(epoch ms). 최신순 정렬용 */
  createdAt: number
}

/** 오브젝트를 01(영상)/02(이미지)로 분류. 해당 없으면 제외 */
function classifyObject(o: GcsObject): 'image' | 'video' | null {
  if (o.contentType?.startsWith('image/')) return 'image'
  if (o.contentType?.startsWith('video/')) return 'video'
  if (/\/looks\//.test(o.name)) return 'image' // tryon.ts 가 output/looks/ 에 올린다
  if (/\.(mp4|webm|mov|m4v)$/i.test(o.name)) return 'video'
  return null
}

type GalleryResponse = {
  items: GalleryItem[]
  /** 비어 있을 때 이유를 사람이 읽는 설명 */
  note?: string
  /** 원본 에러 전문 — 클라이언트 "오류 보기" 새 탭용 */
  detail?: string
}

async function listGallery(config: OmniConfig): Promise<GalleryResponse> {
  if (config.mode !== 'vertex' || !config.outputGcsUri) {
    return {
      items: [],
      note: '갤러리는 Vertex + 출력 버킷이 설정된 환경(배포본)에서만 채워집니다.',
    }
  }

  const { project, outputGcsUri } = config

  // listObjects 가 던지면 미들웨어 catch 가 400 { error, detail } 로 내려준다
  const all = await listObjects(project, outputGcsUri)
  const media = all
    .filter((o) => !o.name.endsWith('/') && classifyObject(o) !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, GALLERY_MAX)

  if (!media.length) {
    return {
      items: [],
      note: `${outputGcsUri} 아래에 전시할 사진·영상이 아직 없습니다 (오브젝트 ${all.length}개 스캔).`,
    }
  }

  // 서명 URL 대신 서버 프록시(/api/gallery/media) 로 스트리밍한다 — 갤러리는
  // 관리자가 IAP + AdminGate 뒤에서만 보므로 IAP 를 우회하는 서명 URL 이 필요 없다.
  return {
    items: media.map((o) => ({
      object: o.name,
      type: classifyObject(o)!,
      url: `/api/gallery/media?object=${encodeURIComponent(o.name)}`,
      createdAt: o.createdAt,
    })),
  }
}

/** object 가 버킷의 output/ 접두사 안에 있는지 확인하고 gs:// URI + project 로 바꾼다 */
function resolveGalleryObject(
  config: OmniConfig,
  object: string,
): { gsUri: string; project: string } {
  if (config.mode !== 'vertex' || !config.outputGcsUri) {
    throw new Error('갤러리는 배포 환경에서만 사용할 수 있습니다')
  }
  const { bucket, object: prefix } = parseGsUri(config.outputGcsUri)
  const clean = (object ?? '').replace(/^\/+/, '')
  const guard = prefix.endsWith('/') ? prefix : `${prefix}/`
  if (!clean || clean.includes('..') || !clean.startsWith(guard)) {
    throw new Error('허용되지 않은 오브젝트 경로입니다')
  }
  return { gsUri: `gs://${bucket}/${clean}`, project: config.project }
}

async function deleteGalleryObject(config: OmniConfig, object: string): Promise<void> {
  const { gsUri, project } = resolveGalleryObject(config, object)
  await deleteObject(project, gsUri)
}

/** 갤러리 미디어를 GCS 에서 바로 스트리밍한다 (Range 지원 — Safari 영상 재생용). */
async function serveGalleryMedia(
  res: ServerResponse,
  config: OmniConfig,
  object: string,
  rangeHeader: string | undefined,
): Promise<void> {
  let gsUri: string
  let project: string
  try {
    ;({ gsUri, project } = resolveGalleryObject(config, object))
  } catch (err) {
    json(res, 400, { error: err instanceof Error ? err.message : String(err) })
    return
  }

  let stat: { size: number; contentType: string }
  try {
    stat = await statObject(project, gsUri)
  } catch {
    json(res, 404, { error: '오브젝트를 찾을 수 없습니다' })
    return
  }

  // 스트림 도중 GCS 오류(오브젝트 삭제 등)로 프로세스가 죽지 않게 막는다
  const pipeStream = (range?: { start: number; end: number }) => {
    const stream = objectReadStream(project, gsUri, range)
    stream.on('error', (err) => {
      console.warn('[gallery] 스트리밍 중단:', err instanceof Error ? err.message : err)
      res.destroy()
    })
    stream.pipe(res)
  }

  const match = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null
  if (match && stat.size) {
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Number(match[2]) : stat.size - 1
    if (start >= stat.size || end >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      'Content-Type': stat.contentType,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
    })
    pipeStream({ start, end })
    return
  }

  const headers: Record<string, string | number> = {
    'Content-Type': stat.contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=300',
  }
  if (stat.size) headers['Content-Length'] = stat.size
  res.writeHead(200, headers)
  pipeStream()
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('요청 본문이 너무 큽니다 (25MB 초과)')
    chunks.push(chunk as Buffer)
  }

  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** { data, mimeType } 형태만 통과시킨다 */
function parseImages(raw: unknown[]): TryOnImage[] {
  return raw.flatMap((item) => {
    const img = item as Record<string, unknown>
    if (typeof img?.data !== 'string' || typeof img?.mimeType !== 'string') return []
    return [{ data: img.data, mimeType: img.mimeType }]
  })
}

function parseOptions(raw: unknown): GenerateOptions {
  const body = (raw ?? {}) as Record<string, unknown>

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) throw new Error('프롬프트를 입력하세요')

  const images = Array.isArray(body.images) ? parseImages(body.images) : undefined
  if (images && images.length > MAX_IMAGES) {
    throw new Error(`사진은 최대 ${MAX_IMAGES}장까지 넣을 수 있습니다`)
  }

  const aspectRatio =
    typeof body.aspectRatio === 'string' && ALLOWED_ASPECT.has(body.aspectRatio)
      ? body.aspectRatio
      : '16:9'

  const resolution =
    typeof body.resolution === 'string' && ALLOWED_RESOLUTION.has(body.resolution)
      ? body.resolution
      : '720p'

  const rawDuration = Number(body.durationSeconds)
  const durationSeconds = Number.isFinite(rawDuration)
    ? Math.min(10, Math.max(3, Math.round(rawDuration)))
    : 5

  const previousInteractionId =
    typeof body.previousInteractionId === 'string' && body.previousInteractionId
      ? body.previousInteractionId
      : undefined

  /**
   * 확장은 앞 영상의 gs:// 를 입력으로 넣어야 한다.
   *
   * previous_interaction_id 는 Vertex 에서 에러 없이 무시된다 — 2026-09-04 확인:
   * 짧은 ID·전체 리소스 경로 둘 다 보내봤지만 결과 usage 의
   * input_tokens_by_modality 에 video 가 아예 없었고(텍스트 4토큰만), 모델이
   * 앞 영상과 무관한 새 영상을 처음부터 만들었다. document 로 넣으면 같은
   * 조건에서 video 8,120 토큰이 입력에 잡힌다.
   */
  let extendFromVideoUri: string | undefined
  if (previousInteractionId) {
    const used = chainSeconds.get(previousInteractionId) ?? 0
    const remaining = MAX_TOTAL_SECONDS - used
    if (remaining < durationSeconds) {
      throw new Error(
        remaining <= 0
          ? `이 영상은 이미 ${MAX_TOTAL_SECONDS}초에 도달해 더 늘릴 수 없습니다`
          : `남은 길이가 ${remaining}초라 ${durationSeconds}초를 이어 붙일 수 없습니다`,
      )
    }

    // 인메모리라 서버를 재시작하면 비어 있다. 그때는 이어 붙일 수 없다.
    extendFromVideoUri = chainVideoUri.get(previousInteractionId)
    if (!extendFromVideoUri) {
      throw new Error(
        '이어 붙일 원본 영상을 찾지 못했습니다 (서버가 재시작되었을 수 있습니다). 새 영상으로 시작해주세요',
      )
    }
  }

  return {
    prompt,
    images,
    aspectRatio,
    resolution,
    durationSeconds,
    previousInteractionId,
    extendFromVideoUri,
  }
}

function parseTryOnOptions(raw: unknown): TryOnOptions {
  const body = (raw ?? {}) as Record<string, unknown>

  const [person] = parseImages(Array.isArray(body.person) ? body.person : [body.person])
  if (!person) throw new Error('인물 사진을 넣어주세요')

  const products = parseImages(Array.isArray(body.products) ? body.products : [])
  if (!products.length) throw new Error('의상 사진을 넣어주세요')

  // virtual-try-on-001 은 productImage 를 하나만 받는다 — 한 벌만 넘긴다
  return { person, products: products.slice(0, 1) }
}

/**
 * SDK 에러는 "400 API error occurred: {...}" 처럼 불친절하다.
 * 흔한 원인을 인증 모드에 맞는 힌트로 덧붙인다.
 */
function describeError(err: unknown, config: OmniConfig): string {
  const message = err instanceof Error ? err.message : String(err)
  const hint = (text: string) => `${message}\n\n힌트: ${text}`

  // 리전 문제는 두 모드 공통이고 메시지에 지원 목록이 같이 온다
  if (/unsupported location/i.test(message)) {
    return hint(
      '.env.local 의 GOOGLE_CLOUD_LOCATION 을 위 메시지가 알려주는 값으로 바꾸고 dev 서버를 재시작하세요.',
    )
  }

  if (/\b5\d\d\b/.test(message)) {
    return hint(
      'Google 쪽 일시적 오류입니다. 요청이 잘못된 게 아니니 잠시 후 다시 시도하세요.',
    )
  }

  if (/\b429\b/.test(message)) {
    return hint('쿼터를 초과했습니다. 잠시 후 다시 시도하거나 콘솔에서 한도를 확인하세요.')
  }

  // 400 중에도 요청 형식 문제는 인증과 무관하다. 엉뚱한 힌트를 주지 않는다.
  if (/\b400\b/.test(message) && /required|not allowed|invalid|must be/i.test(message)) {
    return hint('요청 파라미터가 API 규격과 맞지 않습니다. 위 메시지가 가리키는 필드를 확인하세요.')
  }

  if (/\b(400|401|403)\b/.test(message)) {
    return config.mode === 'vertex'
      ? hint(
          `gcloud auth application-default login 이 되어 있는지, ${config.project} 에서 ${omniModelFor(config)} 를 쓸 권한이 있는지 확인하세요.`,
        )
      : hint(`GEMINI_API_KEY 가 유효한지, 해당 키로 ${omniModelFor(config)} 에 접근 권한이 있는지 확인하세요.`)
  }

  return message
}

/**
 * 잡을 백그라운드로 돌린다.
 *
 * 영상 생성은 수 분이 걸리는 LRO 라서, HTTP 요청 하나를 붙잡고 기다리면
 * 게이트웨이/프록시 타임아웃에 걸린다. docs/GCP-INFRA-GUIDE.md §1.2 의
 * "즉시 응답 + 상태 폴링" 구조를 그대로 따랐다.
 */
function startJob(config: OmniConfig, opts: GenerateOptions, outDir: string): Job {
  const job: Job = {
    id: randomUUID(),
    status: 'queued',
    stage: '대기 중',
    createdAt: Date.now(),
  }
  jobs.set(job.id, job)

  const label = `[job ${job.id.slice(0, 8)}]`
  console.log(
    `${label} 시작 — ${opts.durationSeconds}초 ${opts.resolution} ${opts.aspectRatio}` +
      (opts.images?.length ? ` 사진 ${opts.images.length}장` : '') +
      (opts.previousInteractionId ? ` 확장(${opts.previousInteractionId})` : ''),
  )

  void (async () => {
    job.status = 'running'
    try {
      const result = await generateVideo(config, opts, outDir, (stage) => {
        job.stage = stage
      })
      job.status = 'completed'
      job.stage = '완료'
      job.videoUrl = `/output/${result.fileName}`
      job.downloadUrl = result.downloadUrl
      job.downloadError = result.downloadError
      job.interactionId = result.interactionId

      // 다음 확장 요청이 남은 길이를 판정할 수 있게 체인 누적을 기록한다
      const previous = opts.previousInteractionId
        ? (chainSeconds.get(opts.previousInteractionId) ?? 0)
        : 0
      job.totalSeconds = previous + (opts.durationSeconds ?? 0)
      chainSeconds.set(result.interactionId, job.totalSeconds)
      if (result.videoGcsUri) chainVideoUri.set(result.interactionId, result.videoGcsUri)

      console.log(`${label} 완료 — ${result.interactionId} (총 ${job.totalSeconds}초)`)
    } catch (err) {
      job.status = 'error'
      job.stage = '실패'
      job.error = describeError(err, config)
      job.errorDetail = errorDetail(err)

      // 브라우저에만 보내면 터미널에 흔적이 남지 않아 원인 추적이 안 된다.
      // 가공한 메시지 말고 원본 에러를 그대로 찍는다 — SDK 응답 본문이 여기 들어 있다.
      console.error(`${label} 실패:`, err)
    } finally {
      const took = Math.round((Date.now() - job.createdAt) / 1000)
      job.completedAt = Date.now()
      console.log(`${label} 종료 — ${job.status}, ${took}초 소요`)
    }
  })()

  return job
}

/** 생성된 mp4 를 Range 지원으로 서빙한다 (Safari 는 Range 없이는 재생하지 않는다). */
async function serveVideo(
  res: ServerResponse,
  outDir: string,
  fileName: string,
  rangeHeader: string | undefined,
): Promise<void> {
  // 경로 탈출 방지: 파일명만 취한다
  const safeName = path.basename(fileName)
  const filePath = path.join(outDir, safeName)

  let size: number
  try {
    size = (await stat(filePath)).size
  } catch {
    json(res, 404, { error: '파일을 찾을 수 없습니다' })
    return
  }

  const match = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null
  if (match) {
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Number(match[2]) : size - 1
    if (start >= size || end >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` })
      res.end()
      return
    }
    res.writeHead(206, {
      'Content-Type': 'video/mp4',
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    })
    createReadStream(filePath, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, {
    'Content-Type': 'video/mp4',
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
  })
  createReadStream(filePath).pipe(res)
}

export function createApiMiddleware(config: OmniConfig, outDir: string) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const { pathname } = url

    if (!pathname.startsWith('/api/') && !pathname.startsWith('/output/')) {
      next()
      return
    }

    try {
      if (pathname === '/api/health') {
        json(res, 200, {
          ok: true,
          ready: config.mode !== 'unconfigured',
          mode: config.mode,
          detail: describeConfig(config),
          model: omniModelFor(config),
          tryonModel: TRYON_MODEL_ID,
        })
        return
      }

      if (pathname === '/api/generate' && req.method === 'POST') {
        if (config.mode === 'unconfigured') {
          json(res, 500, { error: config.reason })
          return
        }
        const opts = parseOptions(await readBody(req))

        const job = startJob(config, opts, outDir)
        json(res, 202, { jobId: job.id })
        return
      }

      // 02 Look Studio — LRO 가 아니라 동기 호출이라 잡 구조를 쓰지 않는다
      if (pathname === '/api/tryon' && req.method === 'POST') {
        if (config.mode === 'unconfigured') {
          json(res, 500, { error: config.reason })
          return
        }
        const opts = parseTryOnOptions(await readBody(req))
        json(res, 200, await generateTryOn(config, opts))
        return
      }

      // ── Media Gallery (§4) ──
      if (pathname === '/api/gallery/media' && req.method === 'GET') {
        await serveGalleryMedia(
          res,
          config,
          url.searchParams.get('object') ?? '',
          req.headers.range,
        )
        return
      }

      if (pathname === '/api/gallery' && req.method === 'GET') {
        json(res, 200, await listGallery(config))
        return
      }

      if (pathname === '/api/gallery' && req.method === 'DELETE') {
        await deleteGalleryObject(config, url.searchParams.get('object') ?? '')
        json(res, 200, { ok: true })
        return
      }

      if (pathname.startsWith('/api/jobs/') && req.method === 'GET') {
        const job = jobs.get(pathname.slice('/api/jobs/'.length))
        if (!job) {
          json(res, 404, { error: '해당 작업을 찾을 수 없습니다' })
          return
        }
        json(res, 200, job)
        return
      }

      if (pathname.startsWith('/output/') && req.method === 'GET') {
        await serveVideo(res, outDir, pathname.slice('/output/'.length), req.headers.range)
        return
      }

      json(res, 404, { error: 'Not found' })
    } catch (err) {
      json(res, 400, { error: describeError(err, config), detail: errorDetail(err) })
    }
  }
}
