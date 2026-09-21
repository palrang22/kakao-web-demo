/**
 * Gemini Live 용 오디오 입출력.
 *
 * Live API 규격이 포맷을 정한다.
 *   입력  16kHz 16-bit PCM mono
 *   출력  24kHz 16-bit PCM mono
 *
 * 입력 리샘플링은 직접 하지 않는다. AudioContext 를 16kHz 로 만들면
 * 마이크(보통 48kHz)를 브라우저가 알아서 변환해준다.
 */

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

/** 워크릿은 별도 파일 없이 Blob URL 로 올린다 (빌드 설정을 건드리지 않기 위해) */
const RECORDER_WORKLET = `
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.count = 0;
    // 128 프레임씩 오는 것을 모아서 보낸다. 2048 프레임 = 16kHz 에서 128ms
    this.target = 2048;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    this.chunks.push(new Float32Array(ch));
    this.count += ch.length;
    if (this.count < this.target) return true;

    const merged = new Float32Array(this.count);
    let offset = 0;
    for (const c of this.chunks) { merged.set(c, offset); offset += c.length; }

    const pcm = new Int16Array(merged.length);
    for (let i = 0; i < merged.length; i++) {
      const s = Math.max(-1, Math.min(1, merged[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);

    this.chunks = [];
    this.count = 0;
    return true;
  }
}
registerProcessor('pcm-recorder', PcmRecorder);
`;

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000; // 한 번에 넘기면 인자 개수 제한에 걸린다
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/** 마이크 캡처. 반환된 함수를 호출하면 완전히 정리된다. */
export async function startMicCapture(
  onChunk: (base64: string) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const ctx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
  const url = URL.createObjectURL(
    new Blob([RECORDER_WORKLET], { type: "application/javascript" }),
  );

  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-recorder");
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) =>
    onChunk(toBase64(e.data));

  source.connect(node);
  // 워크릿을 살려두려면 목적지에 연결해야 한다. 소리는 내보내지 않는다.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(ctx.destination);

  return () => {
    node.port.onmessage = null;
    node.disconnect();
    source.disconnect();
    mute.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };
}

/**
 * 모델이 보내는 PCM 조각을 끊김 없이 이어 재생한다.
 * 도착 시각이 아니라 재생 커서를 기준으로 예약해야 소리가 겹치거나 끊기지 않는다.
 */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private cursor = 0;
  private playing = new Set<AudioBufferSourceNode>();

  /** 모델 출력이 작아서 부스 소음에 묻힌다 — 살짝 키운다 */
  private static readonly GAIN = 1.8;

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = PcmPlayer.GAIN;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** 사용자 제스처 안에서 한 번 불러야 자동재생 정책에 걸리지 않는다 */
  async unlock(): Promise<void> {
    await this.context().resume();
  }

  play(pcm: Int16Array): void {
    if (!pcm.length) return;
    const ctx = this.context();

    const buffer = ctx.createBuffer(1, pcm.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain ?? ctx.destination);
    source.onended = () => this.playing.delete(source);

    const startAt = Math.max(ctx.currentTime, this.cursor);
    source.start(startAt);
    this.cursor = startAt + buffer.duration;
    this.playing.add(source);
  }

  /** 지금 예약된 재생이 끝나기까지 남은 시간(ms). 재생 중이 아니면 0 */
  remainingMs(): number {
    if (!this.ctx) return 0;
    return Math.max(0, (this.cursor - this.ctx.currentTime) * 1000);
  }

  /** 현재 재생 시각(초, AudioContext 기준). 자막을 소리에 맞춰 늦출 때 쓴다 */
  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /**
   * 지금까지 예약된 소리가 전부 끝나는 시각(초, AudioContext 기준).
   * 방금 도착한 자막 조각이 담당하는 소리의 끝이기도 하다 — 다음 조각은 여기서 시작한다.
   */
  endTime(): number {
    if (!this.ctx) return 0;
    return Math.max(this.ctx.currentTime, this.cursor);
  }

  /** 사용자가 끼어들었을 때 — 예약된 것까지 전부 버린다 */
  flush(): void {
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        // 이미 끝난 소스는 무시
      }
    }
    this.playing.clear();
    this.cursor = 0;
  }

  close(): void {
    this.flush();
    void this.ctx?.close();
    this.ctx = null;
    this.gain = null;
  }
}
