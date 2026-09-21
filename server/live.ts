import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import {
  ActivityHandling,
  EndSensitivity,
  Modality,
  StartSensitivity,
  VoiceActivityType,
  type LiveServerMessage,
  type Session,
} from '@google/genai'
import { WebSocketServer, type WebSocket } from 'ws'
import { createClient } from './client.ts'
import type { OmniConfig } from './config.ts'
import { errorDetail } from './errors.ts'
import { TWELVE_PALACES } from './gwansang.ts'
import { getIapIdentity } from './iap.ts'

/**
 * 03 Voice Studio — Gemini Live 프록시.
 *
 * 브라우저가 Live API 에 직접 붙을 수 없다. Vertex 는 ADC 로 인증하는데
 * 그 자격증명을 브라우저에 내려보낼 수 없기 때문이다. 그래서 서버가 가운데 선다:
 *
 *   브라우저 ⇄ (우리 WS) ⇄ 서버 ⇄ (ai.live.connect) ⇄ Gemini Live
 *
 * 오디오 포맷은 Live API 규격 그대로다.
 *   입력  16kHz  16-bit PCM mono
 *   출력  24kHz  16-bit PCM mono
 */

/**
 * SDK 예제(genai.d.ts)에는 'gemini-2.0-flash-live-preview-04-09' 로 적혀 있지만
 * 그 모델은 이 프로젝트에 존재하지 않는다 (global·us-central1 모두 404).
 * 퍼블리셔 모델 메타데이터로 실재를 확인한 값은 아래다 — 2026-08-26 기준 GA,
 * global 과 us-central1 양쪽에 있다.
 */
export const LIVE_MODEL_VERTEX = 'gemini-live-2.5-flash'
export const LIVE_MODEL_APIKEY = 'gemini-live-2.5-flash'

export const LIVE_PATH = '/api/live'

/** 부스 비용 방어 — 한 세션이 무한정 열려 있지 않게 한다 */
const SESSION_MAX_MS = 5 * 60 * 1000

/**
 * LIVE_DEBUG=1 로 켜면 Live API 가 보내는 턴 경계·자막 이벤트를 그대로 찍는다.
 * "한 번 말했는데 두 번 요청이 간다" 류는 이 로그(voiceActivity 개수)로만 확정된다.
 */
const DEBUG = process.env.LIVE_DEBUG === '1'

/** 연결이 열리기 전에 브라우저가 보낸 메시지를 담아두는 한도 (오디오 청크 128ms 기준 ≈ 30초) */
const PENDING_MAX = 240

export function liveModelFor(config: OmniConfig): string {
  return config.mode === 'vertex' ? LIVE_MODEL_VERTEX : LIVE_MODEL_APIKEY
}

/**
 * 03 Voice Studio 컨셉 — AI 관상가.
 * 방문자가 웹캠으로 얼굴을 보여주면 실시간으로 관상을 봐준다.
 */
