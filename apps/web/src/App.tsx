import { Routes, Route, Navigate, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Login } from "./launcher/Login";
import { Home } from "./launcher/Home";
import { MyGames } from "./launcher/MyGames";
import { AvatarEditor } from "./avatar/AvatarEditor";
import { EditorPage } from "./editor/EditorPage";
import { PlayerPage } from "./player/PlayerPage";
import type { ReactNode } from "react";

function Nav() {
  const { user, logout } = useAuth();
  return (
    <div className="nav">
      <div className="brand">Brick<span>Launch</span></div>
      <div className="nav-links">
        <NavLink to="/" end>Discover</NavLink>
        {user && <NavLink to="/create">Create</NavLink>}
        {user && <NavLink to="/avatar">Avatar</NavLink>}
      </div>
      <div className="spacer" />
      {user ? (
        <>
          <span className="muted">{user.username}</span>
          <button className="ghost" onClick={logout}>Log out</button>
        </>
      ) : (
        <NavLink to="/login"><button>Log in</button></NavLink>
      )}
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="container">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/create" element={<RequireAuth><MyGames /></RequireAuth>} />
        <Route path="/avatar" element={<RequireAuth><AvatarEditor /></RequireAuth>} />
        <Route path="/edit/:id" element={<RequireAuth><EditorPage /></RequireAuth>} />
        <Route path="/play/:id" element={<PlayerPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
