import type { GameSummary } from "@launcher/shared";

const EMOJI = ["🎮", "🏰", "🚀", "🌈", "⚔️", "🏝️", "🎲", "🧱"];

export function GameCard({
  game,
  onClick,
  live,
  liked,
  onLike,
}: {
  game: GameSummary;
  onClick?: () => void;
  live?: number; // live player count from the gameserver
  liked?: boolean;
  onLike?: () => void;
}) {
  const emoji = EMOJI[game.title.length % EMOJI.length];
  return (
    <div className="card" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
      <div className="thumb" style={{ position: "relative" }}>
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt={game.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          emoji
        )}
        {live !== undefined && live > 0 && (
          <span className="live-badge">🟢 {live} playing</span>
        )}
      </div>
      <div className="body">
        <div className="title">{game.title}</div>
        <div className="meta">
          <span>▶ {game.plays}</span>
          <button
            className={`like-btn ${liked ? "liked" : ""}`}
            title={liked ? "Unlike" : "Like"}
            onClick={(e) => {
              e.stopPropagation();
              onLike?.();
            }}
          >
            ♥ {game.likes}
          </button>
          {!game.published && <span style={{ color: "var(--danger)" }}>draft</span>}
        </div>
      </div>
    </div>
  );
}
