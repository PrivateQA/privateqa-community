import "dotenv/config";
import { mkdir, readFile, writeFile, appendFile, access, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUTPUT_ROOT = process.env.TEST_OUTPUT_DIR ?? "test-output";

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function resetDirSafe(dir) {
  const abs = path.resolve(String(dir || ""));
  const cwd = path.resolve(process.cwd());
  if (!abs || abs === path.parse(abs).root) {
    throw new Error(`Refus de supprimer un dossier dangereux: "${abs}"`);
  }
  if (!abs.startsWith(cwd + path.sep) && abs !== cwd) {
    throw new Error(`Refus de supprimer un dossier hors workspace: "${abs}"`);
  }
  await rm(abs, { recursive: true, force: true });
}

function safeName(input) {
  return String(input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function stripAnsi(s) {
  return String(s ?? "").replace(/\u001b\[[0-9;]*m/g, "");
}

function shortError(msg) {
  const clean = stripAnsi(msg);
  const first = clean.split(/\r?\n/).find(Boolean);
  return (first ?? clean).trim();
}

function pickAttachment(attachments, name) {
  return attachments?.find((x) => x.name === name && x.path)?.path;
}

/**
 * Extrait les résultats par step depuis l'attachement JSON "qa-steps"
 * que base.ts attache à chaque test.
 */
function extractStepsFromAttachments(attachments) {
  const att = attachments?.find(
    (a) => a.name === "qa-steps" && a.contentType === "application/json",
  );
  if (!att?.body) return [];
  try {
    const raw = typeof att.body === "string" ? att.body : att.body.toString("utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

const HISTORY_DIR = process.env.PRIVATEQA_DATA_DIR ?? ".privateqa";

export default class PrivateQAReporter {
  constructor() {
    this.results = [];
    this.jsonlPath = path.join(OUTPUT_ROOT, "run.jsonl");
    this.summaryPath = path.join(OUTPUT_ROOT, "summary.json");
    this.summaryMdPath = path.join(OUTPUT_ROOT, "summary.md");
    this.reportHtmlPath = path.join(OUTPUT_ROOT, "report.html");
    this.evolutionHtmlPath = path.join(OUTPUT_ROOT, "evolution.html");
    this.historyPath = path.join(HISTORY_DIR, "history.json");

    // Chemin des templates HTML (relatif au fichier reporter)
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    this.templatePath = path.join(__dirname, "templates", "report.html");
    this.evolutionTemplatePath = path.join(__dirname, "templates", "evolution.html");
  }

  async onBegin() {
    await resetDirSafe(OUTPUT_ROOT);
    await ensureDir(OUTPUT_ROOT);
    await ensureDir(path.join(OUTPUT_ROOT, ".playwright"));
    await writeFile(this.jsonlPath, "", "utf8");
  }

  async onTestEnd(test, result) {
    const titlePath =
      typeof test.titlePath === "function" ? test.titlePath() : [test.title];

    // Extraire les résultats par step
    const steps = extractStepsFromAttachments(result.attachments);
    const stepsTotal = steps.length;
    const stepsPassed = steps.filter((s) => s.status === "passed").length;
    const stepsFailed = steps.filter((s) => s.status === "failed").length;

    // Screenshot final (posé par base.ts dans afterEach)
    const base = safeName(test.title) || "test";
    const kind = result.status === "passed" ? "success" : "failed";
    const mainShot = path.join(OUTPUT_ROOT, "screenshots", kind, `${base}.png`);
    const mainShotExists = await exists(mainShot);

    // Collecter les screenshots step
    const stepScreenshots = [];
    for (const s of steps) {
      if (s.screenshot && (await exists(s.screenshot))) {
        stepScreenshots.push(s.screenshot);
      }
    }

    const record = {
      title: test.title,
      titlePath,
      file: test.location?.file,
      line: test.location?.line,
      column: test.location?.column,
      status: result.status,
      durationMs: result.duration,
      error: result.error
        ? { message: result.error.message, stack: result.error.stack }
        : undefined,
      screenshot: mainShotExists
        ? mainShot
        : pickAttachment(result.attachments, "screenshot"),
      steps: {
        total: stepsTotal,
        passed: stepsPassed,
        failed: stepsFailed,
        details: steps.map((s) => ({
          index: s.index,
          label: s.label,
          status: s.status,
          durationMs: s.durationMs,
          screenshot: s.screenshot,
          error: s.error,
        })),
      },
      stepScreenshots,
      endedAt: new Date().toISOString(),
    };

    this.results.push(record);
    await appendFile(this.jsonlPath, JSON.stringify(record) + "\n", "utf8");
  }

  async onEnd() {
    await ensureDir(OUTPUT_ROOT);

    const passed = this.results.filter((r) => r.status === "passed").length;
    const failed = this.results.filter((r) => r.status === "failed").length;
    const skipped = this.results.filter((r) => r.status === "skipped").length;
    const timedOut = this.results.filter((r) => r.status === "timedOut").length;

    // Totaux steps toutes specs confondues
    const totalSteps = this.results.reduce(
      (acc, r) => acc + (r.steps?.total ?? 0),
      0,
    );
    const totalStepsPassed = this.results.reduce(
      (acc, r) => acc + (r.steps?.passed ?? 0),
      0,
    );
    const totalStepsFailed = this.results.reduce(
      (acc, r) => acc + (r.steps?.failed ?? 0),
      0,
    );

    const summary = {
      totals: {
        tests: this.results.length,
        passed,
        failed,
        skipped,
        timedOut,
        steps: totalSteps,
        stepsPassed: totalStepsPassed,
        stepsFailed: totalStepsFailed,
      },
      results: this.results,
      version: process.env.TEST_VERSION || undefined,
      generatedAt: new Date().toISOString(),
    };

    await writeFile(this.summaryPath, JSON.stringify(summary, null, 2), "utf8");

    // ── summary.md ──────────────────────────────────────────────────────────
    const md = [];
    md.push(`# privateqa - Résumé d'exécution`);
    md.push("");
    md.push(`| Métrique | Valeur |`);
    md.push(`|----------|--------|`);
    md.push(`| Tests    | ${summary.totals.tests} |`);
    md.push(`| Passed   | ${passed} |`);
    md.push(`| Failed   | ${failed} |`);
    md.push(`| Skipped  | ${skipped} |`);
    md.push(`| TimedOut | ${timedOut} |`);
    md.push(`| Étapes (total) | ${totalSteps} |`);
    md.push(`| Étapes passed  | ${totalStepsPassed} |`);
    md.push(`| Étapes failed  | ${totalStepsFailed} |`);
    md.push("");

    for (const r of this.results) {
      const icon = r.status === "passed" ? "✅" : r.status === "failed" ? "❌" : "⏭️";
      md.push(`## ${icon} ${r.title}`);
      md.push("");
      md.push(`- **Statut** : ${r.status.toUpperCase()}`);
      md.push(`- **Durée** : ${r.durationMs}ms`);
      if (r.error?.message) {
        md.push(
          `- **Erreur** : \`${shortError(r.error.message).replace(/`/g, "'")}\``,
        );
      }
      if (r.screenshot) {
        md.push(
          `- **Screenshot final** : \`${path.relative(process.cwd(), r.screenshot)}\``,
        );
      }
      md.push("");

      if (r.steps?.details?.length) {
        md.push(`### Étapes (${r.steps.passed}/${r.steps.total} passed)`);
        md.push("");
        md.push(`| # | Étape | Statut | Durée | Screenshot |`);
        md.push(`|---|-------|--------|-------|------------|`);
        for (const s of r.steps.details) {
          const sIcon = s.status === "passed" ? "✅" : "❌";
          const ssRel = s.screenshot
            ? `\`${path.relative(process.cwd(), s.screenshot)}\``
            : "-";
          const errNote = s.error
            ? ` — \`${shortError(s.error.message).replace(/`/g, "'")}\``
            : "";
          md.push(
            `| ${s.index} | ${s.label}${errNote} | ${sIcon} ${s.status} | ${s.durationMs}ms | ${ssRel} |`,
          );
        }
        md.push("");
      }
    }

    await writeFile(this.summaryMdPath, md.join("\n"), "utf8");

    // ── report.html ─────────────────────────────────────────────────────────
    await this.generateHtmlReport(summary);

    // ── history.json + evolution.html (uniquement avec --save) ────────────
    if (process.env.PRIVATEQA_SAVE_HISTORY === "1") {
      await this.appendToHistory(summary);
      await this.generateEvolutionReport();
      console.log("[privateqa] Run sauvegardé dans l'historique d'évolution.");
    }
  }

  /** Ajoute le run courant à l'historique persistant (.privateqa/history.json) */
  async appendToHistory(summary) {
    try {
      await ensureDir(HISTORY_DIR);

      let history = [];
      try {
        const raw = await readFile(this.historyPath, "utf8");
        history = JSON.parse(raw);
        if (!Array.isArray(history)) history = [];
      } catch {
        // Fichier inexistant ou corrompu — on repart de zéro
      }

      const totalDuration = summary.results.reduce(
        (a, r) => a + (r.durationMs || 0),
        0,
      );

      history.push({
        date: summary.generatedAt,
        version: summary.version || null,
        totals: { ...summary.totals },
        durationMs: totalDuration,
      });

      await writeFile(this.historyPath, JSON.stringify(history, null, 2), "utf8");
    } catch (err) {
      console.warn(
        `[privateqa] Impossible de mettre à jour l'historique: ${err.message}`,
      );
    }
  }

  /** Génère evolution.html à partir du template + history.json */
  async generateEvolutionReport() {
    try {
      const [template, historyRaw] = await Promise.all([
        readFile(this.evolutionTemplatePath, "utf8"),
        readFile(this.historyPath, "utf8"),
      ]);
      const history = JSON.parse(historyRaw);

      const injection = `<script>var __HISTORY_DATA__ = ${JSON.stringify(history)};</script>`;
      const html = template.replace("</head>", `${injection}\n</head>`);

      await writeFile(this.evolutionHtmlPath, html, "utf8");
    } catch (err) {
      console.warn(
        `[privateqa] Impossible de générer evolution.html: ${err.message}`,
      );
    }
  }

  async generateHtmlReport(summary) {
    try {
      const template = await readFile(this.templatePath, "utf8");

      // Injecte les données JSON directement dans le HTML avant le loadReport()
      const injection = `<script>var __REPORT_DATA__ = ${JSON.stringify(summary)};</script>`;
      const html = template.replace("</head>", `${injection}\n</head>`);

      await writeFile(this.reportHtmlPath, html, "utf8");
    } catch (err) {
      // Si le template n'est pas trouvé, log un warning mais ne crash pas
      console.warn(
        `[privateqa] ⚠️  Impossible de générer report.html: ${err.message}`,
      );
    }
  }
}
