# Deploying BrickLaunch

Three pieces must be hosted: **web** (static build), **api** (Node + SQLite), and
**gameserver** (Node + WebSockets).

## Option A — Play on your LAN (works right now, zero setup)

1. Keep the three dev servers running (`api`, `gameserver`, `web`).
2. Friends on the same Wi-Fi open: `http://<your-LAN-IP>:5173`
   (currently `http://192.168.50.18:5173`).
3. If they can't connect, allow Node through Windows Firewall:
   Settings → Windows Security → Firewall → Allow an app → Node.js
   (ports 5173, 4000, 2567).

## Option B — Public internet (Render.com, free tier)

Requires a GitHub repo + a free Render account (you must create/authorize these).

1. Push the `launcher/` folder to a GitHub repo.
2. On Render: New → Blueprint → point it at the repo (uses `render.yaml`).
3. Set the web service's build-time env vars once the API/gameserver URLs exist:
   - `VITE_API_URL=https://<api-service>.onrender.com`
   - `VITE_GAMESERVER_URL=wss://<gameserver-service>.onrender.com`

Notes:
- Free-tier disks are ephemeral: the SQLite DB resets on redeploy. For persistence,
  attach a paid disk or swap `datasource` in `apps/api/prisma/schema.prisma` to
  Render's free Postgres (change provider to `postgresql` and set `DATABASE_URL`).
- Free web services sleep after idle; first visit takes ~30s to wake.

## Option C — Quick public tunnel (no account, temporary)

Install cloudflared, then run three tunnels (URLs change on every run):

```
cloudflared tunnel --url http://localhost:5173   # web
cloudflared tunnel --url http://localhost:4000   # api
cloudflared tunnel --url http://localhost:2567   # gameserver
```

Rebuild/start web with the two env vars pointing at the api/gameserver tunnel URLs
(`VITE_API_URL`, `VITE_GAMESERVER_URL`, using `wss://` for the gameserver).
