import { useEffect, useRef, useState } from "react";
import { Scene, MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";
import type { AvatarConfig, HatType } from "@launcher/shared";
import { DEFAULT_AVATAR } from "@launcher/shared";
import { BabylonCanvas } from "../engine/BabylonCanvas";
import { buildCharacter, type CharacterHandle } from "../engine/character";
import { api } from "../lib/api";

const HATS: HatType[] = ["none", "cap", "crown", "cone", "beanie"];

export function AvatarEditor() {
  const [cfg, setCfg] = useState<AvatarConfig>(DEFAULT_AVATAR);
  const [status, setStatus] = useState("");
  const sceneRef = useRef<Scene | null>(null);
  const charRef = useRef<CharacterHandle | null>(null);

  useEffect(() => {
    api.getAvatar().then(setCfg).catch(() => {});
  }, []);

  // Rebuild the character whenever config changes and the scene is ready.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    charRef.current?.dispose();
    charRef.current = buildCharacter(scene, cfg);
  }, [cfg]);

  function setup(scene: Scene) {
    sceneRef.current = scene;
    // ground disc
    const ground = MeshBuilder.CreateCylinder("ground", { height: 0.3, diameter: 12 }, scene);
    ground.position.y = -1.15;
    const gm = new StandardMaterial("gm", scene);
    gm.diffuseColor = Color3.FromHexString("#20304d");
    ground.material = gm;
    charRef.current = buildCharacter(scene, cfg);
    return () => charRef.current?.dispose();
  }

  function set<K extends keyof AvatarConfig>(key: K, val: AvatarConfig[K]) {
    setCfg((c) => ({ ...c, [key]: val }));
  }

  async function save() {
    setStatus("Saving…");
    try {
      await api.saveAvatar(cfg);
      setStatus("Saved ✓");
      setTimeout(() => setStatus(""), 1500);
    } catch (e: any) {
      setStatus(e.message);
    }
  }

  return (
    <div className="container">
      <div className="section-title">Avatar Customizer</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 20 }}>
        <div style={{ height: 460, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
          <BabylonCanvas setup={setup} cameraRadius={14} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ColorRow label="Skin" value={cfg.headColor} onChange={(v) => { set("headColor", v); set("bodyColor", v); }} />
          <ColorRow label="Shirt" value={cfg.shirtColor} onChange={(v) => set("shirtColor", v)} />
          <ColorRow label="Pants" value={cfg.pantsColor} onChange={(v) => set("pantsColor", v)} />
          <label className="muted">Hat</label>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {HATS.map((h) => (
              <button
                key={h}
                className={h === cfg.hat ? "" : "ghost"}
                onClick={() => set("hat", h)}
                style={{ textTransform: "capitalize" }}
              >
                {h}
              </button>
            ))}
          </div>
          <label className="muted">Height {cfg.height.toFixed(2)}</label>
          <input
            type="range"
            min={0.8}
            max={1.4}
            step={0.05}
            value={cfg.height}
            onChange={(e) => set("height", Number(e.target.value))}
          />
          <button onClick={save}>Save Avatar</button>
          {status && <div className="muted">{status}</div>}
        </div>
      </div>
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span className="muted">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 54, height: 34, padding: 2, background: "transparent", border: "1px solid var(--border)" }}
      />
    </div>
  );
}