const SYSTEM_INSTRUCTION = [
  '당신은 관상을 봐주는 AI입니다. SM Entertainment AI Day 부스에 있고,',
  '손님 얼굴이 실시간 영상으로, 목소리가 실시간 음성으로 들어옵니다.',
  '',
  '[말투]',
  '- 정중한 존댓말, 차분하고 또렷하게. 손님을 "손님"이라 부른다.',
  '- 한 번에 2~3문장. 짧게 끊어 말하고 늘어놓지 않는다. 부스라 손님이 오래 서 있지 못한다.',
  '  화면에 보이는 특징(이마 넓이, 눈썹 숱, 코끝 모양, 입꼬리 방향 등)을 구체적으로 짚어',
  '  재미있게 말한다. "좋습니다"만 반복하는 뻔한 덕담과 피부·성형 조언은 금지.',
  '- 관상학 용어를 뜻풀이와 함께 자연스럽게 쓴다. 용어의 뜻은 아래 [12궁 사전] 을 따른다.',
  '',
  '[시작]',
  '손님이 자리에 앉으면 관상가가 먼저 입을 연다. 손님이 말을 걸 때까지 기다리지 않는다.',
  '인사는 한두 문장이면 충분하다 ("어서 오세요 손님, 관상을 봐 드리겠습니다").',
  '인사만 하고 멈추지 말고, 그 턴에서 바로 1단계(전체 윤곽)로 들어간다.',
  '',
  '[진행 — 4단계 스캔]',
  '얼굴을 위치로 훑어 내려간다. 1단계에서 전체 윤곽을 잡고, 2~4단계는',
  '상정 → 중정 → 하정 순으로 내려간다. 한 턴에 한 단계씩, 네 단계를 하나도 빼지 않는다.',
  '',
  '1단계 — 전체 프레임 & 기본 체질 (얼굴 윤곽)',
  '  보는 곳: 상모궁, 오악, 삼정(상정·중정·하정) 비율',
  '  읽는 것: 오행상(목·화·토·금·수) 체형 구분 / 삼정 비율로 본 삶의 균형감과 그릇의 크기 /',
  '           뼈와 살의 조화로 본 전체 인상과 에너지 수준',
  '',
  '2단계 — 지혜 & 명예운 (상정: 이마~눈썹)',
  '  보는 곳: 명궁(인당), 관록궁, 복덕궁, 천이궁',
  '  읽는 것: 이마의 넓이·매끄러움과 눈썹 사이(인당) 상태 / 초년운(15~30세), 학업운,',
  '           직장·관운, 명예, 이동(해외·이사)운 / 정신적 기상과 사고력, 조상·부모의 덕',
  '',
  '3단계 — 재물 & 대인관계운 (중정: 눈~코~광대)',
  '  보는 곳: 재백궁(코), 전택궁(눈두덩), 질액궁(산근), 형제궁, 처첩궁·남녀궁(눈가)',
  '  읽는 것: 눈·코·광대의 형태와 피부 상태 / 중년운(31~50세)의 핵심인 현금 재물운,',
  '           부동산운, 건강 저항력 / 배우자·연인 관계, 자식복, 동료와 사회적 인복',
  '',
  '4단계 — 말년 & 수확운 (하정: 입~턱~귀)',
  '  보는 곳: 노복궁, 지각(턱), 식록(인중·입), 귀(채청관)',
  '  읽는 것: 턱선·입술·귓바퀴의 형태와 살집 / 말년운(51세 이후), 노후 경제적 안정성,',
  '           평생의 식복 / 조직 관리력(리더십), 아랫사람·팬덤 복, 타고난 체력',
  '',
  '한 턴에서 이 세 가지를 이어서 말한다:',
  '1) (손님이 답했으면) 지금 단계를 2~3문장으로 읽어준다. 그 단계에 적힌 궁 가운데',
  '   한두 개만 골라 이름과 함께 짚는다. 적힌 궁을 다 짚으려 하지 않는다.',
  '2) 다음 단계가 얼굴의 어디이고 무엇을 보는 곳인지 한 문장으로 말한다.',
  '3) 그 자리를 보기 위한 자세를 청하며 말을 맺는다.',
  '   (예: "이제 이마와 미간이 있는 2단계를 볼까요? 머리를 넘겨 주시겠어요?")',
  '',
  '[말을 맺는 법 — 매우 중요]',
  '턴의 마지막 문장은 반드시 손님이 곧바로 답할 수 있는 요청이나 질문이어야 한다.',
  '(예: "눈썹이 잘 보이게 정면을 봐 주시겠어요?", "고개를 살짝 들어 주시겠어요?")',
  '"이제 눈썹과 눈을 봐 드리겠습니다" 처럼 예고만 해놓고 말을 멈추면 안 된다.',
  '손님은 자기 차례인 줄 모르고 가만히 있는다. 예고했으면 그 자리에서 이어서 보고,',
  '멈출 거면 "~해 주시겠어요?" 로 끝낸다.',
  '질문은 한 턴에 하나만. 한마디로 답할 수 있는 것으로 묻는다.',
  '',
  '[화면 보는 법]',
  '영상은 계속 들어오고 지난 장면도 함께 쌓인다. 판단은 항상 가장 최근 화면으로 한다.',
  '지금 손으로 가렸거나 고개를 돌렸거나 화면을 벗어났다면, 아까 잘 보였던 모습으로',
  '대신 읽지 않는다. 지금 안 보이면 안 보이는 것이다.',
  '',
  '한 부위를 읽기 전에, 지금 화면에서 그 부위가 실제로 보이는지 먼저 확인한다.',
  '"잘 보이네요", "화면에 잘 나와 계시네요" 같은 말은 하지 않는다. 확인도 없이',
  '보인다고 넘어가는 버릇이 든다. 보이면 아무 말 없이 바로 읽고, 안 보이면 다시 청한다.',
  '',
  '[잘 안 보일 때]',
  '볼 부위가 가려지거나 어둡거나 화면 밖이라 읽을 수 없으면, 그냥 넘기지 말고',
  '뭐가 어떻게 안 보이는지 짚어서 한 번 더 청한다.',
  '(예: "손에 가려 얼굴이 안 보이네요. 손을 내려 주시겠어요?")',
  '(예: "앞머리에 가려 이마가 잘 안 보이네요. 손으로 살짝 올려 주시겠어요?",',
  ' "화면이 어두워 눈썹이 잘 안 보입니다. 고개를 조금만 들어 주시겠어요?",',
  ' "얼굴이 화면에서 멀어요. 조금만 가까이 와 주시겠어요?")',
  '단, 같은 자리를 다시 청하는 것은 한 번까지다. 그래도 안 보이면 더 조르지 말고',
  '"얼굴이 잘 안 보여서 이 부분은 넘기겠습니다" 하고 다음 단계로 간다.',
  '못 본 자리를 본 것처럼 지어내지는 않는다.',
  '',
  '[반복 금지 — 매우 중요]',
  '말을 시작하기 전에 지금까지 몇 단계까지 읽었는지 먼저 떠올린다.',
  '이미 읽은 단계는 무슨 일이 있어도 다시 읽지 않는다. 방금 한 말을 그대로 다시 하지 않는다.',
  '손님이 뒤늦게 대답하거나 엉뚱한 말을 해도, 그 말에는 한 문장으로만 반응하고',
  '진행은 반드시 아직 안 읽은 다음 단계부터 이어간다.',
  '4단계까지 다 읽었으면 손님이 무슨 말을 하든 스캔을 다시 하지 않고 자유대화로 답한다.',
  '손님 답이 "네" 한마디여도 충분하다. 되묻지 말고 바로 읽어준다.',
  '말로 한 답이 짧거나 부실해도 다시 캐묻지 않는다.',
  '(화면에 부위가 안 보이는 것은 여기 해당하지 않는다 — 위 [잘 안 보일 때] 를 따른다.)',
  '진행이 꼬여도 단계를 건너뛰지 않는다. 어디까지 봤는지 떠올려 다음 단계부터 이어서 본다.',
  '',
  '[진행 안내]',
  '"(진행 안내: …)" 로 시작하는 말은 손님이 한 말이 아니라 무대 뒤 지시다.',
  '절대 소리 내어 읽거나 언급하지 말고, 시킨 대로 자연스럽게 이어서 말한다.',
  '',
  '관상가 자신은 "(진행 안내:" 로 시작하는 말을 어떤 경우에도 입 밖에 내지 않는다.',
  '그 형식을 따라 하지 않는다. 지시를 받았으면 손님에게 할 말만 바로 시작한다.',
  '괄호로 자기 행동을 설명하는 말("(2단계를 봅니다)" 같은 것)도 하지 않는다.',
  '',
  '[돈 이야기] 재물운·재정·돈 이야기는 오직 코(재백궁)를 볼 때만. 눈에서는 가정·집안·심성만 본다.',
  '',
  '[음성]',
  '전체 대화에서 한두 번, 손님 목소리 울림·톤을 관상 관점에서 짧게 평한다. 표현은 매번 바꾼다.',
  '3단계를 마치고 4단계(하정)로 넘어가기 직전에 한 번',
  '"SM 대박나자, 하고 크게 외쳐보세요" 하고 그 울림을 평한다.',
  '',
  '[스캔 마무리]',
  '4단계까지 읽었으면 그 턴 안에서 곧바로 마무리한다. 총평 턴을 따로 두지 않는다.',
  '1단계에서 이미 전체 그릇을 짚었으므로 같은 말을 또 할 필요가 없다.',
  '"이렇게 4단계 기본 스캔을 모두 마쳤습니다" 하고 한 문장으로 닫은 뒤,',
  '그 자리에서 곧바로 아래처럼 손님에게 차례를 넘긴다.',
  '',
  '[스캔 뒤 — 자유대화]',
  '4단계 스캔을 마치면 이렇게 손님에게 차례를 넘긴다:',
  '"추가적으로 궁금하신 부분이 있다면 질문 주세요. 더 자세히 답변해 드리겠습니다."',
  '이때부터는 4단계 스캔을 다시 하지 않는다. 손님이 묻는 것에만 답한다.',
  '손님이 "SM 대박나자" 를 다시 외치거나, 뒤늦게 대답하거나, 아무 말이나 해도',
  '4단계 내용을 다시 읽지 않는다. 한 문장으로 짧게 반응하고 무엇이 궁금한지 묻는다.',
  '앞에서 한 말과 같은 문장을 다시 말하는 것은 어떤 경우에도 금지다.',
  '답은 2~3문장. 화면에 보이는 얼굴 특징을 근거로 삼되, 앞에서 이미 한 말을 그대로',
  '되풀이하지 말고 그 질문에 맞는 새로운 이야기를 한다.',
  '손님이 한동안 말이 없어도 재촉하지 않고 조용히 기다린다.',
  '',
  '[금지] 정치·종교·건강 진단·수명·불행 예언은 피한다. 재미로 보는 것이다.',
  '',
  // 행동 규칙은 위까지. 아래는 "무엇을 아는지" — server/gwansang.ts 가 단일 소스다.
  TWELVE_PALACES,
].join('\n')

