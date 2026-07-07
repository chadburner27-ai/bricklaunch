import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Scene,
  Mesh,
  MeshBuilder,
  Vector3,
  ArcRotateCamera,
  DynamicTexture,
  StandardMaterial,
  Color3,
} from "@babylonjs/core";
import { Client, Room, getStateCallbacks } from "colyseus.js";
import type { AvatarConfig, PartData, SceneData } from "@launcher/shared";
import { DEFAULT_AVATAR } from "@launcher/shared";
import { BabylonCanvas } from "../engine/BabylonCanvas";
import { createPartMesh, syncMeshFromPart, applyPartMaterial } from "../engine/parts";
import { createSkybox } from "../engine/textures";
import { buildCharacter, type CharacterHandle } from "../engine/character";
import { LuaRunner } from "../lua/LuaRunner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { IS_DESKTOP } from "../lib/platform";
import { DownloadScreen } from "../launcher/DownloadScreen";

// Configurable for deployment; defaults to same-host for local/LAN play.
const GAMESERVER_URL =
  (import.meta as any).env?.VITE_GAMESERVER_URL ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:2567`;
// HTTP form of the same host, for the /counts capacity check.
const COUNTS_URL = GAMESERVER_URL.replace(/^ws/, "http") + "/counts";
const MAX_PLAYERS = 35;
const GRAVITY = -0.22;
const WALK_SPEED = 0.18;
const JUMP_POWER = 0.32;

interface ChatLine {
  from?: string;
  text: string;
  system?: boolean;
}

interface RemotePlayer {
  char: CharacterHandle;
  tag: Mesh;
  target: { x: number; y: number; z: number; ry: number };
}

type Role = "none" | "innocent" | "sheriff" | "murderer" | "hero";

const ROLE_INFO: Record<Role, { label: string; hint: string; color: string }> = {
  none: { label: "", hint: "", color: "" },
  innocent: { label: "🟢 INNOCENT", hint: "Survive! If the sheriff falls, grab the dropped gun to become the hero.", color: "#6ad46a" },
  sheriff: { label: "🔵 SHERIFF", hint: "Find and shoot the murderer — click a player to shoot. Don't shoot innocents!", color: "#3fb2ff" },
  murderer: { label: "🔪 MURDERER", hint: "Eliminate EVERYONE. Get close and left-click to strike.", color: "#e0457b" },
  hero: { label: "🦸 HERO", hint: "You grabbed the gun — hunt down the murderer!", color: "#3fb2ff" },
};

// Must match the MAPS order on the server (GameRoom.ts).
const MURDER_MAPS = [
  { id: "manor", name: "🏰 Brick Manor" },
  { id: "village", name: "❄️ Snowy Village" },
  { id: "arena", name: "🌈 Neon Arena" },
];

export function PlayerPage() {
  const { id: gameId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { user, loading } = useAuth();

  const [status, setStatus] = useState("Loading game…");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const openChat = () => {
    setChatOpen(true);
    setTimeout(() => chatInputRef.current?.focus(), 0);
  };
  const [playerCount, setPlayerCount] = useState(1);
  const [full, setFull] = useState(false);

  // murder-mode HUD state (mirrored into refs for use inside Babylon callbacks)
  const [role, _setRole] = useState<Role>("none");
  const [phase, _setPhase] = useState("sandbox");
  const [timer, setTimer] = useState(0);
  const [myAlive, _setMyAlive] = useState(true);
  const [votes, setVotes] = useState<[number, number, number]>([0, 0, 0]);
  const [myVote, setMyVote] = useState(-1);
  const roleRef = useRef<Role>("none");
  const phaseRef = useRef("sandbox");
  const aliveRef = useRef(true);
  const gunRef = useRef({ dropped: false, x: 0, y: 0, z: 0 });
  const setRole = (r: Role) => { roleRef.current = r; _setRole(r); };
  const setPhase = (p: string) => { phaseRef.current = p; _setPhase(p); };
  const setMyAlive = (a: boolean) => { aliveRef.current = a; _setMyAlive(a); };

  const castVote = (i: number) => {
    roomRef.current?.send("vote", { map: i });
    setMyVote(i);
  };

  const roomRef = useRef<Room | null>(null);
  const runnerRef = useRef<LuaRunner>(new LuaRunner());
  const remoteRef = useRef<Map<string, RemotePlayer>>(new Map());

  const pushChat = (line: ChatLine) => setChat((c) => [...c.slice(-99), line]);

  function setup(scene: Scene, camera: ArcRotateCamera) {
    let disposed = false;
    const cleanupFns: (() => void)[] = [];
    const meshes = new Map<string, Mesh>();
    scene.collisionsEnabled = true;
    createSkybox(scene);

    // --- input state ---------------------------------------------------------
    const keys: Record<string, boolean> = {};
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      keys[e.code] = true;
    };
    const up = (e: KeyboardEvent) => (keys[e.code] = false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    (async () => {
      // 1) scene data
      let sd: SceneData;
      try {
        sd = await api.playScene(gameId!);
      } catch (e: any) {
        setStatus(`Could not load game: ${e.message}`);
        return;
      }
      if (disposed) return;

      for (const part of sd.parts) {
        try {
          const mesh = createPartMesh(scene, part);
          mesh.checkCollisions = true;
          meshes.set(part.id, mesh);
        } catch (err) {
          console.error(`part "${part.name}" failed to build:`, err);
        }
      }

      // 2) my avatar
      let avatar: AvatarConfig = DEFAULT_AVATAR;
      if (user) {
        try { avatar = await api.getAvatar(); } catch { /* default */ }
      }
      const me = buildCharacter(scene, avatar);
      const spawn = new Vector3(...sd.spawnPoint);
      // checkpoint: falling off the world returns you to your last teleport
      // target (so multi-level maps like the Backrooms keep progress)
      let checkpoint = spawn.add(new Vector3(0, 3, 0));
      // invisible collider capsule the character visuals follow
      const collider = MeshBuilder.CreateBox("collider", { width: 2, height: 5, depth: 1.2 }, scene);
      collider.isVisible = false;
      collider.position = spawn.add(new Vector3(0, 3, 0));
      collider.ellipsoid = new Vector3(1, 2.5, 0.7);
      me.root.parent = collider;
      me.root.position = new Vector3(0, -2.4, 0);

      // --- third-person follow camera -------------------------------------
      // Orbit with RIGHT mouse drag; scroll to zoom; zooming all the way in
      // switches to first person (your character hides until you zoom out).
      const canvasEl = scene.getEngine().getRenderingCanvas();
      if (canvasEl) canvasEl.oncontextmenu = (e) => e.preventDefault();

      // Full manual camera control — Babylon's built-in input differs across
      // versions (left vs right, orbit vs pan), so we drive it ourselves for
      // predictable Roblox-style feel: hold RIGHT mouse and drag to orbit,
      // scroll to zoom, left button stays free for clicking/attacking.
      camera.detachControl();
      const MIN_RADIUS = 0.5;
      const MAX_RADIUS = 28;
      const MIN_BETA = 0.15;      // how high you can look
      const MAX_BETA = 2.6;       // how low (near ground level)
      const ORBIT_SPEED = 0.006;  // radians per pixel dragged
      // Override BabylonCanvas's defaults so zoom can reach first person.
      camera.lowerRadiusLimit = MIN_RADIUS;
      camera.upperRadiusLimit = MAX_RADIUS;
      camera.radius = 14;
      camera.setTarget(collider.position.clone());
      const FIRST_PERSON_AT = 1.6;
      let firstPerson = false;

      let orbiting = false;
      let lastPX = 0, lastPY = 0;
      const onCamDown = (e: PointerEvent) => {
        if (e.button !== 2) return; // right button only
        orbiting = true;
        lastPX = e.clientX;
        lastPY = e.clientY;
        canvasEl?.setPointerCapture?.(e.pointerId);
      };
      const onCamMove = (e: PointerEvent) => {
        if (!orbiting) return;
        const dx = e.clientX - lastPX;
        const dy = e.clientY - lastPY;
        lastPX = e.clientX;
        lastPY = e.clientY;
        camera.alpha -= dx * ORBIT_SPEED;
        camera.beta = Math.min(MAX_BETA, Math.max(MIN_BETA, camera.beta - dy * ORBIT_SPEED));
      };
      const onCamUp = (e: PointerEvent) => {
        if (e.button === 2) orbiting = false;
      };
      const onCamWheel = (e: WheelEvent) => {
        e.preventDefault();
        camera.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, camera.radius + e.deltaY * 0.02));
      };
      canvasEl?.addEventListener("pointerdown", onCamDown);
      canvasEl?.addEventListener("pointermove", onCamMove);
      window.addEventListener("pointerup", onCamUp);
      canvasEl?.addEventListener("wheel", onCamWheel, { passive: false });
      cleanupFns.push(() => {
        canvasEl?.removeEventListener("pointerdown", onCamDown);
        canvasEl?.removeEventListener("pointermove", onCamMove);
        window.removeEventListener("pointerup", onCamUp);
        canvasEl?.removeEventListener("wheel", onCamWheel);
      });

      let vy = 0;
      let grounded = false;

      // 3) local Lua scripts (visual behaviors)
      const myName = user?.username ?? "guest";
      const watchedParts = new Set<string>(); // parts with Touched handlers
      const lastTouchAt = new Map<string, number>();
      runnerRef.current.start(sd.parts, sd.scripts, {
        onPatch: (pid, props) => {
          const part = sd.parts.find((p) => p.id === pid);
          const mesh = meshes.get(pid);
          if (part && mesh) {
            Object.assign(part, props);
            syncMeshFromPart(mesh, part);
            if (props.color) applyPartMaterial(mesh, part, scene);
          }
        },
        onCreate: (part) => {
          sd.parts.push(part);
          const mesh = createPartMesh(scene, part);
          mesh.checkCollisions = true;
          meshes.set(part.id, mesh);
        },
        onDestroy: (pid) => {
          meshes.get(pid)?.dispose();
          meshes.delete(pid);
          watchedParts.delete(pid);
        },
        onListen: (pid) => watchedParts.add(pid),
        onTeleport: (x, y, z) => {
          collider.position.set(x, y + 2.6, z);
          checkpoint = new Vector3(x, y + 2.6, z);
        },
        onPrint: (t) => pushChat({ text: `📜 ${t}`, system: true }),
        onError: (t) => pushChat({ text: `script error: ${t}`, system: true }),
      }, myName);

      // Touched detection: bounding-box overlap between my collider and any
      // watched part, checked at 5Hz on a timer (not rAF) so it also works
      // while the tab is backgrounded. Debounced to 1 fire / 600ms per part.
      const touchTimer = setInterval(() => {
        if (disposed) return;
        const now = Date.now();
        for (const pid of watchedParts) {
          const mesh = meshes.get(pid);
          if (!mesh) continue;
          mesh.computeWorldMatrix(true);
          collider.computeWorldMatrix(true);
          if (mesh.intersectsMesh(collider, false)) {
            if (now - (lastTouchAt.get(pid) ?? 0) > 600) {
              lastTouchAt.set(pid, now);
              runnerRef.current.sendTouched(pid, myName);
            }
          }
        }
      }, 200);
      cleanupFns.push(() => clearInterval(touchTimer));

      // 4) multiplayer
      try {
        // Capacity gate: a game holds up to MAX_PLAYERS. Checking /counts before
        // joining also stops joinOrCreate from silently spinning up a 2nd room
        // (which would split players across servers).
        const counts = await fetch(COUNTS_URL).then((r) => r.json()).catch(() => ({}));
        if ((counts[gameId!] ?? 0) >= MAX_PLAYERS) {
          setFull(true);
          setStatus("");
          return;
        }

        const client = new Client(GAMESERVER_URL);
        let room: Room;
        try {
          room = await client.joinOrCreate("game", {
            gameId,
            name: user?.username ?? `guest${Math.floor(Math.random() * 999)}`,
            avatar: JSON.stringify(avatar),
            mode: sd.mode ?? "sandbox",
          });
        } catch (joinErr: any) {
          // Room locked/full between our check and the join → treat as full.
          const msg = String(joinErr?.message ?? joinErr).toLowerCase();
          if (msg.includes("full") || msg.includes("locked") || msg.includes("seat")) {
            setFull(true);
            setStatus("");
            return;
          }
          throw joinErr;
        }
        if (disposed) { room.leave(); return; }
        roomRef.current = room;

        // chat + overhead speech bubbles (one per speaker, replaced on new message)
        const bubbles = new Map<string, { mesh: Mesh; timer: ReturnType<typeof setTimeout> }>();
        const showBubble = (sid: string, text: string) => {
          const old = bubbles.get(sid);
          if (old) { clearTimeout(old.timer); old.mesh.dispose(); }
          const anchor = sid === room.sessionId ? me.root : remoteRef.current.get(sid)?.char.root;
          if (!anchor) return;
          const bubble = makeChatBubble(scene, text);
          bubble.parent = anchor;
          bubble.position = new Vector3(0, sid === room.sessionId ? 5.6 : 6.6, 0);
          const timer = setTimeout(() => {
            if (!bubble.isDisposed()) bubble.dispose();
            bubbles.delete(sid);
          }, 4500);
          bubbles.set(sid, { mesh: bubble, timer });
        };
        cleanupFns.push(() => {
          for (const b of bubbles.values()) { clearTimeout(b.timer); b.mesh.dispose(); }
          bubbles.clear();
        });

        room.onMessage("chat", (m: { from: string; sid?: string; text: string }) => {
          pushChat({ from: m.from, text: m.text });
          if (m.sid) showBubble(m.sid, m.text);
        });
        room.onMessage("system", (m: { text: string }) =>
          pushChat({ text: m.text, system: true })
        );
        room.onMessage("role", (m: { role: Role; note?: string }) => {
          setRole(m.role);
          if (m.note) pushChat({ text: m.note, system: true });
        });
        // Server moves us between lobby / map spawns / respawn points.
        room.onMessage("teleport", (m: { x: number; y: number; z: number }) => {
          collider.position.set(m.x, m.y + 2.6, m.z);
          checkpoint = new Vector3(m.x, m.y + 2.6, m.z);
          vy = 0;
        });

        // gun drop visual: floats and spins where the sheriff fell
        const gunMesh = MeshBuilder.CreateBox("gun", { width: 1.6, height: 0.5, depth: 0.4 }, scene);
        const gunGrip = MeshBuilder.CreateBox("gunGrip", { width: 0.4, height: 0.9, depth: 0.4 }, scene);
        gunGrip.parent = gunMesh;
        gunGrip.position.set(-0.5, -0.55, 0);
        const gunMat = new StandardMaterial("gunMat", scene);
        gunMat.diffuseColor = Color3.FromHexString("#39424f");
        gunMat.emissiveColor = Color3.FromHexString("#1c232d");
        gunMesh.material = gunMat;
        gunGrip.material = gunMat;
        gunMesh.setEnabled(false);
        scene.onBeforeRenderObservable.add(() => {
          if (gunMesh.isEnabled()) gunMesh.rotation.y += 0.03;
        });
        cleanupFns.push(() => { gunMesh.dispose(); gunGrip.dispose(); });

        // Colyseus 0.16 callback API
        const $ = getStateCallbacks(room);

        // murder-mode round state
        $(room.state).listen("phase", (v: string) => {
          setPhase(v);
          if (v === "voting") setMyVote(-1);
        });
        $(room.state).listen("timer", (v: number) => setTimer(v));
        const syncVotes = () => {
          const s: any = room.state;
          setVotes([s.vote0, s.vote1, s.vote2]);
        };
        $(room.state).listen("vote0", syncVotes);
        $(room.state).listen("vote1", syncVotes);
        $(room.state).listen("vote2", syncVotes);
        const syncGun = () => {
          const s: any = room.state;
          gunRef.current = { dropped: s.gunDropped, x: s.gunX, y: s.gunY, z: s.gunZ };
          gunMesh.setEnabled(s.gunDropped);
          if (s.gunDropped) gunMesh.position.set(s.gunX, s.gunY + 1, s.gunZ);
        };
        $(room.state).listen("gunDropped", syncGun);
        $(room.state).listen("gunX", syncGun);

        $(room.state).players.onAdd((p: any, sessionId: string) => {
          if (sessionId === room.sessionId) {
            // my own server-side state: track alive for spectate mode
            $(p).listen("alive", (v: boolean) => {
              setMyAlive(v);
              me.root.setEnabled(v && camera.radius > FIRST_PERSON_AT);
            });
            return;
          }
          let cfg: AvatarConfig = DEFAULT_AVATAR;
          try { cfg = { ...DEFAULT_AVATAR, ...JSON.parse(p.avatar) }; } catch { /* default */ }
          const char = buildCharacter(scene, cfg);
          const tag = makeNameTag(scene, p.name);
          tag.parent = char.root;
          tag.position = new Vector3(0, 5.2, 0);
          // tag every mesh with the owner's sessionId so clicks can target them
          for (const m of char.root.getChildMeshes()) m.metadata = { sessionId };
          const rp: RemotePlayer = {
            char,
            tag,
            target: { x: p.x, y: p.y, z: p.z, ry: p.ry },
          };
          remoteRef.current.set(sessionId, rp);
          $(p).onChange(() => {
            rp.target = { x: p.x, y: p.y, z: p.z, ry: p.ry };
          });
          $(p).listen("alive", (v: boolean) => rp.char.root.setEnabled(v));
          setPlayerCount(remoteRef.current.size + 1);
        });
        $(room.state).players.onRemove((_p: any, sessionId: string) => {
          const rp = remoteRef.current.get(sessionId);
          if (rp) { rp.char.dispose(); rp.tag.dispose(); }
          remoteRef.current.delete(sessionId);
          setPlayerCount(remoteRef.current.size + 1);
        });

        setStatus("");

        // left-click = attack (murder mode): pick a player mesh under the cursor
        const onPointerDown = (evt: PointerEvent) => {
          if (evt.button !== 0) return;
          const r = roleRef.current;
          if (phaseRef.current !== "playing" || !aliveRef.current) return;
          if (r !== "murderer" && r !== "sheriff" && r !== "hero") return;
          const pick = scene.pick(scene.pointerX, scene.pointerY);
          const sid = pick?.pickedMesh?.metadata?.sessionId;
          if (sid) roomRef.current?.send("attack", { target: sid });
        };
        canvasEl?.addEventListener("pointerdown", onPointerDown);
        cleanupFns.push(() => canvasEl?.removeEventListener("pointerdown", onPointerDown));

        // send my position ~10Hz; also auto-grab the gun when close enough
        const sendTimer = setInterval(() => {
          if (!roomRef.current) return;
          roomRef.current.send("move", {
            x: collider.position.x,
            y: collider.position.y,
            z: collider.position.z,
            ry: me.root.rotation.y,
          });
          const g = gunRef.current;
          if (
            g.dropped && aliveRef.current && roleRef.current === "innocent" &&
            Math.hypot(collider.position.x - g.x, collider.position.y - g.y, collider.position.z - g.z) < 4
          ) {
            roomRef.current.send("pickup");
          }
        }, 100);
        room.onLeave(() => clearInterval(sendTimer));
      } catch (e: any) {
        setStatus("");
        pushChat({ text: `offline mode (gameserver unreachable: ${e.message})`, system: true });
      }

      // 5) game loop: movement + camera + remote interpolation
      scene.onBeforeRenderObservable.add(() => {
        // Camera-relative WASD: W walks where the camera looks, A/D strafe.
        // getDirection is correct by construction — no hand-rolled yaw math.
        const fwd = camera.getDirection(Vector3.Forward());
        fwd.y = 0;
        fwd.normalize();
        const right = camera.getDirection(Vector3.Right());
        right.y = 0;
        right.normalize();

        // Dead players during a round become free-flying ghost spectators.
        const spectating = !aliveRef.current && phaseRef.current === "playing";

        let dx = 0, dz = 0;
        if (keys["KeyW"]) { dx += fwd.x; dz += fwd.z; }
        if (keys["KeyS"]) { dx -= fwd.x; dz -= fwd.z; }
        if (keys["KeyD"]) { dx += right.x; dz += right.z; }
        if (keys["KeyA"]) { dx -= right.x; dz -= right.z; }
        const moving = dx !== 0 || dz !== 0;
        if (moving) {
          const len = Math.hypot(dx, dz);
          const spd = spectating ? WALK_SPEED * 1.6 : WALK_SPEED;
          dx = (dx / len) * spd;
          dz = (dz / len) * spd;
          me.root.rotation.y = Math.atan2(dx, dz); // face travel direction
        }
        me.animate(performance.now() / 1000, moving && !spectating ? 1 : 0);

        if (spectating) {
          // ghost: fly freely, no gravity or collision, Space up / Shift down
          let dy = 0;
          if (keys["Space"]) dy += WALK_SPEED * 1.6;
          if (keys["ShiftLeft"] || keys["ControlLeft"]) dy -= WALK_SPEED * 1.6;
          collider.position.x += dx;
          collider.position.y += dy;
          collider.position.z += dz;
          vy = 0;
        } else {
          vy += GRAVITY * scene.getAnimationRatio() * 0.06;
          if (keys["Space"] && grounded) { vy = JUMP_POWER; grounded = false; }
          const before = collider.position.y;
          collider.moveWithCollisions(new Vector3(dx, vy, dz));
          if (vy < 0 && Math.abs(collider.position.y - (before + vy)) > 0.001) {
            grounded = true;
            vy = 0;
          }
          // respawn at the last checkpoint if fallen off the world
          if (collider.position.y < checkpoint.y - 80) {
            collider.position.copyFrom(checkpoint);
            vy = 0;
          }
        }
        // camera locked to the player's head — moves with the player, orbit
        // angle stays wherever the right-drag left it
        camera.target.copyFrom(collider.position);
        camera.target.y += 1.4;

        // first-person toggle at minimum zoom
        const fp = camera.radius <= FIRST_PERSON_AT;
        if (fp !== firstPerson) {
          firstPerson = fp;
          me.root.setEnabled(!fp); // hide own body in first person
        }
        if (firstPerson && !moving) {
          // face the camera's look direction so movement stays intuitive
          me.root.rotation.y = Math.atan2(fwd.x, fwd.z);
        }

        // interpolate remote players; drive their walk cycle from how far
        // they still are from their network target (distance ≈ speed)
        const now = performance.now() / 1000;
        for (const rp of remoteRef.current.values()) {
          const r = rp.char.root;
          const gap = Math.hypot(rp.target.x - r.position.x, rp.target.z - r.position.z);
          r.position.x += (rp.target.x - r.position.x) * 0.2;
          r.position.y += (rp.target.y - 2.4 - r.position.y) * 0.2;
          r.position.z += (rp.target.z - r.position.z) * 0.2;
          r.rotation.y += (rp.target.ry - r.rotation.y) * 0.2;
          rp.char.animate(now, Math.min(1, gap * 2));
        }
      });
    })();

    return () => {
      disposed = true;
      cleanupFns.forEach((fn) => fn());
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      runnerRef.current.stop();
      roomRef.current?.leave();
      roomRef.current = null;
      for (const rp of remoteRef.current.values()) { rp.char.dispose(); rp.tag.dispose(); }
      remoteRef.current.clear();
    };
  }

  function sendChat(e: React.FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (text) roomRef.current?.send("chat", text);
    setChatInput("");
    setChatOpen(false);
    chatInputRef.current?.blur();
  }

  // Press "/" to start chatting (Roblox-style), unless already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "/") {
        e.preventDefault();
        openChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Wait for auth to resolve so we join with the right username/avatar,
  // not as a guest during the initial token check.
  if (loading) {
    return <div className="container"><p className="muted">Loading…</p></div>;
  }

  // On the website, games are download-gated — real play happens in the EXE.
  if (!IS_DESKTOP) {
    return <DownloadScreen />;
  }

  if (full) {
    return (
      <div className="center">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <h2>Game is full</h2>
          <p className="muted">This server has reached its {MAX_PLAYERS}-player limit. Please try again later.</p>
          <button onClick={() => nav("/")}>← Back to games</button>
        </div>
      </div>
    );
  }

  return (
    <div className="player-root">
      <div className="player-canvas">
        <BabylonCanvas setup={setup} cameraRadius={22} />
        <div className="player-hud">
          <button className="ghost" onClick={() => nav("/")}>← Play Another Game</button>
          <span className="muted">
            {status || `${playerCount} player${playerCount === 1 ? "" : "s"} · WASD move · Space jump · right-drag camera · scroll to zoom`}
          </span>
        </div>
        {phase !== "sandbox" && (
          <div className="round-hud">
            {phase === "lobby" && (
              <span className="muted">
                {playerCount >= 2 ? `🏠 Lobby — voting in ${timer}s…` : "🏠 Lobby — waiting for players…"}
              </span>
            )}
            {phase === "voting" && <span>🗺️ Vote for the next map · {timer}s</span>}
            {phase === "playing" && (
              <>
                <span>⏱ {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, "0")}</span>
                {role !== "none" && (
                  <span className="role-chip" style={{ color: ROLE_INFO[role].color }}>
                    {ROLE_INFO[role].label}
                  </span>
                )}
              </>
            )}
            {phase === "ended" && <span>Round over — back to lobby in {timer}s</span>}
          </div>
        )}

        {/* Map voting panel */}
        {phase === "voting" && (
          <div className="vote-panel">
            <div className="vote-title">Vote for the next map</div>
            <div className="vote-maps">
              {MURDER_MAPS.map((m, i) => (
                <button
                  key={m.id}
                  className={`vote-map ${myVote === i ? "voted" : ""}`}
                  onClick={() => castVote(i)}
                >
                  <div className="vote-map-name">{m.name}</div>
                  <div className="vote-count">{votes[i]} vote{votes[i] === 1 ? "" : "s"}</div>
                </button>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {myVote >= 0 ? "Vote locked in — most votes wins!" : "Click a map to vote"}
            </div>
          </div>
        )}

        {phase === "playing" && role !== "none" && myAlive && (
          <div className="role-hint">{ROLE_INFO[role].hint}</div>
        )}
        {phase === "playing" && !myAlive && (
          <div className="dead-overlay">
            💀 You're out — spectating<br />
            <span style={{ fontSize: 13, fontWeight: 400 }}>Fly with WASD · Space up · Shift down</span>
          </div>
        )}

        {/* Compact chat box, top-left. Click it or press "/" to type. */}
        <div className={`chat-box ${chatOpen ? "open" : ""}`} onClick={() => !chatOpen && openChat()}>
          <div className="chat-log">
            {chat.slice(-7).map((l, i) => (
              <div key={i} className={l.system ? "chat-system" : ""}>
                {l.from && <b>{l.from}: </b>}
                {l.text}
              </div>
            ))}
          </div>
          {chatOpen ? (
            <form onSubmit={sendChat} className="chat-input-row">
              <input
                ref={chatInputRef}
                placeholder="Type a message, then Enter…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setChatOpen(false); e.currentTarget.blur(); }
                }}
                onBlur={() => setChatOpen(false)}
              />
            </form>
          ) : (
            <div className="chat-hint">Press <kbd>/</kbd> or click to chat</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Speech bubble above a character's head; caller disposes/replaces it.
function makeChatBubble(scene: Scene, text: string): Mesh {
  const short = text.length > 44 ? text.slice(0, 43) + "…" : text;
  const w = 512, h = 96;
  const tex = new DynamicTexture("bubble", { width: w, height: h }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);
  // rounded white bubble
  const r = 26;
  ctx.beginPath();
  ctx.moveTo(r, 4);
  ctx.arcTo(w - 4, 4, w - 4, h - 24, r);
  ctx.arcTo(w - 4, h - 24, 4, h - 24, r);
  ctx.arcTo(4, h - 24, 4, 4, r);
  ctx.arcTo(4, 4, w - 4, 4, r);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  // little tail
  ctx.beginPath();
  ctx.moveTo(w / 2 - 12, h - 24);
  ctx.lineTo(w / 2, h - 2);
  ctx.lineTo(w / 2 + 12, h - 24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1b2434";
  ctx.font = "bold 34px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(short, w / 2, (h - 20) / 2 + 4);
  tex.update();

  const plane = MeshBuilder.CreatePlane("chatBubble", { width: 7, height: 7 * (h / w) }, scene);
  const mat = new StandardMaterial("bubbleMat", scene);
  mat.diffuseTexture = tex;
  mat.emissiveColor = Color3.White();
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  plane.material = mat;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  return plane;
}

function makeNameTag(scene: Scene, name: string): Mesh {
  const tex = new DynamicTexture("tag", { width: 256, height: 64 }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 256, 64);
  tex.drawText(name, null, 44, "bold 36px Segoe UI", "#ffffff", "transparent", true);
  const plane = MeshBuilder.CreatePlane("tagPlane", { width: 4, height: 1 }, scene);
  const mat = new StandardMaterial("tagMat", scene);
  mat.diffuseTexture = tex;
  mat.emissiveColor = Color3.White();
  mat.disableLighting = true;
  mat.useAlphaFromDiffuseTexture = true;
  plane.material = mat;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  return plane;
}
