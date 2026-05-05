import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test as base } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

import { getPlugins } from "./core/plugin.js";
import type { StepContext } from "./core/plugin.js";
import { enrichErrorMessage, isLocatorError, stripAnsi } from "./core/errors.js";

export { registerPlugin, clearPlugins, getPlugins } from "./core/plugin.js";
export type { QAPlugin, StepContext, StepInterceptorResult } from "./core/plugin.js";

const OUTPUT_ROOT = process.env.TEST_OUTPUT_DIR ?? "test-output";
const MAX_HEAL_RETRIES = Number(process.env.PRIVATEQA_MAX_RETRIES ?? 1);
const KEEP_TAB_BETWEEN_TESTS = (process.env.PRIVATEQA_KEEP_TAB ?? "true").toLowerCase() === "true";
const DEBUG_HEAL = (process.env.PRIVATEQA_DEBUG_HEAL ?? "false").toLowerCase() === "true";
const HEAL_DEBUG_LOG_PATH = path.join(OUTPUT_ROOT, "logs", "heal-debug.log");

// En mode "keep tab", on réutilise la même page entre tests (même worker).
// Avec PRIVATEQA_SINGLE_BROWSER=true (défaut), cela couvre toute l'exécution.
let sharedContext: import("@playwright/test").BrowserContext | undefined;
let sharedPage: Page | undefined;

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

async function debugLog(testInfo: TestInfo, message: string) {
  if (!DEBUG_HEAL) return;
  const line = `${new Date().toISOString()} [${testInfo.title}] ${message}`;
  const logsDir = path.join(OUTPUT_ROOT, "logs");
  await ensureDir(logsDir);
  await appendFile(HEAL_DEBUG_LOG_PATH, `${line}\n`, "utf8");
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
  debug: string[];
};

export type StepResult = {
  index: number;
  label: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number;
  screenshot?: string;
  error?: { message: string; stack?: string };
  healedOnAttempt?: number;
};

// ── Registre interne par test ───────────────────────────────────────────────

const stepsRegistry = new Map<string, StepResult[]>();

function getSteps(testInfo: TestInfo): StepResult[] {
  const key = testInfo.testId;
  if (!stepsRegistry.has(key)) stepsRegistry.set(key, []);
  return stepsRegistry.get(key)!;
}

// ── Helpers internes ────────────────────────────────────────────────────────

function toErrorObj(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) return { message: stripAnsi(e.message), stack: e.stack };
  return { message: stripAnsi(String(e)) };
}

async function safeScreenshot(
  testInfo: TestInfo,
  page: Page,
  kind: "success" | "failed",
  suffix: string,
): Promise<string | undefined> {
  try {
    const dir = path.join(OUTPUT_ROOT, "screenshots", kind);
    await ensureDir(dir);
    const ss = screenshotPath(testInfo, kind, suffix);
    await page.screenshot({ path: ss, fullPage: true });
    await testInfo.attach(`${suffix}`, { path: ss, contentType: "image/png" });
    return ss;
  } catch {
    return undefined;
  }
}

async function attachError(testInfo: TestInfo, stepIndex: number, err: { message: string }) {
  try {
    await testInfo.attach(`step-${stepIndex}-error`, {
      body: Buffer.from(err.message),
      contentType: "text/plain",
    });
  } catch {
    // silencieux
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

export const test = base.extend<{ _qaLogs: RuntimeLogs }>({
  page: async ({ browser }, use) => {
    if (!KEEP_TAB_BETWEEN_TESTS) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await use(page);
      } finally {
        await context.close();
      }
      return;
    }

    if (!sharedContext) sharedContext = await browser.newContext();
    if (!sharedPage || sharedPage.isClosed()) sharedPage = await sharedContext.newPage();
    await use(sharedPage);
  },
  _qaLogs: async ({ page }, use, testInfo) => {
    const logs: RuntimeLogs = { console: [], pageErrors: [], requestFailed: [], debug: [] };

    const onConsole = (msg: import("@playwright/test").ConsoleMessage) => {
      logs.console.push({
        type: msg.type(),
        text: msg.text(),
        location: msg.location()?.url,
      });
    };
    const onPageError = (err: Error) => logs.pageErrors.push({ message: String(err) });
    const onRequestFailed = (req: import("@playwright/test").Request) => {
      logs.requestFailed.push({
        url: req.url(),
        method: req.method(),
        failure: req.failure()?.errorText,
      });
    };

    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("requestfailed", onRequestFailed);

    for (const plugin of getPlugins()) {
      if (plugin.onTestBegin) await plugin.onTestBegin(page, testInfo);
    }
    if (DEBUG_HEAL) {
      const pluginNames = getPlugins().map((p) => p.name).join(", ") || "(none)";
      const line = `[qa-debug] test-begin title="${testInfo.title}" plugins=${pluginNames} maxRetries=${MAX_HEAL_RETRIES}`;
      logs.debug.push(line);
      await debugLog(testInfo, line);
    }

    try {
      await use(logs);
    } finally {
      // Important quand la même page est réutilisée entre tests.
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("requestfailed", onRequestFailed);
    }

    for (const plugin of getPlugins()) {
      if (plugin.onTestEnd) await plugin.onTestEnd(page, testInfo);
    }
  },
});

// ── afterEach : log global avec détail par step ─────────────────────────────

