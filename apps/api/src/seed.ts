import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import { putObject } from "./storage.js";
import { DEFAULT_AVATAR, type PartData, type SceneData } from "@launcher/shared";

// ---- little map-building helpers --------------------------------------------

let n = 0;
function part(p: Partial<PartData> & { name: string }): PartData {
  n += 1;
  return {
    id: `seed_${n}`,
    shape: "box",
    position: [0, 0, 0],
    size: [4, 1, 4],
    rotation: [0, 0, 0],
    color: "#a3a7b0",
    anchored: true,
    material: "plastic",
    ...p,
  };
}

function tree(x: number, z: number, scale = 1): PartData[] {
  return [
    part({
      name: "Trunk", shape: "cylinder", position: [x, 3 * scale, z],
      size: [1.4 * scale, 6 * scale, 1.4 * scale], color: "#7a5230", material: "wood",
    }),
    part({
      name: "Leaves", shape: "sphere", position: [x, 7 * scale, z],
      size: [5 * scale, 4.5 * scale, 5 * scale], color: "#3f8a34", material: "grass",
    }),
  ];
}

function grassBase(size = 96): PartData {
  return part({
    name: "Baseplate", position: [0, -0.5, 0], size: [size, 1, size],
    color: "#4c8a3d", material: "grass",
  });
}

function dirtPath(x: number, z: number, w: number, d: number): PartData {
  return part({
    name: "Path", position: [x, 0.05, z], size: [w, 0.2, d],
    color: "#8a6a42", material: "dirt",
  });
}

// ---- maps --------------------------------------------------------------------

function obbyMap(): SceneData {
  const parts: PartData[] = [grassBase(), dirtPath(0, 14, 6, 28)];
  // stepping-stone course rising toward the tower
  const stepColors = ["#e0457b", "#ffd23f", "#3fb2ff", "#6ad46a", "#b57bee"];
  for (let i = 0; i < 8; i++) {
    parts.push(part({
      name: `Step${i + 1}`,
      position: [Math.sin(i * 0.8) * 10, 1 + i * 1.6, 26 + i * 6],
      size: [5, 1, 5],
      color: stepColors[i % stepColors.length],
    }));
  }
  parts.push(part({
    name: "Tower", position: [0, 8, 76], size: [8, 16, 8], color: "#e0457b",
  }));
  parts.push(part({
    name: "WinPad", position: [0, 16.6, 76], size: [6, 0.4, 6],
    color: "#ffd23f", material: "neon",
  }));
  parts.push(...tree(-24, 10), ...tree(28, -18), ...tree(-30, -26, 1.3));
  return {
    version: 1,
    spawnPoint: [0, 3, 0],
    parts,
    scripts: [{
      id: "win",
      name: "WinPad",
      source: `local pad = workspace:FindFirstChild("WinPad")
pad.Touched:Connect(function(hit)
  print(hit.Name .. " reached the top! 🏆")
end)
while true do
  pad.Rotation = pad.Rotation + Vector3.new(0, 2, 0)
  wait(0.03)
end`,
    }],
  };
}

function neonMap(): SceneData {
  const parts: PartData[] = [
    part({ name: "Baseplate", position: [0, -0.5, 0], size: [96, 1, 96], color: "#12141c", material: "plastic" }),
  ];
  const neon = ["#3fb2ff", "#e0457b", "#6ad46a", "#ffd23f", "#b57bee"];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    parts.push(part({
      name: `Ring${i + 1}`,
      position: [Math.cos(a) * 26, 1 + (i % 4) * 2, Math.sin(a) * 26],
      size: [6, 0.6, 6],
      color: neon[i % neon.length],
      material: "neon",
    }));
  }
  parts.push(part({
    name: "Core", shape: "sphere", position: [0, 8, 0], size: [6, 6, 6],
    color: "#3fb2ff", material: "neon",
  }));
  // arena walls + corner towers so it reads as a real space, not a floating plate
  const W = 46;
  ([[0, -W, 96, 1.5], [0, W, 96, 1.5], [-W, 0, 1.5, 96], [W, 0, 1.5, 96]] as const).forEach(([x, z, w, d], i) =>
    parts.push(part({ name: `ArenaWall${i}`, position: [x, 4, z], size: [w, 8, d], color: "#1b2030", material: "metal" }))
  );
  ([[-W, -W], [W, -W], [-W, W], [W, W]] as const).forEach(([x, z], i) => {
    parts.push(part({ name: `ArenaTower${i}`, position: [x, 7, z], size: [5, 14, 5], color: "#232a3e", material: "metal" }));
    parts.push(part({ name: `ArenaBeacon${i}`, shape: "sphere", position: [x, 15.4, z], size: [2, 2, 2], color: "#e0457b", material: "neon" }));
  });
  return {
    version: 1,
    spawnPoint: [0, 3, 12],
    parts,
    scripts: [{
      id: "pulse",
      name: "CorePulse",
      source: `local core = workspace:FindFirstChild("Core")
local t = 0
while true do
  t = t + 0.1
  core.Position = Vector3.new(0, 8 + 2 * (t % 2 < 1 and (t % 1) or (1 - t % 1)), 0)
  core.Rotation = core.Rotation + Vector3.new(0, 3, 0)
  wait(0.05)
end`,
    }],
  };
}

