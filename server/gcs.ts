import type { Readable } from 'node:stream'
import { Storage } from '@google-cloud/storage'
import { GoogleAuth, Impersonated } from 'google-auth-library'
import { errorDetail } from './errors.ts'

/**
 * GCS 헬퍼 — omni.ts(다운로드)와 tryon.ts(업로드+서명)가 공유한다.
 *
 * 업로드·다운로드는 ADC 로 바로 된다. 서명 URL(getSignedUrl V4)만 "서명 주체"가 필요하다:
 *   - Cloud Run — attach 된 서비스 계정으로 IAM signBlob 을 호출한다 (SA 가 자기 자신에게
 *     roles/iam.serviceAccountTokenCreator 를 가지면 됨). 이게 기본 경로.
 *   - 로컬 dev — 사용자 개인 ADC 는 client_email 이 없어 서명을 아예 못 한다.
 *     GCS_SIGNER_SA 를 주면 그 서비스 계정을 impersonate 해서 서명한다
 *     (사용자 계정이 그 SA 에 대해 serviceAccountTokenCreator 를 가져야 함).
 * 서명이 안 되면 던지지 않고 null → 호출부는 QR 없이 계속 진행한다.
 */

const SIGNED_URL_TTL_MS = 60 * 60 * 1000 // 60분 — 부스 세션 길이 감안

/** 서명 전용 Storage 클라이언트. GCS_SIGNER_SA 가 있으면 impersonate, 없으면 기본 ADC. */
let signerStoragePromise: Promise<Storage> | null = null

function signerStorage(project: string): Promise<Storage> {
  if (!signerStoragePromise) {
    signerStoragePromise = buildSignerStorage(project).catch((err) => {
      signerStoragePromise = null // 실패는 캐시하지 않는다 — 다음 호출에서 재시도
      throw err
    })
  }
  return signerStoragePromise
}

async function buildSignerStorage(project: string): Promise<Storage> {
  const signerSa = process.env.GCS_SIGNER_SA?.trim()
  if (!signerSa) return new Storage({ projectId: project })

  const sourceClient = await new GoogleAuth().getClient()
  const authClient = new Impersonated({
    sourceClient,
    targetPrincipal: signerSa,
    lifetime: 3600,
    targetScopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
  })
  console.log(`[gcs] 서명 주체를 impersonate 합니다: ${signerSa}`)
  return new Storage({ projectId: project, authClient })
}

export function parseGsUri(gsUri: string): { bucket: string; object: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(gsUri)
  if (!match) throw new Error(`GCS URI 를 해석하지 못했습니다: ${gsUri}`)
  const [, bucket, object] = match
  return { bucket, object }
}

/** gs://bucket/path 를 로컬 파일로 내려받는다 (인증은 ADC 가 처리). */
export async function downloadFromGcs(
  gsUri: string,
  project: string,
  filePath: string,
): Promise<void> {
  const { bucket, object } = parseGsUri(gsUri)
  await new Storage({ projectId: project }).bucket(bucket).file(object).download({
    destination: filePath,
  })
}

/** 버퍼를 destGsUri(gs://bucket/path) 에 올린다. 실제로 쓰인 gs:// URI 를 돌려준다. */
export async function uploadBuffer(
  project: string,
  destGsUri: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const { bucket, object } = parseGsUri(destGsUri)
  await new Storage({ projectId: project })
    .bucket(bucket)
    .file(object)
    .save(buffer, { contentType })
  return destGsUri
}

export type GcsObject = {
  /** 버킷 기준 오브젝트 경로 (예: output/looks/123-0.png) */
  name: string
  /** 생성 시각(epoch ms). 메타데이터가 없으면 0 */
  createdAt: number
  contentType?: string
}

/**
 * prefixGsUri(gs://bucket/prefix) 아래 오브젝트를 나열한다 (갤러리 §4).
 * 목록 조회는 ADC(Editor 의 storage.objects.list)로 바로 된다 — 서명 주체 불필요.
 */
export async function listObjects(
  project: string,
  prefixGsUri: string,
): Promise<GcsObject[]> {
  const { bucket, object: prefix } = parseGsUri(prefixGsUri)
  const [files] = await new Storage({ projectId: project })
    .bucket(bucket)
    .getFiles({ prefix })
  return files.map((f) => ({
    name: f.name,
    createdAt: f.metadata?.timeCreated ? Date.parse(String(f.metadata.timeCreated)) : 0,
    contentType: f.metadata?.contentType ? String(f.metadata.contentType) : undefined,
  }))
}

/** gs://bucket/path 오브젝트를 버킷에서 삭제한다 (갤러리 삭제 버튼). */
export async function deleteObject(project: string, gsUri: string): Promise<void> {
  const { bucket, object } = parseGsUri(gsUri)
  await new Storage({ projectId: project }).bucket(bucket).file(object).delete()
}

export type ObjectStat = { size: number; contentType: string }

/**
 * 갤러리 미디어 프록시(§4)용. 갤러리는 관리자가 앱 안(IAP + AdminGate 뒤)에서만
 * 보므로 서명 URL 이 필요 없다 — 서버가 ADC 읽기 권한으로 GCS 에서 바로
 * 스트리밍한다. (서명이 필요한 건 IAP 밖에서 열리는 QR 다운로드뿐)
 */
export async function statObject(project: string, gsUri: string): Promise<ObjectStat> {
  const { bucket, object } = parseGsUri(gsUri)
  const [md] = await new Storage({ projectId: project })
    .bucket(bucket)
    .file(object)
    .getMetadata()
  return {
    size: Number(md.size ?? 0),
    contentType: md.contentType ? String(md.contentType) : 'application/octet-stream',
  }
}

/** gs://bucket/path 를 읽기 스트림으로 연다. range 를 주면 그 바이트 구간만 (양끝 포함). */
export function objectReadStream(
  project: string,
  gsUri: string,
  range?: { start: number; end: number },
): Readable {
  const { bucket, object } = parseGsUri(gsUri)
  const file = new Storage({ projectId: project }).bucket(bucket).file(object)
  return range
    ? file.createReadStream({ start: range.start, end: range.end })
    : file.createReadStream()
}

export type SignedUrlResult = {
  /** 성공 시 서명 URL, 실패 시 null */
  url: string | null
  /** 실패 시 원인 전문 — 클라이언트 "오류 보기" 새 탭에 띄운다 */
  error?: string
}

/**
 * gsUri 에 대한 V4 서명 다운로드 URL을 만든다. IAP 를 거치지 않는
 * storage.googleapis.com 직행 링크라, 로그인 없는 부스 방문자도 열 수 있다.
 * 서명 주체가 없거나(로컬 dev + GCS_SIGNER_SA 미설정) 권한이 없으면
 * 던지지 않고 `{ url: null, error }` 를 돌려준다 — 호출부는 QR 없이 계속 진행한다.
 */
export async function createSignedUrl(
  project: string,
  gsUri: string,
  ttlMs: number = SIGNED_URL_TTL_MS,
): Promise<SignedUrlResult> {
  try {
    const { bucket, object } = parseGsUri(gsUri)
    const storage = await signerStorage(project)
    const [url] = await storage
      .bucket(bucket)
      .file(object)
      .getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + ttlMs })
    return { url }
  } catch (err) {
    console.warn(
      `[gcs] 서명 URL 생성 실패 (${gsUri}) — QR 다운로드 없이 계속합니다:`,
      err instanceof Error ? err.message : err,
    )
    return { url: null, error: errorDetail(err) }
  }
}
