import { basename } from "node:path";
import { extractTestCases } from "../../utils/scenario.js";
import { OllamaClient } from "../../infrastructure/ollama.js";
import type { QAStep } from "../../core/steps.js";
import { stepsFromMarkdown } from "../../core/steps.js";

export type PivotScenarioV1 = {
  version: 1;
  createdAt: string;
  source: {
    scenarioPath?: string;
    title?: string;
  };
  cases: Array<{
    id: string;
    title: string;
    steps: QAStep[];
  }>;
};

export type PreprocessOptions = {
  scenarioPath?: string;
  scenarioContent: string;
  /** Base URL Ollama, ex: http://127.0.0.1:11434 */
  ollamaBaseUrl: string;
  /** Modèle de génération, ex: mistral */
  generationModel: string;
  /** Désactive l'IA (fallback heuristique uniquement) */
  noAI?: boolean;
  /** Nombre max de steps à renvoyer par cas (sécurité) */
  maxStepsPerCase?: number;
};

function safeJsonExtract(s: string): string | undefined {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  return s.slice(start, end + 1);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function validateSteps(rawSteps: unknown, maxSteps: number): QAStep[] | undefined {
  if (!Array.isArray(rawSteps)) return undefined;
  const out: QAStep[] = [];

  for (const item of rawSteps.slice(0, maxSteps)) {
    if (!isRecord(item)) return undefined;
    const kind = asString(item.kind);
    const raw = asString(item.raw) ?? "";
    const index = asNumber(item.index);

    if (!kind) return undefined;
    if (kind === "goto") {
      const url = asString(item.url);
      if (!url) return undefined;
      out.push({ kind, url, raw: raw || `goto ${url}` });
      continue;
    }
    if (kind === "click") {
      const target = asString(item.target);
      if (!target) return undefined;
      out.push({ kind, target, index, raw: raw || `click ${target}` });
      continue;
    }
    if (kind === "fill") {
      const target = asString(item.target);
      const value = asString(item.value);
      if (!target || value === undefined) return undefined;
      out.push({ kind, target, value, index, raw: raw || `fill ${target}=${value}` });
      continue;
    }
    if (kind === "select") {
      const target = asString(item.target);
      const option = asString(item.option);
      if (!target || !option) return undefined;
      out.push({ kind, target, option, index, raw: raw || `select ${option} in ${target}` });
      continue;
    }
    if (kind === "scrollTop") {
      out.push({ kind, raw: raw || "scrollTop" });
      continue;
    }
    if (kind === "scrollToText") {
      const text = asString(item.text);
      if (!text) return undefined;
      out.push({ kind, text, raw: raw || `scroll "${text}"` });
      continue;
    }
    if (kind === "see") {
      const text = asString(item.text);
      if (!text) return undefined;
      out.push({ kind, text, raw: raw || `see "${text}"` });
      continue;
    }
    if (kind === "wait") {
      const ms = asNumber(item.ms);
      if (ms === undefined) return undefined;
      out.push({ kind, ms, raw: raw || `wait ${ms}` });
      continue;
    }
    if (kind === "unknown") {
      out.push({ kind, raw: raw || "unknown" });
      continue;
    }
    return undefined;
  }

  return out;
}

function buildPrompt(caseTitle: string, caseContent: string, maxSteps: number) {
  // Important: on aligne les "kinds" avec le builder.
  // But: transformer un texte FR très libre en steps atomiques, 1 action par step.
  return [
    `Tu es un compilateur de scénarios de test E2E Playwright.`,
    `Transforme le scénario en une liste de steps JSON STRICTE, sans texte additionnel.`,
    ``,
    `Contraintes:`,
    `- Répondre avec un objet JSON valide uniquement.`,
    `- "steps" doit contenir au plus ${maxSteps} éléments.`,
    `- Chaque step doit être 1 action/attendu atomique (pas de "et ...").`,
    `- "kind" doit être l'un de: goto, click, fill, select, scrollTop, scrollToText, see, wait, unknown.`,
    `- Champs:`,
    `  - goto: { kind:"goto", url, raw }`,
    `  - click: { kind:"click", target, index?, raw } (index=1 si "première occurrence")`,
    `  - fill: { kind:"fill", target, value, index?, raw }`,
    `  - select: { kind:"select", target, option, index?, raw }`,
    `  - scrollTop: { kind:"scrollTop", raw }`,
    `  - scrollToText: { kind:"scrollToText", text, raw }`,
    `  - see: { kind:"see", text, raw }`,
    `  - wait: { kind:"wait", ms, raw } (ms en millisecondes)`,
    `  - unknown: { kind:"unknown", raw }`,
    ``,
    `Règles de normalisation:`,
    `- Utilise url complète (https://...) pour goto.`,
    `- Pour click/fill/select: "target" est le libellé lisible (ex: texte bouton, label).`,
    `- Pour see/scrollToText: "text" est le texte attendu/repère.`,
    ``,
    `Titre: ${caseTitle}`,
    `Scénario (brut):`,
    caseContent,
    ``,
    `Réponds avec ce format exact:`,
    `{"steps":[ ... ]}`,
  ].join("\n");
}

export async function preprocessScenarioToPivot(opts: PreprocessOptions): Promise<PivotScenarioV1> {
  const maxStepsPerCase = opts.maxStepsPerCase ?? 80;

  const baseName = opts.scenarioPath ? basename(opts.scenarioPath).replace(/\.\w+$/, "") : "scenario";
  const cases = extractTestCases(opts.scenarioContent, baseName);

  const ollama = opts.noAI ? undefined : new OllamaClient(opts.ollamaBaseUrl);

  const outCases: PivotScenarioV1["cases"] = [];
  for (const tc of cases) {
    let steps: QAStep[] | undefined;

    if (ollama) {
      try {
        const prompt = buildPrompt(tc.title, tc.content, maxStepsPerCase);
        const resp = await ollama.generate(opts.generationModel, prompt);
        const jsonText = safeJsonExtract(resp) ?? resp.trim();
        const parsed = JSON.parse(jsonText) as unknown;
        const rawSteps = isRecord(parsed) ? parsed.steps : undefined;
        steps = validateSteps(rawSteps, maxStepsPerCase);
      } catch {
        steps = undefined;
      }
    }

    // fallback: parsing heuristique existant (markdown -> steps)
    if (!steps) steps = stepsFromMarkdown(tc.content);

    outCases.push({
      id: tc.id,
      title: tc.title,
      steps,
    });
  }

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    source: { scenarioPath: opts.scenarioPath },
    cases: outCases,
  };
}