/** 목소리 — 차분한 톤. 마음에 안 들면 바꿀 것 (voice 목록 30종) */
const VOICE_NAME = 'Gacrux'

/**
 * 손님이 말을 안 하면 진행이 멈춘다.
 *
 * Live API 는 턴제라, 모델이 말을 마치면 손님이 뭐라도 말하기 전까지 아무 일도
 * 일어나지 않는다. 부스 방문자는 "지금이 내 차례"라는 걸 모르고 가만히 있는다.
 * (proactivity 설정은 반대 기능 — 모델이 답을 *안* 하게 만드는 것이라 쓸 수 없다.)
 * 그래서 침묵이 이만큼 이어지면 서버가 대신 등을 떠민다.
 */
const NUDGE_READING_MS = 3000

/**
 * "SM 대박나자" 를 지난 뒤로는 떠밀지 않는다 (0 = 끔).
 * 이때부터 손님은 이미 대화에 붙어 있고, 총평·자유대화는 생각할 시간이 필요하다.
 * 끊고 들어가면 대화가 아니라 방송이 된다. 자리를 오래 잡는 것은 SESSION_MAX_MS 가 막는다.
 */
const NUDGE_FREE_MS = 0

/** 손님이 한 마디도 안 하는 동안 연속으로 떠밀 수 있는 횟수 — 빈 자리에서 혼자 떠드는 것 방지 */
const NUDGE_MAX = 6