function sandboxMap(): SceneData {
  const parts: PartData[] = [
    grassBase(120),
    dirtPath(0, 0, 8, 90),
    dirtPath(-25, 20, 42, 8),
    ...tree(-18, -20), ...tree(22, -30, 1.2), ...tree(-40, 35, 0.9),
    ...tree(38, 28), ...tree(-45, -40, 1.4),
    // little pond
    part({ name: "Pond", shape: "cylinder", position: [30, -0.1, -8], size: [18, 0.4, 18], color: "#2f8fd6", material: "metal" }),
    // picnic benches
    part({ name: "BenchTop", position: [-24, 1.2, 22], size: [6, 0.4, 2], color: "#8a5a30", material: "wood" }),
    part({ name: "BenchLegL", position: [-26.4, 0.6, 22], size: [0.6, 1.2, 1.8], color: "#7a4e28", material: "wood" }),
    part({ name: "BenchLegR", position: [-21.6, 0.6, 22], size: [0.6, 1.2, 1.8], color: "#7a4e28", material: "wood" }),
  ];
  // white picket fence around the park
  const F = 58;
  ([[0, -F, 118, 1], [0, F, 118, 1], [-F, 0, 1, 118], [F, 0, 1, 118]] as const).forEach(([x, z, w, d], i) =>
    parts.push(part({ name: `Fence${i}`, position: [x, 1.2, z], size: [w, 2.4, d], color: "#e8e4da" }))
  );
  // two little houses
  ([[-38, -12, "#c96a4a"], [40, 42, "#5a86c9"]] as const).forEach(([x, z, c], i) => {
    parts.push(part({ name: `House${i}Base`, position: [x, 3, z], size: [12, 6, 10], color: c as string }));
    parts.push(part({ name: `House${i}Roof`, shape: "wedge", position: [x, 7.5, z], size: [12, 3, 11], color: "#6e4a30", material: "wood" }));
    parts.push(part({ name: `House${i}Door`, position: [x, 2, z + 5.1], size: [2.4, 4, 0.3], color: "#5a3a22", material: "wood" }));
    parts.push(part({ name: `House${i}Win`, position: [x - 3.5, 3.5, z + 5.1], size: [2, 2, 0.2], color: "#bfe3ff", material: "metal" }));
  });
  return { version: 1, spawnPoint: [0, 3, 40], parts, scripts: [] };
}

