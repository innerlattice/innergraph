// Composition root: opens a Vault directory and wires Managers to Engines and Access.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Db, openDatabase } from "./access/database.js";
import { ChatAccess } from "./access/chatAccess.js";
import { SchemaAccess, loadSchemaFile } from "./access/schemaAccess.js";
import { VaultAccess } from "./access/vaultAccess.js";
import { USER } from "./core/types.js";
import { AnalysisEngine } from "./engines/analysisEngine.js";
import { InterpretationEngine } from "./engines/interpretationEngine.js";
import { LlmReranker } from "./engines/llmReranker.js";
import { RecallEngine, type Reranker } from "./engines/recallEngine.js";
import { ChatManager } from "./managers/chatManager.js";
import { ExploreManager } from "./managers/exploreManager.js";
import { IngestManager } from "./managers/ingestManager.js";
import { MapManager } from "./managers/mapManager.js";
import { newKey } from "./utilities/crypto.js";
import { PATHS } from "./paths.js";
import { JobQueue } from "./utilities/jobQueue.js";
import { BUILT_IN_MODEL, LocalEmbedder, loadRuntime } from "./utilities/localEmbedder.js";
import { type Embedder, type ModelGateway, OllamaEmbedder, OllamaGateway } from "./utilities/modelGateway.js";

export interface VaultOptions {
  dir: string;
  key?: string;
  gateway?: ModelGateway;
  now?: () => number;
  /** Environment for chat settings (e.g. OPENROUTER_API_KEY); defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Search stages; null disables one, undefined uses the environment's default. */
  embedder?: Embedder | null;
  reranker?: Reranker | null;
}

export interface Vault {
  ingest: IngestManager;
  map: MapManager;
  explore: ExploreManager;
  chat: ChatManager;
  queue: JobQueue;
  gateway: ModelGateway;
  close(): void;
}

const DB_FILE = "vault.db";
const KEY_FILE = "vault.key";

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

/** The model that comes with the app, unless INNER_GRAPH_EMBED_MODEL names an Ollama model or is "off". */
function defaultEmbedder(): Embedder | undefined {
  const model = process.env.INNER_GRAPH_EMBED_MODEL;
  if (model === "off") return undefined;
  if (!model) return new LocalEmbedder(() => loadRuntime(join(PATHS.models, BUILT_IN_MODEL.name)));
  return new OllamaEmbedder({ baseUrl: process.env.INNER_GRAPH_MODEL_URL, model });
}

/**
 * Off by default: a general chat model is a slow, coarse reranker (seconds per query, tied
 * scores). Opt in with INNER_GRAPH_RERANK=llm; a dedicated cross-encoder would replace it.
 */
function defaultReranker(gateway: ModelGateway): Reranker | undefined {
  return process.env.INNER_GRAPH_RERANK === "llm" ? new LlmReranker(gateway) : undefined;
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
  return {
    ingest: new IngestManager({ vault, schemas, interpretation, recall, queue }),
    map: new MapManager({ vault, schemas, interpretation, analysis }),
    explore: new ExploreManager({
      vault,
      analysis,
      recall,
      embedder: orDefault(options.embedder, defaultEmbedder),
      reranker: orDefault(options.reranker, () => defaultReranker(gateway)),
    }),
    chat: new ChatManager({ chats: new ChatAccess(db), vault, env: options.env }),
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
