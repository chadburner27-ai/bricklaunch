// Marks this environment as the desktop app so the launcher unlocks real
// gameplay (the website gates play behind a download instead).
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("bricklaunch", {
  isDesktop: true,
  version: "1.0.0",
});
