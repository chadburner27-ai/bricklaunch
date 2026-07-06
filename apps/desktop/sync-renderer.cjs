// Builds the launcher web app pointed at the CLOUD backend, then copies the
// output into ./renderer for electron-builder to package. The desktop app is
// a thin shell around the same UI the website uses — it just talks to Render.
//
// Override the backend URLs by setting env vars before `npm run dist`:
//   VITE_API_URL=https://your-api.onrender.com
//   VITE_GAMESERVER_URL=wss://your-gameserver.onrender.com
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const API = process.env.VITE_API_URL || "https://bricklaunch-1.onrender.com";
const GS = process.env.VITE_GAMESERVER_URL || "wss://bricklaunch-2.onrender.com";

const webDir = path.resolve(__dirname, "..", "web");
const dist = path.join(webDir, "dist");
const renderer = path.join(__dirname, "renderer");

console.log(`[desktop] building launcher for:\n  API = ${API}\n  GS  = ${GS}`);

execSync("npm run build", {
  cwd: webDir,
  stdio: "inherit",
  env: { ...process.env, VITE_API_URL: API, VITE_GAMESERVER_URL: GS },
});

fs.rmSync(renderer, { recursive: true, force: true });
fs.cpSync(dist, renderer, { recursive: true });
console.log(`[desktop] copied ${dist} -> ${renderer}`);
