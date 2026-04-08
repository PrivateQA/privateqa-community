import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/cli.ts",
    "src/index.ts",
    "src/base.ts",
    "src/core/plugin.ts",
    "src/core/errors.ts",
  ],
  format: ["esm"],
  platform: "node",
  target: "node20",
  sourcemap: true,
  clean: true,
  dts: true,
  external: [
    "@playwright/test",
    "playwright",
    "playwright-core",
    "chromium-bidi",
    "fsevents",
  ],
});
