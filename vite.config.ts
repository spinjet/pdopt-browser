import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import metadata from "./package.json" with { type: "json" };

const commit = process.env.CF_PAGES_COMMIT_SHA?.trim() ?? "";
const shortCommit = /^[0-9a-f]{7,64}$/i.test(commit) ? commit.slice(0, 7) : "";

export default defineConfig({
  plugins: [vue()],
  define: {
    "import.meta.env.VITE_PDOPT_VERSION": JSON.stringify(metadata.version),
    "import.meta.env.VITE_PDOPT_BUILD": JSON.stringify(shortCommit),
  },
  worker: { format: "es" },
  base: process.env.APP_BASE || "/",
  build: {
    target: "es2022",
    rollupOptions: { input: { app: "index.html", proof: "engine-proof.html" } },
  },
});
