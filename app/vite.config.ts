import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { worldRoutes } from "./server/world";

/**
 * Deployments are baked in via `define`, so a redeploy (e.g. scripts/demo.sh again) must restart
 * the dev server; otherwise the app keeps stale addresses and deploy block and pools silently
 * disappear. Watch the file and restart on change.
 */
function restartOnDeploymentsChange(path: string): Plugin {
  return {
    name: "clinch:deployments-restart",
    apply: "serve",
    configureServer(server) {
      server.watcher.add(path);
      server.watcher.on("change", (file) => {
        if (resolve(file) === path) {
          server.config.logger.info("deployments changed, restarting dev server", { timestamp: true });
          void server.restart();
        }
      });
    },
  };
}

// Deployment addresses are baked in at build time. VITE_DEPLOYMENTS may point at another JSON
// file (path relative to app/), e.g. a Sepolia deployment with the same shape as
// src/deployments.local.json.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const path = resolve(process.cwd(), env.VITE_DEPLOYMENTS || "src/deployments.local.json");
  const deployments = JSON.parse(readFileSync(path, "utf8"));
  return {
    plugins: [react(), tailwindcss(), restartOnDeploymentsChange(path), worldRoutes(env, deployments)],
    define: {
      __DEPLOYMENTS__: JSON.stringify(deployments),
    },
    server: { port: 5173, strictPort: false },
    build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  };
});
