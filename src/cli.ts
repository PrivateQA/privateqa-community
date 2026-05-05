#!/usr/bin/env node
import "./core/env.js";
import { existsSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultConfig } from "./core/config.js";
import { buildMap } from "./agents/mapper/mapper.js";
import { compileToSpec } from "./agents/builder/builder.js";
import { preprocessScenarioToPivot } from "./agents/preprocessor/preprocessor.js";
import { readJsonFile, writeJsonFile, writeTextFile } from "./utils/fs.js";
import { createLogger, type LogLevel } from "./utils/logger.js";
import type { MapFile } from "./infrastructure/store.js";
import { extractTestCases, slugify } from "./utils/scenario.js";
import { parseStepsFromMarkdown, stepsFromMarkdown, toStep } from "./core/steps.js";
import { applyGlossaryToMarkdown, type GlossaryFile } from "./utils/glossary.js";

const __cliDir = dirname(fileURLToPath(import.meta.url));
const REPORTER_PATH = resolve(__cliDir, "..", "privateqa.reporter.mjs").replace(/\\/g, "/");
const REPORT_HTML = resolve("test-output", "report.html");

/** Supprime un fichier ou dossier s'il existe (silencieux sinon) */
async function rmIfExists(p: string) {
  try {
    const s = await stat(p);
    await rm(p, { recursive: s.isDirectory(), force: true });
  } catch {
    // n'existe pas – rien à faire
  }
}

