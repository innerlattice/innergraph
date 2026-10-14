// ModelGateway: the only place that knows how to talk to an inference runtime.
import { postJson } from "./postJson.js";

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

/** Where Ollama listens by default. */
const OLLAMA_URL = "http://127.0.0.1:11434";

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
    this.baseUrl = options.baseUrl ?? OLLAMA_URL;
    this.name = options.model ?? "gemma4:latest";
    this.hosted = !isLocalUrl(this.baseUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async generateJson(request: JsonRequest): Promise<unknown> {
    const response = await postJson(this.fetchImpl, `${this.baseUrl}/api/chat`, this.payload(request));
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
  /** Embeds a search query; models trained with a query prefix add it here. */
  embedQuery?(text: string): Promise<number[]>;
}