/**
 * 관상가가 먼저 말을 건다.
 *
 * 손님이 "안녕하세요" 하고 먼저 말을 걸어야 시작되는 구조였는데, 부스 방문자는
 * 언제 말해야 하는지도, 마이크가 살아 있는지도 모른다. 관상가가 먼저 입을 열면
 * 그 두 가지가 한 번에 해결된다 — 소리가 나는 순간 "아 되는구나" 하고 대답하게 된다.
 *
 * 곧바로 보내지 않고 잠깐 두는 이유: 연결되는 동안 손님이 한 인사가 버퍼에 담겼다가
 * 이 시점에 함께 올라온다. 그 인사에 모델이 반응하기 시작하면 이 지시는 취소된다.
 */
const OPENING_AFTER_MS = 2000

const OPENING_TEXT =
  '(진행 안내: 손님이 방금 자리에 앉았습니다. 짧게 인사하고, 바로 첫 부위인 이마부터 ' +
  '관상을 시작하세요.)'

/**
 * 부위를 훑는 동안의 떠밀기.
 * "다음 순서로"라고 하면 부위를 건너뛴다 — 실제로 이마·눈을 빼먹었다. "다음 부위로"라고 못박는다.
 */
const NUDGE_TEXT =
  '(진행 안내: 손님이 말이 없습니다. "네"라는 대답을 기다리지 마세요. 지금 화면이 가려져 ' +
  '볼 수 없으면 무엇이 어떻게 가렸는지 짚어 한 번 더 청하고, 볼 수 있으면 아직 읽지 않은 ' +
  '다음 단계를 읽어주세요. 이미 읽은 단계를 다시 읽지 말고, 단계를 건너뛰지도 마세요.)'

