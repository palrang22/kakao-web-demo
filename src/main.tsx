import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable.css'
// h1 .out(허브 히어로의 outline 글자)용 — variable 폰트는 굵은 굵기를 보간할 때
// 윤곽선이 미세하게 겹쳐서 -webkit-text-stroke 로 속을 비우면 그 겹침이 이중선으로 드러난다.
// static(고정 마스터) 폰트는 그 문제가 없어서 이 굵기만 따로 로드한다.
import 'pretendard/dist/web/static/Pretendard-ExtraBold.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
