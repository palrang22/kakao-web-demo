import { NavLink } from "react-router-dom";
import {
  AdminIcon,
  AudioIcon,
  GalleryIcon,
  HomeIcon,
  ImageIcon,
  VideoIcon,
} from "./Icons.tsx";

const ITEMS = [
  { to: "/", label: "홈", Icon: HomeIcon, end: true },
  { to: "/video", label: "비디오", Icon: VideoIcon, end: false },
  { to: "/image", label: "이미지", Icon: ImageIcon, end: false },
  { to: "/audio", label: "오디오", Icon: AudioIcon, end: false },
];

export function Rail() {
  return (
    <aside className="rail">
      <img className="mark" src="/header-logo-dot.svg" alt="Kakao AI 돛 Summit 26" />

      {ITEMS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          title={label}
          aria-label={label}
          className={({ isActive }) => (isActive ? "ritem on" : "ritem")}
        >
          <Icon />
        </NavLink>
      ))}

      <div className="spacer" />

      <NavLink
        to="/gallery"
        title="갤러리"
        aria-label="갤러리"
        className={({ isActive }) => (isActive ? "ritem on" : "ritem")}
      >
        <GalleryIcon />
      </NavLink>

      <NavLink
        to="/settings"
        title="관리자"
        aria-label="관리자"
        className={({ isActive }) => (isActive ? "ritem on" : "ritem")}
      >
        <AdminIcon />
      </NavLink>

      <img
        className="gc"
        src="/Google_Cloud_icon.svg"
        alt="Google Cloud"
        title="Powered by Google Cloud"
      />
    </aside>
  );
}
