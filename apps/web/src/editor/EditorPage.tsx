import { useEffect, useReducer, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Scene,
  Mesh,
  GizmoManager,
  UtilityLayerRenderer,
  Color3,
} from "@babylonjs/core";
import type { PartData, SceneData, ScriptData } from "@launcher/shared";
import { BabylonCanvas } from "../engine/BabylonCanvas";
import {
  createPartMesh,
  syncMeshFromPart,
  syncPartFromMesh,
  applyPartMaterial,
} from "../engine/parts";
import { LuaRunner } from "../lua/LuaRunner";
import { createSkybox } from "../engine/textures";
import { api } from "../lib/api";

const SCRIPT_TEMPLATE = `-- Lua2Code script
-- API: workspace:FindFirstChild(name), Instance.new("Part"|"Sphere"|"Cylinder"|"Wedge"),
--      part.Position/Rotation/Size (Vector3), part.Color (hex or Color3.fromRGB),
--      wait(seconds), spawn(fn), print(...)
local part = Instance.new("Part")
part.Position = Vector3.new(0, 6, 0)
part.Color = Color3.fromRGB(255, 80, 80)
while true do
  part.Rotation = part.Rotation + Vector3.new(0, 4, 0)
  wait(0.03)
end
`;

type GizmoMode = "move" | "rotate" | "scale";
const SHAPES: PartData["shape"][] = ["box", "sphere", "cylinder", "wedge"];
const MATERIALS: PartData["material"][] = ["plastic", "metal", "wood", "neon", "grass", "dirt"];

let partCounter = 0;
function newPart(shape: PartData["shape"]): PartData {
  partCounter += 1;
  return {
    id: `part_${Date.now()}_${partCounter}`,
    name: `${shape[0].toUpperCase()}${shape.slice(1)}${partCounter}`,
    shape,
    position: [0, 3, 0],
    size: shape === "sphere" ? [2, 2, 2] : [4, 1, 2],
    rotation: [0, 0, 0],
    color: "#a3a7b0",
    anchored: true,
    material: "plastic",
  };
}

