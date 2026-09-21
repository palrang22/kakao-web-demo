import { GoogleGenAI } from '@google/genai'
import type { OmniConfig } from './config.ts'

/**
 * 인증 방식에 따라 SDK 클라이언트를 만든다.
 * vertex 모드에서는 apiKey 를 넘기는 자리가 아예 없고, ADC 가 알아서 인증한다.
 *
 * 스튜디오 3종이 같은 클라이언트를 쓰므로 여기 한 곳에만 둔다.
 */
export function createClient(config: OmniConfig, locationOverride?: string): GoogleGenAI {
  switch (config.mode) {
    case 'vertex':
      return new GoogleGenAI({
        vertexai: true,
        project: config.project,
        // 모델마다 지원 리전이 다르다. 호출부가 필요하면 덮어쓴다
        location: locationOverride ?? config.location,
      })
    case 'apikey':
      return new GoogleGenAI({ apiKey: config.apiKey })
    case 'unconfigured':
      throw new Error(config.reason)
  }
}
