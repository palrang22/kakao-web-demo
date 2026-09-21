import { AdminGate } from "../components/AdminGate.tsx";
import "../styles/studio.css";

function SettingsInner() {
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
