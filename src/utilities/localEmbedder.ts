// LocalEmbedder: embeddings computed in this process by a small model that comes with the app, so
// search understands meaning without Ollama and without anything leaving the machine. ONNX
// Runtime's WebAssembly build runs the same on every platform the app ships for.
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { Embedder } from "./modelGateway.js";

/** The built-in model, pinned: multilingual-e5-small (MIT), int8. `npm run models` fetches it. */
export const BUILT_IN_MODEL = {
  name: "multilingual-e5-small",
  repo: "Xenova/multilingual-e5-small",
  revision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  files: [
    { name: "model_quantized.onnx", path: "onnx/model_quantized.onnx", sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193" },
    { name: "tokenizer.json", path: "tokenizer.json", sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39" },
    { name: "tokenizer_config.json", path: "tokenizer_config.json", sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b" },
  ],
};

const MAX_TOKENS = 512;

/** A padded batch of token ids; the mask marks the real tokens. */
interface Batch {
  ids: BigInt64Array;
  mask: BigInt64Array;
  length: number;
}

/** What LocalEmbedder needs from a model: its tokenizer and a forward pass. */
export interface EmbeddingRuntime {
  padId: number;
  tokenize(text: string): number[];
  /** The last hidden states, [batch, length, dim] flattened. */
  run(batch: Batch): Promise<{ data: Float32Array; dim: number }>;
}

/** Keeps the first tokens and the closing special token when a text is longer than the model reads. */
export function truncate(ids: number[], max = MAX_TOKENS): number[] {
  return ids.length > max ? [...ids.slice(0, max - 1), ids[ids.length - 1]] : ids;
}

export function pad(rows: number[][], padId: number): Batch {
  const length = Math.max(...rows.map((r) => r.length));
  const ids = new BigInt64Array(rows.length * length).fill(BigInt(padId));
  const mask = new BigInt64Array(rows.length * length);
  for (const [i, row] of rows.entries()) {
    for (const [j, id] of row.entries()) {
      ids[i * length + j] = BigInt(id);
      mask[i * length + j] = 1n;
    }
  }
  return { ids, mask, length };
}

function unit(vector: number[]): number[] {
  const norm = Math.hypot(...vector) || 1;
  return vector.map((x) => x / norm);
}

/** Averages each text's token states (the padding left out) into one unit-length vector. */
export function meanPool(hidden: Float32Array, lengths: number[], padded: number, dim: number): number[][] {
  return lengths.map((n, i) => {
    const sum = new Array<number>(dim).fill(0);
    for (let j = 0; j < n; j++) {
      const at = (i * padded + j) * dim;
      for (let k = 0; k < dim; k++) sum[k] += hidden[at + k];
    }
    return unit(sum);
  });
}

const readJson = (file: string): object => JSON.parse(readFileSync(file, "utf8"));

/** Loads the model from a folder holding BUILT_IN_MODEL's files. */
export async function loadRuntime(dir: string): Promise<EmbeddingRuntime> {
  const file = (name: string) => join(dir, name);
  if (!existsSync(file("model_quantized.onnx"))) throw new Error(`the built-in embedding model isn't in ${dir}; run: npm run models`);
  const [{ Tokenizer }, ort] = await Promise.all([import("@huggingface/tokenizers"), import("onnxruntime-web")]);
  const tokenizer = new Tokenizer(readJson(file("tokenizer.json")), readJson(file("tokenizer_config.json")));
  ort.env.wasm.numThreads = Math.min(4, availableParallelism());
  const session = await ort.InferenceSession.create(readFileSync(file("model_quantized.onnx")));
  return {
    padId: tokenizer.token_to_id("<pad>") ?? 0,
    tokenize: (text) => tokenizer.encode(text).ids,
    run: async ({ ids, mask, length }) => {
      const tensor = (data: BigInt64Array) => new ort.Tensor("int64", data, [ids.length / length, length]);
      const output = await session.run({ input_ids: tensor(ids), attention_mask: tensor(mask), token_type_ids: tensor(new BigInt64Array(ids.length)) });
      const hidden = output[session.outputNames[0]];
      return { data: hidden.data as Float32Array, dim: hidden.dims[2] };
    },
  };
}

export class LocalEmbedder implements Embedder {
  readonly name = BUILT_IN_MODEL.name;
  private runtime?: Promise<EmbeddingRuntime>;

  /** The model loads on first use; a failed load is retried on the next call. */
  constructor(private readonly load: () => Promise<EmbeddingRuntime>) {}

  /** e5 models are trained with "passage: " and "query: " prefixes. */
  async embed(texts: string[]): Promise<number[][]> {
    return this.vectors(texts.map((t) => `passage: ${t}`));
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.vectors([`query: ${text}`]);
    return vector;
  }

  private ready(): Promise<EmbeddingRuntime> {
    this.runtime ??= this.load().catch((error: unknown) => {
      this.runtime = undefined;
      throw error;
    });
    return this.runtime;
  }

  private async vectors(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const runtime = await this.ready();
    const rows = texts.map((t) => truncate(runtime.tokenize(t)));
    const batch = pad(rows, runtime.padId);
    const { data, dim } = await runtime.run(batch);
    return meanPool(
      data,
      rows.map((r) => r.length),
      batch.length,
      dim,
    );
  }
}
