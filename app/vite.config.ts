import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

// Deployment addresses are baked in at build time. VITE_DEPLOYMENTS may point at another JSON
// file (path relative to app/), e.g. a Sepolia deployment with the same shape as
// src/deployments.local.json.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const path = resolve(process.cwd(), env.VITE_DEPLOYMENTS || "src/deployments.local.json");
  const deployments = JSON.parse(readFileSync(path, "utf8"));
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __DEPLOYMENTS__: JSON.stringify(deployments),
    },
    server: { port: 5173, strictPort: false },
    build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  };
});
