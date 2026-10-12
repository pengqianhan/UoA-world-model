import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";

// The site is served from https://pengqianhan.github.io/UoA-world-model/ so every
// asset URL has to be prefixed with the repository name. Override with BASE_PATH=/
// when hosting at a domain root.
const base = process.env.BASE_PATH ?? "/UoA-world-model/";

export default defineConfig({
  base,
  plugins: [preact()],
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
