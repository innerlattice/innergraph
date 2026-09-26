// IngestAccess: adapters that normalise each input source into plain Entry text.

export type InputFormat = "text" | "markdown" | "chat-json";

export interface RawInput {
  content: string;
  format?: InputFormat;
  title?: string;
  source?: string;
}

export interface NormalisedEntry {
  text: string;
  title: string;
  source: string;
  media: string;
}

type Adapter = (input: RawInput) => { text: string; title?: string; media: string };

const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/;

const adapters: Record<InputFormat, Adapter> = {
  text: (input) => ({ text: input.content, media: "text/plain" }),
  markdown: (input) => {
    const text = input.content.replace(FRONT_MATTER, "");
    return { text, title: /^#\s+(.+)$/m.exec(text)?.[1], media: "text/markdown" };
  },
  "chat-json": (input) => ({ text: chatToText(input.content), media: "text/plain" }),
};

function chatToText(content: string): string {
  const messages = JSON.parse(content) as { role?: string; content?: string }[];
  if (!Array.isArray(messages)) throw new Error("chat-json expects an array of {role, content}");
  return messages.map((m) => `${m.role ?? "unknown"}: ${m.content ?? ""}`).join("\n\n");
}

function firstLine(text: string): string {
  return (text.trim().split("\n")[0] ?? "").slice(0, 80) || "Untitled entry";
}

export function normalise(input: RawInput): NormalisedEntry {
  const adapted = adapters[input.format ?? "text"](input);
  const text = adapted.text.trim();
  if (text.length === 0) throw new Error("Entry is empty");
  return {
    text,
    title: input.title ?? adapted.title ?? firstLine(text),
    source: input.source ?? input.format ?? "text",
    media: adapted.media,
  };
}
