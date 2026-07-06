// Message protocol between the main thread and the Lua sandbox worker.
import type { PartData, ScriptData } from "@launcher/shared";

export type MainToWorker =
  | {
      type: "start";
      parts: PartData[];
      scripts: ScriptData[];
      localName?: string; // exposed as Players.LocalPlayer.Name
    }
  | { type: "touched"; id: string; byName: string }; // main thread detected a touch

export type WorkerToMain =
  | { type: "ready" }
  | { type: "print"; text: string }
  | { type: "error"; text: string }
  | { type: "patch"; id: string; props: Partial<Pick<PartData, "position" | "rotation" | "size" | "color" | "name">> }
  | { type: "create"; part: PartData }
  | { type: "destroy"; id: string }
  | { type: "listen"; id: string } // a script attached a Touched handler to this part
  | { type: "teleport"; x: number; y: number; z: number }; // move the local player
