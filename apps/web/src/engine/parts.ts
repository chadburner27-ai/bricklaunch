// Builds Babylon meshes from serialized PartData. Shared by the editor (Phase 3)
// and the player runtime (Phase 6) so parts look identical in both.
import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
} from "@babylonjs/core";
import type { PartData } from "@launcher/shared";
import { getPartTexture } from "./textures";

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function applyPartMaterial(mesh: Mesh, part: PartData, scene: Scene) {
  const m = (mesh.material as StandardMaterial) ?? new StandardMaterial(part.id + "_mat", scene);
  const c = Color3.FromHexString(part.color);
  m.diffuseColor = c;
  m.emissiveColor = part.material === "neon" ? c.scale(0.65) : Color3.Black();
  m.specularColor =
    part.material === "metal" ? new Color3(0.9, 0.9, 0.9) : new Color3(0.08, 0.08, 0.08);
  if (part.material === "wood") m.diffuseColor = c.scale(0.85);

  // Classic stud look on everything. Grass/dirt bring their own colors
  // (diffuseColor stays white so the texture isn't tinted); every other
  // material gets the neutral stud pattern tinted by the part color.
  // One texture per (kind, tiling-scale), cached — see getPartTexture.
  try {
    const kind =
      part.material === "grass" ? "grass" : part.material === "dirt" ? "dirt" : "stud";
    if (kind !== "stud") m.diffuseColor = Color3.White();
    const scale = Math.max(part.size[0], part.size[2]) / 2;
    m.diffuseTexture = getPartTexture(scene, kind, scale);
  } catch {
    m.diffuseTexture = null; // textures are cosmetic — never block rendering
  }
  mesh.material = m;
}

// All meshes are created at unit size and scaled by part.size, so
// mesh.scaling always mirrors part.size (keeps gizmo scaling in sync).
export function createPartMesh(scene: Scene, part: PartData): Mesh {
  let mesh: Mesh;
  switch (part.shape) {
    case "sphere":
      mesh = MeshBuilder.CreateSphere(part.id, { diameter: 1, segments: 16 }, scene);
      break;
    case "cylinder":
      mesh = MeshBuilder.CreateCylinder(part.id, { height: 1, diameter: 1 }, scene);
      break;
    case "wedge": {
      // Triangular prism = 3-sided cylinder, laid so the ramp faces forward.
      mesh = MeshBuilder.CreateCylinder(part.id, { height: 1, diameter: 1, tessellation: 3 }, scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.bakeCurrentTransformIntoVertices();
      break;
    }
    case "box":
    default:
      mesh = MeshBuilder.CreateBox(part.id, { size: 1 }, scene);
      break;
  }
  syncMeshFromPart(mesh, part);
  applyPartMaterial(mesh, part, scene);
  return mesh;
}

export function syncMeshFromPart(mesh: Mesh, part: PartData) {
  mesh.position = new Vector3(...part.position);
  mesh.scaling = new Vector3(...part.size);
  mesh.rotationQuaternion = null;
  mesh.rotation = new Vector3(
    part.rotation[0] * DEG2RAD,
    part.rotation[1] * DEG2RAD,
    part.rotation[2] * DEG2RAD
  );
}

// Read the mesh's live transform back into the part (after gizmo drags).
export function syncPartFromMesh(part: PartData, mesh: Mesh) {
  part.position = [mesh.position.x, mesh.position.y, mesh.position.z];
  part.size = [mesh.scaling.x, mesh.scaling.y, mesh.scaling.z];
  if (mesh.rotationQuaternion) {
    const e = mesh.rotationQuaternion.toEulerAngles();
    mesh.rotation = e;
    mesh.rotationQuaternion = null;
  }
  part.rotation = [
    mesh.rotation.x * RAD2DEG,
    mesh.rotation.y * RAD2DEG,
    mesh.rotation.z * RAD2DEG,
  ];
}
