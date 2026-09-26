// One turn of the conversation. The person's words keep their shape, with every passage the
// assistant put on the map highlighted (click to see it); the assistant's replies interleave
// prose and tool cards in the order they happened.
import { Component, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import type { ChatMessage } from "../api";
import { ToolCard } from "./ToolCard";
import { type Segment, isToolPart, marksFor, recordedEntry, segments, textOf } from "./parts";

export interface MessageActions {
  onSelect: (ids: string[]) => void;
  onOpenEntry: (entry: string) => void;
}

function Highlight(props: { segment: Segment; onSelect: (ids: string[]) => void }) {
  const { segment } = props;
  const pending = segment.ids.length === 0;
  const title = segment.labels.length > 0 ? `On your map: ${segment.labels.join(", ")}` : "Adding to your map…";
  return (
    <mark
      role="button"
      tabIndex={0}
      title={title}
      onClick={() => !pending && props.onSelect(segment.ids)}
      onKeyDown={(e) => e.key === "Enter" && !pending && props.onSelect(segment.ids)}
      className={`rounded-sm box-decoration-clone text-inherit transition ${pending ? "animate-pulse bg-sage-100" : "bg-clay-200/60 decoration-clay-400 underline-offset-4 hover:bg-clay-200 hover:underline"}`}
    >
      {segment.text}
    </mark>
  );
}

/** `replies` answer this message (one may record it as an Entry); `later` is everything after it. */
export function UserMessage(props: { message: ChatMessage; replies: ChatMessage[]; later: ChatMessage[]; onSelect: (ids: string[]) => void }) {
  const text = textOf(props.message);
  const parts = segments(text, marksFor(text, recordedEntry(props.replies), props.later));
  return (
    <div className="flex animate-rise justify-end">
      <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-stone-100 px-4 py-3 font-serif text-[15px] leading-relaxed text-stone-800">
        {parts.map((segment, i) => (segment.marked ? <Highlight key={i} segment={segment} onSelect={props.onSelect} /> : <span key={i}>{segment.text}</span>))}
      </div>
    </div>
  );
}

export function AssistantMessage(props: { message: ChatMessage; streaming: boolean; labels?: Record<string, string> } & MessageActions) {
  return (
    <div className="animate-rise">
      {props.message.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <Streamdown key={i} className="font-serif text-[15px] leading-relaxed text-stone-800" isAnimating={props.streaming} controls={false}>
              {part.text}
            </Streamdown>
          );
        }
        if (isToolPart(part)) return <ToolCard key={part.toolCallId} part={part} labels={props.labels} onSelect={props.onSelect} onOpenEntry={props.onOpenEntry} />;
        return null;
      })}
    </div>
  );
}

/** One message that fails to render shows a note instead of taking the conversation down. */
export class MessageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p className="text-xs text-stone-400">This message couldn't be shown.</p> : this.props.children;
  }
}

/** A slow, breathing dot while the assistant thinks. */
export function Thinking() {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-stone-400" aria-label="Thinking">
      <span className="h-2.5 w-2.5 animate-breathe rounded-full bg-clay-300" />
    </div>
  );
}
