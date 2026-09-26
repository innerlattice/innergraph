// RecallEngine: finds related, possibly forgotten material. v1 uses TF-IDF cosine
// similarity so it runs offline with no extra model; embeddings can replace `vectorise`.

export interface RecallDoc {
  id: string;
  kind: "entry" | "node";
  text: string;
}

export interface RecallMatch {
  id: string;
  kind: RecallDoc["kind"];
  score: number;
  terms: string[];
}

export interface RecallOptions {
  limit?: number;
  threshold?: number;
  exclude?: string[];
}

const STOPWORDS = new Set(
  "a an and are as at be been but by for from had has have i if in into is it its me my of on or our so that the their them then there they this to was we were what when which who will with you your not do does did can just about like feel felt".split(
    " ",
  ),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function inverseDocumentFrequency(docs: Map<string, number>[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) for (const term of doc.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [term, count] of df) idf.set(term, Math.log((1 + docs.length) / (1 + count)) + 1);
  return idf;
}

type Vector = Map<string, number>;

function vectorise(tf: Map<string, number>, idf: Map<string, number>): Vector {
  const v: Vector = new Map();
  for (const [term, count] of tf) v.set(term, count * (idf.get(term) ?? 1));
  return v;
}

function norm(v: Vector): number {
  return Math.sqrt([...v.values()].reduce((acc, x) => acc + x * x, 0));
}

export function cosine(a: Vector, b: Vector): { score: number; shared: string[] } {
  const shared = [...a.keys()].filter((t) => b.has(t));
  const dot = shared.reduce((acc, t) => acc + (a.get(t) as number) * (b.get(t) as number), 0);
  const denominator = norm(a) * norm(b);
  return { score: denominator === 0 ? 0 : dot / denominator, shared };
}

function topTerms(shared: string[], query: Vector): string[] {
  return [...shared].sort((x, y) => (query.get(y) as number) - (query.get(x) as number)).slice(0, 5);
}

export class RecallEngine {
  recall(query: string, corpus: RecallDoc[], options: RecallOptions = {}): RecallMatch[] {
    const exclude = new Set(options.exclude ?? []);
    const docs = corpus.filter((d) => !exclude.has(d.id));
    const tfs = docs.map((d) => termFrequencies(tokenize(d.text)));
    const queryTf = termFrequencies(tokenize(query));
    const idf = inverseDocumentFrequency([...tfs, queryTf]);
    const q = vectorise(queryTf, idf);
    return docs
      .map((doc, i) => ({ doc, ...cosine(q, vectorise(tfs[i], idf)) }))
      .filter((m) => m.score >= (options.threshold ?? 0.12))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.limit ?? 5)
      .map((m) => ({ id: m.doc.id, kind: m.doc.kind, score: Number(m.score.toFixed(3)), terms: topTerms(m.shared, q) }));
  }
}
