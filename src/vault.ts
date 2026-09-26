// Composition root: opens a Vault directory and wires Managers to Engines and Access.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Db, openDatabase } from "./access/database.js";
import { SchemaAccess, loadSchemaFile } from "./access/schemaAccess.js";
import { VaultAccess } from "./access/vaultAccess.js";
import { USER } from "./core/types.js";
import { AnalysisEngine } from "./engines/analysisEngine.js";
import { InterpretationEngine } from "./engines/interpretationEngine.js";
import { LlmReranker } from "./engines/llmReranker.js";
import { RecallEngine, type Reranker } from "./engines/recallEngine.js";
import { DEFAULT_POLICY, ReviewEngine, type ReviewPolicy } from "./engines/reviewEngine.js";
import { ExploreManager } from "./managers/exploreManager.js";
import { IngestManager } from "./managers/ingestManager.js";
import { MapManager } from "./managers/mapManager.js";
import { newKey } from "./utilities/crypto.js";
import { JobQueue } from "./utilities/jobQueue.js";
import { type Embedder, type ModelGateway, OllamaEmbedder, OllamaGateway } from "./utilities/modelGateway.js";

export interface VaultOptions {
  dir: string;
  key?: string;
  gateway?: ModelGateway;
  policy?: ReviewPolicy;
  now?: () => number;
  /** Search stages; null disables one, undefined uses the environment's default. */
  embedder?: Embedder | null;
  reranker?: Reranker | null;
}

export interface Vault {
  ingest: IngestManager;
  map: MapManager;
  explore: ExploreManager;
  queue: JobQueue;
  gateway: ModelGateway;
  close(): void;
}

const DB_FILE = "vault.db";
const KEY_FILE = "vault.key";
const CONFIG_FILE = "config.json";

export function vaultExists(dir: string): boolean {
  return existsSync(join(dir, DB_FILE));
}

function resolveKey(dir: string, explicit?: string): string {
  const key = explicit ?? process.env.INNER_GRAPH_KEY;
  if (key) return key;
  const file = join(dir, KEY_FILE);
  if (!existsSync(file)) {
    writeFileSync(file, newKey(), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return readFileSync(file, "utf8").trim();
}

function readPolicy(dir: string): ReviewPolicy {
  const file = join(dir, CONFIG_FILE);
  if (!existsSync(file)) return DEFAULT_POLICY;
  const config = JSON.parse(readFileSync(file, "utf8")) as { review?: Partial<ReviewPolicy> };
  return { ...DEFAULT_POLICY, ...config.review };
}

function defaultEmbedder(): Embedder | undefined {
  const model = process.env.INNER_GRAPH_EMBED_MODEL;
  return model === "off" ? undefined : new OllamaEmbedder({ baseUrl: process.env.INNER_GRAPH_MODEL_URL, model });
}

function defaultReranker(gateway: ModelGateway): Reranker | undefined {
  return process.env.INNER_GRAPH_RERANK === "off" ? undefined : new LlmReranker(gateway);
}

function orDefault<T>(value: T | null | undefined, fallback: () => T | undefined): T | undefined {
  return value === null ? undefined : (value ?? fallback());
}

function defaultGateway(): ModelGateway {
  return new OllamaGateway({ baseUrl: process.env.INNER_GRAPH_MODEL_URL, model: process.env.INNER_GRAPH_MODEL });
}

export function openVault(options: VaultOptions): Vault {
  mkdirSync(options.dir, { recursive: true });
  const db: Db = openDatabase(join(options.dir, DB_FILE), resolveKey(options.dir, options.key));
  const vault = new VaultAccess(db, options.now);
  const schemas = new SchemaAccess(db);
  const gateway = options.gateway ?? defaultGateway();
  const interpretation = new InterpretationEngine(gateway);
  const analysis = new AnalysisEngine();
  const recall = new RecallEngine();
  const queue = new JobQueue();
  const policy = options.policy ?? readPolicy(options.dir);
  return {
    ingest: new IngestManager({ vault, schemas, interpretation, review: new ReviewEngine(), recall, queue, policy }),
    map: new MapManager({ vault, schemas, interpretation, analysis }),
    explore: new ExploreManager({
      vault,
      analysis,
      recall,
      embedder: orDefault(options.embedder, defaultEmbedder),
      reranker: orDefault(options.reranker, () => defaultReranker(gateway)),
    }),
    queue,
    gateway,
    close: () => db.close(),
  };
}

/** Creates a Vault seeded with a Schema file. Refuses to touch an existing Vault. */
export function initVault(options: VaultOptions & { schemaFile: string }): Vault {
  if (vaultExists(options.dir)) throw new Error(`A Vault already exists in ${options.dir}`);
  const schema = loadSchemaFile(options.schemaFile);
  const vault = openVault(options);
  vault.map.changeSchema(schema, {}, USER);
  return vault;
}

