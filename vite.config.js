import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const PORT = Number(process.env.AW_APP_PORT) || 10011;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: PORT,
    strictPort: true,
    allowedHosts: true,
    // Public access is exclusively through Caddy's TLS wildcard proxy on
    // 443 (aw-frontend.app.{AW_DOMAIN}) — the container's own port is
    // never reachable externally, so the HMR client must dial back on
    // 443/wss, not the internal dev-server port.
    hmr: { clientPort: 443, protocol: "wss" },
  },
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
    exclude: ["tests/**", "node_modules/**"],
  },
});
