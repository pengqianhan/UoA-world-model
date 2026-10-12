import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

// The site is served from https://pengqianhan.github.io/UoA-world-model/ so every
// asset URL has to be prefixed with the repository name. Override with BASE_PATH=/
// when hosting at a domain root.
const base = process.env.BASE_PATH ?? "/UoA-world-model/";

export default defineConfig({
  base,
  plugins: [preact()],
  // Fixed, uncommon ports so the dev server, the preview server and the e2e tests agree,
  // and so they do not collide with other projects using Vite's default 5173.
  server: { port: 5273, strictPort: true },
  preview: { port: 4273, strictPort: true },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