type Args = {
  _: string[];
  flags: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const [k, v] = a.split("=", 2);
    const key = k.slice(2);
    if (v !== undefined) {
      flags[key] = v;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { _: positional, flags };
}

function strFlag(args: Args, key: string, fallback?: string) {
  const v = args.flags[key];
  if (typeof v === "string") return v;
  return fallback;
}

function boolFlag(args: Args, key: string, fallback = false) {
  const v = args.flags[key];
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v === "true";
  return fallback;
}

function numFlag(args: Args, key: string, fallback: number) {
  const v = args.flags[key];
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeRunTargets(targets: string[]) {
  // En PowerShell, un `*` résiduel peut se retrouver en argument littéral et
  // casser Playwright (regex interne invalide: /*/gi).
  return targets.filter((t) => t.trim() !== "*");
}

async function openFile(filePath: string) {
  const abs = resolve(filePath);
  const fileUrl = pathToFileURL(abs).href;
  // Ouvre le rapport via le Chromium Playwright dans le même process shell
  // (pas de fenêtre cmd supplémentaire).
  const child = spawn("npx", ["playwright", "open", fileUrl], {
    stdio: "inherit",
    shell: true,
    windowsHide: true,
  });
  await new Promise<void>((resolveDone) => {
    child.on("exit", () => resolveDone());
    child.on("error", () => resolveDone());
  });
}

async function runPlaywrightWithPrivateqaReporter(
  specsOrArgs: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  const pwArgs = ["playwright", "test"];
  if (existsSync(REPORTER_PATH)) {
    pwArgs.push(`--reporter=list,${REPORTER_PATH}`);
  }
  pwArgs.push(...specsOrArgs);

  const child = spawn("npx", pwArgs, { stdio: "inherit", shell: true, env });
  return await new Promise<number>((res) => {
    child.on("exit", (code) => res(code ?? 1));
    child.on("error", () => res(1));
  });
}

function resolveGlossaryPath(customPath?: string) {
  if (customPath) {
    const abs = resolve(customPath);
    return existsSync(abs) ? abs : undefined;
  }
  const candidates = [resolve(".privateqa", "glossary.json"), resolve("glossary.json")];
  return candidates.find((p) => existsSync(p));
}

function validateScenarioContent(content: string) {
  const rawSteps = parseStepsFromMarkdown(content);
  const unknowns = rawSteps
    .map((raw, i) => ({ index: i + 1, step: toStep(raw) }))
    .filter((x) => x.step.kind === "unknown")
    .map((x) => ({ index: x.index, raw: x.step.raw }));
  return {
    total: rawSteps.length,
    unknowns,
  };
}

function ensureBrowser(logger: ReturnType<typeof createLogger>) {
  logger.info("Vérification du navigateur Chromium...");
  const r = spawnSync("npx", ["playwright", "install", "chromium"], {
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) {
    logger.warn("Chromium introuvable. Lancez: npx playwright install chromium");
  }
}

function help() {
  console.log(`
privateqa — Natural-language scenario → Playwright tests

Usage:
  privateqa run <scenario.md> [--url <url>] [--headed] [--no-map] [--no-embeddings] [--save] [--reporter] [--no-open] [--no-validate]
  privateqa run [--headed|--headless] [args...]
  privateqa run-generated [tests/generated[/...]] [--headed|--headless] [--reporter] [--no-open]

All-in-one (recommended):
  npx privateqa run scenario.md                 Map + compile + execute in one go
  npx privateqa run scenario.md --headed        Same, with a visible browser
  npx privateqa run scenario.md --url <url>     Override the URL from the scenario
  npx privateqa run scenario.md --no-map        Skip mapping (reuse existing map)
  npx privateqa run scenario.md --map-headed    Show browser only during mapping
  npx privateqa run scenario.md --glossary .privateqa/glossary.json   Apply business glossary
  npx privateqa run scenario.md --save          Save this run in the evolution history
  npx privateqa run scenario.md --reporter      Open report in Chromium at the end
  npx privateqa run scenario.md --no-open       Don't auto-open report in browser
  npx privateqa run scenario.md --no-validate   Skip scenario validation before compile

Step-by-step:
  privateqa map <url> [--out .privateqa/map.json] [--no-embeddings] [--max 200] [--headed]
  privateqa compile <scenario.md> [--map .privateqa/map.json] [--out <file.spec.ts|dir>] [--base-import <path>] [--glossary <path>]
  privateqa run [--headed|--headless]
  privateqa run-generated                     Exécute uniquement tests/generated avec le reporter privateqa

Other:
  privateqa preprocess <scenario.md> [--out .privateqa/pivot.json] [--ollama ...] [--model mistral] [--no-ai] [--glossary <path>]
  privateqa validate <scenario.md> [--glossary <path>] [--allow-unknown]
  privateqa report [--input test-output/summary.json] [--out test-output/report.html]
  privateqa evolution [--history .privateqa/history.json] [--out test-output/evolution.html]
  privateqa api [--port 3000]

Quick start:
  npm install privateqa-community
  echo '- Ouvrir "https://example.com"' > scenario.md
  echo '- Vérifie que "Example Domain" est visible' >> scenario.md
  npx privateqa run scenario.md
`);
}

async function main() {
  const envLevel = process.env.LOG_LEVEL;
  const level: LogLevel =
    envLevel === "debug" || envLevel === "info" || envLevel === "warn" || envLevel === "error"
      ? envLevel
      : "info";
  const logger = createLogger(level);
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (!cmd || cmd === "help" || cmd === "--help") {
    help();
    process.exit(0);
  }

  if (cmd === "map") {
    const url = args._[1] ?? strFlag(args, "url");
    if (!url) throw new Error("map: URL manquante. Ex: privateqa map https://example.com");

    const out = strFlag(args, "out", defaultConfig.mapPath)!;
    const ollama = strFlag(args, "ollama", defaultConfig.ollamaBaseUrl)!;
    const embedModel = strFlag(args, "embed-model", defaultConfig.embeddingModel)!;
    const computeEmbeddings = !boolFlag(args, "no-embeddings", false);
    const maxElements = numFlag(args, "max", 200);
    const headed = boolFlag(args, "headed", false);

    logger.info(`Mapping URL: ${url}`);
    const map = await buildMap({
      url,
      ollamaBaseUrl: ollama,
      embeddingModel: embedModel,
      computeEmbeddings,
      maxElements,
      headed,
    });
    await writeJsonFile(out, map);
    logger.info(`Map écrite: ${out} (éléments: ${map.elements.length})`);
    return;
  }

  if (cmd === "compile") {
    const scenarioPath = args._[1] ?? strFlag(args, "scenario");
    if (!scenarioPath) throw new Error("compile: scénario manquant. Ex: privateqa compile examples/demo.md");

    const mapPath = strFlag(args, "map", defaultConfig.mapPath)!;
    const outFlag = strFlag(args, "out");
    const ollama = strFlag(args, "ollama", defaultConfig.ollamaBaseUrl)!;
    const embedModel = strFlag(args, "embed-model", defaultConfig.embeddingModel)!;
    const genModel = strFlag(args, "gen-model", defaultConfig.generationModel)!;
    const doPreprocess = boolFlag(args, "preprocess", false);
    const noAI = boolFlag(args, "no-ai", false);

    logger.info(`Lecture map: ${mapPath}`);
    const map = await readJsonFile<MapFile>(mapPath);
    const scenarioAbs = resolve(scenarioPath);
    logger.info(`Lecture scénario: ${scenarioAbs}`);
    let scenarioContent = await readFile(scenarioAbs, "utf8");
    const glossaryPath = resolveGlossaryPath(strFlag(args, "glossary"));
    if (glossaryPath) {
      const glossary = await readJsonFile<GlossaryFile>(glossaryPath);
      const applied = applyGlossaryToMarkdown(scenarioContent, glossary);
      scenarioContent = applied.content;
      if (applied.replacements.length > 0) {
        logger.info(
          `Glossaire appliqué: ${glossaryPath} (${applied.replacements.reduce((a, b) => a + b.count, 0)} remplacements)`,
        );
      }
    }

    const baseName = scenarioPath.split(/[\\/]/).pop()!.replace(/\.\w+$/, "");
    const cases = extractTestCases(scenarioContent, baseName);

    const baseImportOverride = strFlag(args, "base-import");
    const hasLocalBase = existsSync(resolve("tests/_privateqa/base.ts"));
    const resolveBaseImport = (fromFileAbs: string): string | undefined => {
      if (baseImportOverride) return baseImportOverride;
      if (hasLocalBase) {
        const baseAbs = resolve("tests/_privateqa/base");
        const rel = relative(dirname(fromFileAbs), baseAbs);
        const withSlashes = rel.replace(/\\/g, "/");
        return withSlashes.startsWith(".") ? withSlashes : `./${withSlashes}`;
      }
      return undefined;
    };

    const pivot = doPreprocess
      ? await preprocessScenarioToPivot({
          scenarioPath,
          scenarioContent,
          ollamaBaseUrl: ollama,
          generationModel: genModel,
          noAI,
        })
      : undefined;

    // Chemins possibles pour les artefacts (fichier unique OU dossier de specs)
    const singleSpecPath = resolve(defaultConfig.generatedTestsDir, `${baseName}.spec.ts`);
    const multiSpecDir = resolve(defaultConfig.generatedTestsDir, baseName);

    // Si un seul test est détecté, comportement identique à avant (1 fichier)
    if (cases.length <= 1) {
      const out = outFlag ?? singleSpecPath;
      const spec = await compileToSpec({
        scenarioPath,
        scenarioContent: cases[0]?.content ?? scenarioContent,
        steps: pivot?.cases[0]?.steps,
        map,
        ollamaBaseUrl: ollama,
        embeddingModel: embedModel,
        testTitle: cases[0]?.title,
        baseTestImportPath: resolveBaseImport(resolve(out)),
      });

      // Nettoyage: supprimer l'ancien dossier multi-specs s'il existe
      await rmIfExists(multiSpecDir);
      await writeTextFile(out, spec);
      logger.info(`Spec générée: ${out}`);
      return;
    }

    // Plusieurs tests: génère 1 spec par cas
    const outDir =
      outFlag && outFlag.toLowerCase().endsWith(".ts")
        ? dirname(resolve(outFlag))
        : resolve(outFlag ?? multiSpecDir);

    // Nettoyage: supprimer l'ancien fichier unique s'il existe + purger l'ancien dossier
    await rmIfExists(singleSpecPath);
    await rmIfExists(outDir);

    logger.info(`Cas de test détectés: ${cases.length} -> génération dans: ${outDir}`);

    for (const [i, tc] of cases.entries()) {
      const slug = slugify(tc.title) || `test-${i + 1}`;
      const file = resolve(outDir, `${String(i + 1).padStart(2, "0")}-${slug}.spec.ts`);
      const spec = await compileToSpec({
        scenarioPath,
        scenarioContent: tc.content,
        steps: pivot?.cases[i]?.steps,
        map,
        ollamaBaseUrl: ollama,
        embeddingModel: embedModel,
        testTitle: tc.title,
        baseTestImportPath: resolveBaseImport(resolve(file)),
      });
      await writeTextFile(file, spec);
    }
    logger.info(`Specs générées: ${cases.length}`);
    return;
  }

  if (cmd === "preprocess") {
    const scenarioPath = args._[1] ?? strFlag(args, "scenario");
    if (!scenarioPath) throw new Error("preprocess: scénario manquant. Ex: privateqa preprocess scenario.md");

    const out = strFlag(args, "out", resolve(".privateqa", "pivot.json"))!;
    const ollama = strFlag(args, "ollama", defaultConfig.ollamaBaseUrl)!;
    const model = strFlag(args, "model", defaultConfig.generationModel)!;
    const noAI = boolFlag(args, "no-ai", false);

    const scenarioAbs = resolve(scenarioPath);
    logger.info(`Lecture scénario: ${scenarioAbs}`);
    let scenarioContent = await readFile(scenarioAbs, "utf8");
    const glossaryPath = resolveGlossaryPath(strFlag(args, "glossary"));
    if (glossaryPath) {
      const glossary = await readJsonFile<GlossaryFile>(glossaryPath);
      const applied = applyGlossaryToMarkdown(scenarioContent, glossary);
      scenarioContent = applied.content;
      if (applied.replacements.length > 0) {
        logger.info(
          `Glossaire appliqué: ${glossaryPath} (${applied.replacements.reduce((a, b) => a + b.count, 0)} remplacements)`,
        );
      }
    }

    const pivot = await preprocessScenarioToPivot({
      scenarioPath,
      scenarioContent,
      ollamaBaseUrl: ollama,
      generationModel: model,
      noAI,
    });

    await writeJsonFile(out, pivot);
    logger.info(`Pivot écrit: ${out} (cas: ${pivot.cases.length})`);
    return;
  }

  if (cmd === "api") {
    const { Router, startServer } = await import("./api/server.js");
    const { registerRoutes } = await import("./api/routes.js");
    const port = numFlag(args, "port", Number(process.env.API_PORT ?? 3000));

    const router = new Router();
    registerRoutes(router);
    startServer(router, port, level);
    // Le serveur reste actif – pas de return
    return new Promise(() => {}); // block forever
  }

  if (cmd === "validate") {
    const scenarioPath = args._[1] ?? strFlag(args, "scenario");
    if (!scenarioPath) throw new Error("validate: scénario manquant. Ex: privateqa validate scenario.md");

    const scenarioAbs = resolve(scenarioPath);
    logger.info(`Validation scénario: ${scenarioAbs}`);
    let scenarioContent = await readFile(scenarioAbs, "utf8");

    const glossaryPath = resolveGlossaryPath(strFlag(args, "glossary"));
    if (glossaryPath) {
      const glossary = await readJsonFile<GlossaryFile>(glossaryPath);
      const applied = applyGlossaryToMarkdown(scenarioContent, glossary);
      scenarioContent = applied.content;
      logger.info(
        `Glossaire appliqué: ${glossaryPath} (${applied.replacements.reduce((a, b) => a + b.count, 0)} remplacements)`,
      );
    }

    const report = validateScenarioContent(scenarioContent);
    if (report.total === 0) {
      throw new Error("Validation échouée: aucun step détecté dans le scénario.");
    }

    if (report.unknowns.length === 0) {
      logger.info(`Validation OK: ${report.total} step(s), 0 unknown.`);
      return;
    }

    logger.warn(
      `Validation: ${report.total} step(s), ${report.unknowns.length} unknown détecté(s).`,
    );
    for (const u of report.unknowns.slice(0, 20)) {
      console.warn(`  [${u.index}] ${u.raw}`);
    }
    if (report.unknowns.length > 20) {
      console.warn(`  ... ${report.unknowns.length - 20} autre(s) step(s) unknown`);
    }

    if (!boolFlag(args, "allow-unknown", false)) {
      throw new Error(
        "Validation échouée: des steps unknown sont présents. Corrigez le scénario ou relancez avec --allow-unknown.",
      );
    }
    return;
  }

  if (cmd === "run") {
    const raw = process.argv.slice(3);
    const runArgs = parseArgs(raw);
    const headed = boolFlag(runArgs, "headed", false);
    const headless = boolFlag(runArgs, "headless", false);

    const save = boolFlag(runArgs, "save", false);

    const env = { ...process.env };
    // Par défaut, forcer headless si aucun flag n'est donné.
    env.HEADLESS = "true";
    if (headed) env.HEADLESS = "false";
    if (headless) env.HEADLESS = "true";
    if (save) env.PRIVATEQA_SAVE_HISTORY = "1";

    const firstArg = runArgs._[0];
    const isScenario = firstArg && /\.md$/i.test(firstArg) && existsSync(resolve(firstArg));

    ensureBrowser(logger);

    if (isScenario) {
      const scenarioPath = firstArg;
      const urlOverride = strFlag(runArgs, "url");
      const noMap = boolFlag(runArgs, "no-map", false);
      const mapHeaded = boolFlag(runArgs, "map-headed", false);
      const ollama = strFlag(runArgs, "ollama", defaultConfig.ollamaBaseUrl)!;
      const embedModel = strFlag(runArgs, "embed-model", defaultConfig.embeddingModel)!;
      const noEmbeddings = boolFlag(runArgs, "no-embeddings", false);
      const maxElements = numFlag(runArgs, "max", 200);
      const noAI = boolFlag(runArgs, "no-ai", false);
      const doPreprocess = boolFlag(runArgs, "preprocess", false);
      const genModel = strFlag(runArgs, "gen-model", defaultConfig.generationModel)!;

      const scenarioAbs = resolve(scenarioPath);
      let scenarioContent = await readFile(scenarioAbs, "utf8");
      const glossaryPath = resolveGlossaryPath(strFlag(runArgs, "glossary"));
      if (glossaryPath) {
        const glossary = await readJsonFile<GlossaryFile>(glossaryPath);
        const applied = applyGlossaryToMarkdown(scenarioContent, glossary);
        scenarioContent = applied.content;
        if (applied.replacements.length > 0) {
          logger.info(
            `Glossaire appliqué: ${glossaryPath} (${applied.replacements.reduce((a, b) => a + b.count, 0)} remplacements)`,
          );
        }
      }

      if (!boolFlag(runArgs, "no-validate", false)) {
        const validation = validateScenarioContent(scenarioContent);
        if (validation.total === 0) {
          throw new Error("Validation échouée: aucun step détecté dans le scénario.");
        }
        if (validation.unknowns.length > 0) {
          const preview = validation.unknowns
            .slice(0, 5)
            .map((u) => `[${u.index}] ${u.raw}`)
            .join(" | ");
          throw new Error(
            `Validation échouée: ${validation.unknowns.length} step(s) unknown. ${preview}. ` +
              `Corrigez le scénario ou utilisez --no-validate pour ignorer ce contrôle.`,
          );
        }
        logger.info(`Validation scénario: OK (${validation.total} step(s), 0 unknown).`);
      }

      const steps = stepsFromMarkdown(scenarioContent);
      const gotoStep = steps.find((s) => s.kind === "goto") as
        | { kind: "goto"; url: string }
        | undefined;
      const url = urlOverride ?? gotoStep?.url;

      // ── 1/3  Map ──────────────────────────────────────────────────────
      let map: MapFile;
      const mapPath = defaultConfig.mapPath;

      if (noMap && existsSync(resolve(mapPath))) {
        logger.info(`[1/3] Réutilisation de la map: ${mapPath}`);
        map = await readJsonFile<MapFile>(mapPath);
      } else {
        if (!url) {
          throw new Error(
            'URL introuvable. Ajoutez "Ouvrir https://..." dans le scénario ou passez --url',
          );
        }
        logger.info(`[1/3] Mapping: ${url}`);
        map = await buildMap({
          url,
          ollamaBaseUrl: ollama,
          embeddingModel: embedModel,
          computeEmbeddings: !noEmbeddings,
          maxElements,
          // Mapping headless par défaut pour éviter l'ouverture visuelle de la fenêtre.
          // Peut être surchargé via --map-headed.
          headed: mapHeaded,
        });
        await writeJsonFile(mapPath, map);
        logger.info(`      → ${mapPath} (${map.elements.length} éléments)`);
      }

      // ── 2/3  Compile ──────────────────────────────────────────────────
      logger.info(`[2/3] Compilation: ${scenarioPath}`);
      const baseName = scenarioPath
        .split(/[\\/]/)
        .pop()!
        .replace(/\.\w+$/, "");
      const cases = extractTestCases(scenarioContent, baseName);

      const baseImportOverride = strFlag(runArgs, "base-import");
      const hasLocalBase = existsSync(resolve("tests/_privateqa/base.ts"));
      const resolveBaseImport = (fromFileAbs: string): string | undefined => {
        if (baseImportOverride) return baseImportOverride;
        if (hasLocalBase) {
          const baseAbs = resolve("tests/_privateqa/base");
          const rel = relative(dirname(fromFileAbs), baseAbs);
          const withSlashes = rel.replace(/\\/g, "/");
          return withSlashes.startsWith(".") ? withSlashes : `./${withSlashes}`;
        }
        return undefined;
      };

      const pivot = doPreprocess
        ? await preprocessScenarioToPivot({
            scenarioPath,
            scenarioContent,
            ollamaBaseUrl: ollama,
            generationModel: genModel,
            noAI,
          })
        : undefined;

      const specFiles: string[] = [];
      const singleSpecPath = resolve(defaultConfig.generatedTestsDir, `${baseName}.spec.ts`);
      const multiSpecDir = resolve(defaultConfig.generatedTestsDir, baseName);

      if (cases.length <= 1) {
        const out = singleSpecPath;
        const spec = await compileToSpec({
          scenarioPath,
          scenarioContent: cases[0]?.content ?? scenarioContent,
          steps: pivot?.cases[0]?.steps,
          map,
          ollamaBaseUrl: ollama,
          embeddingModel: embedModel,
          testTitle: cases[0]?.title,
          baseTestImportPath: resolveBaseImport(resolve(out)),
        });
        await rmIfExists(multiSpecDir);
        await writeTextFile(out, spec);
        specFiles.push(out);
      } else {
        await rmIfExists(singleSpecPath);
        await rmIfExists(multiSpecDir);
        for (const [i, tc] of cases.entries()) {
          const slug = slugify(tc.title) || `test-${i + 1}`;
          const file = resolve(multiSpecDir, `${String(i + 1).padStart(2, "0")}-${slug}.spec.ts`);
          const spec = await compileToSpec({
            scenarioPath,
            scenarioContent: tc.content,
            steps: pivot?.cases[i]?.steps,
            map,
            ollamaBaseUrl: ollama,
            embeddingModel: embedModel,
            testTitle: tc.title,
            baseTestImportPath: resolveBaseImport(resolve(file)),
          });
          await writeTextFile(file, spec);
          specFiles.push(file);
        }
      }
      logger.info(`      → ${specFiles.length} spec(s) générée(s)`);

      // ── 3/3  Execute ──────────────────────────────────────────────────
      logger.info("[3/3] Exécution des tests...");
      const relPaths = specFiles.map((f) => relative(process.cwd(), f).replace(/\\/g, "/"));
      const noOpen = boolFlag(runArgs, "no-open", false);
      const exitCode = await runPlaywrightWithPrivateqaReporter(relPaths, env);

      // Ouvre le rapport par défaut (sauf --no-open).
      // --reporter est conservé pour compatibilité/explicitation.
      const openReporter = boolFlag(runArgs, "reporter", true);
      if (!noOpen && openReporter && existsSync(REPORT_HTML)) {
        logger.info(`Rapport: ${REPORT_HTML}`);
        await openFile(REPORT_HTML);
      }

      if (exitCode !== 0) {
        throw new Error(`Tests terminés avec le code ${exitCode}`);
      }
    } else {
      const extra = runArgs._;
      const child = spawn("npx", ["playwright", "test", ...extra], {
        stdio: "inherit",
        shell: true,
        env,
      });
      await new Promise<void>((res, rej) => {
        child.on("exit", (code) =>
          code === 0 ? res() : rej(new Error(`playwright test exit ${code}`)),
        );
        child.on("error", rej);
      });
    }
    return;
  }

  if (cmd === "run-generated") {
    const runArgs = parseArgs(process.argv.slice(3));
    const headed = boolFlag(runArgs, "headed", false);
    const headless = boolFlag(runArgs, "headless", false);
    const noOpen = boolFlag(runArgs, "no-open", false);
    const openReporter = boolFlag(runArgs, "reporter", true);

    const env = { ...process.env };
    env.HEADLESS = "true";
    if (headed) env.HEADLESS = "false";
    if (headless) env.HEADLESS = "true";

    ensureBrowser(logger);

    // Par défaut, cible le dossier généré; sinon accepte un fichier/dossier passé en argument.
    const targetsRaw = runArgs._.length > 0 ? runArgs._ : [defaultConfig.generatedTestsDir];
    const targets = sanitizeRunTargets(targetsRaw);
    if (targets.length === 0) {
      throw new Error(
        "Aucune cible de test valide après filtrage des wildcards. Retirez l'argument `*`.",
      );
    }
    logger.info(`Exécution des tests générés: ${targets.join(", ")}`);

    const exitCode = await runPlaywrightWithPrivateqaReporter(targets, env);

    if (!noOpen && openReporter && existsSync(REPORT_HTML)) {
      logger.info(`Rapport: ${REPORT_HTML}`);
      await openFile(REPORT_HTML);
    }

    if (exitCode !== 0) {
      throw new Error(`Tests terminés avec le code ${exitCode}`);
    }
    return;
  }

  if (cmd === "report") {
    const input = strFlag(args, "input", "test-output/summary.json")!;
    const out = strFlag(args, "out", "test-output/report.html")!;
    const template = strFlag(args, "template", resolve("templates", "report.html"))!;

    logger.info(`Lecture du résumé: ${input}`);
    const summaryRaw = await readFile(resolve(input), "utf8");
    const summary = JSON.parse(summaryRaw);

    logger.info(`Lecture du template: ${template}`);
    const tpl = await readFile(resolve(template), "utf8");

    const injection = `<script>var __REPORT_DATA__ = ${JSON.stringify(summary)};</script>`;
    const html = tpl.replace("</head>", `${injection}\n</head>`);

    await writeTextFile(out, html);
    logger.info(`Rapport HTML généré: ${out}`);
    return;
  }

  if (cmd === "evolution") {
    const historyFile = strFlag(args, "history", ".privateqa/history.json")!;
    const out = strFlag(args, "out", "test-output/evolution.html")!;
    const template = strFlag(args, "template", resolve("templates", "evolution.html"))!;

    logger.info(`Lecture de l'historique: ${historyFile}`);
    const historyRaw = await readFile(resolve(historyFile), "utf8");
    const history = JSON.parse(historyRaw);

    logger.info(`Lecture du template: ${template}`);
    const tpl = await readFile(resolve(template), "utf8");

    const injection = `<script>var __HISTORY_DATA__ = ${JSON.stringify(history)};</script>`;
    const html = tpl.replace("</head>", `${injection}\n</head>`);

    await writeTextFile(out, html);
    logger.info(`Rapport évolution HTML généré: ${out} (${Array.isArray(history) ? history.length : 0} runs)`);
    return;
  }

  help();
  process.exit(1);
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});

