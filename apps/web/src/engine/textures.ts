// Procedural textures: classic stud bumps, grass, dirt, and a gradient skybox.
// Everything is drawn on canvases at runtime — no external assets.
import {
  Scene,
  DynamicTexture,
  Texture,
  StandardMaterial,
  MeshBuilder,
  Color3,
  Mesh,
} from "@babylonjs/core";

const cache = new WeakMap<Scene, Map<string, DynamicTexture>>();

function getCache(scene: Scene): Map<string, DynamicTexture> {
  let m = cache.get(scene);
  if (!m) {
    m = new Map();
    cache.set(scene, m);
  }
  return m;
}

/** Draw one tile of stud bumps (grid of shaded circles) onto a canvas ctx. */
function drawStuds(ctx: CanvasRenderingContext2D, size: number, studs: number, alpha: number) {
  const cell = size / studs;
  const r = cell * 0.3;
  for (let y = 0; y < studs; y++) {
    for (let x = 0; x < studs; x++) {
      const cx = x * cell + cell / 2;
      const cy = y * cell + cell / 2;
      // shadow ring
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.18, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${0.28 * alpha})`;
      ctx.fill();
      // top of the stud
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.16 * alpha})`;
      ctx.fill();
      // highlight crescent
      ctx.beginPath();
      ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.14 * alpha})`;
      ctx.fill();
    }
  }
}

function speckle(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  colors: string[],
  maxR: number
) {
  for (let i = 0; i < count; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, Math.random() * maxR + 0.5, 0, Math.PI * 2);
    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    ctx.fill();
  }
}

function makeTexture(scene: Scene, key: string, draw: (ctx: CanvasRenderingContext2D, size: number) => void): DynamicTexture {
  const c = getCache(scene);
  const hit = c.get(key);
  if (hit) return hit;
  const size = 256;
  const tex = new DynamicTexture(`tex_${key}`, size, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  draw(ctx, size);
  tex.update();
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  c.set(key, tex);
  return tex;
}

const DRAWERS: Record<string, (ctx: CanvasRenderingContext2D, size: number) => void> = {
  stud: (ctx, size) => {
    ctx.fillStyle = "#bfbfbf"; // mid-gray base so diffuseColor tinting stays vivid
    ctx.fillRect(0, 0, size, size);
    drawStuds(ctx, size, 4, 1);
  },
  grass: (ctx, size) => {
    ctx.fillStyle = "#4c8a3d";
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 900, ["#57994a", "#3f7a33", "#63a854", "#468636"], 2.2);
    drawStuds(ctx, size, 4, 0.8);
  },
  dirt: (ctx, size) => {
    ctx.fillStyle = "#8a6a42";
    ctx.fillRect(0, 0, size, size);
    speckle(ctx, size, 700, ["#96784f", "#7a5c38", "#a3835a", "#6e5230"], 2.6);
    drawStuds(ctx, size, 4, 0.7);
  },
};

/**
 * Tiling part texture, cached per (kind, scale).
 * IMPORTANT: never clone() a DynamicTexture — clones have no source URL, never
 * become ready, and Babylon then refuses to render the mesh (invisible-map bug).
 * Instead each tiling scale gets its own cached texture with uScale baked in.
 */
export function getPartTexture(
  scene: Scene,
  kind: "stud" | "grass" | "dirt",
  scale: number
): DynamicTexture {
  const s = Math.max(1, Math.min(32, Math.round(scale)));
  const tex = makeTexture(scene, `${kind}_${s}`, DRAWERS[kind]);
  tex.uScale = s;
  tex.vScale = s;
  return tex;
}

/** Gradient sky + sun, on an inside-out box that follows the camera. */
export function createSkybox(scene: Scene): Mesh {
  const tex = makeTexture(scene, "sky", (ctx, size) => {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, "#1e63c8");
    g.addColorStop(0.55, "#7db4e8");
    g.addColorStop(0.78, "#cfe6f7");
    g.addColorStop(1, "#e8f2fa");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // sun
    const grad = ctx.createRadialGradient(size * 0.72, size * 0.24, 4, size * 0.72, size * 0.24, 34);
    grad.addColorStop(0, "rgba(255,252,220,1)");
    grad.addColorStop(0.35, "rgba(255,244,180,0.9)");
    grad.addColorStop(1, "rgba(255,244,180,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  });

  const box = MeshBuilder.CreateBox("skybox", { size: 900 }, scene);
  const mat = new StandardMaterial("skyboxMat", scene);
  mat.backFaceCulling = false;
  mat.disableLighting = true;
  mat.emissiveTexture = tex;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  box.material = mat;
  box.infiniteDistance = true; // follows the camera
  box.isPickable = false;
  return box;
}
