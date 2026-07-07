import http from "node:http";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./GameRoom.js";

// GAMESERVER_PORT for local dev; PORT is what cloud hosts (Render etc.) inject.
const PORT = Number(process.env.GAMESERVER_PORT ?? process.env.PORT ?? 2567);

// Keep the process alive through unexpected errors (a crash here takes the whole
// server down for everyone). Capture the latest error so it can be read remotely
// via /debug when we can't see the host's logs.
let lastError = "none";
process.on("uncaughtException", (err) => {
  lastError = String((err as Error)?.stack || err);
  console.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (err) => {
  lastError = String((err as { stack?: string })?.stack || err);
  console.error("[unhandledRejection]", err);
});

// Colyseus attaches its OWN `request` listener for /matchmake/*. This handler
// must NEVER respond to those (it would race Colyseus and 502 behind a proxy).
// Sync (not async) to avoid any promise-timing surprises.
const httpServer = http.createServer((req, res) => {
  const url = req.url ?? "";
  if (url.indexOf("/matchmake") !== -1) return; // Colyseus owns it

  if (req.method === "GET" && url === "/counts") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    matchMaker
      .query({ name: "game" })
      .then((rooms) => {
        const counts: Record<string, number> = {};
        for (const r of rooms) {
          const gid = (r.metadata as { gameId?: string } | undefined)?.gameId;
          if (gid) counts[gid] = (counts[gid] ?? 0) + r.clients;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(counts));
      })
      .catch(() => {
        res.writeHead(500);
        res.end("{}");
      });
    return;
  }

  if (req.method === "GET" && url === "/debug") {
    res.setHeader("Content-Type", "text/plain");
    res.end(`build=node-build-2\nlastError:\n${lastError}`);
    return;
  }

  if (req.method === "GET" && (url === "/" || url === "/health")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("BrickLaunch game server OK (build node-build-2)");
    return;
  }

  res.writeHead(404);
  res.end();
});

const server = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

server.define("game", GameRoom).filterBy(["gameId"]);

server
  .listen(PORT, "0.0.0.0")
  .then(() => console.log(`[gameserver] listening on :${PORT}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
