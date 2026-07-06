import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // pre-bundle wasmoon so its first use doesn't trigger a dep re-optimization page reload
  optimizeDeps: { include: ["wasmoon"] },
  worker: { format: "es" },
  server: {
    port: 5173,
    host: true, // listen on all interfaces so friends on your LAN can join
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
