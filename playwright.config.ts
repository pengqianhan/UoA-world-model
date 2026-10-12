import { defineConfig, devices } from "@playwright/test";

// By default the tests run against a local production build (`npm run build && npm run preview`).
// Set E2E_BASE_URL to check a deployed copy instead, e.g. the GitHub Pages site:
//   E2E_BASE_URL=https://pengqianhan.github.io/UoA-world-model/ npm run e2e
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:4273/UoA-world-model/";
const local = baseURL.startsWith("http://localhost");

// Headless Chromium needs to be told how to get a WebGL context. On Windows the real GPU is
// available through D3D11; elsewhere (CI) fall back to the SwiftShader software renderer.
// E2E_GL=swiftshader forces the software renderer, to reproduce what CI sees.
const glArgs =
  process.platform === "win32" && process.env.E2E_GL !== "swiftshader"
    ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  // CI renders in software on a small runner, so give it more room.
  timeout: process.env.CI ? 180_000 : 60_000,
  expect: { timeout: process.env.CI ? 30_000 : 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: { args: glArgs },
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      // CI renders in software, so it gets a 1x screen; locally the phone's real pixel density is used.
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, ...(process.env.CI ? { deviceScaleFactor: 1 } : {}) },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: local
    ? {
        command: "npm run preview",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
      }
    : undefined,
});
