// Main-thread controller for the Lua sandbox worker.
// start() spins up a fresh worker; stop() hard-terminates it (kills runaway loops).
import type { PartData, ScriptData } from "@launcher/shared";
import type { WorkerToMain } from "./protocol";

export interface LuaRunnerEvents {
  onReady?: () => void;
  onPrint?: (text: string) => void;
  onError?: (text: string) => void;
  onPatch?: (id: string, props: Partial<PartData>) => void;
  onCreate?: (part: PartData) => void;
  onDestroy?: (id: string) => void;
  /** A script attached a Touched handler to this part — main thread should watch it. */
  onListen?: (id: string) => void;
  /** A script asked to move the local player (Players.LocalPlayer:Teleport). */
  onTeleport?: (x: number, y: number, z: number) => void;
}

export class LuaRunner {
  private worker: Worker | null = null;

  get running() {
    return this.worker !== null;
  }

  start(parts: PartData[], scripts: ScriptData[], ev: LuaRunnerEvents, localName = "tester") {
    this.stop();
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => {
      const m = e.data;
      switch (m.type) {
        case "ready": ev.onReady?.(); break;
        case "print": ev.onPrint?.(m.text); break;
        case "error": ev.onError?.(m.text); break;
        case "patch": ev.onPatch?.(m.id, m.props); break;
        case "create": ev.onCreate?.(m.part); break;
        case "destroy": ev.onDestroy?.(m.id); break;
        case "listen": ev.onListen?.(m.id); break;
        case "teleport": ev.onTeleport?.(m.x, m.y, m.z); break;
      }
    };
    this.worker.onerror = (e) => ev.onError?.(`worker: ${e.message}`);
    // Deep-copy so the worker owns its own state snapshot.
    this.worker.postMessage({
      type: "start",
      parts: JSON.parse(JSON.stringify(parts)),
      scripts: JSON.parse(JSON.stringify(scripts)),
      localName,
    });
  }

  /** Notify scripts that a player touched a watched part. */
  sendTouched(id: string, byName: string) {
    this.worker?.postMessage({ type: "touched", id, byName });
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
  }
}
