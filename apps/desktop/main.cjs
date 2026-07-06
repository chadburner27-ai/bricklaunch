// BrickLaunch desktop shell. Serves the built launcher (renderer/) from a local
// http server so React Router, Web Workers (the Lua sandbox), and WASM all work
// — none of which load reliably from file://. The app talks to the cloud API +
// game server over the network exactly like the website does.
const { app, BrowserWindow, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "renderer");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        let filePath = path.join(ROOT, urlPath);
        // Prevent path traversal outside the renderer folder.
        if (!filePath.startsWith(ROOT)) {
          res.writeHead(403);
          return res.end("forbidden");
        }
        // SPA fallback: routes without a file extension serve index.html so
        // client-side routing (BrowserRouter) works.
        if (!path.extname(filePath) || !fs.existsSync(filePath)) {
          filePath = path.join(ROOT, "index.html");
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
      } catch {
        res.writeHead(500);
        res.end("error");
      }
    });
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

// Single instance — a second launch just focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const port = await startServer();

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      backgroundColor: "#0e1520",
      title: "BrickLaunch",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Open real external links in the system browser, keep app nav internal.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("http")) shell.openExternal(url);
      return { action: "deny" };
    });

    mainWindow.loadURL(`http://127.0.0.1:${port}/`);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow?.reload();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
