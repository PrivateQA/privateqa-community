#!/usr/bin/env node
import "./core/env.js";
import { readFile, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { defaultConfig } from "./core/config.js";
import { buildMap } from "./agents/mapper/mapper.js";
import { compileToSpec } from "./agents/builder/builder.js";
import { preprocessScenarioToPivot } from "./agents/preprocessor/preprocessor.js";
import { readJsonFile, writeJsonFile, writeTextFile } from "./utils/fs.js";
import { createLogger, type LogLevel } from "./utils/logger.js";
import type { MapFile } from "./infrastructure/store.js";
import { extractTestCases, slugify } from "./utils/scenario.js";

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

function help() {
  console.log(`
fwkTest (MVP)

Commandes:
  fwkTest map <url> [--out .fwkTest/map.json] [--ollama http://127.0.0.1:11434] [--embed-model nomic-embed-text] [--no-embeddings] [--max 200] [--headed]
  fwkTest preprocess <scenario.md> [--out .fwkTest/pivot.json] [--ollama ...] [--model mistral] [--no-ai]
  fwkTest compile <scenario.md> [--map .fwkTest/map.json] [--out <fichier.spec.ts|dossier>] [--ollama ...] [--embed-model ...]
                  [--preprocess] [--gen-model mistral] [--no-ai]
  fwkTest run [--headed|--headless] [args...]
  fwkTest report [--input test-output/summary.json] [--out test-output/report.html] [--template templates/report.html]
  fwkTest evolution [--history .fwkTest/history.json] [--out test-output/evolution.html] [--template templates/evolution.html]
  fwkTest api [--port 3000]

Exemples:
  npm run map -- https://example.com
  npm run dev -- preprocess scenario.md --out .fwkTest/scenario.pivot.json
  npm run compile -- examples/demo.md
  npm test
  npm run run -- --headed
  npm run api
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
    if (!url) throw new Error("map: URL manquante. Ex: fwkTest map https://example.com");

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
    if (!scenarioPath) throw new Error("compile: scénario manquant. Ex: fwkTest compile examples/demo.md");

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
    const scenarioContent = await readFile(scenarioAbs, "utf8");

    const baseName = scenarioPath.split(/[\\/]/).pop()!.replace(/\.\w+$/, "");
    const cases = extractTestCases(scenarioContent, baseName);
    const baseAbs = resolve("tests/_fwkTest/base");
    const toImportPath = (fromFileAbs: string) => {
      const rel = relative(dirname(fromFileAbs), baseAbs);
      const withSlashes = rel.replace(/\\/g, "/");
      return withSlashes.startsWith(".") ? withSlashes : `./${withSlashes}`;
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
      const baseImport = toImportPath(resolve(out));
      const spec = await compileToSpec({
        scenarioPath,
        scenarioContent: cases[0]?.content ?? scenarioContent,
        steps: pivot?.cases[0]?.steps,
        map,
        ollamaBaseUrl: ollama,
        embeddingModel: embedModel,
        testTitle: cases[0]?.title,
        baseTestImportPath: baseImport,
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
      const baseImport = toImportPath(resolve(file));
      const spec = await compileToSpec({
        scenarioPath,
        scenarioContent: tc.content,
        steps: pivot?.cases[i]?.steps,
        map,
        ollamaBaseUrl: ollama,
        embeddingModel: embedModel,
        testTitle: tc.title,
        baseTestImportPath: baseImport,
      });
      await writeTextFile(file, spec);
    }
    logger.info(`Specs générées: ${cases.length}`);
    return;
  }

  if (cmd === "preprocess") {
    const scenarioPath = args._[1] ?? strFlag(args, "scenario");
    if (!scenarioPath) throw new Error("preprocess: scénario manquant. Ex: fwkTest preprocess scenario.md");

    const out = strFlag(args, "out", resolve(".fwkTest", "pivot.json"))!;
    const ollama = strFlag(args, "ollama", defaultConfig.ollamaBaseUrl)!;
    const model = strFlag(args, "model", defaultConfig.generationModel)!;
    const noAI = boolFlag(args, "no-ai", false);

    const scenarioAbs = resolve(scenarioPath);
    logger.info(`Lecture scénario: ${scenarioAbs}`);
    const scenarioContent = await readFile(scenarioAbs, "utf8");

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

  if (cmd === "run") {
    // keep raw args after "run", but allow a couple of flags
    const raw = process.argv.slice(3);
    const runArgs = parseArgs(raw);
    const headed = boolFlag(runArgs, "headed", false);
    const headless = boolFlag(runArgs, "headless", false);
    const extra = runArgs._; // positional only

    const env = { ...process.env };
    if (headed) env.HEADLESS = "false";
    if (headless) env.HEADLESS = "true";

    const child = spawn("npx", ["playwright", "test", ...extra], {
      stdio: "inherit",
      shell: true,
      env,
    });
    await new Promise<void>((res, rej) => {
      child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`playwright test exit ${code}`))));
      child.on("error", rej);
    });
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
    const historyFile = strFlag(args, "history", ".fwkTest/history.json")!;
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

