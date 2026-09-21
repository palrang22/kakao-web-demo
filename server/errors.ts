/**
 * 에러 원문을 사람이 읽을 수 있는 한 덩어리로 만든다.
 *
 * describeError() 는 화면에 띄울 한 줄짜리 친절한 메시지를 만드는 반면,
 * 이쪽은 원인 추적용이다 — SDK 가 던진 상태 코드와 응답 본문이 여기 들어 있다.
 * "에러코드 확인하기" 버튼이 새 탭에 띄우는 내용이 이 문자열이다.
 */

/** 응답 본문에 자격증명이 섞여 들어오는 경우를 대비한 마스킹 */
function redact(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z\-_]{10,}/g, 'AIza…(가려짐)')
    .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer …(가려짐)')
    .replace(/ya29\.[A-Za-z0-9._-]{20,}/g, 'ya29.…(가려짐)')
}

export function errorDetail(err: unknown): string {
  const lines: string[] = []

  if (err instanceof Error) {
    lines.push(`이름: ${err.name}`)
    lines.push(`메시지: ${err.message}`)

    // SDK 는 상태 코드를 프로퍼티로 따로 달아두는 경우가 많다
    const bag = err as unknown as Record<string, unknown>
    for (const key of ['status', 'statusText', 'code', 'reason']) {
      if (bag[key] !== undefined) lines.push(`${key}: ${String(bag[key])}`)
    }

    // cause / response 본문에 진짜 원인이 들어 있다
    if (bag.cause !== undefined) {
      lines.push('', '--- cause ---', safeStringify(bag.cause))
    }
    if (bag.response !== undefined) {
      lines.push('', '--- response ---', safeStringify(bag.response))
    }
    if (err.stack) {
      lines.push('', '--- stack ---', err.stack)
    }
  } else {
    lines.push(safeStringify(err))
  }

  return redact(lines.join('\n'))
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}
