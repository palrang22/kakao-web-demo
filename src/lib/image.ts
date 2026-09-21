/** 스튜디오 공용 — 파일 입력에서 받은 이미지를 base64 로 읽는다 */

/**
 * 업로드 전 축소 기준.
 *
 * 입력 이미지는 GCS 를 거치지 않고 요청 본문에 base64 로 실려 우리 서버로 간다
 * (버킷은 출력 영상 전용이다). base64 는 원본보다 약 1.33 배로 불어나므로
 * 폰 사진 원본을 여러 장 넣으면 server/api.ts 의 25MB 상한에 바로 걸린다.
 * 긴 변 1920px / JPEG 0.85 로 줄이면 장당 1MB 안쪽이라 10 장을 넣어도 여유가 있다.
 */
const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.85;

/** 이 크기 아래면 재인코딩하지 않는다 — PNG 투명도 등 원본 특성을 보존한다 */
const SKIP_RESIZE_BYTES = 1024 * 1024;

/**
 * 재인코딩 없이 모델로 그대로 보내도 되는 포맷.
 * 샘플 이미지는 `.webp` 지만 `virtual-try-on-001` 등 Vertex 이미지 API 는
 * PNG/JPEG 만 문서상 보장한다. webp 는 크기와 무관하게 항상 JPEG 로 정규화한다.
 */
const SAFE_PASSTHROUGH = /^image\/(jpeg|png)$/;

/** 긴 변이 MAX_EDGE 를 넘으면 canvas 로 줄여 JPEG data URL 로 만든다 */
async function shrink(file: File): Promise<string | null> {
  if (file.size <= SKIP_RESIZE_BYTES && SAFE_PASSTHROUGH.test(file.type)) return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null; // 디코딩 실패 시 원본 경로로 넘긴다
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export type Attachment = {
  id: string;
  name: string;
  data: string; // base64 (data: 접두사 제거됨)
  mimeType: string;
  preview: string; // data: URL, 미리보기용
};

export async function readAsAttachment(file: File): Promise<Attachment> {
  const shrunk = await shrink(file);
  const url = shrunk ?? (await readAsDataUrl(file));
  const comma = url.indexOf(",");

  return {
    id: `${file.name}-${file.size}-${Date.now()}`,
    name: file.name,
    data: url.slice(comma + 1),
    // 축소했으면 JPEG 로 재인코딩된 상태다
    mimeType: shrunk ? "image/jpeg" : file.type || "image/png",
    preview: url,
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} 을 읽지 못했습니다`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/** 같은 출처의 이미지 URL(예: public/samples 의 샘플 인물)을 Attachment 로 만든다 */
export async function attachmentFromUrl(
  url: string,
  name: string,
): Promise<Attachment> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} 을 불러오지 못했습니다 (${res.status})`);
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`${name} 파일이 이미지가 아닙니다`);
  }
  return readAsAttachment(new File([blob], name, { type: blob.type }));
}

/** 이미 base64 를 들고 있을 때 (예: 생성 결과를 다시 인물 입력으로 넣기) */
export function attachmentFromBase64(
  data: string,
  mimeType: string,
  name: string,
): Attachment {
  return {
    id: `${name}-${Date.now()}`,
    name,
    data,
    mimeType,
    preview: `data:${mimeType};base64,${data}`,
  };
}
