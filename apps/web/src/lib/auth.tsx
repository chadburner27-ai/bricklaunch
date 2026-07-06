import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicUser } from "@launcher/shared";
import { api, setToken, getToken } from "./api";

interface AuthCtx {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

// Safe defaults so consumers never crash if the provider isn't mounted yet
// (also hardens against HMR module-identity mismatches in dev).
const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: async () => { throw new Error("auth not ready"); },
  register: async () => { throw new Error("auth not ready"); },
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await api.login(email, password);
    setToken(res.token);
    setUser(res.user);
  }
  async function register(username: string, email: string, password: string) {
    const res = await api.register(username, email, password);
    setToken(res.token);
    setUser(res.user);
  }
  function logout() {
    setToken(null);
    setUser(null);
  }

  return (
    <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
