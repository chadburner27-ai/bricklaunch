// Multiplayer smoke-test bot: joins a game room, moves around, says hello.
// In murder mode it also plays: logs its role and attacks once the round starts.
// Usage: node scripts/mp-testbot.mjs <gameId> [seconds] [mode]
import { Client, getStateCallbacks } from "colyseus.js";

const gameId = process.argv[2];
const lifetime = Number(process.argv[3] ?? 25) * 1000;
const mode = process.argv[4] ?? "sandbox";
if (!gameId) {
  console.error("usage: node scripts/mp-testbot.mjs <gameId> [seconds] [mode]");
  process.exit(1);
}

const client = new Client("ws://localhost:2567");
const room = await client.joinOrCreate("game", {
  gameId,
  mode,
  name: "TestBot",
  avatar: JSON.stringify({ shirtColor: "#ff3355", hat: "cone" }),
});
console.log(`[bot] joined room ${room.roomId} as ${room.sessionId} (mode=${mode})`);

let myRole = "none";
room.onMessage("chat", (m) => console.log(`[bot] chat  <- ${m.from}: ${m.text}`));
room.onMessage("system", (m) => console.log(`[bot] system<- ${m.text}`));
room.onMessage("role", (m) => {
  myRole = m.role;
  console.log(`[bot] role  <- ${m.role}`);
});

const voteFor = Number(process.argv[5] ?? 0); // which map this bot votes for
const $ = getStateCallbacks(room);
$(room.state).listen("phase", (v) => {
  console.log(`[bot] phase <- ${v} (map=${room.state.map || "-"} winner=${room.state.winner || "-"})`);
  if (v === "voting") {
    setTimeout(() => {
      console.log(`[bot] voting for map ${voteFor}`);
      room.send("vote", { map: voteFor });
    }, 1000);
  }
  if (v === "playing" && (myRole === "murderer" || myRole === "sheriff" || myRole === "hero")) {
    setTimeout(() => {
      for (const [sid] of room.state.players) {
        if (sid !== room.sessionId) {
          console.log(`[bot] attacking ${sid} as ${myRole}`);
          room.send("attack", { target: sid });
          break;
        }
      }
    }, 2500);
  }
});
$(room.state).listen("map", (m) => { if (m) console.log(`[bot] map chosen: ${m}`); });
// Hold wherever the server teleports us so attacks land in range.
let pos = { x: 0, y: 6, z: 40 };
room.onMessage("teleport", (m) => {
  pos = { x: m.x, y: m.y, z: m.z };
  console.log(`[bot] teleport <- (${Math.round(m.x)},${Math.round(m.y)},${Math.round(m.z)})`);
});

let t = 0;
const timer = setInterval(() => {
  t += 0.1;
  if (mode === "murder") {
    room.send("move", { x: pos.x, y: pos.y, z: pos.z, ry: 0 });
  } else {
    room.send("move", { x: Math.sin(t) * 8, y: 3, z: Math.cos(t) * 8, ry: t % (Math.PI * 2) });
  }
}, 100);

setTimeout(() => room.send("chat", "hello from TestBot! 👋"), 1500);

setTimeout(() => {
  clearInterval(timer);
  room.leave();
  console.log("[bot] left cleanly");
  process.exit(0);
}, lifetime);