// The murder map: a manor with rooms, hiding spots, and grounds.
function murderMap(): SceneData {
  const parts: PartData[] = [
    grassBase(110),
    dirtPath(0, 30, 10, 50),
    // manor floor + outer walls (leaving a front door gap)
    part({ name: "ManorFloor", position: [0, 0.1, -20], size: [56, 0.4, 40], color: "#9a8f7a", material: "wood" }),
    part({ name: "WallBack", position: [0, 5, -40], size: [56, 10, 1.5], color: "#c8bda6" }),
    part({ name: "WallLeft", position: [-28, 5, -20], size: [1.5, 10, 40], color: "#c8bda6" }),
    part({ name: "WallRight", position: [28, 5, -20], size: [1.5, 10, 40], color: "#c8bda6" }),
    part({ name: "WallFrontL", position: [-17, 5, 0], size: [22, 10, 1.5], color: "#c8bda6" }),
    part({ name: "WallFrontR", position: [17, 5, 0], size: [22, 10, 1.5], color: "#c8bda6" }),
    // inner dividers -> three rooms with door gaps
    part({ name: "DividerA", position: [-9, 4, -28], size: [1, 8, 22], color: "#b3a68c" }),
    part({ name: "DividerB", position: [12, 4, -14], size: [30, 8, 1], color: "#b3a68c" }),
    // furniture / hiding spots
    part({ name: "Table", position: [-18, 1.5, -30], size: [8, 0.6, 4], color: "#7a5230", material: "wood" }),
    part({ name: "Crate1", position: [20, 1.5, -34], size: [3, 3, 3], color: "#8a6a42", material: "wood" }),
    part({ name: "Crate2", position: [23.5, 1.5, -30], size: [3, 3, 3], color: "#8a6a42", material: "wood" }),
    part({ name: "Crate3", position: [20, 4.5, -32], size: [3, 3, 3], color: "#96784f", material: "wood" }),
    part({ name: "Sofa", position: [-20, 1.2, -8], size: [7, 2.4, 3], color: "#8a2f4f" }),
    // grounds: shed + trees for outdoor hiding
    part({ name: "ShedFloor", position: [34, 0.1, 24], size: [14, 0.4, 12], color: "#9a8f7a", material: "wood" }),
    part({ name: "ShedBack", position: [34, 3.5, 30], size: [14, 7, 1], color: "#6e5230", material: "wood" }),
    part({ name: "ShedLeft", position: [27, 3.5, 24], size: [1, 7, 12], color: "#6e5230", material: "wood" }),
    part({ name: "ShedRight", position: [41, 3.5, 24], size: [1, 7, 12], color: "#6e5230", material: "wood" }),
    part({ name: "ShedRoof", shape: "wedge", position: [34, 7.8, 24], size: [14, 3, 13], color: "#5a4326", material: "wood" }),
    ...tree(-35, 25), ...tree(-42, 8, 1.2), ...tree(45, -5, 0.9), ...tree(-15, 45, 1.1),
    // lamp posts along the path
    part({ name: "LampPole1", shape: "cylinder", position: [7, 3, 20], size: [0.6, 6, 0.6], color: "#39424f", material: "metal" }),
    part({ name: "LampGlow1", shape: "sphere", position: [7, 6.4, 20], size: [1.6, 1.6, 1.6], color: "#ffd23f", material: "neon" }),
    part({ name: "LampPole2", shape: "cylinder", position: [-7, 3, 40], size: [0.6, 6, 0.6], color: "#39424f", material: "metal" }),
    part({ name: "LampGlow2", shape: "sphere", position: [-7, 6.4, 40], size: [1.6, 1.6, 1.6], color: "#ffd23f", material: "neon" }),
  ];
  return {
    version: 1,
    spawnPoint: [0, 3, 48],
    parts,
    scripts: [],
    mode: "murder",
  };
}

// ---- The Backrooms: 7 stacked levels, exit pad on each teleports you deeper ---
// Levels sit at y = -60 * k so each feels endless and isolated.

const LVL_Y = (k: number) => -60 * k;
const LVL_SPAWN: [number, number, number][] = Array.from({ length: 7 }, (_, k) => [0, LVL_Y(k) + 2, -42]);
const LVL_EXIT: [number, number][] = [
  [38, 40], [-40, 38], [0, 44], [40, -38], [-38, -40], [0, 40], [42, 42],
];
const LVL_NAMES = [
  "Level 0 — The Yellow Rooms",
  "Level 1 — The Warehouse",
  "Level 2 — The Pipeworks",
  "Level 3 — The Power Station",
  "Level 4 — The Empty Offices",
  "Level 5 — The Endless Hotel",
  "Level 6 — Blackout",
];

