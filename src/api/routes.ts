import { readFile, readdir, rm, stat, access } from "node:fs/promises";
import { resolve, join, extname, relative } from "node:path";
import { spawn } from "node:child_process";
import { Router, json, text, sendFile, type RouteContext } from "./server.js";
import { defaultConfig } from "../core/config.js";
import { preprocessScenarioToPivot } from "../agents/preprocessor/preprocessor.js";
import { compileToSpec } from "../agents/builder/builder.js";
import { readJsonFile, writeJsonFile, writeTextFile } from "../utils/fs.js";
import { extractTestCases, slugify } from "../utils/scenario.js";
import type { MapFile } from "../infrastructure/store.js";

const OUTPUT_ROOT = process.env.TEST_OUTPUT_DIR ?? "test-output";

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function rmIfExists(p: string) {
  try {
    const s = await stat(p);
    await rm(p, { recursive: s.isDirectory(), force: true });
  } catch {
    // n'existe pas
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function requireBody<T>(ctx: RouteContext, ...keys: string[]): T {
  if (!ctx.body || typeof ctx.body !== "object") {
    throw new Error("Corps JSON requis");
  }
  for (const k of keys) {
    if (!(k in (ctx.body as Record<string, unknown>))) {
      throw new Error(`Champ requis manquant: "${k}"`);
    }
  }
  return ctx.body as T;
}

type RunResult = { exitCode: number; stdout: string; stderr: string };

function runPlaywrightProcess(extraArgs: string[] = [], env?: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["playwright", "test", ...extraArgs], {
      shell: true,
      env: { ...process.env, ...env },
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout?.on("data", (d) => stdout.push(d.toString()));
    child.stderr?.on("data", (d) => stderr.push(d.toString()));
    child.on("close", (code) =>
      resolve({ exitCode: code ?? 1, stdout: stdout.join(""), stderr: stderr.join("") }),
    );
  });
}

// ── Collecte récursive de fichiers ─────────────────────────────────────────

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await listFilesRecursive(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

// ── Routes ─────────────────────────────────────────────────────────────────

export function registerRoutes(router: Router) {
  // ── Health ──────────────────────────────────────────────────────────────
  router.get("/api/health", async ({ res }) => {
    json(res, { status: "ok", version: "0.1.0", timestamp: new Date().toISOString() });
  });

  // ── POST /api/preprocess ───────────────────────────────────────────────
  // Body: { scenario: "chemin.md" | contenu brut, noAI?: bool }
  router.post("/api/preprocess", async (ctx) => {
    const { scenario, noAI } = requireBody<{
      scenario: string;
      noAI?: boolean;
    }>(ctx, "scenario");

    // Détection: si c'est un chemin de fichier existant, on le lit; sinon on traite comme contenu brut
    let scenarioContent: string;
    let scenarioPath: string;
    if (await exists(scenario)) {
      scenarioPath = resolve(scenario);
      scenarioContent = await readFile(scenarioPath, "utf8");
    } else {
      scenarioPath = "inline.md";
      scenarioContent = scenario;
    }

    ctx.logger.info(`Preprocess: ${scenarioPath} (noAI=${!!noAI})`);

    const pivot = await preprocessScenarioToPivot({
      scenarioPath,
      scenarioContent,
      ollamaBaseUrl: defaultConfig.ollamaBaseUrl,
      generationModel: defaultConfig.generationModel,
      noAI: noAI ?? false,
    });

    // Sauvegarder le pivot
    const pivotPath = resolve(".privateqa", "pivot.json");
    await writeJsonFile(pivotPath, pivot);

    json(ctx.res, { success: true, pivotPath, pivot });
  });

  // ── POST /api/compile ──────────────────────────────────────────────────
  // Body: { scenario: "chemin.md", preprocess?: bool, noAI?: bool }
  router.post("/api/compile", async (ctx) => {
    const {
      scenario,
      preprocess: doPreprocess,
      noAI,
    } = requireBody<{
      scenario: string;
      preprocess?: boolean;
      noAI?: boolean;
    }>(ctx, "scenario");

    const scenarioAbs = resolve(scenario);
    const scenarioContent = await readFile(scenarioAbs, "utf8");
    const baseName = scenario.split(/[\\/]/).pop()!.replace(/\.\w+$/, "");

    ctx.logger.info(`Compile: ${scenarioAbs}`);

    // Lecture map
    const mapPath = defaultConfig.mapPath;
    const map = await readJsonFile<MapFile>(mapPath);

    // Pré-traitement optionnel
    const pivot = doPreprocess
      ? await preprocessScenarioToPivot({
          scenarioPath: scenario,
          scenarioContent,
          ollamaBaseUrl: defaultConfig.ollamaBaseUrl,
          generationModel: defaultConfig.generationModel,
          noAI: noAI ?? false,
        })
      : undefined;

    const cases = extractTestCases(scenarioContent, baseName);
    const baseAbs = resolve("tests/_privateqa/base");
    const toImportPath = (fromFileAbs: string) => {
      const rel = relative(resolve(fromFileAbs, ".."), baseAbs);
      const withSlashes = rel.replace(/\\/g, "/");
      return withSlashes.startsWith(".") ? withSlashes : `./${withSlashes}`;
    };

    const singleSpecPath = resolve(defaultConfig.generatedTestsDir, `${baseName}.spec.ts`);
    const multiSpecDir = resolve(defaultConfig.generatedTestsDir, baseName);
    const generatedFiles: string[] = [];

    if (cases.length <= 1) {
      const out = singleSpecPath;
      const baseImport = toImportPath(resolve(out));
      const spec = await compileToSpec({
        scenarioPath: scenario,
        scenarioContent: cases[0]?.content ?? scenarioContent,
        steps: pivot?.cases[0]?.steps,
        map,
        ollamaBaseUrl: defaultConfig.ollamaBaseUrl,
        embeddingModel: defaultConfig.embeddingModel,
        testTitle: cases[0]?.title,
        baseTestImportPath: baseImport,
      });
      await rmIfExists(multiSpecDir);
      await writeTextFile(out, spec);
      generatedFiles.push(out);
    } else {
      await rmIfExists(singleSpecPath);
      await rmIfExists(multiSpecDir);

      for (const [i, tc] of cases.entries()) {
        const slug = slugify(tc.title) || `test-${i + 1}`;
        const file = resolve(multiSpecDir, `${String(i + 1).padStart(2, "0")}-${slug}.spec.ts`);
        const baseImport = toImportPath(resolve(file));
        const spec = await compileToSpec({
          scenarioPath: scenario,
          scenarioContent: tc.content,
          steps: pivot?.cases[i]?.steps,
          map,
          ollamaBaseUrl: defaultConfig.ollamaBaseUrl,
          embeddingModel: defaultConfig.embeddingModel,
          testTitle: tc.title,
          baseTestImportPath: baseImport,
        });
        await writeTextFile(file, spec);
        generatedFiles.push(file);
      }
    }

    json(ctx.res, {
      success: true,
      cases: cases.length,
      files: generatedFiles,
    });
  });

  // ── POST /api/run ──────────────────────────────────────────────────────
  // Body optionnel: { headed?: bool, pattern?: string, grep?: string }
  router.post("/api/run", async (ctx) => {
    const body = (ctx.body ?? {}) as {
      headed?: boolean;
      pattern?: string;
      grep?: string;
    };

    const env: Record<string, string> = {};
    if (body.headed === true) env.HEADLESS = "false";
    if (body.headed === false) env.HEADLESS = "true";
    if (body.pattern) env.TEST_PATTERN = body.pattern;

    const extra: string[] = [];
    if (body.grep) extra.push("--grep", body.grep);

    ctx.logger.info(
      `Run: headed=${body.headed ?? "default"}, pattern=${body.pattern ?? "*"}, grep=${body.grep ?? "-"}`,
    );

    const result = await runPlaywrightProcess(extra, env);

    // Lire le summary s'il existe
    const summaryPath = resolve(OUTPUT_ROOT, "summary.json");
    let summary: unknown = null;
    if (await exists(summaryPath)) {
      try {
        summary = JSON.parse(await readFile(summaryPath, "utf8"));
      } catch {
        // pas grave
      }
    }

    json(ctx.res, {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      summary,
    });
  });

  // ── GET /api/results ───────────────────────────────────────────────────
  router.get("/api/results", async ({ res }) => {
    const summaryPath = resolve(OUTPUT_ROOT, "summary.json");
    if (!(await exists(summaryPath))) {
      json(res, { error: "Aucun résultat. Lancez d'abord les tests." }, 404);
      return;
    }
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    json(res, summary);
  });

  // ── GET /api/results/steps ─────────────────────────────────────────────
  router.get("/api/results/steps", async ({ res }) => {
    const logsDir = resolve(OUTPUT_ROOT, "logs");
    if (!(await exists(logsDir))) {
      json(res, { error: "Aucun log. Lancez d'abord les tests." }, 404);
      return;
    }
    const files = await readdir(logsDir);
    const allSteps: unknown[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const log = JSON.parse(await readFile(join(logsDir, f), "utf8"));
        allSteps.push({
          title: log.title,
          status: log.status,
          durationMs: log.durationMs,
          steps: log.steps,
        });
      } catch {
        // ignore
      }
    }
    json(res, { tests: allSteps });
  });

  // ── GET /api/screenshots/:name ─────────────────────────────────────────
  router.get("/api/screenshots/:name", async ({ res, params }) => {
    const name = params.name!;
    // Chercher dans success puis failed
    for (const sub of ["success", "failed"]) {
      const p = resolve(OUTPUT_ROOT, "screenshots", sub, name);
      if (await exists(p)) {
        const buf = await readFile(p);
        sendFile(res, buf, "image/png");
        return;
      }
    }
    json(res, { error: `Screenshot "${name}" introuvable` }, 404);
  });

  // ── GET /api/screenshots ───────────────────────────────────────────────
  router.get("/api/screenshots", async ({ res }) => {
    const ssDir = resolve(OUTPUT_ROOT, "screenshots");
    if (!(await exists(ssDir))) {
      json(res, { screenshots: [] });
      return;
    }
    const all = await listFilesRecursive(ssDir);
    const screenshots = all
      .filter((f) => extname(f).toLowerCase() === ".png")
      .map((f) => ({
        path: relative(process.cwd(), f).replace(/\\/g, "/"),
        name: f.split(/[\\/]/).pop()!,
        kind: f.includes("success") ? "success" : "failed",
      }));
    json(res, { screenshots });
  });

  // ── GET /api/scenarios ─────────────────────────────────────────────────
  router.get("/api/scenarios", async ({ res }) => {
    // Liste les fichiers .md à la racine et dans examples/
    const dirs = [".", "examples"];
    const scenarios: Array<{ path: string; name: string }> = [];
    for (const dir of dirs) {
      const entries = await readdir(dir).catch(() => []);
      for (const e of entries) {
        if (typeof e === "string" && e.endsWith(".md") && e !== "README.md" && e !== "explication.md") {
          scenarios.push({ path: join(dir, e), name: e.replace(/\.md$/, "") });
        }
      }
    }
    json(res, { scenarios });
  });

  // ── DELETE /api/test-output ────────────────────────────────────────────
  router.delete("/api/test-output", async ({ res, logger }) => {
    const absOutput = resolve(OUTPUT_ROOT);
    if (await exists(absOutput)) {
      await rm(absOutput, { recursive: true, force: true });
      logger.info(`test-output supprimé: ${absOutput}`);
    }
    json(res, { success: true, deleted: absOutput });
  });

  // ── POST /api/pipeline ────────────────────────────────────────────────
  // Chaîne complète: preprocess → compile → run
  // Body: { scenario: "chemin.md", preprocess?: bool, noAI?: bool, headed?: bool }
  router.post("/api/pipeline", async (ctx) => {
    const {
      scenario,
      preprocess: doPreprocess,
      noAI,
      headed,
    } = requireBody<{
      scenario: string;
      preprocess?: boolean;
      noAI?: boolean;
      headed?: boolean;
    }>(ctx, "scenario");

    const results: Record<string, unknown> = {};

    // 1. Preprocess (optionnel)
    if (doPreprocess) {
      ctx.logger.info(`Pipeline [1/3] Preprocess: ${scenario}`);
      const scenarioAbs = resolve(scenario);
      const scenarioContent = await readFile(scenarioAbs, "utf8");
      const pivot = await preprocessScenarioToPivot({
        scenarioPath: scenario,
        scenarioContent,
        ollamaBaseUrl: defaultConfig.ollamaBaseUrl,
        generationModel: defaultConfig.generationModel,
        noAI: noAI ?? false,
      });
      const pivotPath = resolve(".privateqa", "pivot.json");
      await writeJsonFile(pivotPath, pivot);
      results.preprocess = { cases: pivot.cases.length, pivotPath };
    }

    // 2. Compile
    ctx.logger.info(`Pipeline [2/3] Compile: ${scenario}`);
    const scenarioAbs = resolve(scenario);
    const scenarioContent = await readFile(scenarioAbs, "utf8");
    const baseName = scenario.split(/[\\/]/).pop()!.replace(/\.\w+$/, "");
    const map = await readJsonFile<MapFile>(defaultConfig.mapPath);
    const cases = extractTestCases(scenarioContent, baseName);
    const baseAbs = resolve("tests/_privateqa/base");
    const toImportPath = (fromFileAbs: string) => {
      const rel = relative(resolve(fromFileAbs, ".."), baseAbs);
      const withSlashes = rel.replace(/\\/g, "/");
      return withSlashes.startsWith(".") ? withSlashes : `./${withSlashes}`;
    };

    const singleSpecPath = resolve(defaultConfig.generatedTestsDir, `${baseName}.spec.ts`);
    const multiSpecDir = resolve(defaultConfig.generatedTestsDir, baseName);
    const generatedFiles: string[] = [];

    if (cases.length <= 1) {
      const out = singleSpecPath;
      const spec = await compileToSpec({
        scenarioPath: scenario,
        scenarioContent: cases[0]?.content ?? scenarioContent,
        map,
        ollamaBaseUrl: defaultConfig.ollamaBaseUrl,
        embeddingModel: defaultConfig.embeddingModel,
        testTitle: cases[0]?.title,
        baseTestImportPath: toImportPath(resolve(out)),
      });
      await rmIfExists(multiSpecDir);
      await writeTextFile(out, spec);
      generatedFiles.push(out);
    } else {
      await rmIfExists(singleSpecPath);
      await rmIfExists(multiSpecDir);
      for (const [i, tc] of cases.entries()) {
        const slug = slugify(tc.title) || `test-${i + 1}`;
        const file = resolve(multiSpecDir, `${String(i + 1).padStart(2, "0")}-${slug}.spec.ts`);
        const spec = await compileToSpec({
          scenarioPath: scenario,
          scenarioContent: tc.content,
          map,
          ollamaBaseUrl: defaultConfig.ollamaBaseUrl,
          embeddingModel: defaultConfig.embeddingModel,
          testTitle: tc.title,
          baseTestImportPath: toImportPath(resolve(file)),
        });
        await writeTextFile(file, spec);
        generatedFiles.push(file);
      }
    }
    results.compile = { cases: cases.length, files: generatedFiles };

    // 3. Run
    ctx.logger.info(`Pipeline [3/3] Run`);
    const env: Record<string, string> = {};
    if (headed === true) env.HEADLESS = "false";
    if (headed === false) env.HEADLESS = "true";

    const runResult = await runPlaywrightProcess([], env);

    const summaryPath = resolve(OUTPUT_ROOT, "summary.json");
    let summary: unknown = null;
    if (await exists(summaryPath)) {
      try {
        summary = JSON.parse(await readFile(summaryPath, "utf8"));
      } catch {
        // pas grave
      }
    }

    results.run = {
      exitCode: runResult.exitCode,
      success: runResult.exitCode === 0,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      summary,
    };

    json(ctx.res, { success: runResult.exitCode === 0, pipeline: results });
  });
}
