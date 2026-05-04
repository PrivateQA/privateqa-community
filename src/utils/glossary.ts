export type GlossaryTerm =
  | string
  | {
      mapsTo?: string;
      uiHints?: string[];
      description?: string;
    };

export type GlossaryFile = {
  version: 1;
  terms?: Record<string, GlossaryTerm>;
  actions?: Record<string, string>;
};

export type GlossaryApplyReport = {
  content: string;
  replacements: Array<{ from: string; to: string; count: number }>;
};

function escapeRegex(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWordLike(input: string) {
  return /^[\p{L}\p{N}_-]+$/u.test(input);
}

function toReplacementMap(glossary: GlossaryFile): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];

  for (const [key, raw] of Object.entries(glossary.terms ?? {})) {
    if (typeof raw === "string") {
      out.push({ from: key, to: raw });
      continue;
    }
    const target = raw.mapsTo?.trim();
    if (!target) continue;
    out.push({ from: key, to: target });
    for (const hint of raw.uiHints ?? []) {
      if (hint.trim()) out.push({ from: hint, to: target });
    }
  }

  for (const [key, value] of Object.entries(glossary.actions ?? {})) {
    if (key.trim() && value.trim()) out.push({ from: key, to: value });
  }

  // Déterministe: on remplace d'abord les clés les plus longues.
  out.sort((a, b) => b.from.length - a.from.length);
  return out;
}

export function applyGlossaryToMarkdown(content: string, glossary: GlossaryFile): GlossaryApplyReport {
  const pairs = toReplacementMap(glossary);
  if (pairs.length === 0) return { content, replacements: [] };

  const reports: Array<{ from: string; to: string; count: number }> = [];
  const lines = content.split(/\r?\n/);
  let inCode = false;

  const out = lines.map((rawLine) => {
    const line = rawLine;
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCode = !inCode;
      return line;
    }
    if (inCode || trimmed.startsWith("#")) return line;

    let current = line;
    for (const pair of pairs) {
      const escaped = escapeRegex(pair.from);
      const pattern = isWordLike(pair.from)
        ? new RegExp(`\\b${escaped}\\b`, "gi")
        : new RegExp(escaped, "gi");
      let localCount = 0;
      current = current.replace(pattern, () => {
        localCount += 1;
        return pair.to;
      });
      if (localCount > 0) {
        reports.push({ from: pair.from, to: pair.to, count: localCount });
      }
    }
    return current;
  });

  // Agrège les occurrences d'un même mapping pour reporting.
  const merged = new Map<string, { from: string; to: string; count: number }>();
  for (const r of reports) {
    const key = `${r.from}\u0000${r.to}`;
    const existing = merged.get(key);
    if (existing) {
      existing.count += r.count;
    } else {
      merged.set(key, { ...r });
    }
  }

  return {
    content: out.join("\n"),
    replacements: Array.from(merged.values()),
  };
}

