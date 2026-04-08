import type { Page, TestInfo } from "@playwright/test";

// ── Types publics du contrat Plugin ─────────────────────────────────────────

export type StepContext = {
  page: Page;
  testInfo: TestInfo;
  stepIndex: number;
  label: string;
  /** Fonction originale du step (permet un retry identique) */
  fn: () => Promise<void>;
  error: Error;
  /** Screenshot capturé automatiquement au moment de l'échec */
  screenshotPath?: string;
};

export type StepInterceptorResult =
  | { action: "retry"; newFn?: () => Promise<void> }
  | { action: "skip"; reason: string }
  | { action: "fail" };

export type QAPlugin = {
  name: string;
  /** Appelé quand un step échoue, AVANT le rethrow — peut décider de retry/skip/fail */
  onStepFailure?: (ctx: StepContext) => Promise<StepInterceptorResult>;
  /** Appelé au démarrage de chaque test */
  onTestBegin?: (page: Page, testInfo: TestInfo) => Promise<void>;
  /** Appelé à la fin de chaque test */
  onTestEnd?: (page: Page, testInfo: TestInfo) => Promise<void>;
};

// ── Registre singleton ──────────────────────────────────────────────────────

const plugins: QAPlugin[] = [];

export function registerPlugin(plugin: QAPlugin): void {
  if (plugins.some((p) => p.name === plugin.name)) return;
  plugins.push(plugin);
}

export function getPlugins(): readonly QAPlugin[] {
  return plugins;
}

export function clearPlugins(): void {
  plugins.length = 0;
}