/**
 * 떠밀기를 그만둘 지점을 판별하는 말들.
 *
 * 기준점은 "SM 대박나자" 다. 손님이 크게 외치려고 숨을 고르는 사이에 NUDGE_READING_MS
 * 가 지나버려서, 손님이 외치는 도중에 관상가의 다음 말이 먼저 나오는 일이 있었다.
 * 외침을 청한 뒤로는 기다려 줘야 한다.
 *
 * 이 뒤로는 아무도 안 밀어주므로, 관상가가 스스로 차례를 넘기게 해야 한다 —
 * 입·턱을 읽은 턴을 "총평을 말씀드릴까요?" 로 맺도록 프롬프트에 못박아 두었다.
 *
 * 한 표현에만 걸면 안 된다 — 모델이 외침을 건너뛸 수도 있다. 그래서 뒤쪽 마무리
 * 표현들도 함께 보고, 그마저 다 빗나가면 턴 수로 강제 전환한다.
 * 공백을 지우고 비교한다 ("SM 대박 나자", "에스엠 대박나자" 가 모두 걸리도록).
 */
const HANDOFF_MARKS = ['대박나자', '총평', '궁금하신', '물어보세요', '무엇이든봐']

/** 안내 순서는 이마·눈·코·입턱·총평 다섯 턴이다. 이보다 넉넉히 지나면 무조건 그만 떠민다 */
const HANDOFF_TURN_FALLBACK = 7

const squash = (text: string): string => text.replace(/\s/g, '')

type ClientMessage =
  | { type: 'audio'; data: string }
  | { type: 'audioStreamEnd' }
  | { type: 'video'; data: string }
  | { type: 'text'; text: string }
  /** 관상가 목소리 재생이 실제로 끝났다 — 여기서부터 손님 차례다 */
  | { type: 'playbackDone' }

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

/** 모델이 보낸 메시지를 브라우저가 쓰기 좋은 형태로 추려서 넘긴다 */
function forwardServerMessage(browser: WebSocket, message: LiveServerMessage): void {
  // 서버가 판정한 손님 발화 시작/끝. 한 번 말했는데 이게 두 번 잡히면
  // 모델도 두 턴으로 답한다 — 지금 겪는 "말하다 끊고 다시 말함"의 근거가 여기 있다.
  const activity = message.voiceActivity?.voiceActivityType
  if (activity) {
    if (DEBUG) console.log(`[live] voiceActivity ${activity} @${message.voiceActivity?.audioOffset ?? '-'}`)
    if (activity === VoiceActivityType.ACTIVITY_START || activity === VoiceActivityType.ACTIVITY_END) {
      send(browser, {
        type: 'activity',
        state: activity === VoiceActivityType.ACTIVITY_START ? 'start' : 'end',
      })
    }
  }

  const content = message.serverContent
  if (!content) return

  // 사용자가 끼어들면 브라우저가 재생 큐를 비워야 한다
  if (content.interrupted) send(browser, { type: 'interrupted' })

  for (const part of content.modelTurn?.parts ?? []) {
    const data = part.inlineData?.data
    if (data) send(browser, { type: 'audio', data })
  }

  // 자막은 세 갈래로 온다 (genai.d.ts: LiveServerContent).
  //   interimInputTranscription — 손님이 말하는 도중의 저지연 추정. 계속 고쳐진다.
  //   inputTranscription        — 손님 발화 확정 자막. finished 로 그 발화의 끝을 알린다.
  //   outputTranscription       — 관상가(모델) 발화 자막.
  // interim 과 확정본을 구분 없이 이어붙이면 같은 말이 두 번 적힌다. 구분해서 넘긴다.
  //
  // 세 자막 모두 "모델 턴과의 순서를 보장하지 않는다"고 타입 주석에 적혀 있다.
  // 손님 자막과 관상가 자막이 서로 끼어들어 오므로, 줄 관리는 클라이언트가 역할별로 한다.
  const interim = content.interimInputTranscription?.text
  if (interim) {
    if (DEBUG) console.log(`[live] interim  ${JSON.stringify(interim)}`)
    send(browser, { type: 'transcript', role: 'user', text: interim, interim: true })
  }

  const heard = content.inputTranscription
  if (heard?.text) {
    if (DEBUG) console.log(`[live] heard    ${JSON.stringify(heard.text)} finished=${heard.finished ?? false}`)
    send(browser, {
      type: 'transcript',
      role: 'user',
      text: heard.text,
      done: heard.finished === true,
    })
  }

  const spoken = content.outputTranscription
  if (spoken?.text) {
    if (DEBUG) console.log(`[live] spoken   ${JSON.stringify(spoken.text)} finished=${spoken.finished ?? false}`)
    send(browser, {
      type: 'transcript',
      role: 'model',
      text: spoken.text,
      done: spoken.finished === true,
    })
  }

  if (content.turnComplete) {
    if (DEBUG) {
      console.log(
        `[live] turnComplete reason=${content.turnCompleteReason ?? '-'} ` +
          `status=${content.interactionStatus ?? '-'} waitingForInput=${content.waitingForInput ?? false}`,
      )
    }
    send(browser, { type: 'turnComplete' })
  }
}

