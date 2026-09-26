import { useEffect, useState } from "react";
import type { Navigate } from "../App";
import { type IngestResult, type Job, type RelatedItem, api } from "../api";
import { Button, Card, ErrorNote, Page } from "../components/ui";

const FORMATS = [
  { value: "text", label: "Plain text" },
  { value: "markdown", label: "Markdown" },
  { value: "chat-json", label: "Chat export (JSON)" },
];

/** Polls a job until it settles. */
export function useJob(id: string | undefined, intervalMs = 1500): Job | undefined {
  const [job, setJob] = useState<Job>();
  useEffect(() => {
    if (!id) return;
    let live = true;
    const poll = async () => {
      const next = await api.job(id).catch(() => undefined);
      if (!live) return;
      setJob(next);
      if (next?.state === "queued" || next?.state === "running") timer = setTimeout(poll, intervalMs);
    };
    let timer = setTimeout(poll, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, intervalMs]);
  return job;
}

export function Related(props: { items: RelatedItem[] }) {
  const [open, setOpen] = useState(false);
  if (props.items.length === 0) return null;
  return (
    <Card className="bg-stone-50">
      <button type="button" className="text-sm text-stone-600 underline-offset-2 hover:underline" onClick={() => setOpen(!open)}>
        {open ? "Hide related material" : `Something from before may be related (${props.items.length}). Show?`}
      </button>
      {open ? (
        <ul className="mt-3 space-y-3">
          {props.items.map((item) => (
            <li key={item.id} className="text-sm">
              <p className="font-medium text-stone-700">{item.title}</p>
              <p className="text-stone-500">{item.snippet}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function JobStatus(props: { job?: Job; model?: string; navigate: Navigate }) {
  const { job, navigate } = props;
  if (!job) return null;
  const text: Record<Job["state"], string> = {
    queued: "Waiting to interpret…",
    running: "Reading your entry and drafting a proposal…",
    done: "Proposal ready. Low-impact items were added as hypotheses.",
    failed: `Interpretation did not finish: ${job.error ?? "unknown error"}. The entry is saved.`,
  };
  return (
    <Card className="flex items-center justify-between gap-4">
      <p className="text-sm text-stone-600">{text[job.state]}</p>
      {job.state === "done" ? <Button onClick={() => navigate("review")}>Open review</Button> : null}
    </Card>
  );
}

export function WriteView(props: { navigate: Navigate }) {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState("text");
  const [result, setResult] = useState<IngestResult>();
  const [error, setError] = useState<string>();
  const job = useJob(result?.job?.id);

  const submit = async () => {
    setError(undefined);
    try {
      setResult(await api.addEntry({ content, title: title || undefined, format }));
      setContent("");
      setTitle("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Page title="Write" subtitle="Journal, transcript or reflection. Everything stays on this device.">
      <div className="space-y-4">
        <Card className="space-y-3">
          <input className="w-full border-0 bg-transparent font-serif text-lg outline-none placeholder:text-stone-300" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea
            className="h-72 w-full resize-y border-0 bg-transparent font-serif leading-relaxed outline-none placeholder:text-stone-300"
            placeholder="Write freely…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <div className="flex items-center justify-between border-t border-stone-100 pt-3">
            <select aria-label="Format" className="rounded-md border border-stone-200 bg-white px-2 py-1 text-sm" value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <Button tone="primary" disabled={!content.trim()} onClick={submit}>
              Add entry
            </Button>
          </div>
        </Card>
        <ErrorNote error={error} />
        <JobStatus job={job} navigate={props.navigate} />
        <Related items={result?.related ?? []} />
      </div>
    </Page>
  );
}
