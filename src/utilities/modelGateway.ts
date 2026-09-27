// ModelGateway: the only place that knows how to talk to an inference runtime.

export interface JsonRequest {
  system: string;
  user: string;
  schema: object;
}

export interface ModelGateway {
  readonly name: string;
  /** True when vault content leaves this machine. Clients show a one-line notice. */
  readonly hosted: boolean;
  generateJson(request: JsonRequest): Promise<unknown>;
}

export function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) || host.endsWith(".localhost");
}

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export class OllamaGateway implements ModelGateway {
  readonly name: string;
  readonly hosted: boolean;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
    this.name = options.model ?? "gemma4:latest";
    this.hosted = !isLocalUrl(this.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateJson(request: JsonRequest): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(this.payload(request)),
    });
    if (!response.ok) throw new Error(`Model runtime returned ${response.status}`);
    const data = (await response.json()) as { message?: { content?: string } };
    return JSON.parse(data.message?.content ?? "{}");
  }

  private payload(request: JsonRequest): object {
    return {
      model: this.name,
      stream: false,
      think: false,
      format: request.schema,
      options: { temperature: 0.2 },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    };
  }
}

/** Deterministic gateway for tests and offline demos: replays canned responses in order. */
export class ScriptedGateway implements ModelGateway {
  readonly name = "scripted";
  readonly hosted = false;
  readonly requests: JsonRequest[] = [];

  constructor(private readonly responses: unknown[]) {}

  async generateJson(request: JsonRequest): Promise<unknown> {
    this.requests.push(request);
    if (this.responses.length === 0) throw new Error("No scripted response left");
    return this.responses.shift();
  }
}

/** Turns texts into vectors for dense retrieval. */
export interface Embedder {
  readonly name: string;
  /** Embeds documents (the things being searched). */
  embed(texts: string[]): Promise<number[][]>;
  /** Embeds a search query; instruction-tuned models get their query instruction here. */
  embedQuery?(text: string): Promise<number[]>;
}

/** Qwen3-Embedding is trained with an instruction on the query side only. */
const QUERY_INSTRUCTION = "Instruct: Given what a person is describing, retrieve the items in their graph (things, beliefs, patterns and the relations between them) that it refers to\nQuery: ";

export function queryInstructionFor(model: string): string {
  return model.startsWith("qwen3-embedding") ? QUERY_INSTRUCTION : "";
}

export class OllamaEmbedder implements Embedder {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
    this.name = options.model ?? "qwen3-embedding:0.6b";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.fetchImpl(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.name, input: texts }),
    });
    if (!response.ok) throw new Error(`Embedding model ${this.name} unavailable (${response.status}); try: ollama pull ${this.name}`);
    return ((await response.json()) as { embeddings: number[][] }).embeddings;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embed([`${queryInstructionFor(this.name)}${text}`]);
    return vector;
  }
}
