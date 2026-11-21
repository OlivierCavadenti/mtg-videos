import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Served by GitHub Pages under /mtg-videos/: the archive and the day page.
export default defineConfig({
  base: "/mtg-videos/",
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        archive: fileURLToPath(new URL("index.html", import.meta.url)),
        day: fileURLToPath(new URL("day/index.html", import.meta.url)),
      },
    },
  },
});
