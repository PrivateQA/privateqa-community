import { createHash } from "node:crypto";
import { chromium, type Page } from "playwright";
import type { MapFile, MappedElement } from "../../infrastructure/store.js";
import { OllamaClient } from "../../infrastructure/ollama.js";

export type MapOptions = {
  url: string;
  ollamaBaseUrl: string;
  embeddingModel: string;
  computeEmbeddings: boolean;
  maxElements: number;
  headed: boolean;
};

type RawElement = {
  description: string;
  locator:
    | { kind: "testId"; testId: string }
    | { kind: "role"; role: string; name?: string }
    | { kind: "label"; label: string }
    | { kind: "css"; selector: string }
    | { kind: "text"; text: string };
  meta?: Record<string, unknown>;
};

function shortId(s: string) {
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}

async function extractInteractives(page: Page, maxElements: number): Promise<RawElement[]> {
  // NOTE: Avec certains transpilers (ex: esbuild via tsx), les fonctions passées à `page.evaluate`
  // peuvent être transformées et référencer des helpers (ex: `__name`) inexistants dans le navigateur.
  // Pour éviter ça, on exécute un "source string" en contexte page.
  const fnSource = String.raw`(function(limit){
    const clean = (s) => String(s ?? "").replace(/\\s+/g, " ").trim().slice(0, 120);
    const roleFromTag = (el) => {
      const explicit = clean(el.getAttribute("role"));
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === "button") return "button";
      if (tag === "a" && el.href) return "link";
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (tag === "input") {
        const t = String(el.type ?? "").toLowerCase();
        if (["button", "submit", "reset"].includes(t)) return "button";
        if (["checkbox"].includes(t)) return "checkbox";
        if (["radio"].includes(t)) return "radio";
        if (["email", "password", "search", "tel", "text", "url", ""].includes(t)) return "textbox";
      }
      return "";
    };

    const nameFromElement = (el) => {
      const aria = clean(el.getAttribute("aria-label"));
      if (aria) return aria;

      if (el.labels && el.labels.length > 0) {
        const lab = clean(el.labels[0]?.innerText ?? el.labels[0]?.textContent ?? "");
        if (lab) return lab;
      }

      const tag = el.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") {
        const ph = clean(el.placeholder);
        if (ph) return ph;
        const nm = clean(el.name);
        if (nm) return nm;
      }

      const txt = clean(el.innerText ?? el.textContent);
      if (txt) return txt;
      return "";
    };

    const isVisible = (el) => {
      const r = el.getBoundingClientRect?.();
      if (!r) return true;
      return r.width > 0 && r.height > 0;
    };

    const candidates = Array.from(document.querySelectorAll([
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='combobox']",
      "[data-testid]"
    ].join(","))).filter(isVisible);

    const out = [];
    const seen = new Set();

    for (const el of candidates) {
      if (out.length >= limit) break;

      const testId = clean(el.getAttribute("data-testid"));
      if (testId) {
        const key = "testId:" + testId;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          description: 'Élément testId "' + testId + '"',
          locator: { kind: "testId", testId },
          meta: { tag: el.tagName.toLowerCase() }
        });
        continue;
      }

      const role = roleFromTag(el);
      const name = nameFromElement(el);
      if (role) {
        const key = "role:" + role + ":" + name;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          description: name ? (role + ' "' + name + '"') : role,
          locator: name ? { kind: "role", role, name } : { kind: "role", role },
          meta: { tag: el.tagName.toLowerCase() }
        });
        continue;
      }

      if (name) {
        const key = "text:" + name;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          description: 'Texte "' + name + '"',
          locator: { kind: "text", text: name },
          meta: { tag: el.tagName.toLowerCase() }
        });
      }
    }

    return out;
  })`;

  const raw = await page.evaluate(
    ({ limit, source }) => {
      const fn = (0, eval)(source) as (n: number) => unknown;
      return fn(limit);
    },
    { limit: maxElements, source: fnSource },
  );

  return raw as RawElement[];
}

export async function buildMap(opts: MapOptions): Promise<MapFile> {
  const browser = await chromium.launch({ headless: !opts.headed });
  const page = await browser.newPage();
  await page.goto(opts.url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  const extracted = await extractInteractives(page, opts.maxElements);
  await browser.close();

  const map: MapFile = {
    version: 1,
    createdAt: new Date().toISOString(),
    url: opts.url,
    embeddingModel: opts.computeEmbeddings ? opts.embeddingModel : undefined,
    elements: [],
  };

  const ollama = new OllamaClient(opts.ollamaBaseUrl);
  let embeddingsAvailable = opts.computeEmbeddings;

  for (const el of extracted) {
    const signature = JSON.stringify(el.locator) + "|" + el.description;
    const id = shortId(signature);

    const mapped: MappedElement = {
      id,
      description: el.description,
      locator: el.locator,
      url: opts.url,
      meta: el.meta,
    };

    if (embeddingsAvailable) {
      try {
        mapped.embedding = await ollama.embeddings(opts.embeddingModel, el.description);
      } catch (e) {
        // Si Ollama n'est pas dispo, on évite de retenter sur chaque élément.
        embeddingsAvailable = false;
        mapped.embedding = undefined;
        mapped.meta = { ...(mapped.meta ?? {}), embeddingError: String(e) };
      }
    }

    map.elements.push(mapped);
  }

  return map;
}

