/**
 * Motion Studio(01) 컨셉.
 *
 * 버튼을 누르면 `prompt` 가 입력창에 자동으로 채워지고(합의 D3),
 * `refImages`(배경) 와 선택한 `outfits`(옷) 가 인물 사진과 함께 모델에 들어간다.
 * 파일은 `public/samples/motion-studio/<폴더>/` — 폴더는 사용자가 만든 이름 그대로.
 *
 * ── 프롬프트 작성 규칙 (2026-09-07 개정) ──────────────────────────────
 * 시나리오 의도는 시안에서 온 것이고, 문구는 Gemini Omni 1.1 Flash
 * (`docs/gemini_omni_v1.1.md` §「prompt guide」) 에 맞춰 다시 썼다.
 *
 *  - 언어는 영어. 문서상 영어만 완전 지원되고 다른 언어는 결과가 달라질 수 있다.
 *  - `<IMAGE_REF_N>` 태그로 입력 이미지의 역할을 고정한다. N 은 모델에 들어가는
 *    순서(0부터)이고, `MotionStudio.tsx` submit() 이 `[인물, 옷, ...refImages]`
 *    순으로 보낸다. 따라서:
 *        옷이 있는 컨셉 : REF_0=인물, REF_1=옷, REF_2~=refImages(배열 순서)
 *        옷이 없는 컨셉 : REF_0=인물, REF_1~=refImages
 *    ⚠️ 태그 번호는 컨셉마다 실제 입력 목록과 맞아야 한다. refImages/outfits 를
 *    바꾸면 프롬프트의 REF 번호도 같이 손봐야 한다.
 *  - "reference, not a literal first frame" 문구로 reference-to-video 를 유도한다
 *    (서버는 task 파라미터를 안 쓰고 프롬프트에만 의존 — 문서 권장).
 *  - 타임코드 `[0-3s]` 식 비트는 기본 길이 10초 기준. 방문자가 슬라이더로
 *    길이를 줄이면 모델이 알아서 압축한다.
 *  - 부정 지시("No on-screen text …")는 프롬프트 본문에 넣는다. Omni 는 별도
 *    negative prompt 파라미터를 지원하지 않는다.
 *  - 성별을 특정하지 않는다("the person / they") — 합의 D1.
 */

export type Concept = {
  id: string;
  label: string;
  /** 컨셉 버튼에 붙는 아이콘 (이모지) */
  icon: string;
  /** 버튼을 누르면 입력창에 채워지는 프롬프트 */
  prompt: string;
  /** 배경·무대 참조 이미지 (여러 장 가능). 파일이 없으면 프롬프트만 적용된다. */
  refImages?: string[];
  /**
   * 입힐 옷 사진 경로들.
   *  - 2벌 이상: 컨셉 칸에 옷 사진을 띄우고 사용자가 고른다
   *  - 1벌: 자동 적용
   *  - 없음(빈 배열): 인물 사진 속 옷 그대로
   * 성별 구분 없이 한 목록에 다 넣는다 — 사용자가 사진 보고 고른다.
   */
  outfits?: string[];
  /** 쇼츠 기본 비율 */
  aspectRatio?: "16:9" | "9:16";
};

const dir = "/samples/motion-studio";

