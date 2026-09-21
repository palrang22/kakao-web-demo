import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { AdminGate } from "./components/AdminGate.tsx";
import { ConsentGate } from "./components/ConsentGate.tsx";
import { Rail } from "./components/Rail.tsx";
import { ThemeProvider } from "./lib/ThemeProvider.tsx";
import { Gallery } from "./routes/Gallery.tsx";
import { Hub } from "./routes/Hub.tsx";
import { LookStudio } from "./routes/LookStudio.tsx";
import { MotionStudio } from "./routes/MotionStudio.tsx";
import { Settings } from "./routes/Settings.tsx";
import { VoiceStudio } from "./routes/VoiceStudio.tsx";
import "./styles/hub.css";

/** 허브만 2열 분할 레이아웃을 쓴다. 스튜디오 페이지는 전체 폭. */
function Shell() {
  const { pathname } = useLocation();
  const isHub = pathname === "/";

  return (
    <div className="shell">
      <Rail />
      <div className={isHub ? "main main-split" : "main"}>
        <Routes>
          <Route path="/" element={<Hub />} />
          {/* key 는 라우트마다 ConsentGate 를 강제로 새로 마운트시킨다.
              key 가 없으면 세 라우트의 <ConsentGate> 가 트리에서 같은 위치·같은 타입이라
              React 가 상태(consented)를 유지해서, 한 번 동의하면 다른 스튜디오는 게이트가 건너뛰어진다. */}
          <Route
            path="/video"
            element={
              <ConsentGate key="video" variant="capture" kind="video">
                <MotionStudio />
              </ConsentGate>
            }
          />
          <Route
            path="/image"
            element={
              <ConsentGate key="image" variant="capture" kind="image">
                <LookStudio />
              </ConsentGate>
            }
          />
          <Route
            path="/audio"
            element={
              <ConsentGate key="audio" variant="live" kind="audio">
                <VoiceStudio />
              </ConsentGate>
            }
          />
          <Route
            path="/gallery"
            element={
              <AdminGate prompt="갤러리는 관리자 전용입니다. 비밀번호를 입력하세요.">
                <Gallery />
              </AdminGate>
            }
          />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Hub />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </ThemeProvider>
  );
}
