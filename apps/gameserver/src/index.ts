import http from "node:http";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./GameRoom.js";

// GAMESERVER_PORT for local dev; PORT is what cloud hosts (Render etc.) inject.
const PORT = Number(process.env.GAMESERVER_PORT ?? process.env.PORT ?? 2567);

// The same HTTP server carries the Colyseus WebSocket upgrade AND a tiny
// REST surface: GET /counts -> { [gameId]: livePlayerCount } for the launcher.
const httpServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "GET" && req.url === "/counts") {
    try {
      const rooms = await matchMaker.query({ name: "game" });
      const counts: Record<string, number> = {};
      for (const r of rooms) {
        const gid = (r.metadata as { gameId?: string } | undefined)?.gameId;
        if (gid) counts[gid] = (counts[gid] ?? 0) + r.clients;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(counts));
    } catch {
      res.writeHead(500);
      res.end("{}");
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

const server = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// filterBy gameId: players of the same game share a room; different games never mix.
server.define("game", GameRoom).filterBy(["gameId"]);

server
  .listen(PORT)
  .then(() => console.log(`[gameserver] listening on ws://localhost:${PORT}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
