import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

const OUTPUT_ROOT = process.env.TEST_OUTPUT_DIR ?? "test-output";

function safeName(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function ensureDir(p: string) {
  await mkdir(p, { recursive: true });
}

function screenshotPath(testInfo: TestInfo, kind: "success" | "failed", suffix?: string) {
  const fileBase = safeName(testInfo.title) || "test";
  const file = suffix ? `${fileBase}-${suffix}.png` : `${fileBase}.png`;
  return path.join(OUTPUT_ROOT, "screenshots", kind, file);
}

function logPath(testInfo: TestInfo) {
  const fileBase = safeName(testInfo.title) || "test";
  return path.join(OUTPUT_ROOT, "logs", `${fileBase}.json`);
}

// ── Types ───────────────────────────────────────────────────────────────────

type RuntimeLogs = {
  console: Array<{ type: string; text: string; location?: string }>;
  pageErrors: Array<{ message: string }>;
  requestFailed: Array<{ url: string; method: string; failure?: string }>;
};

export type StepResult = {
  index: number;
  label: string;
  status: "passed" | "failed";
  durationMs: number;
  screenshot?: string;
  error?: { message: string; stack?: string };
};

// ── Registre interne par test (pas besoin de modifier les specs) ────────────

const stepsRegistry = new Map<string, StepResult[]>();

/** Retourne (ou crée) le tableau de steps pour un test donné. */
function getSteps(testInfo: TestInfo): StepResult[] {
  const key = testInfo.testId;
  if (!stepsRegistry.has(key)) stepsRegistry.set(key, []);
  return stepsRegistry.get(key)!;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export const test = base.extend<{ _fwkLogs: RuntimeLogs }>({
  _fwkLogs: async ({ page }, use) => {
    const logs: RuntimeLogs = { console: [], pageErrors: [], requestFailed: [] };

    page.on("console", (msg) => {
      logs.console.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location()?.url,
      });
    });
    page.on("pageerror", (err) => logs.pageErrors.push({ message: String(err) }));
    page.on("requestfailed", (req) => {
      logs.requestFailed.push({
        url: req.url(),
        method: req.method(),
        failure: req.failure()?.errorText,
      });
    });

    await use(logs);
  },
});

// ── afterEach : log global avec détail par step ─────────────────────────────

test.afterEach(async ({ page, _fwkLogs }, testInfo) => {
  const steps = getSteps(testInfo);
  const kind: "success" | "failed" = testInfo.status === "passed" ? "success" : "failed";

  const ssDir = path.join(OUTPUT_ROOT, "screenshots", kind);
  const logsDir = path.join(OUTPUT_ROOT, "logs");
  await Promise.all([ensureDir(ssDir), ensureDir(logsDir)]);

  // Screenshot final du test
  let screenshot: string | undefined;
  try {
    screenshot = screenshotPath(testInfo, kind);
    await page.screenshot({ path: screenshot, fullPage: true });
    await testInfo.attach("screenshot", { path: screenshot, contentType: "image/png" });
  } catch {
    screenshot = undefined;
  }

  const err = testInfo.error
    ? { message: testInfo.error.message, stack: testInfo.error.stack }
    : undefined;

  // Résumé par step
  const stepsTotal = steps.length;
  const stepsPassed = steps.filter((s) => s.status === "passed").length;
  const stepsFailed = steps.filter((s) => s.status === "failed").length;

  const record = {
    title: testInfo.title,
    file: testInfo.file,
    project: testInfo.project.name,
    status: testInfo.status,
    durationMs: testInfo.duration,
    error: err,
    screenshot,
    steps: {
      total: stepsTotal,
      passed: stepsPassed,
      failed: stepsFailed,
      details: steps,
    },
    logs: _fwkLogs,
    attachments: testInfo.attachments.map((a) => ({
      name: a.name,
      contentType: a.contentType,
      path: a.path,
    })),
    endedAt: new Date().toISOString(),
  };

  // Attacher le JSON des steps pour que le reporter puisse aussi le lire
  await testInfo.attach("fwk-steps", {
    body: Buffer.from(JSON.stringify(steps)),
    contentType: "application/json",
  });

  await writeFile(logPath(testInfo), JSON.stringify(record, null, 2), "utf8");

  // Nettoyage du registre (libère la mémoire)
  stepsRegistry.delete(testInfo.testId);
});

// ── fwkStep : exécute une étape avec tracking complet ───────────────────────

/**
 * Exécute une étape du scénario en capturant systématiquement :
 * - un screenshot (succès ET échec)
 * - la durée
 * - le statut
 * - l'erreur éventuelle
 *
 * Les résultats sont accumulés dans un registre interne par test,
 * puis écrits dans le log JSON et transmis au reporter via un attachment.
 */
export async function fwkStep(
  testInfo: TestInfo,
  page: Page,
  stepIndex: number,
  label: string,
  fn: () => Promise<void>,
) {
  const steps = getSteps(testInfo);
  const t0 = Date.now();
  const suffix = `step-${String(stepIndex).padStart(2, "0")}`;

  await base.step(label, async () => {
    try {
      await fn();

      // ── Succès ──
      const durationMs = Date.now() - t0;
      const ssDir = path.join(OUTPUT_ROOT, "screenshots", "success");
      await ensureDir(ssDir);
      const ss = screenshotPath(testInfo, "success", suffix);
      let shotPath: string | undefined;
      try {
        await page.screenshot({ path: ss, fullPage: true });
        await testInfo.attach(`step-${stepIndex}`, { path: ss, contentType: "image/png" });
        shotPath = ss;
      } catch {
        // ignore screenshot failure
      }

      steps.push({
        index: stepIndex,
        label,
        status: "passed",
        durationMs,
        screenshot: shotPath,
      });
    } catch (e) {
      // ── Échec ──
      const durationMs = Date.now() - t0;
      const ssDir = path.join(OUTPUT_ROOT, "screenshots", "failed");
      await ensureDir(ssDir);
      const ss = screenshotPath(testInfo, "failed", suffix);
      let shotPath: string | undefined;
      try {
        await page.screenshot({ path: ss, fullPage: true });
        await testInfo.attach(`step-${stepIndex}`, { path: ss, contentType: "image/png" });
        shotPath = ss;
      } catch {
        // ignore screenshot failure
      }
      const errorObj = {
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      };
      await testInfo.attach(`step-${stepIndex}-error`, {
        body: Buffer.from(errorObj.message),
        contentType: "text/plain",
      });

      steps.push({
        index: stepIndex,
        label,
        status: "failed",
        durationMs,
        screenshot: shotPath,
        error: errorObj,
      });

      throw e;
    }
  });
}

export { expect };
