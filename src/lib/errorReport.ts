/**
 * 에러 원문을 담은 페이지를 만들어 새 탭으로 연다.
 *
 * 부스 화면에는 짧은 메시지만 두고, 스택 트레이스·응답 본문 같은 원문은
 * 여기서 새 탭에 띄운다. `ErrorBanner` 와 `DownloadQr` 가 공유한다.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function openErrorReport(
  context: string,
  message: string,
  detail: string,
): void {
  const body = [
    `발생 위치 : ${context}`,
    `발생 시각 : ${new Date().toLocaleString("ko-KR")}`,
    `페이지    : ${location.pathname}`,
    "",
    "--- 화면에 표시된 메시지 ---",
    message,
    "",
    "--- 원본 에러 ---",
    detail,
  ].join("\n");

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>에러 상세 — ${escapeHtml(context)}</title>
<style>
  body { margin:0; padding:24px; background:#0f0f0f; color:#e8e8e8;
         font:13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size:15px; margin:0 0 16px; color:#ea4335; }
  pre { white-space:pre-wrap; word-break:break-word; margin:0;
        padding:16px; background:#1a1a1a; border:1px solid #333; border-radius:8px; }
  button { margin-bottom:16px; padding:8px 14px; cursor:pointer; border-radius:6px;
           border:1px solid #444; background:#1a1a1a; color:#e8e8e8; font:inherit; }
  button:hover { border-color:#666; }
</style></head><body>
<h1>에러 상세 — ${escapeHtml(context)}</h1>
<button id="copy">📋 전체 복사</button>
<pre id="body">${escapeHtml(body)}</pre>
<script>
  document.getElementById('copy').addEventListener('click', function () {
    var t = document.getElementById('body').textContent;
    navigator.clipboard.writeText(t).then(function () {
      var b = document.getElementById('copy');
      b.textContent = '✅ 복사됨';
      setTimeout(function () { b.textContent = '📋 전체 복사'; }, 1500);
    });
  });
</script>
</body></html>`;

  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const tab = window.open(url, "_blank");
  if (!tab) {
    // 팝업 차단 — 최소한 원문은 볼 수 있게 알린다
    alert("팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.");
  }
  // 탭이 로드된 뒤 해제한다. 즉시 revoke 하면 빈 탭이 뜬다
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
