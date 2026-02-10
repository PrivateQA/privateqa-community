import { createHash } from "node:crypto";

export type ExtractedTestCase = {
  id: string;
  title: string;
  /** Contenu "brut" (lignes) qui décrivent les actions/attendus */
  content: string;
};

function shortId(s: string) {
  return createHash("sha1").update(s).digest("hex").slice(0, 10);
}

function normalizeTitle(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

type PrefixKey = {
  alpha: string; // ex: A / AA
  num: number; // ex: 1
  label?: string; // texte après ":" si présent
};

function parseAlphaNumericPrefix(line: string): PrefixKey | undefined {
  // Supporte:
  // - A.1: ...
  // - A.1.2: ...
  // - AA.12.3: ...
  const m = line.match(/^\s*([A-Za-z]+)\.(\d+)(?:\.\d+)*\s*:\s*(.*)$/);
  if (!m) return undefined;
  const alpha = m[1]!.toUpperCase();
  const num = Number(m[2]);
  const label = m[3]?.trim();
  return { alpha, num, label: label ? normalizeTitle(label) : undefined };
}

function looksLikeTestStart(line: string) {
  const t = line.trim();
  if (!t) return false;
  if (/^#{2,6}\s+/.test(t)) return true;
  if (/^\s*(?:TC|TEST|CAS)\b/i.test(t)) return true;
  if (/^\s*Test\s*\d+\b/i.test(t)) return true;
  return false;
}

function titleFromLine(line: string) {
  const t = line.trim();
  const heading = t.match(/^#{2,6}\s+(.+)$/);
  if (heading) return normalizeTitle(heading[1]!);

  const named = t.match(/^\s*(?:TC|TEST|CAS)\s*(?:DE\s+TEST)?\s*[:#-]\s*(.+)$/i);
  if (named) return normalizeTitle(named[1]!);

  const testN = t.match(/^\s*Test\s*(\d+)\s*[:#-]?\s*(.*)$/i);
  if (testN) return normalizeTitle(testN[2] ? `Test ${testN[1]} - ${testN[2]}` : `Test ${testN[1]}`);

  return normalizeTitle(t);
}

/**
 * Extrait une liste de cas de test à partir d'un markdown "brut".
 *
 * Heuristiques MVP:
 * - Si le fichier est au format "A.1:", "A.2:" ... alors chaque préfixe (A.1) devient un test.
 * - Si le fichier contient plusieurs sections identifiées (titres `##`/`###` ou lignes `TEST:`/`TC:`),
 *   chaque section devient un test.
 * - Sinon, tout le fichier est un seul test.
 *
 * Note: on garde volontairement le contenu assez "brut" pour laisser le builder/parser décider
 * de ce qui est une action/attendu.
 */
export function extractTestCases(markdown: string, fallbackTitle: string): ExtractedTestCase[] {
  const lines = markdown.split(/\r?\n/);

  // 1) Détection format "A.1:" -> considéré comme steps.
  // Heuristique: on groupe par "alpha" (A, B, AA...), pas par "A.1".
  // Exemple: A.1..A.8 => 1 seul cas "A" avec toutes les lignes.
  {
    const prefixes = lines
      .map((l) => parseAlphaNumericPrefix(l))
      .filter(Boolean) as PrefixKey[];
    if (prefixes.length > 0) {
      const grouped: Array<{ alpha: string; title: string; lines: string[] }> = [];
      let current: { alpha: string; title: string; lines: string[] } | undefined;

      const flush = () => {
        if (!current) return;
        const content = current.lines.join("\n").trim();
        if (content) grouped.push(current);
        current = undefined;
      };

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const t = line.trim();
        if (!t) continue;

        const p = parseAlphaNumericPrefix(t);
        if (!p) {
          if (current) current.lines.push(line);
          continue;
        }

        if (!current || current.alpha !== p.alpha) {
          flush();
          // Si le premier step porte un libellé, on l'utilise pour titrer le cas.
          const title = p.label ? `${p.alpha} - ${p.label}` : p.alpha;
          current = { alpha: p.alpha, title, lines: [] };
        }

        // On conserve la ligne: le builder retirera le préfixe et parsera l'action.
        current.lines.push(line);
      }

      flush();

      return grouped.map((c) => {
        const content = c.lines.join("\n").trim();
        return { id: shortId(c.title + "\n" + content), title: c.title, content };
      });
    }
  }

  const cases: Array<{ title: string; lines: string[] }> = [];

  let inCode = false;
  let current: { title: string; lines: string[] } | undefined;

  const flush = () => {
    if (!current) return;
    const content = current.lines.join("\n").trim();
    if (content) cases.push({ title: current.title, lines: current.lines });
    current = undefined;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const t = line.trim();

    if (t.startsWith("```")) {
      inCode = !inCode;
      // on ignore la fence elle-même
      continue;
    }
    if (inCode) continue;

    // Début d'un nouveau test (titres/labels)
    if (looksLikeTestStart(t)) {
      flush();
      current = { title: titleFromLine(t), lines: [] };
      continue;
    }

    // Si aucun test n'a commencé, on attend d'avoir une première instruction
    if (!current) {
      if (!t) continue; // skip leading empties
      current = { title: fallbackTitle, lines: [] };
    }

    // On conserve les lignes non vides + on conserve aussi certaines vides (pour séparer visuellement),
    // mais le builder filtrera de toute façon.
    current.lines.push(line);
  }

  flush();

  if (cases.length === 0) {
    const content = markdown.trim();
    if (!content) return [];
    return [{ id: shortId(fallbackTitle + content), title: fallbackTitle, content }];
  }

  // Construire ids + content
  return cases.map((c, i) => {
    const content = c.lines.join("\n").trim();
    const title = c.title || `${fallbackTitle} ${i + 1}`;
    return {
      id: shortId(title + "\n" + content),
      title,
      content,
    };
  });
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

