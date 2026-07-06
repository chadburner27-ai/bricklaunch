import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import { putObject, getObject } from "./storage.js";
import {
  DEFAULT_AVATAR,
  EMPTY_SCENE,
  type AvatarConfig,
  type SceneData,
  type GameSummary,
  type PublicUser,
} from "@launcher/shared";

const PORT = Number(process.env.PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

const app = Fastify({ logger: { transport: undefined } });

await app.register(cors, { origin: true });
await app.register(jwt, { secret: JWT_SECRET });

// Auth guard decorator
async function authenticate(req: any, reply: any) {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: "unauthorized" });
  }
}

function toPublicUser(u: { id: string; username: string; createdAt: Date }): PublicUser {
  return { id: u.id, username: u.username, createdAt: u.createdAt.toISOString() };
}

function toSummary(g: any): GameSummary {
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    thumbnailUrl: g.thumbnailUrl,
    plays: g.plays,
    likes: g.likes,
    published: g.published,
    ownerId: g.ownerId,
    ownerName: g.owner?.username ?? "unknown",
    createdAt: g.createdAt.toISOString(),
  };
}

// ---- Health ----------------------------------------------------------------
app.get("/health", async () => ({ ok: true }));

// ---- Auth ------------------------------------------------------------------
app.post("/auth/register", async (req, reply) => {
  const { username, email, password } = (req.body ?? {}) as any;
  if (!username || !email || !password || password.length < 6) {
    return reply.code(400).send({ error: "username, email, and 6+ char password required" });
  }
  const exists = await prisma.user.findFirst({
    where: { OR: [{ username }, { email }] },
  });
  if (exists) return reply.code(409).send({ error: "username or email already taken" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { username, email, passwordHash, avatarJson: JSON.stringify(DEFAULT_AVATAR) },
  });
  const token = app.jwt.sign({ id: user.id, username: user.username });
  return { token, user: toPublicUser(user) };
});

app.post("/auth/login", async (req, reply) => {
  const { email, password } = (req.body ?? {}) as any;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password ?? "", user.passwordHash))) {
    return reply.code(401).send({ error: "invalid credentials" });
  }
  const token = app.jwt.sign({ id: user.id, username: user.username });
  return { token, user: toPublicUser(user) };
});

app.get("/auth/me", { preHandler: authenticate }, async (req: any, reply) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return reply.code(404).send({ error: "not found" });
  return toPublicUser(user);
});

// ---- Avatar ----------------------------------------------------------------
app.get("/avatar", { preHandler: authenticate }, async (req: any) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const cfg: AvatarConfig = user?.avatarJson ? JSON.parse(user.avatarJson) : DEFAULT_AVATAR;
  return cfg;
});

app.put("/avatar", { preHandler: authenticate }, async (req: any) => {
  const cfg = req.body as AvatarConfig;
  await prisma.user.update({
    where: { id: req.user.id },
    data: { avatarJson: JSON.stringify(cfg) },
  });
  return { ok: true };
});

// ---- Games -----------------------------------------------------------------
// Public catalog (published only)
app.get("/games", async () => {
  const games = await prisma.game.findMany({
    where: { published: true },
    include: { owner: true },
    orderBy: { plays: "desc" },
  });
  return games.map(toSummary);
});

// My games (all, incl. unpublished)
app.get("/games/mine", { preHandler: authenticate }, async (req: any) => {
  const games = await prisma.game.findMany({
    where: { ownerId: req.user.id },
    include: { owner: true },
    orderBy: { updatedAt: "desc" },
  });
  return games.map(toSummary);
});

app.get("/games/:id", async (req: any, reply) => {
  const game = await prisma.game.findUnique({
    where: { id: req.params.id },
    include: { owner: true },
  });
  if (!game) return reply.code(404).send({ error: "not found" });
  return toSummary(game);
});

// Create a new (empty) game
app.post("/games", { preHandler: authenticate }, async (req: any) => {
  const { title, description } = (req.body ?? {}) as any;
  const game = await prisma.game.create({
    data: {
      title: title || "Untitled Game",
      description: description || "",
      ownerId: req.user.id,
    },
    include: { owner: true },
  });
  // seed an empty scene
  await putObject(`games/${game.id}/draft.json`, JSON.stringify(EMPTY_SCENE));
  return toSummary(game);
});

