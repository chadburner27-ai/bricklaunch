// One room per running game instance. Holds authoritative player state, relays
// movement + chat, and (for mode:"murder") runs the full round cycle:
//   lobby → map voting (3 maps) → playing (murderer/sheriff/innocents) → ended → lobby
// Round logic lives here on the server so it's synced and cheat-proof; the
// studio Lua handles only client-side flavor.
import { Room, Client } from "colyseus";
import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

export class PlayerState extends Schema {
  name: string = "guest";
  avatar: string = "{}"; // AvatarConfig JSON
  x: number = 0;
  y: number = 3;
  z: number = 0;
  ry: number = 0; // yaw, radians
  alive: boolean = true;
  // Roles are NOT synced through state (that would leak the murderer to
  // everyone). Each player learns only their own role via a private message.
}
defineTypes(PlayerState, {
  name: "string",
  avatar: "string",
  x: "number",
  y: "number",
  z: "number",
  ry: "number",
  alive: "boolean",
});

export class RoomState extends Schema {
  players = new MapSchema<PlayerState>();
  phase: string = "sandbox"; // sandbox | lobby | voting | playing | ended
  timer: number = 0; // seconds left in the current phase
  map: string = ""; // chosen map id while playing
  vote0: number = 0; // live vote tallies during the voting phase
  vote1: number = 0;
  vote2: number = 0;
  gunDropped: boolean = false;
  gunX: number = 0;
  gunY: number = 0;
  gunZ: number = 0;
  winner: string = ""; // "murderer" | "innocents" after a round
}
defineTypes(RoomState, {
  players: { map: PlayerState },
  phase: "string",
  timer: "number",
  map: "string",
  vote0: "number",
  vote1: "number",
  vote2: "number",
  gunDropped: "boolean",
  gunX: "number",
  gunY: "number",
  gunZ: "number",
  winner: "string",
});

// The three maps players vote between. `spawn` must match the scene regions
// built in the murder game (see api/src/seed.ts murderMap()).
export const MAPS = [
  { id: "manor", name: "🏰 Brick Manor", spawn: [180, 4, 40] as const },
  { id: "village", name: "❄️ Snowy Village", spawn: [-180, 4, 40] as const },
  { id: "arena", name: "🌈 Neon Arena", spawn: [0, 4, 220] as const },
];
const LOBBY_SPAWN = [0, 4, 40] as const;

const MAX_CHAT_LEN = 200;
const PROFANITY = ["dumbword1", "dumbword2"];

function cleanChat(text: string): string {
  let t = String(text).slice(0, MAX_CHAT_LEN);
  for (const w of PROFANITY) t = t.replace(new RegExp(w, "gi"), "*".repeat(w.length));
  return t;
}

interface JoinOptions {
  gameId?: string;
  name?: string;
  avatar?: string;
  mode?: string;
}

type Role = "none" | "innocent" | "sheriff" | "murderer" | "hero";

const LOBBY_SECONDS = 8;
const VOTE_SECONDS = 15;
const ROUND_SECONDS = 150;
const ENDED_SECONDS = 8;
const STAB_RANGE = 6;
const SHOOT_RANGE = 60;
const PICKUP_RANGE = 5;
const MIN_PLAYERS = 2;

export const MAX_PLAYERS = 35;

export class GameRoom extends Room<RoomState> {
  maxClients = MAX_PLAYERS;
  private lastChatAt = new Map<string, number>();
  private roles = new Map<string, Role>(); // sessionId -> secret role
  private votes = new Map<string, number>(); // sessionId -> map index