function brShell(
  parts: PartData[],
  k: number,
  floor: { color: string; material: PartData["material"] },
  wall: { color: string; material: PartData["material"] },
  opts: { ceiling?: string; lights?: string } = {}
) {
  const y = LVL_Y(k);
  parts.push(part({ name: `L${k}Floor`, position: [0, y - 0.5, 0], size: [104, 1, 104], ...floor }));
  if (opts.ceiling) {
    parts.push(part({ name: `L${k}Ceil`, position: [0, y + 10, 0], size: [104, 1, 104], color: opts.ceiling }));
  }
  // perimeter walls
  const W = 52;
  parts.push(part({ name: `L${k}WallN`, position: [0, y + 5, -W], size: [104, 10, 1.5], ...wall }));
  parts.push(part({ name: `L${k}WallS`, position: [0, y + 5, W], size: [104, 10, 1.5], ...wall }));
  parts.push(part({ name: `L${k}WallE`, position: [W, y + 5, 0], size: [1.5, 10, 104], ...wall }));
  parts.push(part({ name: `L${k}WallW`, position: [-W, y + 5, 0], size: [1.5, 10, 104], ...wall }));
  // ceiling light strips
  if (opts.lights) {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        parts.push(part({
          name: `L${k}Light${i}_${j}`, position: [i * 30, y + 9.4, j * 30],
          size: [10, 0.3, 2.5], color: opts.lights, material: "neon",
        }));
      }
    }
  }
  // glowing exit pad
  const [ex, ez] = LVL_EXIT[k];
  parts.push(part({
    name: `ExitPad${k}`, position: [ex, y + 0.3, ez], size: [5, 0.6, 5],
    color: "#6ad46a", material: "neon",
  }));
}

