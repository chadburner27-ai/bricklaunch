import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function Login() {
  const { login, register } = useAuth();
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(username, email, password);
      nav("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === "login" ? "Welcome back" : "Create account"}</h2>
        {mode === "register" && (
          <input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>{busy ? "…" : mode === "login" ? "Log in" : "Sign up"}</button>
        <div className="muted" style={{ textAlign: "center" }}>
          {mode === "login" ? (
            <>No account? <a onClick={() => setMode("register")} style={{ cursor: "pointer" }}>Sign up</a></>
          ) : (
            <>Have an account? <a onClick={() => setMode("login")} style={{ cursor: "pointer" }}>Log in</a></>
          )}
        </div>
        <div className="muted" style={{ textAlign: "center", fontSize: 13 }}>
          Demo: demo@launcher.dev / password123
        </div>
      </form>
    </div>
  );
}
