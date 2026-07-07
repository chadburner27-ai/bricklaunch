import http from "node:http";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./GameRoom.js";

// GAMESERVER_PORT for local dev; PORT is what cloud hosts (Render etc.) inject.
const PORT = Number(process.env.GAMESERVER_PORT ?? process.env.PORT ?? 2567);

// IMPORTANT: Colyseus attaches its OWN `request` listener for the matchmaking
// routes (/matchmake/*). If our handler responds to those requests too, the two
// listeners race and the response is corrupted — behind a proxy (Render) that
// surfaces as intermittent 502s and players fail to join the same room.
//
// So this handler ONLY answers /counts and a health check, and returns WITHOUT
// touching the response for everything else (notably /matchmake), letting
// Colyseus handle it.
const httpServer = http.createServer(async (req, res) => {
  const url = req.url ?? "";

  // Never touch matchmaking or websocket-upgrade routes — Colyseus owns them.
  if (url.indexOf("/matchmake") !== -1) return;

  if (req.method === "GET" && url === "/counts") {
    res.setHeader("Access-Control-Allow-Origin", "*");
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

  // Health check / anything else: a plain 200 keeps Render's probes happy.
  if (req.method === "GET" && (url === "/" || url === "/health")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("BrickLaunch game server OK");
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