// Load the editable draft scene (owner only)
app.get("/games/:id/scene", { preHandler: authenticate }, async (req: any, reply) => {
  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!game) return reply.code(404).send({ error: "not found" });
  if (game.ownerId !== req.user.id) return reply.code(403).send({ error: "forbidden" });
  try {
    const raw = await getObject(`games/${game.id}/draft.json`);
    return JSON.parse(raw) as SceneData;
  } catch {
    return EMPTY_SCENE;
  }
});

// Save the draft scene (owner only)
app.put("/games/:id/scene", { preHandler: authenticate }, async (req: any, reply) => {
  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!game) return reply.code(404).send({ error: "not found" });
  if (game.ownerId !== req.user.id) return reply.code(403).send({ error: "forbidden" });
  const scene = req.body as SceneData;
  await putObject(`games/${game.id}/draft.json`, JSON.stringify(scene));
  await prisma.game.update({ where: { id: game.id }, data: { updatedAt: new Date() } });
  return { ok: true };
});

// Publish: snapshot the draft into a new immutable version + flip published
app.post("/games/:id/publish", { preHandler: authenticate }, async (req: any, reply) => {
  const game = await prisma.game.findUnique({
    where: { id: req.params.id },
    include: { versions: true },
  });
  if (!game) return reply.code(404).send({ error: "not found" });
  if (game.ownerId !== req.user.id) return reply.code(403).send({ error: "forbidden" });

  const draft = await getObject(`games/${game.id}/draft.json`);
  const nextVersion = game.versions.length + 1;
  const key = `games/${game.id}/v${nextVersion}.json`;
  await putObject(key, draft);
  await prisma.gameVersion.create({
    data: { gameId: game.id, storageKey: key, version: nextVersion },
  });
  await prisma.game.update({ where: { id: game.id }, data: { published: true } });
  return { ok: true, version: nextVersion };
});

// Toggle a like (auth). One like per user per game, counter kept denormalized.
app.post("/games/:id/like", { preHandler: authenticate }, async (req: any, reply) => {
  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!game) return reply.code(404).send({ error: "not found" });
  const key = { userId: req.user.id, gameId: game.id };
  const existing = await prisma.like.findUnique({ where: { userId_gameId: key } });
  if (existing) {
    await prisma.$transaction([
      prisma.like.delete({ where: { userId_gameId: key } }),
      prisma.game.update({ where: { id: game.id }, data: { likes: { decrement: 1 } } }),
    ]);
    return { liked: false, likes: game.likes - 1 };
  }
  await prisma.$transaction([
    prisma.like.create({ data: key }),
    prisma.game.update({ where: { id: game.id }, data: { likes: { increment: 1 } } }),
  ]);
  return { liked: true, likes: game.likes + 1 };
});

// Which of these games has the current user liked? (bulk, for the launcher grid)
app.get("/likes/mine", { preHandler: authenticate }, async (req: any) => {
  const likes = await prisma.like.findMany({ where: { userId: req.user.id } });
  return likes.map((l) => l.gameId);
});

// Set the game thumbnail (owner only). Small data-URL images only.
app.put("/games/:id/thumbnail", { preHandler: authenticate }, async (req: any, reply) => {
  const game = await prisma.game.findUnique({ where: { id: req.params.id } });
  if (!game) return reply.code(404).send({ error: "not found" });
  if (game.ownerId !== req.user.id) return reply.code(403).send({ error: "forbidden" });
  const { dataUrl } = (req.body ?? {}) as { dataUrl?: string };
  if (!dataUrl || !dataUrl.startsWith("data:image/") || dataUrl.length > 300_000) {
    return reply.code(400).send({ error: "expected a data:image/* URL under 300KB" });
  }
  await prisma.game.update({ where: { id: game.id }, data: { thumbnailUrl: dataUrl } });
  return { ok: true };
});

// Load the latest published scene for playing (public)
app.get("/games/:id/play", async (req: any, reply) => {
  const game = await prisma.game.findUnique({
    where: { id: req.params.id },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!game || !game.published || game.versions.length === 0) {
    return reply.code(404).send({ error: "not published" });
  }
  await prisma.game.update({ where: { id: game.id }, data: { plays: { increment: 1 } } });
  const raw = await getObject(game.versions[0].storageKey);
  return JSON.parse(raw) as SceneData;
});

// ---- Boot ------------------------------------------------------------------
app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => console.log(`[api] listening on http://localhost:${PORT}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
