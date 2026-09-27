// Chat Client: the in-app assistant. One agent loop (AI SDK) over the same tool registry the MCP
// server exposes, plus `record_entry`, which saves the person's own message as an Entry word
// for word so the quotes it cites can be highlighted in that message.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type LanguageModel,
  type LanguageModelUsage,
  type ToolSet,
  type UIMessage,
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  tool,
  toUIMessageStream,
} from "ai";
import { z } from "zod";
import type { ActorId } from "../core/types.js";
import type { SelectionItem } from "../managers/exploreManager.js";
import { chatModel, modelActor } from "../utilities/chatModel.js";
import type { Vault } from "../vault.js";
import { allowedTools, toolSpecs } from "./tools.js";

interface ChatMetadata {
  contextTokens?: number;
  contextWindow?: number;
}

export type ChatMessage = UIMessage<ChatMetadata>;

export interface ChatRequest {
  id: string;
  message: ChatMessage;
}

/** Tools an in-app conversation never needs: it records the person's own words instead. */
const HIDDEN = new Set(["add_entry"]);
const MAX_STEPS = 24;

const SKILL_FILE = join(import.meta.dirname, "..", "..", "plugin", "skills", "inner-graph", "SKILL.md");

function skillText(): string {
  return readFileSync(SKILL_FILE, "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
}

const IN_APP = `You are the assistant inside the Inner Graph app. The person talks to you in a chat
beside a live view of their graph; they are not a developer and never see tool names.

- When they share writing about their life (a journal entry, a reflection, something that
  happened, how they feel), first call \`record_entry\` to save their message word for word,
  then decompose it with \`add_to_graph\` using the returned entry id. Quote their message
  exactly; every quote is highlighted in their message, so keep quotes short and precise.
  In this app use \`record_entry\`, never \`add_entry\`.
- If a tool call fails, read the error, fix the call and try again. Never say you changed
  something unless the tool returned it.
- Questions, corrections and small talk are not entries; answer or act on the graph directly.
- Keep replies short, warm and plain. Say what you changed in a sentence or two and ask
  whether it fits; the app already shows each change as a card with an Undo button.`;

function selectionText(items: SelectionItem[]): string {
  if (items.length === 0) return "";
  const lines = items.map((i) => `- ${i.label} (${i.kind} ${i.type}, id ${i.id})`);
  return `\n\nThe person currently has these selected in the graph view ("these", "this", "the selected ones"):\n${lines.join("\n")}`;
}

export function chatInstructions(selection: SelectionItem[], skill: string = skillText()): string {
  return `${IN_APP}\n\n${skill.trim()}${selectionText(selection)}`;
}

export function messageText(message: UIMessage): string {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** The shared write-tier tools as AI SDK tools, plus `record_entry` for the person's latest message. */
export function chatTools(vault: Vault, actor: ActorId, latestText: string): ToolSet {
  const tools: ToolSet = {};
  for (const spec of allowedTools(toolSpecs(vault, actor), "write").filter((s) => !HIDDEN.has(s.name))) {
    tools[spec.name] = tool({ description: spec.description, inputSchema: z.object(spec.input), execute: async (args) => spec.run(args) });
  }
  tools.record_entry = tool({
    description: "Save the person's latest message, word for word, as an Entry. Returns the entry id to cite with add_to_graph.",
    inputSchema: z.object({ title: z.string().optional().describe("A short title, e.g. 'Tuesday at work'") }),
    execute: async ({ title }) => {
      const added = vault.ingest.addEntry({ content: latestText, title }, { actor, interpret: false });
      return { entry: added.entry, title: vault.explore.entry(added.entry).entry.title };
    },
  });
  return tools;
}

/** How much of the context the conversation now fills: the last step's prompt plus its answer. */
export function contextTokensOf(usage: LanguageModelUsage | undefined, fallback: number): number {
  if (!usage) return fallback;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) || fallback;
}

/** Fields that are lists; small models sometimes send a single string instead. */
const LISTS = new Set(["quotes", "ids", "parts"]);

function coerce(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((v) => coerce(v));
  if (typeof value === "string" && key && LISTS.has(key)) return [value];
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, coerce(v, k)]),
  );
}

/** Fixes the usual slips in a tool call's JSON input (a string for a list, null for absent); undefined when there is nothing to fix. */
export function repairInput(input: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(input);
  } catch {
    return undefined;
  }
  const fixed = JSON.stringify(coerce(value));
  return fixed === JSON.stringify(value) ? undefined : fixed;
}

/** A rough count (about four characters a token) for servers that report no usage. */
export function estimateTokens(...parts: unknown[]): number {
  return Math.ceil(JSON.stringify(parts).length / 4);
}

/** Runs one turn: loads the conversation, streams the answer, and stores it when done. */
export async function respondToChat(vault: Vault, request: ChatRequest, model?: LanguageModel): Promise<Response> {
  const { chat, budget } = vault.chat.open(request.id);
  vault.chat.assertRoom(chat);
  const settings = vault.chat.settings();
  const actor = modelActor(settings.model);
  const messages = [...(chat.messages as ChatMessage[]), request.message];
  const tools = chatTools(vault, actor, messageText(request.message));
  const instructions = chatInstructions(vault.explore.selection().items);
  const estimate = estimateTokens(instructions, messages);
  const choice = model ? { model, instructions } : chatModel(settings, instructions, vault.chat.chatgpt.planTokens());
  let last: LanguageModelUsage | undefined;
  const result = streamText({
    ...choice,
    messages: await convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true }),
    tools,
    stopWhen: isStepCount(MAX_STEPS),
    repairToolCall: async ({ toolCall }) => {
      const input = repairInput(toolCall.input);
      return input ? { ...toolCall, input } : null;
    },
    onStepEnd: ({ usage }) => {
      last = usage;
    },
  });
  const tokens = () => contextTokensOf(last, Math.max(estimate, budget.contextTokens));
  return createUIMessageStreamResponse({
    stream: toUIMessageStream<ToolSet, ChatMessage>({
      stream: result.stream,
      originalMessages: messages,
      generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
      messageMetadata: ({ part }) => (part.type === "finish" ? { contextTokens: tokens(), contextWindow: settings.contextWindow } : undefined),
      onEnd: ({ messages: all }) => {
        vault.chat.save(request.id, all, tokens());
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    }),
  });
}
