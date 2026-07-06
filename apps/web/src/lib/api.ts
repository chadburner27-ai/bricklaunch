// Thin fetch wrapper. Vite proxies /api -> http://localhost:4000
import type {
  AuthResponse,
  AvatarConfig,
  GameSummary,
  SceneData,
  PublicUser,
} from "@launcher/shared";

// Dev: Vite proxies /api -> :4000. Prod: set VITE_API_URL to the deployed API.
const BASE = (import.meta as any).env?.VITE_API_URL || "/api";

let token: string | null = localStorage.getItem("token");

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("token", t);
  else localStorage.removeItem("token");
}

export function getToken() {
  return token;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    // Only claim JSON when we actually send a body — Fastify 400s on empty JSON bodies.
    ...(opts.body ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  register: (username: string, email: string, password: string) =>
    req<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    }),
  login: (email: string, password: string) =>
    req<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => req<PublicUser>("/auth/me"),

  getAvatar: () => req<AvatarConfig>("/avatar"),
  saveAvatar: (cfg: AvatarConfig) =>
    req<{ ok: boolean }>("/avatar", { method: "PUT", body: JSON.stringify(cfg) }),

  listGames: () => req<GameSummary[]>("/games"),
  myGames: () => req<GameSummary[]>("/games/mine"),
  getGame: (id: string) => req<GameSummary>(`/games/${id}`),
  createGame: (title: string, description: string) =>
    req<GameSummary>("/games", { method: "POST", body: JSON.stringify({ title, description }) }),

  toggleLike: (id: string) =>
    req<{ liked: boolean; likes: number }>(`/games/${id}/like`, { method: "POST" }),
  myLikes: () => req<string[]>("/likes/mine"),
  saveThumbnail: (id: string, dataUrl: string) =>
    req<{ ok: boolean }>(`/games/${id}/thumbnail`, {
      method: "PUT",
      body: JSON.stringify({ dataUrl }),
    }),

  getScene: (id: string) => req<SceneData>(`/games/${id}/scene`),
  saveScene: (id: string, scene: SceneData) =>
    req<{ ok: boolean }>(`/games/${id}/scene`, { method: "PUT", body: JSON.stringify(scene) }),
  publish: (id: string) =>
    req<{ ok: boolean; version: number }>(`/games/${id}/publish`, { method: "POST" }),
  playScene: (id: string) => req<SceneData>(`/games/${id}/play`),
};
