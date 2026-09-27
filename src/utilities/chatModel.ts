// The chat model for the chosen provider: the person's ChatGPT plan, OpenRouter (one key, most
// models) or any local OpenAI-compatible server (Ollama, LM Studio, llama.cpp). The only place
// that knows providers.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { type ChatGptTokens, chatgptModel, chatgptOptions } from "./chatgpt.js";

export type ChatProvider = "openrouter" | "chatgpt" | "local";

export interface ChatModelSettings {
  provider: ChatProvider;
  model: string;
  /** OpenRouter key; never sent back to Clients. */
  apiKey?: string;
  /** OpenAI-compatible endpoint for a local model (Ollama, LM Studio, llama.cpp). */
  baseUrl: string;
  /** Reasoning effort, for models that take one (the ChatGPT plan's). */
  effort?: string;
}

/** Fresh ChatGPT plan tokens on demand; undefined when the person hasn't signed in. */
export type PlanTokens = (() => Promise<ChatGptTokens>) | undefined;

export interface ModelChoice {
  model: LanguageModel;
  instructions?: string;
  providerOptions?: ReturnType<typeof chatgptOptions>;
}

/** The chosen provider can't be used as set up (no key, not signed in). */
export class ChatModelError extends Error {}

/** The model for a turn, with the instructions where the provider takes them. */
export function chatModel(settings: ChatModelSettings, instructions: string, plan?: PlanTokens): ModelChoice {
  if (settings.provider === "chatgpt") return planModel(settings, instructions, plan);
  if (settings.provider === "local") {
    return { model: createOpenAICompatible({ name: "local", baseURL: settings.baseUrl, apiKey: settings.apiKey, includeUsage: true })(settings.model), instructions };
  }
  if (!settings.apiKey) throw new ChatModelError("Add an OpenRouter key in Settings, or switch to a local model.");
  return { model: createOpenRouter({ apiKey: settings.apiKey })(settings.model), instructions };
}

/** The ChatGPT plan takes the instructions as a provider option, next to the reasoning effort. */
function planModel(settings: ChatModelSettings, instructions: string, plan: PlanTokens): ModelChoice {
  if (!plan) throw new ChatModelError("Connect your ChatGPT plan in Settings, or choose another provider.");
  return { model: chatgptModel(settings.model, plan), providerOptions: chatgptOptions(instructions, settings.effort ?? "medium") };
}

/** "anthropic/claude-sonnet-5" → "claude-sonnet-5": how the model appears as an Actor. */
export function modelActor(model: string): string {
  return `model:${model.split("/").at(-1)}`;
}
