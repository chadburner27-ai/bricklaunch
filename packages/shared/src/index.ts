// Shared types across the launcher (api, web, gameserver).
// Kept framework-agnostic so every workspace can import them.

export interface PublicUser {
  id: string;
  username: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

// ---- Avatar ----------------------------------------------------------------

export interface AvatarConfig {
  bodyColor: string; // hex
  headColor: string;
  shirtColor: string;
  pantsColor: string;
  hat: HatType;
  height: number; // 0.8 - 1.4 scale
}

export type HatType = "none" | "cap" | "crown" | "cone" | "beanie";

export const DEFAULT_AVATAR: AvatarConfig = {
  bodyColor: "#f2c49b",
  headColor: "#f2c49b",
  shirtColor: "#2f6fed",
  pantsColor: "#26324a",
  hat: "none",
  height: 1.0,
};

// ---- Games / Scenes --------------------------------------------------------

export interface GameSummary {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  plays: number;
  likes: number;
  published: boolean;
  ownerId: string;
  ownerName: string;
  createdAt: string;
}

// A part placed in the 3D world (block/sphere/etc.)
export interface PartData {
  id: string;
  name: string;
  shape: "box" | "sphere" | "cylinder" | "wedge";
  position: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number];
  color: string;
  anchored: boolean;
  material: "plastic" | "metal" | "wood" | "neon" | "grass" | "dirt";
}

export interface ScriptData {
  id: string;
  name: string;
  source: string; // Lua source
}

// The full serialized game: what the editor saves and the player/server loads.
export interface SceneData {
  version: 1;
  spawnPoint: [number, number, number];
  parts: PartData[];
  scripts: ScriptData[];
  /** Optional round-based game mode. "murder" = murderer/sheriff/innocent rounds. */
  mode?: "sandbox" | "murder";
}

export const EMPTY_SCENE: SceneData = {
  version: 1,
  spawnPoint: [0, 3, 0],
  parts: [
    {
      id: "baseplate",
      name: "Baseplate",
      shape: "box",
      position: [0, -0.5, 0],
      size: [64, 1, 64],
      rotation: [0, 0, 0],
      color: "#4a7c3a",
      anchored: true,
      material: "plastic",
    },
  ],
  scripts: [],
};

// ---- Multiplayer / Chat (used by gameserver in Phase 6/7) ------------------

export interface ChatMessage {
  from: string;
  text: string;
  at: number;
}

export interface NetPlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  ry: number; // yaw
  avatar: AvatarConfig;
}
