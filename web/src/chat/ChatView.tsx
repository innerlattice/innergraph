// The conversation: the app's main surface. One AI SDK chat per conversation; the server keeps
// the history, so each turn sends only the new message.
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { type ChatBudget, type ChatDetail, type ChatMessage, type PublicChatSettings, type SelectionItem, api } from "../api";
import { BudgetNotice, Composer, FullNotice, SelectionChips } from "./Composer";
import { AssistantMessage, MessageBoundary, Thinking, UserMessage } from "./Message";
import { budgetLevel } from "../../../src/core/budget";
import { errorText, isFullError, isSilent, latestTokens, repliesTo } from "./parts";

interface ChatActions {
  onSelect: (ids: string[]) => void;
  onOpenEntry: (entry: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onTurnEnd: () => void;
  onDeselect: (id: string) => void;
  onClearSelection: () => void;
}

export interface ChatViewProps extends ChatActions {
  id: string;
  selection: SelectionItem[];
  settings?: PublicChatSettings;
  labels?: Record<string, string>;
}

const SUGGESTIONS = ["Something happened today that I keep thinking about…", "Help me understand a pattern I keep falling into", "What's on my map so far?"];

function Greeting(props: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
      <span className="mb-6 h-3 w-3 animate-breathe rounded-full bg-clay-300" />
      <h1 className="font-serif text-3xl text-stone-800">What's on your mind?</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-stone-500">Write freely: a journal entry, a moment from today, a feeling you can't quite name. I'll help you see how it connects.</p>
      <div className="mt-8 flex max-w-lg flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => props.onPick(s)} className="rounded-2xl bg-white/70 shadow-rest px-4 py-2.5 text-left font-serif text-sm text-stone-600 transition hover:border-clay-200 hover:bg-white">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function footerFor(settings?: PublicChatSettings): string {
  if (!settings) return "";
  if (!settings.hosted) return `Private to this device, using ${settings.model}`;
  const via: Record<string, string> = { openrouter: " through OpenRouter", chatgpt: " through your ChatGPT plan" };
  return `Your messages go to ${settings.model}${via[settings.provider] ?? " off this device"}`;
}

function KeyNotice(props: { settings?: PublicChatSettings; onOpenSettings: () => void }) {
  if (props.settings?.provider !== "openrouter" || props.settings.hasKey) return null;
  return (
    <p className="mb-2 rounded-xl bg-stone-100 px-3.5 py-2 text-xs text-stone-600">
      Add an OpenRouter key to start.{" "}
      <button type="button" className="underline" onClick={props.onOpenSettings}>
        Open settings
      </button>
    </p>
  );
}

function transportFor() {
  return new DefaultChatTransport<ChatMessage>({ api: "/api/chat", prepareSendMessagesRequest: ({ messages, id }) => ({ body: { id, message: messages.at(-1) } }) });
}

function useBudget(messages: ChatMessage[], stored: ChatBudget, error: Error | undefined) {
  const tokens = latestTokens(messages, stored.contextTokens);
  const window = messages.map((m) => m.metadata?.contextWindow).filter(Boolean).at(-1) ?? stored.contextWindow;
  return { share: tokens / window, level: isFullError(error) ? "full" : budgetLevel(tokens, window) };
}

interface ListProps extends ChatViewProps {
  messages: ChatMessage[];
  busy: boolean;
  error?: Error;
  full: boolean;
}

/** Below the last message: thinking, a reply that said nothing, or what went wrong. */
function TurnNotes(props: { last?: ChatMessage; busy: boolean; error?: Error; full: boolean }) {
  const { last, busy, error } = props;
  if (busy) return last?.role !== "assistant" || last.parts.at(-1)?.type !== "text" ? <Thinking /> : null;
  if (error) return props.full ? null : <p className="rounded-xl bg-rose-50 px-3.5 py-2 text-sm text-rose-800">{errorText(error)}</p>;
  return isSilent(last) ? <p className="text-sm text-stone-400">The assistant stopped without replying. You can ask it to go on.</p> : null;
}

function MessageList(props: ListProps) {
  const { messages, busy } = props;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [messages, busy]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-5 px-6 pt-10 pb-6">
        {messages.map((m, i) => (
          <MessageBoundary key={m.id}>
            {m.role === "user" ? (
              <UserMessage message={m} replies={repliesTo(messages, i)} later={messages.slice(i + 1)} onSelect={props.onSelect} />
            ) : (
              <AssistantMessage message={m} streaming={busy && i === messages.length - 1} labels={props.labels} onSelect={props.onSelect} onOpenEntry={props.onOpenEntry} />
            )}
          </MessageBoundary>
        ))}
        <TurnNotes last={messages.at(-1)} busy={busy} error={props.error} full={props.full} />
        <div ref={end} />
      </div>
    </div>
  );
}

function Conversation(props: ChatViewProps & { initial: ChatMessage[]; budget: ChatBudget }) {
  const transport = useMemo(transportFor, []);
  const { messages, sendMessage, status, error, stop } = useChat<ChatMessage>({ id: props.id, messages: props.initial, transport, onFinish: props.onTurnEnd });
  const [draft, setDraft] = useState<string>();
  const busy = status === "submitted" || status === "streaming";
  const { share, level } = useBudget(messages, props.budget, error);
  return (
    <div className="flex h-full flex-col">
      {messages.length === 0 ? <Greeting onPick={setDraft} /> : <MessageList {...props} messages={messages} busy={busy} error={error} full={level === "full"} />}
      <div className="mx-auto w-full max-w-2xl px-6 pb-5">
        {level === "full" ? (
          <FullNotice onNewChat={props.onNewChat} />
        ) : (
          <>
            <KeyNotice settings={props.settings} onOpenSettings={props.onOpenSettings} />
            <BudgetNotice level={level} share={share} />
            <SelectionChips items={props.selection} onRemove={props.onDeselect} onSelect={props.onSelect} onClear={props.onClearSelection} />
            <Composer busy={busy} draft={draft} footer={footerFor(props.settings)} share={share} onSend={(text) => sendMessage({ text })} onStop={stop} />
          </>
        )}
      </div>
    </div>
  );
}

/** Loads a conversation (a new id simply starts empty) and hands it to the chat. */
export function ChatView(props: ChatViewProps) {
  const [loaded, setLoaded] = useState<{ id: string; detail?: ChatDetail }>();
  useEffect(() => {
    let live = true;
    api
      .chat(props.id)
      .then((detail) => live && setLoaded({ id: props.id, detail }))
      .catch(() => live && setLoaded({ id: props.id }));
    return () => {
      live = false;
    };
  }, [props.id]);
  if (loaded?.id !== props.id) return null;
  const budget = loaded.detail?.budget ?? { contextTokens: 0, contextWindow: props.settings?.contextWindow ?? 32_000, level: "ok" as const };
  return <Conversation key={props.id} {...props} initial={loaded.detail?.chat.messages ?? []} budget={budget} />;
}
