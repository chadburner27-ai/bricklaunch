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

const $ = getStateCallbacks(room);
$(room.state).listen("phase", (v) => {
  console.log(`[bot] phase <- ${v} (winner=${room.state.winner || "-"})`);
  if (v === "playing" && (myRole === "murderer" || myRole === "sheriff")) {
    // find the other player and attack after a short delay
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

// park the bot at the murder-map spawn so it's within stab range of the browser
let t = 0;
const timer = setInterval(() => {
  t += 0.1;
  if (mode === "murder") {
    room.send("move", { x: Math.sin(t) * 2, y: 6, z: 48 + Math.cos(t) * 2, ry: t % (Math.PI * 2) });
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
