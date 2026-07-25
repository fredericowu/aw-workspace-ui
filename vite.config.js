import { defineConfig } from "vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const PORT = Number(process.env.AW_APP_PORT) || 10011;

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    // Proxy /api (and /ws) to aw-backend server-to-server so the browser
    // sees same-origin requests — avoids needing every dev/preview origin
    // (127.0.0.1:PORT, aw-frontend.app.<domain>, ...) added to aw-backend's
    // CORS allowlist, which is meant to stay a short, deliberate list (see
    // repos/aw-backend's _cors_allowed_origins()). Production (static build
    // served by Caddy) needs the equivalent reverse-proxy at the Caddy
    // layer — not covered here, that's a Caddy template change.
    proxy: {
      "/api": { target: "https://api.aw.tekflox.com", changeOrigin: true, secure: true },
      "/ws": { target: "wss://api.aw.tekflox.com", ws: true, changeOrigin: true, secure: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        terminal: resolve(__dirname, "terminal.html"),
        androidViewer: resolve(__dirname, "android-viewer.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
    exclude: ["tests/**", "node_modules/**"],
  },
});
