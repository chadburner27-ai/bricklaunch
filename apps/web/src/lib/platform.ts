// Distinguishes the BrickLaunch desktop app (Electron) from the plain website.
// The Electron preload exposes `window.bricklaunch.isDesktop`. On the website
// this is undefined, so games are gated behind a download prompt and actual
// play only happens inside the EXE.
// Localhost counts as "desktop" for development so play is testable without
// building the EXE each time. The deployed website is never on localhost, so
// production still gates play behind the download.
const isLocalhost =
  typeof location !== "undefined" &&
  /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?)/.test(location.hostname);

export const IS_DESKTOP =
  (typeof window !== "undefined" && !!(window as any).bricklaunch?.isDesktop) || isLocalhost;

// The desktop app zip is hosted on GitHub Releases (too large for git/Render
// static, which inherit GitHub's 100 MB file limit). `latest/download` always
// resolves to the newest published release's asset.
export const DOWNLOAD_URL =
  "https://github.com/chadburner27-ai/bricklaunch/releases/latest/download/BrickLaunch-Windows.zip";
