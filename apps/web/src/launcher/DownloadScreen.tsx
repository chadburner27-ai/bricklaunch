import { useNavigate } from "react-router-dom";
import { DOWNLOAD_URL } from "../lib/platform";

// Shown on the website when someone tries to play a game in the browser.
// Games only run inside the BrickLaunch desktop app.
export function DownloadScreen({ title }: { title?: string }) {
  const nav = useNavigate();
  return (
    <div className="center">
      <div className="auth-card" style={{ textAlign: "center", maxWidth: 440 }}>
        <div style={{ fontSize: 46, marginBottom: 6 }}>🧱🎮</div>
        <h2>Play in the BrickLaunch app</h2>
        <p className="muted">
          {title ? <>“{title}” and every BrickLaunch game run in the free desktop app. </> : null}
          Download it for Windows to build, play, and hang out with friends in 3D.
        </p>
        <a href={DOWNLOAD_URL}>
          <button style={{ width: "100%", fontSize: 16, padding: "12px 0" }}>
            ⬇ Download BrickLaunch for Windows
          </button>
        </a>
        <p className="muted" style={{ fontSize: 12 }}>
          Unzip and run <b>BrickLaunch.exe</b> — no install needed. (Windows may show
          a SmartScreen notice: click “More info → Run anyway”.)
        </p>
        <button className="ghost" onClick={() => nav("/")}>← Back to games</button>
      </div>
    </div>
  );
}
