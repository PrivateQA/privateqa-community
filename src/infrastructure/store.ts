export type LocatorHint =
  | { kind: "testId"; testId: string }
  | { kind: "role"; role: string; name?: string }
  | { kind: "label"; label: string }
  | { kind: "css"; selector: string }
  | { kind: "text"; text: string };

export type MappedElement = {
  id: string;
  description: string;
  locator: LocatorHint;
  url: string;
  embedding?: number[];
  meta?: Record<string, unknown>;
};

export type MapFile = {
  version: 1;
  createdAt: string;
  url: string;
  embeddingModel?: string;
  elements: MappedElement[];
};

export function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function normalizeText(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string) {
  return new Set(normalizeText(s).split(" ").filter(Boolean));
}

function jaccard(a: string, b: string) {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export class LocalVectorStore {
  constructor(public readonly map: MapFile) {}

  static from(map: MapFile) {
    return new LocalVectorStore(map);
  }

  bestMatchByEmbedding(queryEmbedding: number[]) {
    let best: { el: MappedElement; score: number } | undefined;
    for (const el of this.map.elements) {
      if (!el.embedding) continue;
      const score = cosineSimilarity(queryEmbedding, el.embedding);
      if (!best || score > best.score) best = { el, score };
    }
    return best;
  }

  bestMatchByText(query: string) {
    let best: { el: MappedElement; score: number } | undefined;
    for (const el of this.map.elements) {
      const score = jaccard(query, el.description);
      if (!best || score > best.score) best = { el, score };
    }
    return best;
  }
}

