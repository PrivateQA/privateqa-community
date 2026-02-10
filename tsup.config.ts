import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  sourcemap: true,
  clean: true,
  dts: false,
  // IMPORTANT: ne pas bundler Playwright (et deps) sinon esbuild tente de résoudre
  // des dépendances optionnelles (ex: chromium-bidi) et le build casse.
  external: [
    "@playwright/test",
    "playwright",
    "playwright-core",
    "chromium-bidi",
    "fsevents",
  ],
});

