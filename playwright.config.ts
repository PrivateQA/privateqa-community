import "dotenv/config";
import { defineConfig } from "@playwright/test";

const outputRoot = process.env.TEST_OUTPUT_DIR ?? "test-output";
const headless = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";
const isHeaded = !headless;

// En mode headed, Playwright ouvre 1 navigateur par worker.
// Si on laisse la valeur par défaut (CPU count), on obtient plusieurs fenêtres,
// souvent visibles comme des "about:blank" en attente.
const workersFromEnv = process.env.PW_WORKERS ?? process.env.WORKERS;
const workersParsed =
  typeof workersFromEnv === "string" && workersFromEnv.trim() !== ""
    ? Number(workersFromEnv)
    : undefined;
const workers = Number.isFinite(workersParsed as number) ? (workersParsed as number) : undefined;

// Permet de cibler un sous-ensemble de tests via .env ou ligne de commande.
// Ex: TEST_PATTERN=scenario -> ne lance que les specs dont le nom contient "scenario"
const testPattern = process.env.TEST_PATTERN;
const testMatch = testPattern
  ? `**/*${testPattern}*.spec.ts`
  : "**/*.spec.ts";

export default defineConfig({
  testDir: "./tests/generated",
  timeout: 30_000,
  // Garder le parallélisme en headless, mais éviter la "fermeture/ouverture" de multiples fenêtres en headed.
  fullyParallel: headless,
  workers: workers ?? (isHeaded ? 1 : undefined),
  testMatch,
  outputDir: `${outputRoot}/.playwright`,
  reporter: [["list"], ["./privateqa.reporter.mjs"]],
  use: {
    headless,
    trace: "on-first-retry",
  },
});

