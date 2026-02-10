import { basename, extname } from "node:path";
import type { MapFile, MappedElement } from "../../infrastructure/store.js";
import { LocalVectorStore } from "../../infrastructure/store.js";
import { OllamaClient } from "../../infrastructure/ollama.js";
import type { FwkStep } from "../../core/steps.js";
import { stepsFromMarkdown } from "../../core/steps.js";

export type CompileOptions = {
  scenarioPath: string;
  scenarioContent: string;
  /** Optionnel: permet de bypass le parsing markdown (ex: pivot JSON pré-processé) */
  steps?: FwkStep[];
  map: MapFile;
  ollamaBaseUrl: string;
  embeddingModel?: string;
  testTitle?: string;
  baseTestImportPath?: string;
};

function locatorExpr(el: MappedElement) {
  const q = (v: string) => JSON.stringify(v);
  switch (el.locator.kind) {
    case "testId":
      return `page.getByTestId(${q(el.locator.testId)})`;
    case "role":
      if (el.locator.name) {
        return `page.getByRole(${q(el.locator.role)}, { name: ${q(el.locator.name)} })`;
      }
      return `page.getByRole(${q(el.locator.role)})`;
    case "label":
      return `page.getByLabel(${q(el.locator.label)})`;
    case "text":
      return `page.getByText(${q(el.locator.text)})`;
    case "css":
      return `page.locator(${q(el.locator.selector)})`;
  }
}

function applyIndex(expr: string, index?: number) {
  if (index === undefined) return expr;
  // Convention scénario: [1] = 1ère occurrence (donc nth(0))
  const zeroBased = Math.max(0, index - 1);
  return `${expr}.nth(${zeroBased})`;
}

function escapeRegexChar(c: string) {
  return /[\\^$.*+?()[\]{}|]/.test(c) ? `\\${c}` : c;
}

function toLooseTextRegex(text: string) {
  // - supporte ' et ’
  // - tolère des espaces multiples
  let pattern = "";
  for (const ch of text) {
    if (ch === "'" || ch === "’") {
      pattern += "['’]";
      continue;
    }
    if (/\s/.test(ch)) {
      pattern += "\\s+";
      continue;
    }
    pattern += escapeRegexChar(ch);
  }
  return `/${pattern}/`;
}

async function resolveElement(
  store: LocalVectorStore,
  query: string,
  embedder?: (text: string) => Promise<number[]>,
) {
  if (embedder) {
    try {
      const emb = await embedder(query);
      const best = store.bestMatchByEmbedding(emb);
      if (best && best.score > 0.55) return { ...best, mode: "embedding" as const };
    } catch {
      // ignore
    }
  }
  const best = store.bestMatchByText(query);
  if (!best || best.score <= 0.1) return undefined;
  return { ...best, mode: "text" as const };
}

