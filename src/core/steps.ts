export type FwkStep =
  | { kind: "goto"; url: string; raw: string }
  | { kind: "click"; target: string; index?: number; raw: string }
  | { kind: "fill"; target: string; value: string; index?: number; raw: string }
  | { kind: "select"; target: string; option: string; index?: number; raw: string }
  | { kind: "scrollTop"; raw: string }
  | { kind: "scrollToText"; text: string; raw: string }
  | { kind: "see"; text: string; raw: string }
  | { kind: "wait"; ms: number; raw: string }
  | { kind: "unknown"; raw: string };

function unbullet(line: string) {
  return line.replace(/^\s*(?:-|\*|\d+\.)\s+/, "").trim();
}

function normalizeStepLine(line: string) {
  // Supporte des préfixes type "A.1:" / "TC-01.2:" / "1.2.3:"
  const noPrefix = line.replace(/^\s*(?:[A-Za-z]+(?:[-_.]\w+)*\.)*\d+(?:\.\d+)*\s*:\s*/, "");
  const noLabels = noPrefix.replace(
    /^\s*(?:action|r[eé]sultat\s+attendu|attendu|expected)\s*[:-]\s*/i,
    "",
  );
  // Retire les ; / . finaux
  return noLabels.replace(/[;.\s]+$/g, "").trim();
}

function extractQuoted(s: string) {
  // Important: supporter les apostrophes *dans* une chaîne entre guillemets doubles
  // (ex: "Résultats de l'analyse"). On extrait séparément:
  // - "..." et “...” (guillemets doubles)
  // - '...' (guillemets simples)
  const out: string[] = [];
  const pushAll = (re: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) out.push(m[1]!.trim());
  };
  pushAll(/"([^"]+)"/g);
  pushAll(/“([^”]+)”/g);
  pushAll(/'([^']+)'/g);
  return out;
}

export function parseStepsFromMarkdown(md: string): string[] {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("#")) continue;
    const normalized = normalizeStepLine(unbullet(t));
    // Heuristique MVP: si une ligne combine scroll + click avec "et", on la découpe.
    if (/\bscroll\b/i.test(normalized) && /\bet\b/i.test(normalized) && /\b(clique|click|appuie)\b/i.test(normalized)) {
      const parts = normalized
        .split(/\s+\bet\b\s+/i)
        .map((p) => p.trim())
        .filter(Boolean);
      out.push(...parts);
      continue;
    }
    out.push(normalized);
  }
  return out.filter(Boolean);
}

export function toStep(raw: string): FwkStep {
  const s = raw.trim();
  const q = extractQuoted(s);
  const indexMatch = s.match(/\[(\d+)\]\s*$/);
  const indexFromBrackets = indexMatch ? Number(indexMatch[1]) : undefined;
  const firstOccur =
    /\b(?:premi[eè]re)\s+occurr?ence\b/i.test(s) || /\bfirst\s+occurrence\b/i.test(s);
  const index = indexFromBrackets ?? (firstOccur ? 1 : undefined);

  // goto
  {
    const m =
      s.match(/\b(?:je|j')\s*(?:vais|ouvre|acc[eè]de)\s+sur\s+(.+)$/i) ??
      s.match(/^\s*(?:ouvrir|ouvre)\s+(.+)$/i);
    if (m) {
      const url = (q[0] ?? m[1] ?? "").trim();
      return { kind: "goto", url, raw };
    }
  }

  // scroll top
  if (/\bscroll\b/i.test(s) && /\b(en\s+haut|haut\s+de\s+page|haut\s+de\s+la\s+page)\b/i.test(s)) {
    return { kind: "scrollTop", raw };
  }

  // scroll to text
  if (/\bscroll\b/i.test(s) && q.length >= 1) {
    return { kind: "scrollToText", text: q[0]!, raw };
  }

  // wait
  {
    const m = s.match(/\b(?:j'attends|je\s+attends)\s+(\d+)\s*(ms|s)?\b/i);
    if (m) {
      const n = Number(m[1]);
      const unit = (m[2] ?? "ms").toLowerCase();
      const ms = unit === "s" ? n * 1000 : n;
      return { kind: "wait", ms, raw };
    }
  }

  // fill
  if (/\b(?:remplis|saisis|entre|renseigne)\b/i.test(s)) {
    if (q.length >= 2) return { kind: "fill", target: q[0]!, value: q[1]!, index, raw };
    const m = s.match(/\b(?:remplis|saisis|entre|renseigne)\b\s+(.+?)\s+(?:avec|=)\s+(.+)$/i);
    if (m) return { kind: "fill", target: m[1]!.trim(), value: m[2]!.trim(), index, raw };
  }

  // select
  if (/\b(?:s[eé]lectionne|choisis)\b/i.test(s)) {
    if (q.length >= 2) return { kind: "select", option: q[0]!, target: q[1]!, index, raw };
    const m = s.match(/\b(?:s[eé]lectionne|choisis)\b\s+(.+?)\s+(?:dans|sur)\s+(.+)$/i);
    if (m) return { kind: "select", option: m[1]!.trim(), target: m[2]!.trim(), index, raw };
  }

  // click
  if (/\b(?:clique|click|appuie)\b/i.test(s)) {
    if (q.length >= 1) return { kind: "click", target: q[0]!, index, raw };
    const m = s.match(/\b(?:clique|click|appuie)\b\s+(?:sur\s+)?(.+)$/i);
    if (m) return { kind: "click", target: m[1]!.trim(), index, raw };
  }

  // see
  if (/\b(?:vois|dois\s+voir|v[eé]rifie|v[eé]rifier)\b/i.test(s)) {
    if (q.length >= 1) return { kind: "see", text: q[0]!, raw };
    const m = s.match(/\b(?:vois|dois\s+voir|v[eé]rifie)\b\s+(.+)$/i);
    if (m) return { kind: "see", text: m[1]!.trim(), raw };
  }

  return { kind: "unknown", raw };
}

export function stepsFromMarkdown(md: string): FwkStep[] {
  return parseStepsFromMarkdown(md).map(toStep);
}