test.afterEach(async ({ page, _qaLogs }, testInfo) => {
  const steps = getSteps(testInfo);
  const kind: "success" | "failed" = testInfo.status === "passed" ? "success" : "failed";

  const ssDir = path.join(OUTPUT_ROOT, "screenshots", kind);
  const logsDir = path.join(OUTPUT_ROOT, "logs");
  await Promise.all([ensureDir(ssDir), ensureDir(logsDir)]);

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

  const stepsTotal = steps.length;
  const stepsPassed = steps.filter((s) => s.status === "passed").length;
  const stepsFailed = steps.filter((s) => s.status === "failed").length;
  const stepsHealed = steps.filter((s) => s.healedOnAttempt).length;

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
      healed: stepsHealed,
      details: steps,
    },
    logs: _qaLogs,
    attachments: testInfo.attachments.map((a) => ({
      name: a.name,
      contentType: a.contentType,
      path: a.path,
    })),
    endedAt: new Date().toISOString(),
  };

  await testInfo.attach("qa-steps", {
    body: Buffer.from(JSON.stringify(steps)),
    contentType: "application/json",
  });

  await writeFile(logPath(testInfo), JSON.stringify(record, null, 2), "utf8");

  stepsRegistry.delete(testInfo.testId);
});

// ── qaStep : exécute une étape avec pipeline de plugins ────────────────────

export async function qaStep(
  testInfo: TestInfo,
  page: Page,
  stepIndex: number,
  label: string,
  fn: () => Promise<void>,
) {
  const steps = getSteps(testInfo);
  const t0 = Date.now();
  const suffix = `step-${String(stepIndex).padStart(2, "0")}`;
  const plugins = getPlugins();

  await base.step(label, async () => {
    let lastError: unknown;
    let attempt = 0;
    let currentFn = fn;

    while (attempt <= MAX_HEAL_RETRIES) {
      try {
        await currentFn();

        const durationMs = Date.now() - t0;
        const ss = await safeScreenshot(testInfo, page, "success", suffix);
        steps.push({
          index: stepIndex,
          label,
          status: "passed",
          durationMs,
          screenshot: ss,
          ...(attempt > 0 ? { healedOnAttempt: attempt } : {}),
        });
        return;
      } catch (e) {
        lastError = e;
        const durationMs = Date.now() - t0;
        const ss = await safeScreenshot(testInfo, page, "failed", suffix);
        const errorObj = toErrorObj(e);

        const realError = e instanceof Error ? e : new Error(String(e));
        if (DEBUG_HEAL) {
          const isLoc = isLocatorError(realError);
          const pluginNames = plugins.map((p) => p.name).join(", ") || "(none)";
          const entry =
            `[qa-debug] step-failure index=${stepIndex} attempt=${attempt} locatorError=${isLoc} ` +
            `plugins=${pluginNames} message="${stripAnsi(realError.message).slice(0, 300)}"`;
          await debugLog(testInfo, entry);
          await testInfo.attach(`qa-debug-step-${stepIndex}-${attempt}`, {
            body: Buffer.from(entry),
            contentType: "text/plain",
          });
        }
        if (plugins.length === 0 || !isLocatorError(realError)) {
          const enriched = enrichErrorMessage(e);
          await attachError(testInfo, stepIndex, toErrorObj(enriched));
          steps.push({
            index: stepIndex,
            label,
            status: "failed",
            durationMs,
            screenshot: ss,
            error: toErrorObj(enriched),
          });
          throw enriched;
        }

        const ctx: StepContext = {
          page,
          testInfo,
          stepIndex,
          label,
          fn: currentFn,
          error: realError,
          screenshotPath: ss,
        };

        let intercepted = false;
        for (const plugin of plugins) {
          if (!plugin.onStepFailure) continue;
          const result = await plugin.onStepFailure(ctx);
          if (DEBUG_HEAL) {
            const summary =
              `[qa-debug] plugin-result plugin=${plugin.name} step=${stepIndex} attempt=${attempt} ` +
              `action=${result.action}`;
            await debugLog(testInfo, summary);
            await testInfo.attach(`qa-debug-plugin-${stepIndex}-${attempt}-${plugin.name}`, {
              body: Buffer.from(summary),
              contentType: "text/plain",
            });
          }

          if (result.action === "retry" && attempt < MAX_HEAL_RETRIES) {
            currentFn = result.newFn ?? fn;
            intercepted = true;
            if (DEBUG_HEAL) {
              const retryLine = `[qa-debug] retry scheduled step=${stepIndex} nextAttempt=${attempt + 1}`;
              await debugLog(testInfo, retryLine);
              await testInfo.attach(`qa-debug-retry-${stepIndex}-${attempt}`, {
                body: Buffer.from(retryLine),
                contentType: "text/plain",
              });
            }
            break;
          }
          if (result.action === "skip") {
            if (DEBUG_HEAL) {
              await debugLog(testInfo, `[qa-debug] step skipped by plugin step=${stepIndex}`);
            }
            steps.push({
              index: stepIndex,
              label,
              status: "skipped",
              durationMs,
              screenshot: ss,
            });
            return;
          }
        }

        if (!intercepted) {
          if (DEBUG_HEAL) {
            await debugLog(testInfo, `[qa-debug] no plugin intercepted step=${stepIndex} -> fail`);
          }
          await attachError(testInfo, stepIndex, errorObj);
          steps.push({
            index: stepIndex,
            label,
            status: "failed",
            durationMs,
            screenshot: ss,
            error: errorObj,
          });
          throw e;
        }

        attempt++;
      }
    }

    const durationMs = Date.now() - t0;
    const errorObj = toErrorObj(lastError);
    await attachError(testInfo, stepIndex, errorObj);
    steps.push({
      index: stepIndex,
      label,
      status: "failed",
      durationMs,
      error: errorObj,
    });
    throw lastError;
  });
}

export { expect };
