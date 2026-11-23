import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Served by GitHub Pages under /mtg-videos/: the archive, the day page and the live streams.
export default defineConfig({
  base: "/mtg-videos/",
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        archive: fileURLToPath(new URL("index.html", import.meta.url)),
        day: fileURLToPath(new URL("day/index.html", import.meta.url)),
        live: fileURLToPath(new URL("live/index.html", import.meta.url)),
      },
    },
  },
});
