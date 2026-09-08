import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { configApi, media, spaFallback } from "./plugins/index.ts";
import type { SiteConfig } from "./src/types.ts";

const APP = import.meta.dirname;

/**
 * One source of truth for the base path, the galleries, and where their photos
 * live -- the build script reads the same file.
 */
const site = JSON.parse(
  readFileSync(resolve(APP, "site.config.json"), "utf8"),
) as SiteConfig;

export default defineConfig({
  // Deployed under treyhakanson.github.io/photography, so every asset URL and
  // the router's basename hang off this.
  base: site.base,
  plugins: [react(), media(site, APP), configApi(site, APP), spaFallback(APP)],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
