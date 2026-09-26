// The chat model for a provider setting: OpenRouter (one key, most models) or any local
// OpenAI-compatible server (Ollama, LM Studio, llama.cpp). The only place that knows providers.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export interface ChatModelSettings {
  provider: "openrouter" | "local";
  model: string;
  apiKey?: string;
  baseUrl: string;
}

export class ChatModelError extends Error {}

export function chatModel(settings: ChatModelSettings): LanguageModel {
  if (settings.provider === "local") {
    return createOpenAICompatible({ name: "local", baseURL: settings.baseUrl, apiKey: settings.apiKey })(settings.model);
  }
  if (!settings.apiKey) throw new ChatModelError("Add an OpenRouter key in Settings, or switch to a local model.");
  return createOpenRouter({ apiKey: settings.apiKey })(settings.model);
}

/** "anthropic/claude-sonnet-5" → "claude-sonnet-5": how the model appears as an Actor. */
export function modelActor(model: string): string {
  return `model:${model.split("/").at(-1)}`;
}
