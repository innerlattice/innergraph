// RecallEngine: finds related, possibly forgotten material. v1 uses TF-IDF cosine
// similarity so it runs offline with no extra model; embeddings can replace `vectorise`.

export interface RecallDoc {
  id: string;
  kind: "entry" | "node" | "edge";
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
  search(input: SearchInput, reranker: Reranker | undefined, limit = 10): Promise<SearchHit[]> {
    return hybridSearch(input, reranker, limit);
  }

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

// ---- hybrid search: lexical + dense, fused, then reranked ----------------------------

export interface Ranked {
  index: number;
  score: number;
}

export interface SearchHit {
  id: string;
  kind: RecallDoc["kind"];
  score: number;
  /** Rank (1-based) in each stage the hit appeared in, plus the reranker's score. */
  stages: { lexical?: number; dense?: number; rerank?: number };
}

export interface SearchInput {
  query: string;
  docs: RecallDoc[];
  queryVector?: number[];
  docVectors?: number[][];
}

/** Scores candidates for a query; higher is more relevant. Aligned with `docs`. */
export interface Reranker {
  readonly name: string;
  rerank(query: string, docs: RecallDoc[]): Promise<number[]>;
}

const CANDIDATES = 50;
const RRF_K = 60;

export function lexicalRanking(query: string, docs: RecallDoc[]): Ranked[] {
  const tfs = docs.map((d) => termFrequencies(tokenize(d.text)));
  const queryTf = termFrequencies(tokenize(query));
  const idf = inverseDocumentFrequency([...tfs, queryTf]);
  const q = vectorise(queryTf, idf);
  return rank(tfs.map((tf) => cosine(q, vectorise(tf, idf)).score));
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * (b[i] ?? 0);
  return sum;
}

export function denseCosine(a: number[], b: number[]): number {
  const denominator = Math.sqrt(dot(a, a)) * Math.sqrt(dot(b, b));
  return denominator === 0 ? 0 : dot(a, b) / denominator;
}

function denseRanking(queryVector: number[], docVectors: number[][]): Ranked[] {
  return rank(docVectors.map((v) => denseCosine(queryVector, v)));
}

function rank(scores: number[]): Ranked[] {
  return scores
    .map((score, index) => ({ index, score }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATES);
}

/** Reciprocal rank fusion: robust to incomparable score scales across stages. */
export function fuse(rankings: Ranked[][]): Ranked[] {
  const fused = new Map<number, number>();
  for (const ranking of rankings) {
    for (const [position, r] of ranking.entries()) fused.set(r.index, (fused.get(r.index) ?? 0) + 1 / (RRF_K + position + 1));
  }
  return [...fused].map(([index, score]) => ({ index, score })).sort((a, b) => b.score - a.score);
}

function positions(ranking: Ranked[] | undefined): Map<number, number> {
  return new Map((ranking ?? []).map((r, i) => [r.index, i + 1]));
}

/** Lexical and (when vectors are given) dense rankings, fused with RRF, then optionally reranked. */
export async function hybridSearch(input: SearchInput, reranker: Reranker | undefined, limit: number, rerankDepth = 20): Promise<SearchHit[]> {
  const lexical = lexicalRanking(input.query, input.docs);
  const dense = input.queryVector && input.docVectors ? denseRanking(input.queryVector, input.docVectors) : undefined;
  const fused = fuse(dense ? [lexical, dense] : [lexical]).slice(0, Math.max(rerankDepth, limit));
  const lexPos = positions(lexical);
  const densePos = positions(dense);
  const hits = fused.map((r) => ({ index: r.index, score: r.score, stages: { lexical: lexPos.get(r.index), dense: densePos.get(r.index) } as SearchHit["stages"] }));
  const reranked = reranker && hits.length > 1 ? await rerankHits(input, hits.slice(0, rerankDepth), reranker) : hits;
  return reranked.slice(0, limit).map((h) => ({ id: input.docs[h.index].id, kind: input.docs[h.index].kind, score: Number(h.score.toFixed(4)), stages: h.stages }));
}

async function rerankHits(input: SearchInput, hits: (Ranked & { stages: SearchHit["stages"] })[], reranker: Reranker) {
  const scores = await reranker.rerank(
    input.query,
    hits.map((h) => input.docs[h.index]),
  );
  return hits.map((h, i) => ({ ...h, score: scores[i] ?? 0, stages: { ...h.stages, rerank: scores[i] ?? 0 } })).sort((a, b) => b.score - a.score);
}
