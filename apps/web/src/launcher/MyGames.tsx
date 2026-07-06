import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GameSummary } from "@launcher/shared";
import { api } from "../lib/api";
import { GameCard } from "./GameCard";

export function MyGames() {
  const nav = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  function load() {
    api.myGames().then(setGames).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.createGame(title.trim(), "");
      setTitle("");
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="container">
      <div className="section-title">Create</div>
      <form className="row" onSubmit={create} style={{ marginBottom: 22, maxWidth: 460 }}>
        <input placeholder="New game title…" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button>Create</button>
      </form>
      {error && <p className="error">{error}</p>}
      {games.length === 0 ? (
        <p className="muted">You haven't created any games yet.</p>
      ) : (
        <div className="grid">
          {games.map((g) => (
            <GameCard key={g.id} game={g} onClick={() => nav(`/edit/${g.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
