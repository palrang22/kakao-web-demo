import { useState } from "react";
import { AdminGate } from "../components/AdminGate.tsx";
import { isDemoMode, setDemoMode } from "../lib/demo.ts";
import "../styles/studio.css";

function SettingsInner() {
  const [demo, setDemo] = useState(isDemoMode);

  return (
    <main className="studio admin">
      <header className="studio-header">
        <div className="panel-head">
          <span className="t">Admin</span>
          <span className="c">잠금 해제됨</span>
        </div>
        <h1>관리자</h1>
      </header>

      <section className="composer">
        <label className="switch-row">
          <span>시연 모드 (촬영용)</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={demo}
            onChange={(e) => {
              setDemoMode(e.target.checked);
              setDemo(e.target.checked);
            }}
          />
        </label>
        <p className="hint-note">
          켜면 세 스튜디오가 모델을 호출하지 않고 public/demo/ 의 준비된 결과를 보여줍니다.
          이 브라우저에만 적용됩니다. 부스 운영 전에 반드시 끄세요.
        </p>
      </section>

      <section className="composer">
        <p className="panel-sub">
          기능 on/off 킬 스위치와 사용량 확인이 여기 들어갑니다.
        </p>
        <p className="hint-note">
          아직 구현 전입니다. 킬 스위치는 서버 쪽 검사와 함께 붙습니다.
        </p>
      </section>
    </main>
  );
}

export function Settings() {
  return (
    <AdminGate>
      <SettingsInner />
    </AdminGate>
  );
}
