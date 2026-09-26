// ChatManager: conversations with the assistant, which model they use, and how much room is
// left in the model's context. A full conversation ends; compaction is not built yet.
import type { ChatAccess, ChatRecord, ChatSummary } from "../access/chatAccess.js";
import type { VaultAccess } from "../access/vaultAccess.js";
import { newId } from "../utilities/crypto.js";
import { isLocalUrl } from "../utilities/modelGateway.js";
import { requireFound } from "./sessions.js";

export type ChatProvider = "openrouter" | "local";

export interface ChatSettings {
  provider: ChatProvider;
  model: string;
  /** OpenRouter key; never sent back to Clients. */
  apiKey?: string;
  /** OpenAI-compatible endpoint for a local model (Ollama, LM Studio, llama.cpp). */
  baseUrl: string;
  /** Token budget for one conversation; it ends as it nears this. */
  contextWindow: number;
}

export interface PublicChatSettings extends Omit<ChatSettings, "apiKey"> {
  hasKey: boolean;
  /** True when messages leave this device. */
  hosted: boolean;
}

export type BudgetLevel = "ok" | "warn" | "full";

export interface ChatBudget {
  contextTokens: number;
  contextWindow: number;
  level: BudgetLevel;
}

export interface ChatView {
  chat: ChatRecord;
  budget: ChatBudget;
}

/** From here on the person is warned; from FULL_AT the conversation takes no more turns. */
export const WARN_AT = 0.7;
export const FULL_AT = 0.9;

export const OPENROUTER_DEFAULTS = { model: "anthropic/claude-sonnet-5", contextWindow: 200_000 };
export const LOCAL_DEFAULTS = { model: "gemma4:latest", baseUrl: "http://127.0.0.1:11434/v1", contextWindow: 32_000 };

const NEW_TITLE = "New conversation";
const SETTINGS_KEY = "chat";

export class ChatFullError extends Error {}

export function budgetLevel(contextTokens: number, contextWindow: number): BudgetLevel {
  const share = contextTokens / contextWindow;
  if (share >= FULL_AT) return "full";
  return share >= WARN_AT ? "warn" : "ok";
}

interface TextMessage {
  role?: string;
  parts?: { type?: string; text?: string }[];
}

/** A title from the first thing the person said, cut at a word boundary. */
export function titleFrom(messages: unknown[]): string | undefined {
  const first = (messages as TextMessage[]).find((m) => m.role === "user");
  const text = (first?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join(" ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length <= 60 ? text : `${text.slice(0, 60).replace(/\s+\S*$/, "")}…`;
}

export interface ChatDeps {
  chats: ChatAccess;
  vault: VaultAccess;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}

export class ChatManager {
  private readonly now: () => Date;
  private readonly env: Record<string, string | undefined>;

  constructor(private readonly deps: ChatDeps) {
    this.now = deps.now ?? (() => new Date());
    this.env = deps.env ?? process.env;
  }

  list(): (ChatSummary & { budget: ChatBudget })[] {
    const { contextWindow } = this.settings();
    return this.deps.chats.list().map((c) => ({ ...c, budget: { contextTokens: c.contextTokens, contextWindow, level: budgetLevel(c.contextTokens, contextWindow) } }));
  }

  get(id: string): ChatView {
    const chat = requireFound(this.deps.chats.read(id), `Conversation ${id}`);
    return { chat, budget: this.budget(chat) };
  }

  create(id: string = newId(), title = NEW_TITLE): ChatView {
    const at = this.now().toISOString();
    const chat = { id, title, createdAt: at, updatedAt: at, contextTokens: 0, messages: [] };
    this.deps.chats.write(chat);
    return { chat, budget: this.budget(chat) };
  }

  /** The conversation, created on first use so a Client can pick its own id. */
  open(id: string): ChatView {
    return this.deps.chats.read(id) ? this.get(id) : this.create(id);
  }

  rename(id: string, title: string): ChatView {
    const { chat } = this.get(id);
    this.deps.chats.write({ ...chat, title: title.trim() || chat.title });
    return this.get(id);
  }

  remove(id: string): { removed: boolean } {
    return { removed: this.deps.chats.delete(id) };
  }

  /** Stores a finished turn; the first message names a new conversation. */
  save(id: string, messages: unknown[], contextTokens: number): ChatView {
    const { chat } = this.open(id);
    const title = chat.title === NEW_TITLE ? (titleFrom(messages) ?? chat.title) : chat.title;
    this.deps.chats.write({ ...chat, title, messages, contextTokens, updatedAt: this.now().toISOString() });
    return this.get(id);
  }

  /** Refuses another turn in a full conversation. */
  assertRoom(chat: ChatRecord): void {
    if (this.budget(chat).level === "full") throw new ChatFullError("This conversation is full. Start a new one to keep going.");
  }

  budget(chat: ChatSummary): ChatBudget {
    const { contextWindow } = this.settings();
    return { contextTokens: chat.contextTokens, contextWindow, level: budgetLevel(chat.contextTokens, contextWindow) };
  }

  /** Stored settings over sensible defaults; an OPENROUTER_API_KEY in the environment also counts. */
  settings(): ChatSettings {
    const stored = this.deps.vault.readSetting<Partial<ChatSettings>>(SETTINGS_KEY) ?? {};
    const apiKey = stored.apiKey ?? this.env.OPENROUTER_API_KEY;
    const provider = stored.provider ?? (apiKey ? "openrouter" : "local");
    const defaults = provider === "openrouter" ? OPENROUTER_DEFAULTS : LOCAL_DEFAULTS;
    return { baseUrl: LOCAL_DEFAULTS.baseUrl, ...defaults, ...stored, provider, apiKey };
  }

  publicSettings(): PublicChatSettings {
    const { apiKey, ...rest } = this.settings();
    return { ...rest, hasKey: Boolean(apiKey), hosted: rest.provider === "openrouter" || !isLocalUrl(rest.baseUrl) };
  }

  /** Switching provider resets model and budget to that provider's defaults unless given. */
  updateSettings(patch: Partial<ChatSettings>): PublicChatSettings {
    const stored = this.deps.vault.readSetting<Partial<ChatSettings>>(SETTINGS_KEY) ?? {};
    const switching = patch.provider !== undefined && patch.provider !== this.settings().provider;
    const base = switching ? { apiKey: stored.apiKey, baseUrl: stored.baseUrl } : stored;
    const next = Object.fromEntries(Object.entries({ ...base, ...patch }).filter(([, v]) => v !== undefined && v !== ""));
    this.deps.vault.writeSetting(SETTINGS_KEY, next);
    return this.publicSettings();
  }
}