  onCreate(options: JoinOptions) {
    this.setState(new RoomState());
    this.setMetadata({ gameId: options.gameId ?? "unknown" });
    const murderMode = options.mode === "murder";
    this.state.phase = murderMode ? "lobby" : "sandbox";
    this.state.timer = LOBBY_SECONDS;

    this.onMessage("move", (client, data: { x: number; y: number; z: number; ry: number }) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || typeof data !== "object") return;
      const num = (v: unknown, min: number, max: number, fb: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb;
      };
      p.x = num(data.x, -500, 500, p.x);
      p.y = num(data.y, -100, 500, p.y);
      p.z = num(data.z, -500, 500, p.z);
      p.ry = num(data.ry, -10, 10, p.ry);
    });

    this.onMessage("chat", (client, text: string) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || typeof text !== "string" || !text.trim()) return;
      const now = Date.now();
      if (now - (this.lastChatAt.get(client.sessionId) ?? 0) < 500) return;
      this.lastChatAt.set(client.sessionId, now);
      this.broadcast("chat", { from: p.name, sid: client.sessionId, text: cleanChat(text.trim()), at: now });
    });

    if (murderMode) {
      this.onMessage("attack", (c, d: { target?: string }) => this.handleAttack(c, String(d?.target ?? "")));
      this.onMessage("pickup", (c) => this.handlePickup(c));
      this.onMessage("vote", (c, d: { map?: number }) => this.handleVote(c, Number(d?.map)));
      this.clock.setInterval(() => this.tickMurder(), 1000);
    }
  }

  onJoin(client: Client, options: JoinOptions) {
    const p = new PlayerState();
    p.name = String(options.name ?? "guest").slice(0, 24) || "guest";
    p.avatar = typeof options.avatar === "string" ? options.avatar.slice(0, 2000) : "{}";
    const [lx, ly, lz] = LOBBY_SPAWN;
    p.x = lx; p.y = ly; p.z = lz;
    this.state.players.set(client.sessionId, p);
    this.roles.set(client.sessionId, "none");
    this.broadcast("system", { text: `${p.name} joined`, at: Date.now() });
    if (this.state.phase === "playing") {
      // joined mid-round: spectate until the next one
      p.alive = false;
      client.send("role", { role: "none", note: "Round in progress — you'll join the next one." });
    } else {
      this.sendTeleport(client.sessionId, LOBBY_SPAWN);
    }
  }

  onLeave(client: Client) {
    const p = this.state.players.get(client.sessionId);
    if (p) this.broadcast("system", { text: `${p.name} left`, at: Date.now() });
    const role = this.roles.get(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.roles.delete(client.sessionId);
    this.votes.delete(client.sessionId);
    this.lastChatAt.delete(client.sessionId);
    if (this.state.phase === "voting") this.tallyVotes();
    if (this.state.phase === "playing") {
      if (role === "murderer") this.endRound("innocents", "The murderer fled!");
      else if (role === "sheriff") this.dropGun(p?.x ?? 0, p?.y ?? 3, p?.z ?? 0);
      this.checkWin();
    }
  }

  // ---- phase machine ---------------------------------------------------------

  private tickMurder() {
    const s = this.state;
    if (s.phase === "lobby") {
      if (s.players.size >= MIN_PLAYERS) {
        s.timer -= 1;
        if (s.timer <= 0) this.startVoting();
      } else {
        s.timer = LOBBY_SECONDS; // hold until enough players
      }
    } else if (s.phase === "voting") {
      s.timer -= 1;
      if (s.timer <= 0) this.startRound();
    } else if (s.phase === "playing") {
      s.timer -= 1;
      if (s.timer <= 0) this.endRound("innocents", "Time's up — the murderer failed!");
    } else if (s.phase === "ended") {
      s.timer -= 1;
      if (s.timer <= 0) this.backToLobby();
    }
  }

  private startVoting() {
    const s = this.state;
    s.phase = "voting";
    s.timer = VOTE_SECONDS;
    s.vote0 = s.vote1 = s.vote2 = 0;
    this.votes.clear();
    this.broadcast("system", { text: "🗺️ Vote for the next map!", at: Date.now() });
  }

  private handleVote(client: Client, mapIdx: number) {
    if (this.state.phase !== "voting") return;
    if (!Number.isInteger(mapIdx) || mapIdx < 0 || mapIdx >= MAPS.length) return;
    this.votes.set(client.sessionId, mapIdx);
    this.tallyVotes();
  }

  private tallyVotes() {
    const counts = [0, 0, 0];
    for (const idx of this.votes.values()) counts[idx] = (counts[idx] ?? 0) + 1;
    this.state.vote0 = counts[0];
    this.state.vote1 = counts[1];
    this.state.vote2 = counts[2];
  }

  private startRound() {
    const s = this.state;
    const ids = [...s.players.keys()];
    if (ids.length < MIN_PLAYERS) {
      this.backToLobby();
      return;
    }
    // Winning map = most votes; ties (and no votes) broken randomly.
    const counts = [s.vote0, s.vote1, s.vote2];
    const max = Math.max(...counts);
    const winners = counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
    const mapIdx = winners.length ? winners[Math.floor(Math.random() * winners.length)] : 0;
    const map = MAPS[mapIdx];
    s.map = map.id;

    // shuffle → [0] murderer, [1] sheriff, rest innocent
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    ids.forEach((sid, i) => {
      const role: Role = i === 0 ? "murderer" : i === 1 ? "sheriff" : "innocent";
      this.roles.set(sid, role);
      const p = s.players.get(sid)!;
      p.alive = true;
      const [sx, sy, sz] = map.spawn;
      // spread players out a little around the spawn
      const off = i * 3;
      p.x = sx + (off % 12) - 6;
      p.z = sz + Math.floor(off / 12) * 3;
      p.y = sy;
      this.clients.find((c) => c.sessionId === sid)?.send("role", { role, map: map.name });
      this.sendTeleport(sid, [p.x, p.y, p.z]);
    });
    s.phase = "playing";
    s.timer = ROUND_SECONDS;
    s.winner = "";
    s.gunDropped = false;
    this.broadcast("system", { text: `🔪 Round started on ${map.name}! One of you is the murderer…`, at: Date.now() });
  }

  private endRound(winner: "murderer" | "innocents", reason: string) {
    const s = this.state;
    if (s.phase !== "playing") return;
    s.phase = "ended";
    s.timer = ENDED_SECONDS;
    s.winner = winner;
    s.gunDropped = false;
    this.broadcast("system", {
      text: `${winner === "murderer" ? "🔪 The murderer wins!" : "🎉 Innocents win!"} ${reason}`,
      at: Date.now(),
    });
  }

  private backToLobby() {
    const s = this.state;
    s.phase = "lobby";
    s.timer = LOBBY_SECONDS;
    s.winner = "";
    s.map = "";
    s.gunDropped = false;
    s.vote0 = s.vote1 = s.vote2 = 0;
    this.votes.clear();
    for (const [sid, p] of s.players) {
      p.alive = true;
      this.roles.set(sid, "none");
      const [lx, ly, lz] = LOBBY_SPAWN;
      p.x = lx; p.y = ly; p.z = lz;
      this.sendTeleport(sid, LOBBY_SPAWN);
    }
    this.broadcast("system", { text: "🏠 Everyone's back in the lobby. Next vote soon!", at: Date.now() });
  }

  private sendTeleport(sid: string, pos: readonly [number, number, number]) {
    this.clients.find((c) => c.sessionId === sid)?.send("teleport", { x: pos[0], y: pos[1], z: pos[2] });
  }

  // ---- combat ----------------------------------------------------------------

  private dist(a: PlayerState, b: PlayerState) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  private kill(sid: string, reason: string) {
    const p = this.state.players.get(sid);
    if (!p || !p.alive) return;
    p.alive = false;
    this.broadcast("system", { text: `💀 ${p.name} ${reason}`, at: Date.now() });
  }

  private handleAttack(client: Client, targetId: string) {
    const s = this.state;
    if (s.phase !== "playing") return;
    const attacker = s.players.get(client.sessionId);
    const target = s.players.get(targetId);
    const role = this.roles.get(client.sessionId);
    if (!attacker || !target || !attacker.alive || !target.alive || targetId === client.sessionId) return;

    if (role === "murderer") {
      if (this.dist(attacker, target) > STAB_RANGE) return;
      const targetRole = this.roles.get(targetId);
      this.kill(targetId, "was murdered!");
      if (targetRole === "sheriff" || targetRole === "hero") this.dropGun(target.x, target.y, target.z);
      this.checkWin();
    } else if (role === "sheriff" || role === "hero") {
      if (this.dist(attacker, target) > SHOOT_RANGE) return;
      if (this.roles.get(targetId) === "murderer") {
        this.kill(targetId, "— the murderer — was shot!");
        this.endRound("innocents", `${attacker.name} took down the murderer!`);
      } else {
        // classic rule: shooting an innocent takes you down too
        this.kill(targetId, "was shot by mistake!");
        this.kill(client.sessionId, "paid the price for shooting an innocent!");
        if (role === "hero") this.dropGun(attacker.x, attacker.y, attacker.z);
        this.checkWin();
      }
    }
  }

  private dropGun(x: number, y: number, z: number) {
    const s = this.state;
    s.gunDropped = true;
    s.gunX = x;
    s.gunY = y;
    s.gunZ = z;
    this.broadcast("system", { text: "🔫 The gun dropped! An innocent can grab it to become the hero.", at: Date.now() });
  }

  private handlePickup(client: Client) {
    const s = this.state;
    if (s.phase !== "playing" || !s.gunDropped) return;
    const p = s.players.get(client.sessionId);
    if (!p || !p.alive || this.roles.get(client.sessionId) !== "innocent") return;
    if (Math.hypot(p.x - s.gunX, p.y - s.gunY, p.z - s.gunZ) > PICKUP_RANGE) return;
    s.gunDropped = false;
    this.roles.set(client.sessionId, "hero");
    client.send("role", { role: "hero" });
    this.broadcast("system", { text: `🦸 ${p.name} grabbed the gun and became the hero!`, at: Date.now() });
  }

  private checkWin() {
    const s = this.state;
    if (s.phase !== "playing") return;
    let murdererAlive = false;
    let othersAlive = 0;
    for (const [sid, p] of s.players) {
      if (!p.alive) continue;
      if (this.roles.get(sid) === "murderer") murdererAlive = true;
      else othersAlive += 1;
    }
    if (!murdererAlive) this.endRound("innocents", "The murderer is dead.");
    else if (othersAlive === 0) this.endRound("murderer", "Everyone was eliminated…");
  }
}
