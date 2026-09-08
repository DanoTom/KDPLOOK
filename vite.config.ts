import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Stamp the build with the commit it came from.
 *
 * Without it there is no way to tell a fix that does not work from a fix that
 * was never deployed — and those need opposite responses. A live verification
 * run had to open its report with "commit: no disponible", which makes every
 * finding in it unattributable to a version of the code.
 */
function buildStamp(): { commit: string; date: string } {
  let commit = "desconocido";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    if (dirty) commit += "+cambios";
  } catch {
    // Building outside a checkout is fine; the stamp just says so.
  }
  return { commit, date: new Date().toISOString().slice(0, 10) };
}

const stamp = buildStamp();

export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(stamp.commit),
    __BUILD_DATE__: JSON.stringify(stamp.date),
  },
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