function backroomsMap(): SceneData {
  const parts: PartData[] = [];
  const wallYellow = { color: "#c9b458", material: "plastic" as const };

  // L0 — the yellow maze
  brShell(parts, 0, { color: "#b3a04a", material: "plastic" }, wallYellow,
    { ceiling: "#cabb6b", lights: "#fff6c9" });
  const maze: [number, number, number, number][] = [ // x, z, w, d
    [-26, -26, 40, 1.5], [26, -12, 40, 1.5], [-26, 2, 40, 1.5], [26, 16, 40, 1.5],
    [-12, 30, 1.5, 26], [12, -38, 1.5, 22], [-38, 14, 1.5, 24], [38, 28, 1.5, 20],
    [0, -12, 1.5, 24], [20, 34, 24, 1.5],
  ];
  maze.forEach(([x, z, w, d], i) =>
    parts.push(part({ name: `L0Maze${i}`, position: [x, LVL_Y(0) + 5, z], size: [w, 10, d], ...wallYellow }))
  );

  // L1 — warehouse: pillar grid + crate stacks
  brShell(parts, 1, { color: "#8f8f8f", material: "plastic" }, { color: "#7d7d7d", material: "plastic" },
    { ceiling: "#6f6f6f", lights: "#e8f2ff" });
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      parts.push(part({ name: `L1Pillar${i}_${j}`, position: [i * 28, LVL_Y(1) + 5, j * 28], size: [3, 10, 3], color: "#9d9d9d" }));
    }
  }
  [[-18, 10], [20, -20], [8, 30], [-30, -32]].forEach(([x, z], i) => {
    parts.push(part({ name: `L1CrateA${i}`, position: [x, LVL_Y(1) + 1.5, z], size: [3, 3, 3], color: "#8a6a42", material: "wood" }));
    parts.push(part({ name: `L1CrateB${i}`, position: [x + 3.4, LVL_Y(1) + 1.5, z], size: [3, 3, 3], color: "#96784f", material: "wood" }));
    parts.push(part({ name: `L1CrateC${i}`, position: [x + 1.6, LVL_Y(1) + 4.5, z], size: [3, 3, 3], color: "#7a5c38", material: "wood" }));
  });

  // L2 — pipeworks: corridors of pipes
  brShell(parts, 2, { color: "#4a4a48", material: "plastic" }, { color: "#5a544c", material: "plastic" },
    { ceiling: "#42403c", lights: "#ffd9a0" });
  for (let i = 0; i < 4; i++) {
    const z = -30 + i * 20;
    parts.push(part({
      name: `L2PipeA${i}`, shape: "cylinder", position: [0, LVL_Y(2) + 7.5, z],
      size: [1.6, 96, 1.6], rotation: [0, 0, 90], color: "#8a4a32", material: "metal",
    }));
    parts.push(part({
      name: `L2PipeB${i}`, shape: "cylinder", position: [0, LVL_Y(2) + 5.8, z + 2],
      size: [1.1, 96, 1.1], rotation: [0, 0, 90], color: "#6e6e6e", material: "metal",
    }));
    parts.push(part({
      name: `L2Valve${i}`, shape: "sphere", position: [-20 + i * 14, LVL_Y(2) + 7.5, z],
      size: [2.4, 2.4, 2.4], color: "#b03a2e", material: "metal",
    }));
  }
  // low steam vents
  [[-24, 18], [18, -6], [30, 26]].forEach(([x, z], i) =>
    parts.push(part({ name: `L2Vent${i}`, position: [x, LVL_Y(2) + 1, z], size: [4, 2, 4], color: "#5f6a6e", material: "metal" }))
  );

  // L3 — power station: generators + cables
  brShell(parts, 3, { color: "#2e2e33", material: "plastic" }, { color: "#3a3a40", material: "metal" },
    { ceiling: "#2a2a2e", lights: "#b8ffb8" });
  for (let i = 0; i < 6; i++) {
    const x = -30 + (i % 3) * 30;
    const z = i < 3 ? -18 : 14;
    parts.push(part({ name: `L3Gen${i}`, position: [x, LVL_Y(3) + 3, z], size: [8, 6, 6], color: "#4a4a52", material: "metal" }));
    parts.push(part({ name: `L3GenTop${i}`, position: [x, LVL_Y(3) + 6.6, z], size: [7, 1.2, 5], color: "#3fff6a", material: "neon" }));
  }
  for (let i = 0; i < 5; i++) {
    parts.push(part({ name: `L3Cable${i}`, position: [-40 + i * 20, LVL_Y(3) + 0.25, 0], size: [1, 0.5, 70], color: "#1c1c20" }));
  }

  // L4 — empty offices: desks + dividers
  brShell(parts, 4, { color: "#6f7d8a", material: "plastic" }, { color: "#b9c2c9", material: "plastic" },
    { ceiling: "#cfd6dc", lights: "#f2f7ff" });
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      const x = -33 + c * 22;
      const z = -24 + r * 24;
      parts.push(part({ name: `L4Desk${r}_${c}`, position: [x, LVL_Y(4) + 1.6, z], size: [7, 0.5, 3.5], color: "#8a5a30", material: "wood" }));
      parts.push(part({ name: `L4DeskBase${r}_${c}`, position: [x, LVL_Y(4) + 0.7, z], size: [6, 1.4, 2.8], color: "#7a4e28", material: "wood" }));
      parts.push(part({ name: `L4Screen${r}_${c}`, position: [x, LVL_Y(4) + 2.6, z - 0.8], size: [2.4, 1.6, 0.3], color: "#20262e", material: "metal" }));
    }
    parts.push(part({ name: `L4Divider${r}`, position: [0, LVL_Y(4) + 3, -12 + r * 24], size: [80, 6, 0.8], color: "#a3adb5" }));
  }

  // L5 — endless hotel: central corridor with doors and lamps
  brShell(parts, 5, { color: "#5a3a2e", material: "wood" }, { color: "#6e2a2a", material: "plastic" },
    { ceiling: "#4a2a22", lights: "#ffdf9e" });
  for (let i = 0; i < 6; i++) {
    const z = -38 + i * 15;
    parts.push(part({ name: `L5HallL${i}`, position: [-10, LVL_Y(5) + 5, z], size: [1.2, 10, 12], color: "#7a3232" }));
    parts.push(part({ name: `L5HallR${i}`, position: [10, LVL_Y(5) + 5, z], size: [1.2, 10, 12], color: "#7a3232" }));
    parts.push(part({ name: `L5DoorL${i}`, position: [-9.3, LVL_Y(5) + 3.5, z], size: [0.4, 7, 4], color: "#5a3a22", material: "wood" }));
    parts.push(part({ name: `L5DoorR${i}`, position: [9.3, LVL_Y(5) + 3.5, z], size: [0.4, 7, 4], color: "#5a3a22", material: "wood" }));
    parts.push(part({ name: `L5Lamp${i}`, shape: "sphere", position: [0, LVL_Y(5) + 8.6, z], size: [1.4, 1.4, 1.4], color: "#ffd23f", material: "neon" }));
  }

  // L6 — blackout: darkness + glowing breadcrumbs to the final exit
  brShell(parts, 6, { color: "#111114", material: "plastic" }, { color: "#0c0c10", material: "plastic" },
    { ceiling: "#0a0a0d" });
  const crumbs: [number, number][] = [
    [0, -34], [8, -24], [2, -12], [12, -2], [22, 8], [18, 20], [28, 30], [36, 36],
  ];
  crumbs.forEach(([x, z], i) =>
    parts.push(part({ name: `L6Crumb${i}`, shape: "sphere", position: [x, LVL_Y(6) + 0.6, z], size: [1, 1, 1], color: "#3fb2ff", material: "neon" }))
  );

  // progression script: each exit pad teleports to the next level
  const lines: string[] = [];
  for (let k = 0; k < 7; k++) {
    const next = k < 6 ? k + 1 : 0;
    const [sx, sy, sz] = LVL_SPAWN[next];
    const msg = k < 6 ? `Entering ${LVL_NAMES[next]}…` : "🎉 You escaped the Backrooms! Back to Level 0…";
    lines.push(
      `local pad${k} = workspace:FindFirstChild("ExitPad${k}")`,
      `pad${k}.Touched:Connect(function(hit)`,
      `  print("${msg}")`,
      `  Players.LocalPlayer:Teleport(Vector3.new(${sx}, ${sy}, ${sz}))`,
      `end)`
    );
  }
  lines.push(
    `print("${LVL_NAMES[0]} — find the glowing green pad to go deeper.")`,
    `while true do`,
    ...Array.from({ length: 7 }, (_, k) => `  pad${k}.Rotation = pad${k}.Rotation + Vector3.new(0, 3, 0)`),
    `  wait(0.05)`,
    `end`
  );

  return {
    version: 1,
    spawnPoint: LVL_SPAWN[0],
    parts,
    scripts: [{ id: "br_progress", name: "LevelProgression", source: lines.join("\n") }],
  };
}

