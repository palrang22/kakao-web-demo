/**
 * Look Studio(02) 샘플 의상.
 *
 * 파일은 `public/samples/look-studio/<섹션>/<파일>` 에 둔다. 폴더 = 화면의 섹션.
 * 새 옷을 넣으면 여기 항목만 추가하면 된다 (Vite 는 public/ 을 그대로 복사, import 아님).
 *
 * 이미지는 `.webp` (긴 변 1536px). 원본 PNG 는 저장소 루트 `samples-original/` 에 백업.
 * 새 옷을 PNG 로 넣었으면 `pnpm optimize:samples` 로 변환한다.
 *
 * `virtual-try-on-001` 은 상의/하의/원피스만 지원한다 (가방·모자·소품 불가).
 * 한 번에 한 벌만 입힌다 (모델이 productImage 를 하나만 받음). — server/api.ts `parseTryOnOptions`
 */

export type Garment = {
  id: string;
  label: string;
  /** public 절대경로 */
  src: string;
};

export type GarmentSection = {
  id: string;
  label: string;
  items: Garment[];
};

const dir = "/samples/look-studio";

export const GARMENT_SECTIONS: GarmentSection[] = [
  {
    id: "concert-girls",
    label: "무대의상 · 여",
    items: [
      { id: "concert-1", label: "무대의상 1", src: `${dir}/concert-girls/concert-1.webp` },
      { id: "concert-2", label: "무대의상 2", src: `${dir}/concert-girls/concert-2.webp` },
      { id: "concert-3", label: "무대의상 3", src: `${dir}/concert-girls/concert-3.webp` },
      { id: "concert-4", label: "무대의상 4", src: `${dir}/concert-girls/concert-4.webp` },
      { id: "concert-5", label: "무대의상 5", src: `${dir}/concert-girls/concert-5.webp` },
      { id: "g-concert-6", label: "무대의상 6", src: `${dir}/concert-girls/g-concert-6.webp` },
    ],
  },
  {
    id: "concert-boys",
    label: "무대의상 · 남",
    items: [
      { id: "b-concert-1", label: "무대의상 1", src: `${dir}/concert-boys/b-concert-1.webp` },
      { id: "b-concert-2", label: "무대의상 2", src: `${dir}/concert-boys/b-concert-2.webp` },
      { id: "b-concert-3", label: "무대의상 3", src: `${dir}/concert-boys/b-concert-3.webp` },
      { id: "b-concert-4", label: "무대의상 4", src: `${dir}/concert-boys/b-concert-4.webp` },
      { id: "b-concert-5", label: "무대의상 5", src: `${dir}/concert-boys/b-concert-5.webp` },
      { id: "b-concert-6", label: "무대의상 6", src: `${dir}/concert-boys/b-concert-6.webp` },
    ],
  },
  {
    id: "suit",
    label: "정장",
    items: [
      { id: "g-beige-suit", label: "베이지 · 여", src: `${dir}/suit/g-beige-suit.webp` },
      { id: "g-black-suit", label: "블랙 · 여", src: `${dir}/suit/g-black-suit.webp` },
      { id: "b-beige-suit", label: "베이지 · 남", src: `${dir}/suit/b-beige-suit.webp` },
      { id: "b-black-suit", label: "블랙 · 남", src: `${dir}/suit/b-black-suit.webp` },
      { id: "b-brown-suit", label: "브라운 · 남", src: `${dir}/suit/b-brown-suit.webp` },
    ],
  },
  {
    id: "etc",
    label: "기타",
    items: [
      { id: "blingbling-1", label: "블링블링", src: `${dir}/etc/blingbling-1.webp` },
      { id: "g-hanbok", label: "여자 한복", src: `${dir}/etc/g-hanbok.webp` },
      { id: "b-hanbok", label: "남자 한복", src: `${dir}/etc/b-hanbok.webp` },
      { id: "musabok", label: "무사복", src: `${dir}/etc/musabok.webp` },
    ],
  },
];

/** 최대 선택 벌 수 — server 의 products.slice(0, N) 와 맞춘다 */
export const MAX_GARMENTS = 1;
