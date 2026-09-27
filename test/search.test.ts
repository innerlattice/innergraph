import { afterEach, describe, expect, it } from "vitest";
import { LlmReranker, parseScores, rerankPrompt } from "../src/engines/llmReranker.js";
import { denseCosine, fuse, hybridSearch } from "../src/engines/recallEngine.js";
import type { RecallDoc, Reranker } from "../src/engines/recallEngine.js";
import { type Embedder, OllamaEmbedder, ScriptedGateway } from "../src/utilities/modelGateway.js";
import { initVault } from "../src/vault.js";
import { ENTRY_1, INTERPRETATION_1, KEY, SCHEMA_FILE, steppingClock, tempDir } from "./helpers.js";

/** Tiny concept space: synonyms share a dimension, so meaning beats spelling. */
const CONCEPTS: Record<string, number> = {
  freeze: 0,
  froze: 0,
  freezing: 0,
  paralysed: 0,
  stuck: 0,
  shame: 1,
  ashamed: 1,
  embarrassed: 1,
  rest: 2,
  resting: 2,
  sleep: 2,
  father: 3,
  dad: 3,
};

class ConceptEmbedder implements Embedder {
  readonly name = "concepts";
  calls: string[][] = [];
  async embed(texts: string[]): Promise<number[][]> {
    this.calls.push(texts);
    return texts.map((t) => {
      const v = [0, 0, 0, 0];
      for (const word of t.toLowerCase().match(/[a-z]+/g) ?? []) if (word in CONCEPTS) v[CONCEPTS[word]] += 1;
      return v;
    });
  }
}

const preferRest: Reranker = {
  name: "prefer-rest",
  rerank: async (_q, docs) => docs.map((d) => (d.text.startsWith("Rest (") ? 1 : 0.1)),
};

let dir: string;
function vault(embedder: Embedder | null, reranker: Reranker | null) {
  dir = tempDir();
  return initVault({ dir, key: KEY, gateway: new ScriptedGateway([INTERPRETATION_1]), schemaFile: SCHEMA_FILE, now: steppingClock(), embedder, reranker });
}

async function seeded(embedder: Embedder | null, reranker: Reranker | null) {
  const v = vault(embedder, reranker);
  v.ingest.addEntry({ content: ENTRY_1, format: "markdown" });
  await v.queue.idle();
  return v;
}

describe("fusion and similarity", () => {
  it("fuses rankings by reciprocal rank and compares vectors", () => {
    const fused = fuse([
      [
        { index: 0, score: 9 },
        { index: 1, score: 1 },
      ],
      [{ index: 1, score: 0.9 }],
    ]);
    expect(fused.map((r) => r.index)).toEqual([1, 0]);
    expect(denseCosine([1, 0], [1, 0])).toBe(1);
    expect(denseCosine([0, 0], [1, 0])).toBe(0);
  });

  it("returns lexical-only hits when no vectors or reranker are given", async () => {
    const docs: RecallDoc[] = [
      { id: "a", kind: "node", text: "shame spiral" },
      { id: "b", kind: "node", text: "garden" },
    ];
    const hits = await hybridSearch({ query: "shame", docs }, undefined, 5);
    expect(hits).toEqual([{ id: "a", kind: "node", score: expect.any(Number), stages: { lexical: 1, dense: undefined } }]);
  });
});