// ---- seeding -----------------------------------------------------------------

const GAMES: { title: string; description: string; build: () => SceneData }[] = [
  { title: "Obby Tower Climb", description: "Hop the stones, climb the tower, touch the golden pad!", build: obbyMap },
  { title: "Neon Runner", description: "Dash through a glowing neon world.", build: neonMap },
  { title: "Sandbox Zone", description: "A calm park to hang out — pond, trees, benches.", build: sandboxMap },
  {
    title: "Murder at Brick Manor",
    description: "One murderer. One sheriff. Everyone else — survive! Round-based social deduction.",
    build: murderMap,
  },
  {
    title: "The Backrooms: 7 Levels",
    description:
      "You noclipped out of reality. Find the glowing exit pad on each of 7 levels — yellow maze, warehouse, pipeworks, power station, offices, hotel, blackout — and escape.",
    build: backroomsMap,
  },
];

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);
  const demo = await prisma.user.upsert({
    where: { email: "demo@launcher.dev" },
    update: {},
    create: {
      username: "demo",
      email: "demo@launcher.dev",
      passwordHash,
      avatarJson: JSON.stringify(DEFAULT_AVATAR),
    },
  });

  for (const g of GAMES) {
    let game = await prisma.game.findFirst({ where: { title: g.title, ownerId: demo.id } });
    if (!game) {
      game = await prisma.game.create({
        data: { title: g.title, description: g.description, ownerId: demo.id, published: true },
      });
    }
    // always refresh the scene: overwrite draft + publish a new version
    const scene = JSON.stringify(g.build());
    await putObject(`games/${game.id}/draft.json`, scene);
    const count = await prisma.gameVersion.count({ where: { gameId: game.id } });
    const key = `games/${game.id}/v${count + 1}.json`;
    await putObject(key, scene);
    await prisma.gameVersion.create({ data: { gameId: game.id, storageKey: key, version: count + 1 } });
    await prisma.game.update({
      where: { id: game.id },
      data: { published: true, description: g.description },
    });
    console.log(`seeded: ${g.title} (v${count + 1})`);
  }

  console.log("Seed complete. Demo login: demo@launcher.dev / password123");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
