import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: {
      // `npm run dev` (Vite) proxies API calls to `npm run dev:worker` (wrangler).
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
});