export async function compileToSpec(opts: CompileOptions) {
  const steps = opts.steps ?? stepsFromMarkdown(opts.scenarioContent);

  const store = LocalVectorStore.from(opts.map);

  const canEmbed = Boolean(opts.embeddingModel && opts.map.elements.some((e) => e.embedding?.length));
  const ollama = canEmbed ? new OllamaClient(opts.ollamaBaseUrl) : undefined;
  const embedder = canEmbed
    ? (text: string) => ollama!.embeddings(opts.embeddingModel!, text)
    : undefined;

  const lines: string[] = [];
  const emit = (s: string) => lines.push(s);

  if (opts.baseTestImportPath) {
    emit(`import { test, expect, fwkStep } from "${opts.baseTestImportPath}";`);
  } else {
    emit(`import { test, expect } from "@playwright/test";`);
  }
  emit(``);
  const scenarioName = basename(opts.scenarioPath, extname(opts.scenarioPath));
  const title = opts.testTitle ? `Scenario: ${opts.testTitle}` : `Scenario: ${scenarioName}`;
  emit(`test(${JSON.stringify(title)}, async ({ page }, testInfo) => {`);
  emit(`  test.setTimeout(60_000);`);

  let stepVar = 0;
  for (const step of steps) {
    stepVar++;
    const label = step.raw.replace(/\s+/g, " ").trim();
    const emitStep = (bodyLines: string[]) => {
      if (opts.baseTestImportPath) {
        emit(`  await fwkStep(testInfo, page, ${stepVar}, ${JSON.stringify(label)}, async () => {`);
        for (const l of bodyLines) emit(`    ${l}`);
        emit(`  });`);
      } else {
        for (const l of bodyLines) emit(`  ${l}`);
      }
    };

    if (step.kind === "goto") {
      emitStep([`await page.goto(${JSON.stringify(step.url)});`]);
      continue;
    }
    if (step.kind === "scrollTop") {
      emitStep([
        `await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior }));`,
      ]);
      continue;
    }
    if (step.kind === "scrollToText") {
      const varName = `_el${stepVar}`;
      const regex = toLooseTextRegex(step.text);
      emitStep([
        `const ${varName} = page.locator("*:visible", { hasText: ${regex} }).first();`,
        `await ${varName}.scrollIntoViewIfNeeded();`,
        `await expect(${varName}).toBeVisible({ timeout: 15000 });`,
      ]);
      continue;
    }
    if (step.kind === "wait") {
      emitStep([`await page.waitForTimeout(${step.ms});`]);
      continue;
    }
    if (step.kind === "see") {
      // default expect timeout (5s) est souvent trop court pour les apps SPA en cold-start
      const regex = toLooseTextRegex(step.text);
      emitStep([
        `await expect(page.locator("*:visible", { hasText: ${regex} }).first()).toBeVisible({ timeout: 15000 });`,
      ]);
      continue;
    }
    if (step.kind === "unknown") {
      emit(`  // TODO: étape non reconnue (MVP): ${JSON.stringify(step.raw)}`);
      continue;
    }

    if (step.kind === "click") {
      const match = await resolveElement(store, step.target, embedder);
      const varName = `_el${stepVar}`;
      const body: string[] = [];
      if (match) {
        body.push(`// match(${match.mode}) score=${match.score.toFixed(3)} -> ${match.el.description}`);
        const locator = applyIndex(locatorExpr(match.el), step.index);
        body.push(`const ${varName} = ${locator};`);
      } else {
        const name = JSON.stringify(step.target);
        const locator = applyIndex(
          `page.locator("button:visible", { hasText: ${name} })` +
            `.or(page.locator("a:visible", { hasText: ${name} }))` +
            `.or(page.locator("text=" + ${name} + ":visible"))`,
          step.index,
        );
        body.push(`const ${varName} = ${locator};`);
      }
      body.push(`await ${varName}.click({ timeout: 15000 });`);
      emitStep(body);
      continue;
    }

    if (step.kind === "fill") {
      const match = await resolveElement(store, step.target, embedder);
      const varName = `_el${stepVar}`;
      const body: string[] = [];
      if (match) {
        body.push(`// match(${match.mode}) score=${match.score.toFixed(3)} -> ${match.el.description}`);
        const locator = applyIndex(locatorExpr(match.el), step.index);
        body.push(`const ${varName} = ${locator};`);
      } else {
        const name = JSON.stringify(step.target);
        const locator = applyIndex(
          `page.getByLabel(${name})` +
            `.or(page.getByPlaceholder(${name}))` +
            `.or(page.getByRole("textbox", { name: ${name} }))`,
          step.index,
        );
        body.push(`const ${varName} = ${locator};`);
      }
      body.push(`await ${varName}.scrollIntoViewIfNeeded();`);
      body.push(`await ${varName}.fill(${JSON.stringify(step.value)});`);
      emitStep(body);
      continue;
    }

    if (step.kind === "select") {
      const match = await resolveElement(store, step.target, embedder);
      const varName = `_el${stepVar}`;
      const body: string[] = [];
      if (match) {
        body.push(`// match(${match.mode}) score=${match.score.toFixed(3)} -> ${match.el.description}`);
        const locator = applyIndex(locatorExpr(match.el), step.index);
        body.push(`const ${varName} = ${locator};`);
      } else {
        const name = JSON.stringify(step.target);
        const locator = applyIndex(
          `page.getByLabel(${name}).or(page.getByRole("combobox", { name: ${name} }))`,
          step.index,
        );
        body.push(`const ${varName} = ${locator};`);
      }
      body.push(`await ${varName}.scrollIntoViewIfNeeded();`);
      body.push(`await ${varName}.selectOption({ label: ${JSON.stringify(step.option)} });`);
      emitStep(body);
      continue;
    }
  }

  emit(`});`);
  emit(``);

  return lines.join("\n");
}