export const CONCEPTS: Concept[] = [
  {
    id: "themepark",
    label: "놀이공원",
    icon: "🎢",
    // 입력: REF_0=인물, REF_1=옷(g/b-school-uniform 중 택1), REF_2=castle, REF_3=merry-go-round
    prompt: `Vertical 9:16, about 10 seconds. Use every provided image as a reference only, never as a literal first frame. <IMAGE_REF_0> = the person's exact face and identity. <IMAGE_REF_1> = the outfit they wear. <IMAGE_REF_2> and <IMAGE_REF_3> = background locations.

[0-3s] Bright midday on a pedestrian bridge, with the amusement-park castle from <IMAGE_REF_2> rising in the background. The person from <IMAGE_REF_0>, dressed in the outfit from <IMAGE_REF_1>, walks from left to right with a relaxed, confident stride while a smooth handheld shot tracks alongside them; other visitors blur by.
[3-5s] They stop mid-bridge, turn to face the camera and hold a poised pose.
[5-7s] The daylight suddenly races into evening and then night in a fast time-lapse; the carousel from <IMAGE_REF_3> lights up and starts turning behind them. They turn to look back over one shoulder with a wide-eyed, delighted, surprised gesture, one hand rising toward their mouth.
[7-10s] They turn back to face the camera and strike a pose with a big, happy smile, the carousel glowing warmly behind them. The camera pushes in slowly with a soft lens flare.

Keep the face, hairstyle and body from <IMAGE_REF_0> consistent in every frame. Photorealistic, cinematic grade, shallow depth of field.
Audio: lively daytime theme-park chatter that shifts into a sparkling evening carousel melody at the time change, a soft whoosh as day turns to night. No dialogue or voiceover.
No on-screen text, captions, subtitles or watermarks.`,
    refImages: [
      `${dir}/amusement-park/castle-background.webp`,
      `${dir}/amusement-park/merry-go-round-background.webp`,
    ],
    outfits: [
      `${dir}/amusement-park/g-school-uniform.webp`,
      `${dir}/amusement-park/b-school-uniform.webp`,
    ],
    aspectRatio: "9:16",
  },
  {
    id: "awards",
    label: "콘서트",
    icon: "🎤",
    // 입력: REF_0=인물, REF_1=옷(b/g-motion-concert 중 택1), REF_2=concert-hall
    prompt: `Vertical 9:16, about 10 seconds. Use every provided image as a reference only, never as a literal first frame. <IMAGE_REF_0> = the person's exact face and identity. <IMAGE_REF_1> = the outfit they wear. <IMAGE_REF_2> = the concert hall.

In one continuous slow-motion shot, the person from <IMAGE_REF_0> stands center stage at a packed arena concert modelled on <IMAGE_REF_2>, wearing the outfit from <IMAGE_REF_1>. They walk to the front of the stage, smile wide and wave both arms to the roaring crowd, then press one hand to their chest in thanks. Giant LED screens behind them carry a live close-up of their face. Sweeping spotlights, lasers and a sea of audience phone-flashes fill the arena; confetti drifts through the light beams. A slow crane move pushes in toward them.

Keep the face and hairstyle from <IMAGE_REF_0> identical in every frame. Photorealistic, saturated concert color, volumetric haze, shallow depth of field.
Audio: a massive crowd cheering and chanting, a driving live band, applause swelling. No dialogue or voiceover.
No on-screen text, captions, subtitles or watermarks.`,
    refImages: [`${dir}/concert/concert-hall.webp`],
    outfits: [
      `${dir}/concert/b-motion-concert.webp`,
      `${dir}/concert/g-motion-concert.webp`,
    ],
    aspectRatio: "9:16",
  },
  {
    id: "redcarpet",
    label: "레드카펫",
    icon: "🎬",
    // 입력: REF_0=인물, REF_1=옷(dress/suit 중 택1), REF_2=limousine, REF_3=photowall
    prompt: `Vertical 9:16, about 10 seconds. Use every provided image as a reference only, never as a literal first frame. <IMAGE_REF_0> = the person's exact face and identity. <IMAGE_REF_1> = the outfit they wear. <IMAGE_REF_2> = the car. <IMAGE_REF_3> = the photo wall.

[0-3s] Night, a glamorous event entrance. The door of the car from <IMAGE_REF_2> opens and the person from <IMAGE_REF_0>, wearing the outfit from <IMAGE_REF_1>, steps out onto the red carpet. A low tracking shot rises from their feet to a full-body view.
[3-6s] They walk toward the camera down the red carpet with poised, self-assured energy. Camera flashes fire from both sides, a cinematic key light rakes across them, crowd silhouettes and velvet ropes line the edges.
[6-10s] They reach the photo wall from <IMAGE_REF_3>, stop, and strike two confident poses as the flashes intensify. The camera settles into a steady medium shot.

Keep the face, hairstyle and build from <IMAGE_REF_0> identical throughout. Photorealistic, high-end cinematic color, shallow depth of field, subtle anamorphic flares.
Audio: rapid camera-shutter clicks, a cheering crowd, muffled event music. No dialogue or voiceover.
No on-screen text, captions, subtitles or watermarks.`,
    refImages: [`${dir}/red-carpet/limousine.webp`,
                `${dir}/red-carpet/photowall.webp`
              ],
    outfits: [`${dir}/red-carpet/g-redcarpet-dress.webp`,
              `${dir}/red-carpet/m-redcarpet-suit.webp`
            ],
    aspectRatio: "9:16",
  },
];
