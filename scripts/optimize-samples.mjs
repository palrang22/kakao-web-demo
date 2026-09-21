/**
 * public/samples/ 의 PNG 샘플을 WebP 로 최적화한다.
 *
 * 왜: 원본은 장당 5~9MB PNG(~1536×2752). 피커 그리드가 이걸 그대로 받아서
 * 배포본 로딩이 느렸다. 표시·전송 양쪽에 이 해상도가 필요 없다
 * (모델로 갈 땐 src/lib/image.ts 가 다시 줄인다).
 *
 * 하는 일:
 *   1. public/samples/**\/*.png  →  긴 변 MAX_EDGE 로 축소, WebP(q QUALITY) 로 재인코딩
 *   2. 원본 .png 삭제 (원본은 저장소 루트 samples-original/ 에 백업되어 있음 — .gitignore)
 *   3. 알파 채널 보존 (의상 컷아웃이 RGBA)
 *
 * 재실행: 원본을 다시 넣으려면 samples-original/ 에서 public/samples/ 로 복사 후 이 스크립트 실행.
 *
 *   pnpm optimize:samples
 */
import { readdir, stat, rename, unlink } from 'node:fs/promises'
import { join, extname } from 'node:path'
import sharp from 'sharp'

const ROOT = new URL('../public/samples/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const MAX_EDGE = 1536
const QUALITY = 82

/** 디렉터리를 재귀 순회하며 .png 경로를 모은다 */
async function collectPngs(dir) {
  const out = []
  for (const name of await readdir(dir)) {
    const p = join(dir, name)
    const s = await stat(p)
    if (s.isDirectory()) out.push(...(await collectPngs(p)))
    else if (extname(name).toLowerCase() === '.png') out.push(p)
  }
  return out
}

const pngs = await collectPngs(ROOT)
if (pngs.length === 0) {
  console.log('변환할 .png 가 없습니다.')
  process.exit(0)
}

let before = 0
let after = 0

for (const src of pngs) {
  const dst = src.replace(/\.png$/i, '.webp')
  const tmp = dst + '.tmp'
  const origBytes = (await stat(src)).size

  await sharp(src)
    .rotate() // EXIF 방향 반영
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 5 })
    .toFile(tmp)

  await rename(tmp, dst)
  await unlink(src)

  const newBytes = (await stat(dst)).size
  before += origBytes
  after += newBytes
  const rel = src.slice(ROOT.length)
  console.log(
    `${rel.padEnd(52)} ${(origBytes / 1e6).toFixed(1)}MB → ${(newBytes / 1e6).toFixed(2)}MB`,
  )
}

console.log(
  `\n합계: ${(before / 1e6).toFixed(0)}MB → ${(after / 1e6).toFixed(1)}MB  (${pngs.length}개, -${(100 - (after / before) * 100).toFixed(0)}%)`,
)
