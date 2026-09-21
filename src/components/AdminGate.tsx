import { useState, type FormEvent, type ReactNode } from "react";
import { ADMIN_PASSWORD, markAdminUnlocked, readAdminUnlocked } from "../lib/admin.ts";
import { LockIcon } from "./Icons.tsx";
import "../styles/studio.css";

function Gate({ prompt, onUnlock }: { prompt: string; onUnlock: () => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (input === ADMIN_PASSWORD) {
      markAdminUnlocked();
      onUnlock();
      return;
    }
    setError(true);
    setInput("");
  }

  return (
    <main className="studio admin">
      <form className="gate" onSubmit={submit}>
        <span className="gate-icon">
          <LockIcon />
        </span>
        <h2>관리자 확인</h2>
        <p>{prompt}</p>

        <input
          type="password"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(false);
          }}
          placeholder="비밀번호"
          aria-label="관리자 비밀번호"
          autoFocus
        />

        {error && <p className="gate-error">비밀번호가 맞지 않습니다.</p>}

        <button type="submit" className="primary" disabled={!input}>
          확인
        </button>
      </form>
    </main>
  );
}

/** 잠겨 있으면 게이트를, 풀려 있으면 children 을 렌더한다. 세션 내내 유지. */
export function AdminGate({
  children,
  prompt = "운영용 화면입니다. 비밀번호를 입력하세요.",
}: {
  children: ReactNode;
  prompt?: string;
}) {
  const [unlocked, setUnlocked] = useState(readAdminUnlocked);
  if (unlocked) return <>{children}</>;
  return <Gate prompt={prompt} onUnlock={() => setUnlocked(true)} />;
}
