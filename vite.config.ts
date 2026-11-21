import { defineConfig } from "vite";

// Served by GitHub Pages under /mtg-videos/.
export default defineConfig({
  base: "/mtg-videos/",
  build: { target: "es2022" },
});