async function handleConnection(config: OmniConfig, browser: WebSocket): Promise<void> {
  let session: Session | null = null
  let closed = false

  const shutdown = (reason?: string, kind: 'error' | 'ended' = 'error', detail?: string) => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    if (nudgeTimer) clearTimeout(nudgeTimer)
    if (reason) send(browser, { type: kind, message: reason, detail })
    try {
      session?.close()
    } catch {
      // 이미 닫혔으면 무시
    }
    browser.close()
  }

  // 시간 초과 시 정상 종료 (오류 아님) — 부스 비용·대기열 방어 (SESSION_MAX_MS)
  const timer = setTimeout(
    () => shutdown('세션이 종료되었습니다. 다시 보려면 버튼을 눌러 주세요.', 'ended'),
    SESSION_MAX_MS,
  )

  /**
   * Live 세션이 열리기 전에 브라우저가 보낸 것들.
   *
   * ai.live.connect 는 수 초가 걸린다. 예전에는 그 사이에 들어온 메시지를 받을
   * 핸들러 자체가 없어서 손님의 첫 "안녕하세요"가 통째로 사라졌고, 그래서
   * 손님이 두 번 인사하게 됐다. 이제는 담아뒀다가 열리자마자 순서대로 흘려보낸다.
   */
  let live: Session | null = null
  const pending: ClientMessage[] = []

  const forwardToModel = (msg: ClientMessage) => {
    if (closed || !live) return

    if (msg.type === 'audio') {
      live.sendRealtimeInput({
        audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
      })
    } else if (msg.type === 'audioStreamEnd') {
      // "마이크가 꺼졌다" 신호. 지금은 클라이언트가 보내지 않는다 (VoiceStudio.tsx 참고).
      live.sendRealtimeInput({ audioStreamEnd: true })
    } else if (msg.type === 'video') {
      // 웹캠 프레임 (JPEG). 음성 대화와 병행 — 활동 감지에는 잡히지 않는다
      live.sendRealtimeInput({
        video: { data: msg.data, mimeType: 'image/jpeg' },
      })
    } else if (msg.type === 'text') {
      // 채팅 입력 — 하나의 완결된 턴으로 넣어 응답을 유도한다
      const text = msg.text.trim()
      if (text) live.sendClientContent({ turns: text, turnComplete: true })
    }
    // playbackDone 은 모델로 보내지 않는다 — 넛지 타이머용 신호다 (아래 browser.on)
  }

  /**
   * 침묵 넛지 — 손님이 답을 안 해서 진행이 멈추는 것을 푼다.
   * 모델 턴이 끝나면 타이머를 걸고, 손님이 한 마디라도 하면 취소한다.
   */
  let nudgeTimer: ReturnType<typeof setTimeout> | null = null
  let nudgeStreak = 0
  /** "SM 대박나자" 를 지나면 손님 페이스에 맡긴다 — 여기서부터는 떠밀지 않는다 */
  let handedOff = false
  /** 오간 말 — 자막이 조각나서 오므로 이어 붙여놓고 본다 ("대박" + "나자" 로 쪼개져 온다) */
  let saidSoFar = ''
  let modelTurns = 0

  const handOff = (why: string) => {
    if (handedOff) return
    handedOff = true
    cancelNudge(false)
    if (DEBUG) console.log(`[live] 손님 페이스로 전환 (${why}) — 떠밀기 중단`)
  }

  const cancelNudge = (spoke: boolean) => {
    if (nudgeTimer) {
      clearTimeout(nudgeTimer)
      nudgeTimer = null
    }
    // 손님이 실제로 말했으면 연속 카운트를 리셋한다
    if (spoke) nudgeStreak = 0
  }

  const scheduleNudge = (text = NUDGE_TEXT, afterMs?: number) => {
    cancelNudge(false)
    const after = afterMs ?? (handedOff ? NUDGE_FREE_MS : NUDGE_READING_MS)
    if (after <= 0 || nudgeStreak >= NUDGE_MAX) return
    nudgeTimer = setTimeout(() => {
      nudgeTimer = null
      if (closed || !live) return
      nudgeStreak += 1
      if (DEBUG) console.log(`[live] 침묵 ${after}ms — 진행 안내 주입 (${nudgeStreak}/${NUDGE_MAX})`)
      live.sendClientContent({ turns: text, turnComplete: true })
    }, after)
  }

  /** 모델 메시지를 보고 넛지 타이머를 걸거나 푼다 */
  const paceTurns = (message: LiveServerMessage) => {
    // 손님이 말을 시작했다는 신호는 두 갈래로 잡는다. voiceActivity 가 오는지는
    // 모델·리전마다 다를 수 있어서, 자막이 잡히는 것도 같은 신호로 본다.
    if (message.voiceActivity?.voiceActivityType === VoiceActivityType.ACTIVITY_START) {
      cancelNudge(true)
      return
    }
    const content = message.serverContent
    if (!content) return

    // 관상가가 말한 것이든 손님이 외친 것이든 "SM 대박나자" 가 나오면 넘긴다.
    // 자막은 조각나서 오므로 이어 붙인 문자열에서 찾는다.
    if (!handedOff) {
      saidSoFar +=
        squash(content.outputTranscription?.text ?? '') + squash(content.inputTranscription?.text ?? '')
      const hit = HANDOFF_MARKS.find((mark) => saidSoFar.includes(mark))
      if (hit) handOff(`"${hit}" 감지`)
    }
    if (content.turnComplete) {
      modelTurns += 1
      if (modelTurns >= HANDOFF_TURN_FALLBACK) handOff(`${modelTurns}번째 턴 — 안전장치`)
    }

    if (content.inputTranscription?.text || content.interimInputTranscription?.text) {
      cancelNudge(true)
      return
    }
    // 모델이 말하는 중엔 타이머를 물린다.
    // 다시 세는 시작점은 turnComplete 가 아니라 브라우저의 playbackDone 이다 —
    // turnComplete 는 "생성이 끝났다"일 뿐, 스피커에서는 아직 몇 초 더 말하고 있다.
    if (content.modelTurn) cancelNudge(false)
  }

  // 연결 완료를 기다리지 않고 먼저 붙인다 — 위 주석의 이유
  browser.on('message', (raw) => {
    if (closed) return
    let msg: ClientMessage
    try {
      msg = JSON.parse(String(raw)) as ClientMessage
    } catch {
      return
    }

    if (msg.type === 'text') cancelNudge(true)
    if (msg.type === 'playbackDone') {
      scheduleNudge()
      return
    }

    if (live) {
      forwardToModel(msg)
      return
    }
    // 아직 세션 전 — 영상 프레임은 버린다 (지난 프레임은 의미가 없다). 음성·텍스트만 모은다.
    if (msg.type === 'video') return
    if (pending.length < PENDING_MAX) pending.push(msg)
  })

  browser.on('close', () => shutdown())
  browser.on('error', () => shutdown())

  // 첫 발화는 관상가가 한다 — 아래 연결 직후 OPENING_TEXT 주입 (OPENING_AFTER_MS 참고)

  try {
    const ai = createClient(config)
    session = await ai.live.connect({
      model: liveModelFor(config),
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: SYSTEM_INSTRUCTION,
        inputAudioTranscription: {
          languageCodes: ['ko-KR'],
          // 부스에서 반드시 나오는 말들. 기본 ASR 은 "SM 대박나자"를 "물슨 대박 나"로 듣는다.
          customVocabulary: [
            'SM',
            '에스엠',
            'SM 대박나자',
            '관상',
            '관상가',
            '재물운',
            '관록궁',
            '재백궁',
            '전택궁',
            '형제궁',
          ],
        },
        // 관상가가 한 말 — 화면 자막으로 내보낸다 (forwardServerMessage)
        outputAudioTranscription: {},
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } },
          languageCode: 'ko-KR',
        },
        realtimeInputConfig: {
          // 손님 목소리(또는 스피커 에코·주변 소음)가 감지돼도 AI 발화를 자르지 않는다.
          // 부스·이어폰 없는 환경에서 에코로 AI가 계속 끊기는 문제를 막는다.
          activityHandling: ActivityHandling.NO_INTERRUPTION,
          // 음성 감지 민감도는 낮게 — 손님 턴 시작/종료 판정만 느슨하게
          automaticActivityDetection: {
            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
            prefixPaddingMs: 300,
            silenceDurationMs: 1200,
          },
        },
      },
      callbacks: {
        // ready 는 여기서 보내지 않는다 — 아래에서 밀린 메시지를 다 흘려보낸 뒤에 보낸다
        onopen: () => {
          if (DEBUG) console.log('[live] 세션 열림')
        },
        onmessage: (message: LiveServerMessage) => {
          forwardServerMessage(browser, message)
          paceTurns(message)
        },
        // ErrorEvent 는 Node 전역 타입이 아니라서 SDK 콜백 시그니처에서 추론시킨다
        onerror: (e) => shutdown(e.message || 'Live API 오류', 'error', errorDetail(e)),
        onclose: () => shutdown(),
      },
    })
  } catch (err) {
    shutdown(err instanceof Error ? err.message : String(err), 'error', errorDetail(err))
    return
  }

  if (closed) {
    // 연결을 기다리는 동안 손님이 떠났다
    try {
      session.close()
    } catch {
      // 이미 닫혔으면 무시
    }
    return
  }

  live = session
  if (DEBUG && pending.length) console.log(`[live] 연결 전 밀린 메시지 ${pending.length}개 전달`)
  for (const msg of pending) forwardToModel(msg)
  pending.length = 0

  // 밀린 것을 다 넣은 뒤에 알린다 — 브라우저는 이걸 받고 나서 실시간 전송으로 전환한다
  send(browser, { type: 'ready' })

  // 손님이 먼저 말을 걸기를 기다리지 않는다. 연결되는 동안 손님이 인사했다면
  // 그 자막이나 모델 응답이 먼저 도착해 이 지시를 취소한다.
  scheduleNudge(OPENING_TEXT, OPENING_AFTER_MS)
}

/**
 * HTTP 서버의 upgrade 이벤트에 붙인다.
 *
 * Vite dev 서버는 HMR 용 WebSocket 을 이미 쓰고 있으므로 `noServer: true` 로 두고
 * 우리 경로(/api/live)로 온 것만 가로챈다. 나머지는 건드리지 않고 흘려보낸다.
 */
export function attachLiveServer(
  httpServer: { on(event: 'upgrade', cb: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): void },
  config: OmniConfig,
): void {
  const wss = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname !== LIVE_PATH) return

    if (config.mode === 'unconfigured') {
      socket.destroy()
      return
    }

    // 로깅용 — 차단 안 함. IAP 가 WS 업그레이드 요청에 JWT 헤더를 안 붙이는 알려진 버그가
    // 있어서(Google Issue Tracker #238496778) 여기서 막으면 정상 사용자도 끊길 수 있다.
    void getIapIdentity(req.headers).then((identity) => {
      console.log(`[iap] WS ${LIVE_PATH} ← ${identity?.email ?? '(미검증)'}`)
    })

    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleConnection(config, ws)
    })
  })
}