export function EditorPage() {
  const { id: gameId } = useParams<{ id: string }>();
  const nav = useNavigate();

  const dataRef = useRef<SceneData | null>(null);
  const meshesRef = useRef<Map<string, Mesh>>(new Map());
  const sceneRef = useRef<Scene | null>(null);
  const gmRef = useRef<GizmoManager | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const [mode, setMode] = useState<GizmoMode>("move");
  const [status, setStatus] = useState("Loading…");
  const [, force] = useReducer((x: number) => x + 1, 0);

  // Lua test-play state
  const runnerRef = useRef<LuaRunner>(new LuaRunner());
  const snapshotRef = useRef<SceneData | null>(null);
  const [playing, setPlaying] = useState(false);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [consoleLines, setConsoleLines] = useState<{ kind: "out" | "err"; text: string }[]>([]);

  const data = dataRef.current;
  const selected = data?.parts.find((p) => p.id === selectedId) ?? null;
  const activeScript = data?.scripts.find((s) => s.id === activeScriptId) ?? null;

  // ---- Babylon setup --------------------------------------------------------

  function setup(scene: Scene) {
    sceneRef.current = scene;
    createSkybox(scene);

    const utility = new UtilityLayerRenderer(scene);
    const gm = new GizmoManager(scene, 1, utility);
    gm.usePointerToAttachGizmos = true;
    gm.attachableMeshes = [];
    gm.clearGizmoOnEmptyPointerEvent = true;
    gm.onAttachedToMeshObservable.add((mesh) => {
      setSelectedId(mesh ? mesh.name : null);
    });
    gmRef.current = gm;
    applyMode(gm, "move");

    api
      .getScene(gameId!)
      .then((sd) => {
        dataRef.current = sd;
        for (const part of sd.parts) addMesh(scene, part);
        setStatus("");
        force();
      })
      .catch((e) => setStatus(`Load failed: ${e.message}`));

    return () => {
      gm.dispose();
      meshesRef.current.clear();
    };
  }

  function addMesh(scene: Scene, part: PartData) {
    const mesh = createPartMesh(scene, part);
    mesh.outlineColor = Color3.FromHexString("#3f7bed");
    mesh.outlineWidth = 0.04;
    meshesRef.current.set(part.id, mesh);
    gmRef.current!.attachableMeshes!.push(mesh);
  }

  function applyMode(gm: GizmoManager, m: GizmoMode) {
    gm.positionGizmoEnabled = m === "move";
    gm.rotationGizmoEnabled = m === "rotate";
    gm.scaleGizmoEnabled = m === "scale";
    // After a drag ends, copy the mesh transform back into part data.
    const onEnd = () => {
      const id = selectedIdRef.current;
      const part = dataRef.current?.parts.find((p) => p.id === id);
      const mesh = id ? meshesRef.current.get(id) : null;
      if (part && mesh) {
        syncPartFromMesh(part, mesh);
        force();
      }
    };
    gm.gizmos.positionGizmo?.onDragEndObservable.add(onEnd);
    gm.gizmos.rotationGizmo?.onDragEndObservable.add(onEnd);
    gm.gizmos.scaleGizmo?.onDragEndObservable.add(onEnd);
  }

  useEffect(() => {
    if (gmRef.current) applyMode(gmRef.current, mode);
  }, [mode]);

  // Selection outline
  useEffect(() => {
    for (const [pid, mesh] of meshesRef.current) {
      mesh.renderOutline = pid === selectedId;
    }
  }, [selectedId]);

  // Delete key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Delete" && selectedIdRef.current) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        deletePart(selectedIdRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- Actions --------------------------------------------------------------

  function addPart(shape: PartData["shape"]) {
    const scene = sceneRef.current;
    if (!scene || !dataRef.current) return;
    const part = newPart(shape);
    dataRef.current.parts.push(part);
    addMesh(scene, part);
    selectPart(part.id);
    force();
  }

  function selectPart(pid: string) {
    const mesh = meshesRef.current.get(pid);
    if (mesh && gmRef.current) gmRef.current.attachToMesh(mesh);
    setSelectedId(pid);
  }

  function deletePart(pid: string) {
    const d = dataRef.current;
    if (!d) return;
    const mesh = meshesRef.current.get(pid);
    if (mesh) {
      const gm = gmRef.current!;
      gm.attachToMesh(null);
      gm.attachableMeshes = gm.attachableMeshes!.filter((m) => m !== mesh);
      mesh.dispose();
    }
    meshesRef.current.delete(pid);
    d.parts = d.parts.filter((p) => p.id !== pid);
    setSelectedId(null);
    force();
  }

  function updatePart(pid: string, patch: Partial<PartData>) {
    const d = dataRef.current;
    const part = d?.parts.find((p) => p.id === pid);
    const mesh = meshesRef.current.get(pid);
    if (!part || !mesh) return;
    Object.assign(part, patch);
    syncMeshFromPart(mesh, part);
    applyPartMaterial(mesh, part, sceneRef.current!);
    force();
  }

  // ---- Scripts / Lua test-play ----------------------------------------------

  function addScript() {
    const d = dataRef.current;
    if (!d) return;
    const script: ScriptData = {
      id: `script_${Date.now()}`,
      name: `Script${d.scripts.length + 1}`,
      source: SCRIPT_TEMPLATE,
    };
    d.scripts.push(script);
    setActiveScriptId(script.id);
    force();
  }

  function updateScriptSource(sid: string, source: string) {
    const s = dataRef.current?.scripts.find((x) => x.id === sid);
    if (s) {
      s.source = source;
      force();
    }
  }

  function deleteScript(sid: string) {
    const d = dataRef.current;
    if (!d) return;
    d.scripts = d.scripts.filter((s) => s.id !== sid);
    if (activeScriptId === sid) setActiveScriptId(null);
    force();
  }

  const pushConsole = (kind: "out" | "err", text: string) =>
    setConsoleLines((lines) => [...lines.slice(-199), { kind, text }]);

  function play() {
    const d = dataRef.current;
    const scene = sceneRef.current;
    if (!d || !scene || playing) return;
    snapshotRef.current = JSON.parse(JSON.stringify(d)); // restore point
    setConsoleLines([]);
    setPlaying(true);
    gmRef.current?.attachToMesh(null);
    runnerRef.current.start(d.parts, d.scripts, {
      onReady: () => pushConsole("out", "▶ scripts running"),
      onPrint: (t) => pushConsole("out", t),
      onError: (t) => pushConsole("err", t),
      onPatch: (pid, props) => {
        const part = dataRef.current?.parts.find((p) => p.id === pid);
        const mesh = meshesRef.current.get(pid);
        if (part && mesh) {
          Object.assign(part, props);
          syncMeshFromPart(mesh, part);
          if (props.color) applyPartMaterial(mesh, part, sceneRef.current!);
        }
      },
      onCreate: (part) => {
        dataRef.current?.parts.push(part);
        if (sceneRef.current) addMesh(sceneRef.current, part);
        force();
      },
      onDestroy: (pid) => {
        const mesh = meshesRef.current.get(pid);
        mesh?.dispose();
        meshesRef.current.delete(pid);
        if (dataRef.current) {
          dataRef.current.parts = dataRef.current.parts.filter((p) => p.id !== pid);
        }
        force();
      },
    });
  }

  function stopPlay() {
    runnerRef.current.stop();
    setPlaying(false);
    // restore the pre-play scene
    const snap = snapshotRef.current;
    const scene = sceneRef.current;
    if (snap && scene) {
      for (const mesh of meshesRef.current.values()) mesh.dispose();
      meshesRef.current.clear();
      if (gmRef.current) gmRef.current.attachableMeshes = [];
      dataRef.current = snap;
      for (const part of snap.parts) addMesh(scene, part);
      snapshotRef.current = null;
    }
    pushConsole("out", "■ stopped — scene restored");
    setSelectedId(null);
    force();
  }

  // kill the worker if the user leaves the editor mid-play
  useEffect(() => () => runnerRef.current.stop(), []);

  async function save() {
    if (!dataRef.current) return;
    setStatus("Saving…");
    try {
      await api.saveScene(gameId!, dataRef.current);
      setStatus("Saved ✓");
    } catch (e: any) {
      setStatus(`Save failed: ${e.message}`);
    }
    setTimeout(() => setStatus(""), 1800);
  }

  // Downscale the live viewport into a small JPEG data URL for the game card.
  function captureThumbnail(): string | null {
    const canvas = document.querySelector<HTMLCanvasElement>(".editor-canvas canvas");
    if (!canvas || canvas.width === 0) return null;
    const t = document.createElement("canvas");
    t.width = 320;
    t.height = 180;
    const ctx = t.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, t.width, t.height);
    return t.toDataURL("image/jpeg", 0.7);
  }

  async function publish() {
    if (!dataRef.current) return;
    setStatus("Publishing…");
    try {
      await api.saveScene(gameId!, dataRef.current);
      const thumb = captureThumbnail();
      if (thumb) await api.saveThumbnail(gameId!, thumb).catch(() => {});
      const res = await api.publish(gameId!);
      setStatus(`Published v${res.version} ✓`);
    } catch (e: any) {
      setStatus(`Publish failed: ${e.message}`);
    }
    setTimeout(() => setStatus(""), 2500);
  }

  // ---- UI -------------------------------------------------------------------

  return (
    <div className="editor-root">
      <div className="editor-toolbar">
        <button className="ghost" onClick={() => nav("/create")}>← Back</button>
        <span className="muted">|</span>
        {SHAPES.map((s) => (
          <button key={s} className="ghost" onClick={() => addPart(s)}>
            + {s}
          </button>
        ))}
        <span className="muted">|</span>
        {(["move", "rotate", "scale"] as GizmoMode[]).map((m) => (
          <button key={m} className={mode === m ? "" : "ghost"} onClick={() => setMode(m)}>
            {m}
          </button>
        ))}
        <span className="muted">|</span>
        {playing ? (
          <button className="danger" onClick={stopPlay}>■ Stop</button>
        ) : (
          <button onClick={play}>▶ Play</button>
        )}
        <div style={{ flex: 1 }} />
        <span className="muted">{status}</span>
        <button className="ghost" onClick={save} disabled={playing}>Save</button>
        <button onClick={publish} disabled={playing}>Publish</button>
      </div>

      <div className="editor-body">
        <div className="editor-panel">
          <div className="panel-title">Explorer</div>
          {data?.parts.map((p) => (
            <div
              key={p.id}
              className={`explorer-item ${p.id === selectedId ? "active" : ""}`}
              onClick={() => selectPart(p.id)}
            >
              <span className="muted" style={{ fontSize: 11 }}>▣</span> {p.name}
            </div>
          ))}
          <div className="panel-title" style={{ marginTop: 16 }}>
            Scripts
            <button className="ghost" style={{ padding: "2px 8px", marginLeft: 8, fontSize: 12 }} onClick={addScript}>
              +
            </button>
          </div>
          {data?.scripts.map((s) => (
            <div
              key={s.id}
              className={`explorer-item ${s.id === activeScriptId ? "active" : ""}`}
              onClick={() => setActiveScriptId(s.id === activeScriptId ? null : s.id)}
            >
              <span className="muted" style={{ fontSize: 11 }}>≡</span> {s.name}
            </div>
          ))}
        </div>

        <div className="editor-canvas">
          <BabylonCanvas setup={setup} cameraRadius={40} />
        </div>

        <div className="editor-panel">
          <div className="panel-title">Properties</div>
          {!selected && <div className="muted" style={{ padding: 8 }}>Select a part</div>}
          {selected && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 8 }}>
              <input
                value={selected.name}
                onChange={(e) => updatePart(selected.id, { name: e.target.value })}
              />
              <Vec3Row label="Position" value={selected.position}
                onChange={(v) => updatePart(selected.id, { position: v })} />
              <Vec3Row label="Size" value={selected.size} min={0.1}
                onChange={(v) => updatePart(selected.id, { size: v })} />
              <Vec3Row label="Rotation°" value={selected.rotation}
                onChange={(v) => updatePart(selected.id, { rotation: v })} />
              <div className="prop-row">
                <span className="muted">Color</span>
                <input type="color" value={selected.color} style={{ width: 48, padding: 1 }}
                  onChange={(e) => updatePart(selected.id, { color: e.target.value })} />
              </div>
              <div className="prop-row">
                <span className="muted">Material</span>
                <select
                  value={selected.material}
                  onChange={(e) =>
                    updatePart(selected.id, { material: e.target.value as PartData["material"] })
                  }
                >
                  {MATERIALS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <label className="prop-row" style={{ cursor: "pointer" }}>
                <span className="muted">Anchored</span>
                <input type="checkbox" checked={selected.anchored}
                  onChange={(e) => updatePart(selected.id, { anchored: e.target.checked })} />
              </label>
              <button className="danger" onClick={() => deletePart(selected.id)}>
                Delete part
              </button>
            </div>
          )}
        </div>
      </div>

      {(activeScript || consoleLines.length > 0) && (
        <div className="editor-drawer">
          {activeScript && (
            <div className="drawer-code">
              <div className="drawer-head">
                <span>≡ {activeScript.name}</span>
                <div style={{ flex: 1 }} />
                <button className="ghost" style={{ padding: "2px 10px", fontSize: 12 }}
                  onClick={() => deleteScript(activeScript.id)}>delete</button>
                <button className="ghost" style={{ padding: "2px 10px", fontSize: 12 }}
                  onClick={() => setActiveScriptId(null)}>close</button>
              </div>
              <textarea
                className="code-area"
                spellCheck={false}
                value={activeScript.source}
                onChange={(e) => updateScriptSource(activeScript.id, e.target.value)}
              />
            </div>
          )}
          <div className="drawer-console">
            <div className="drawer-head"><span>Output</span></div>
            <div className="console-lines">
              {consoleLines.map((l, i) => (
                <div key={i} className={l.kind === "err" ? "console-err" : "console-out"}>
                  {l.text}
                </div>
              ))}
              {consoleLines.length === 0 && <div className="muted">— run ▶ Play to see output —</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Vec3Row({
  label, value, onChange, min,
}: {
  label: string;
  value: [number, number, number];
  onChange: (v: [number, number, number]) => void;
  min?: number;
}) {
  function set(i: number, raw: string) {
    const n = Number(raw);
    if (Number.isNaN(n)) return;
    const v = [...value] as [number, number, number];
    v[i] = min !== undefined ? Math.max(min, n) : n;
    onChange(v);
  }
  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div className="row">
        {value.map((n, i) => (
          <input key={i} type="number" step={0.5} value={round2(n)}
            onChange={(e) => set(i, e.target.value)} style={{ padding: "6px 8px" }} />
        ))}
      </div>
    </div>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
