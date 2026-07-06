import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GameSummary } from "@launcher/shared";
import { api, getToken } from "../lib/api";
import { GameCard } from "./GameCard";

const COUNTS_URL =
  ((import.meta as any).env?.VITE_GAMESERVER_URL || `${location.protocol}//${location.hostname}:2567`)
    .replace(/^ws/, "http") + "/counts";
type SortMode = "top" | "new" | "liked";

export function Home() {
  const nav = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("top");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [myLikes, setMyLikes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listGames()
      .then(setGames)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    if (getToken()) {
      api.myLikes().then((ids) => setMyLikes(new Set(ids))).catch(() => {});
    }
  }, []);

  // Live player counts from the gameserver, refreshed every 4s.
  useEffect(() => {
    let stop = false;
    const poll = () =>
      fetch(COUNTS_URL)
        .then((r) => r.json())
        .then((c) => { if (!stop) setCounts(c); })
        .catch(() => {}); // gameserver offline -> just no badges
    poll();
    const t = setInterval(poll, 4000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  async function toggleLike(id: string) {
    if (!getToken()) { nav("/login"); return; }
    try {
      const res = await api.toggleLike(id);
      setMyLikes((s) => {
        const next = new Set(s);
        res.liked ? next.add(id) : next.delete(id);
        return next;
      });
      setGames((gs) => gs.map((g) => (g.id === id ? { ...g, likes: res.likes } : g)));
    } catch { /* ignore */ }
  }

  const totalOnline = Object.values(counts).reduce((a, b) => a + b, 0);

  const filtered = games
    .filter((g) => g.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      // live games float to the top within every sort mode
      const liveDiff = (counts[b.id] ?? 0) - (counts[a.id] ?? 0);
      if (liveDiff !== 0) return liveDiff;
      if (sort === "new") return b.createdAt.localeCompare(a.createdAt);
      if (sort === "liked") return b.likes - a.likes;
      return b.plays - a.plays;
    });

  return (
    <div className="container">
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div className="section-title" style={{ margin: 0 }}>Discover Games</div>
        {totalOnline > 0 && <span className="muted">🟢 {totalOnline} online now</span>}
        <div style={{ flex: 1 }} />
        <div className="sort-tabs">
          {(["top", "new", "liked"] as SortMode[]).map((m) => (
            <button key={m} className={sort === m ? "" : "ghost"} onClick={() => setSort(m)}>
              {m === "top" ? "Top" : m === "new" ? "New" : "Most liked"}
            </button>
          ))}
        </div>
        <input
          style={{ maxWidth: 220 }}
          placeholder="Search games…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {loading && <p className="muted">Loading games…</p>}
      {error && <p className="error">{error}</p>}
      {!loading && filtered.length === 0 && <p className="muted">No games yet.</p>}
      <div className="grid">
        {filtered.map((g) => (
          <GameCard
            key={g.id}
            game={g}
            live={counts[g.id]}
            liked={myLikes.has(g.id)}
            onLike={() => toggleLike(g.id)}
            onClick={() => nav(`/play/${g.id}`)}
          />
        ))}
      </div>
    </div>
  );
}