describe("graph search", () => {
  let v: Awaited<ReturnType<typeof seeded>>;
  afterEach(() => v.close());

  it("finds nodes by meaning through the dense stage", async () => {
    const embedder = new ConceptEmbedder();
    v = await seeded(embedder, null);
    const result = await v.explore.searchGraph("I got paralysed and embarrassed", 5);
    expect(result.stages).toEqual(["lexical", "dense"]);
    expect(result.hits[0]).toMatchObject({ kind: "edge", label: "Freezing —reinforces→ Shame" });
    expect(result.hits.map((h) => h.label)).toEqual(expect.arrayContaining(["Freezing", "Shame"]));
    expect(result.hits[0].evidence).toBeTruthy();
  });

  it("reuses cached vectors on the next search", async () => {
    const embedder = new ConceptEmbedder();
    v = await seeded(embedder, null);
    await v.explore.searchGraph("stuck", 3);
    const before = embedder.calls.flat().length;
    await v.explore.searchGraph("sleep", 3);
    expect(embedder.calls.flat().length - before).toBe(1);
  });

  it("reranks candidates and reports each stage", async () => {
    v = await seeded(new ConceptEmbedder(), preferRest);
    const result = await v.explore.searchGraph("freezing and shame and rest", 5);
    expect(result.stages).toEqual(["lexical", "dense", "rerank"]);
    expect(result.hits[0].label).toBe("Rest");
    expect(result.hits[0].stages.rerank).toBe(1);
  });

  it("falls back gracefully when models are unavailable, and never returns removed items", async () => {
    const broken: Embedder = { name: "broken", embed: async () => Promise.reject(new Error("model missing")) };
    const failing: Reranker = { name: "failing", rerank: async () => Promise.reject(new Error("timeout")) };
    v = await seeded(broken, failing);
    const shame = Object.values(v.explore.graph().nodes).find((n) => n.label === "Shame")?.id as string;
    v.map.remove([shame]);
    const result = await v.explore.searchGraph("shame freezing rest father", 10);
    expect(result.stages).toEqual(["lexical"]);
    expect(result.notes).toEqual(["dense retrieval skipped: model missing", "rerank skipped: timeout"]);
    expect(result.hits.map((h) => h.id)).not.toContain(shame);
    expect(result.hits.some((h) => h.kind === "edge")).toBe(true);
  });
});

describe("LLM reranker", () => {
  it("prompts with numbered candidates and normalises scores", async () => {
    const docs: RecallDoc[] = [
      { id: "a", kind: "node", text: "one\n\ntwo" },
      { id: "b", kind: "edge", text: "three" },
    ];
    expect(rerankPrompt("q", docs)).toContain("[0] (node) one two");
    expect(
      parseScores(
        {
          scores: [
            { index: 1, score: 15 },
            { index: 7, score: 3 },
          ],
        },
        2,
      ),
    ).toEqual([0, 1]);
    expect(parseScores("junk", 2)).toEqual([0, 0]);
    const reranker = new LlmReranker(new ScriptedGateway([{ scores: [{ index: 0, score: 5 }] }]));
    expect(reranker.name).toBe("llm:scripted");
    expect(await reranker.rerank("q", docs)).toEqual([0.5, 0]);
  });
});

describe("Ollama embedder", () => {
  it("calls the embed endpoint and explains a missing model", async () => {
    const ok = new OllamaEmbedder({ model: "m", fetchImpl: (async () => new Response(JSON.stringify({ embeddings: [[1, 2]] }))) as typeof fetch });
    expect(await ok.embed(["x"])).toEqual([[1, 2]]);
    expect(await ok.embed([])).toEqual([]);
    const missing = new OllamaEmbedder({ fetchImpl: (async () => new Response("", { status: 404 })) as typeof fetch });
    await expect(missing.embed(["x"])).rejects.toThrow("ollama pull qwen3-embedding:0.6b");
  });
});

describe("query instructions", async () => {
  const { queryInstructionFor } = await import("../src/utilities/modelGateway.js");
  it("prefixes queries only for instruction-tuned models", async () => {
    expect(queryInstructionFor("qwen3-embedding:0.6b")).toContain("Instruct:");
    expect(queryInstructionFor("embeddinggemma")).toBe("");
    const bodies: string[] = [];
    const embedder = new OllamaEmbedder({
      model: "qwen3-embedding:0.6b",
      fetchImpl: (async (_u: string, init: RequestInit) => (bodies.push(String(init.body)), new Response(JSON.stringify({ embeddings: [[1]] })))) as typeof fetch,
    });
    expect(await embedder.embedQuery("hello")).toEqual([1]);
    expect(JSON.parse(bodies[0]).input[0]).toMatch(/^Instruct: .*\nQuery: hello$/s);
  });
});
