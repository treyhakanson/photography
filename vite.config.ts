import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { configApi, media, spaFallback } from "./plugins/index.ts";
import { loadGalleries, loadSite } from "./scripts/galleries.ts";

const APP = import.meta.dirname;

// The same discovery the build scripts use, so the dev server serves exactly
// the galleries that config/ declares.
const site = loadSite(APP);
const galleries = loadGalleries(APP, site);

export default defineConfig({
  // Deployed under treyhakanson.github.io/photography, so every asset URL and
  // the router's basename hang off this.
  base: site.base,
  plugins: [
    react(),
    media(site, galleries, APP),
    configApi(site, galleries),
    spaFallback(APP),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
