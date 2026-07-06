// Builds a blocky, Roblox-style humanoid from an AvatarConfig.
// Limbs hang from pivot nodes (shoulders/hips) so they can swing while walking.
// Reused by the avatar customizer, the editor preview, and the multiplayer player.
import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import type { AvatarConfig } from "@launcher/shared";

function mat(scene: Scene, hex: string, neon = false): StandardMaterial {
  const m = new StandardMaterial("m" + Math.random(), scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  if (neon) m.emissiveColor = c.scale(0.6);
  m.specularColor = new Color3(0.1, 0.1, 0.1);
  return m;
}

export interface CharacterHandle {
  root: TransformNode;
  /** Drive the walk cycle. t = seconds, speed = 0 (idle) .. 1 (walking). */
  animate: (t: number, speed: number) => void;
  dispose: () => void;
}

const SWING = 0.7; // max limb swing in radians

export function buildCharacter(scene: Scene, cfg: AvatarConfig): CharacterHandle {
  const root = new TransformNode("character", scene);
  const meshes: Mesh[] = [];
  const nodes: TransformNode[] = [];

  const box = (
    name: string,
    dims: { w: number; h: number; d: number },
    material: StandardMaterial,
    parent: TransformNode,
    pos: Vector3
  ) => {
    const m = MeshBuilder.CreateBox(name, { width: dims.w, height: dims.h, depth: dims.d }, scene);
    m.material = material;
    m.parent = parent;
    m.position = pos;
    meshes.push(m);
    return m;
  };

  const pivot = (name: string, pos: Vector3): TransformNode => {
    const n = new TransformNode(name, scene);
    n.parent = root;
    n.position = pos;
    nodes.push(n);
    return n;
  };

  const skin = mat(scene, cfg.headColor);
  const body = mat(scene, cfg.bodyColor);
  const shirt = mat(scene, cfg.shirtColor);
  const pants = mat(scene, cfg.pantsColor);

  // Torso (y 1..3) and head — static.
  box("torso", { w: 2, h: 2, d: 1 }, shirt, root, new Vector3(0, 2, 0));
  box("head", { w: 1.2, h: 1.2, d: 1.2 }, skin, root, new Vector3(0, 3.6, 0));

  // Arms hang from shoulder pivots at y=3; legs from hip pivots at y=1.
  const shoulderL = pivot("shoulderL", new Vector3(-1.5, 3, 0));
  const shoulderR = pivot("shoulderR", new Vector3(1.5, 3, 0));
  const hipL = pivot("hipL", new Vector3(-0.5, 1, 0));
  const hipR = pivot("hipR", new Vector3(0.5, 1, 0));
  box("armL", { w: 1, h: 2, d: 1 }, body, shoulderL, new Vector3(0, -1, 0));
  box("armR", { w: 1, h: 2, d: 1 }, body, shoulderR, new Vector3(0, -1, 0));
  box("legL", { w: 1, h: 2, d: 1 }, pants, hipL, new Vector3(0, -1, 0));
  box("legR", { w: 1, h: 2, d: 1 }, pants, hipR, new Vector3(0, -1, 0));

  buildHat(scene, root, cfg, meshes);

  root.scaling = new Vector3(cfg.height, cfg.height, cfg.height);

  // Walk cycle: arms and legs counter-swing; amplitude eases toward the target
  // speed so starting/stopping doesn't snap.
  let amp = 0;
  const animate = (t: number, speed: number) => {
    amp += (Math.max(0, Math.min(1, speed)) - amp) * 0.15;
    const phase = Math.sin(t * 8) * SWING * amp;
    shoulderL.rotation.x = phase;
    shoulderR.rotation.x = -phase;
    hipL.rotation.x = -phase;
    hipR.rotation.x = phase;
  };

  return {
    root,
    animate,
    dispose: () => {
      meshes.forEach((m) => m.dispose());
      nodes.forEach((n) => n.dispose());
      root.dispose();
    },
  };
}

function buildHat(scene: Scene, root: TransformNode, cfg: AvatarConfig, out: Mesh[]) {
  if (cfg.hat === "none") return;
  const headTop = 4.3;
  if (cfg.hat === "cap") {
    const cap = MeshBuilder.CreateCylinder("cap", { height: 0.5, diameter: 1.4 }, scene);
    cap.position = new Vector3(0, headTop, 0);
    cap.material = mat(scene, "#e0457b");
    cap.parent = root;
    out.push(cap);
    const brim = MeshBuilder.CreateBox("brim", { width: 1.4, height: 0.15, depth: 0.9 }, scene);
    brim.position = new Vector3(0, headTop - 0.2, 0.7);
    brim.material = mat(scene, "#e0457b");
    brim.parent = root;
    out.push(brim);
  } else if (cfg.hat === "crown") {
    const crown = MeshBuilder.CreateCylinder(
      "crown",
      { height: 0.8, diameterTop: 1.6, diameterBottom: 1.3, tessellation: 8 },
      scene
    );
    crown.position = new Vector3(0, headTop + 0.1, 0);
    crown.material = mat(scene, "#ffd23f", true);
    crown.parent = root;
    out.push(crown);
  } else if (cfg.hat === "cone") {
    const cone = MeshBuilder.CreateCylinder(
      "cone",
      { height: 1.4, diameterTop: 0, diameterBottom: 1.3 },
      scene
    );
    cone.position = new Vector3(0, headTop + 0.4, 0);
    cone.material = mat(scene, "#3fb2ff", true);
    cone.parent = root;
    out.push(cone);
  } else if (cfg.hat === "beanie") {
    const beanie = MeshBuilder.CreateSphere("beanie", { diameter: 1.4, slice: 0.5 }, scene);
    beanie.position = new Vector3(0, headTop - 0.3, 0);
    beanie.material = mat(scene, "#6ad46a");
    beanie.parent = root;
    out.push(beanie);
  }
}
