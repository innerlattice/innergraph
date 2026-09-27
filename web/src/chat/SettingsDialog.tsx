// Which model the assistant uses: the person's ChatGPT plan (signed in with a code on OpenAI's
// page), OpenRouter (one key, many models), or a local OpenAI-compatible server. Keys and
// tokens are write-only; they never come back to the page.
import { Check, Copy, ExternalLink, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { type ChatProvider, type LinkStatus, PLAN_MODELS, type PublicChatSettings, api } from "../api";
import { Button, buttonClass } from "../components/ui";

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-stone-700">{props.label}</span>
      {props.children}
      {props.hint ? <span className="mt-1 block text-xs text-stone-400">{props.hint}</span> : null}
    </label>
  );
}

const INPUT = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-clay-300";

const PROVIDERS: { id: ChatProvider; name: string; note: string }[] = [
  { id: "chatgpt", name: "ChatGPT plan", note: "Your subscription" },
  { id: "openrouter", name: "OpenRouter", note: "Many models, one key" },
  { id: "local", name: "Local model", note: "Stays on this device" },
];

function ProviderPicker(props: { value: ChatProvider; onChange: (p: ChatProvider) => void }) {
  return (
    <fieldset className="grid grid-cols-3 gap-2">
      {PROVIDERS.map((p) => (
        <label key={p.id} className={`rounded-xl border px-3 py-2 text-sm transition ${props.value === p.id ? "border-clay-300 bg-clay-50 text-stone-800" : "border-stone-200 text-stone-500"}`}>
          <input type="radio" name="provider" className="sr-only" checked={props.value === p.id} onChange={() => props.onChange(p.id)} />
          {p.name}
          <span className="block text-xs text-stone-400">{p.note}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** How often a pending sign-in is checked; tests shorten it. */
export const linkPoll = { ms: 2500 };

/** Polls the link while a sign-in is pending, so the dialog notices when the person finishes. */
function useLink() {
  const [status, setStatus] = useState<LinkStatus>();
  const [error, setError] = useState<string>();
  const run = (call: () => Promise<LinkStatus>) =>
    call()
      .then((s) => (setStatus(s), setError(undefined)))
      .catch((e: Error) => setError(e.message));
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  useEffect(() => void run(api.chatgptStatus), []);
  useEffect(() => {
    if (status?.state !== "pending") return;
    const timer = setInterval(() => void run(api.chatgptStatus), linkPoll.ms);
    return () => clearInterval(timer);
  }, [status?.state]);
  return { status, error: error ?? status?.error, connect: () => run(api.connectChatgpt), disconnect: () => run(api.disconnectChatgpt) };
}

function CodeBox(props: { code: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard
      ?.writeText(props.code)
      .then(() => setCopied(true))
      .catch(() => undefined);
  return (
    <div className="space-y-3 rounded-xl border border-clay-200 bg-clay-50 p-4 text-center">
      <p className="text-sm text-stone-600">Enter this code on OpenAI's page:</p>
      <div className="flex items-center justify-center gap-2">
        <span className="font-mono text-2xl tracking-[0.2em] text-stone-800">{props.code}</span>
        <button type="button" aria-label="Copy code" onClick={copy} className="rounded-md p-1.5 text-stone-500 hover:bg-clay-100">
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <a href={props.url} target="_blank" rel="noreferrer" className={buttonClass("primary")}>
        Open OpenAI <ExternalLink size={13} />
      </a>
      <p className="flex items-center justify-center gap-2 text-xs text-stone-500">
        <span className="h-2 w-2 animate-breathe rounded-full bg-clay-400" /> Waiting for you to finish there…
      </p>
    </div>
  );
}

function Connected(props: { status: LinkStatus; onDisconnect: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-sage-200 bg-sage-50 px-3 py-2 text-sm text-sage-700">
      <span>
        Connected{props.status.plan ? ` · ${props.status.plan}` : ""}
        {props.status.email ? <span className="block text-xs text-sage-600">{props.status.email}</span> : null}
      </span>
      <button type="button" onClick={props.onDisconnect} className="rounded-full px-3 py-1 text-xs hover:bg-sage-100">
        Disconnect
      </button>
    </div>
  );
}

function Pending(props: { status: LinkStatus; onCancel: () => void }) {
  return (
    <>
      <CodeBox code={props.status.userCode ?? ""} url={props.status.url ?? ""} />
      <button type="button" onClick={props.onCancel} className="w-full text-xs text-stone-400 hover:text-stone-700">
        Cancel
      </button>
    </>
  );
}

function LinkState(props: { status?: LinkStatus; onConnect: () => void; onDisconnect: () => void }) {
  const { status } = props;
  if (status?.state === "connected") return <Connected status={status} onDisconnect={props.onDisconnect} />;
  if (status?.state === "pending") return <Pending status={status} onCancel={props.onDisconnect} />;
  if (!status) return null;
  return (
    <button type="button" onClick={props.onConnect} className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-700 hover:border-clay-300 hover:bg-clay-50">
      Connect ChatGPT
    </button>
  );
}

function ChatGptConnection() {
  const { status, error, connect, disconnect } = useLink();
  return (
    <div className="space-y-2">
      <LinkState status={status} onConnect={connect} onDisconnect={disconnect} />
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      <p className="text-xs text-stone-400">Messages go to OpenAI under your plan. If the code is refused, turn on device code sign-in in ChatGPT's security settings.</p>
    </div>
  );
}

function PlanModelFields(props: { settings: PublicChatSettings; switched: boolean }) {
  const initial = props.switched ? "gpt-6-sol" : props.settings.model;
  const [model, setModel] = useState(initial);
  const efforts = PLAN_MODELS.find((m) => m.id === model)?.efforts ?? ["low", "medium", "high"];
  const models = PLAN_MODELS.some((m) => m.id === initial) ? PLAN_MODELS : [{ id: initial, label: initial, efforts }, ...PLAN_MODELS];
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Model">
        <select name="model" value={model} onChange={(e) => setModel(e.target.value)} className={INPUT}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reasoning">
        <select key={model} name="effort" defaultValue={efforts.includes(props.settings.effort ?? "") ? props.settings.effort : "medium"} className={INPUT}>
          {efforts.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function ProviderFields(props: { provider: ChatProvider; settings: PublicChatSettings; switched: boolean }) {
  const { provider, settings, switched } = props;
  if (provider === "chatgpt") {
    return (
      <>
        <ChatGptConnection />
        <PlanModelFields settings={settings} switched={switched} />
      </>
    );
  }
  return (
    <>
      <Field label="Model" hint={provider === "openrouter" ? "e.g. anthropic/claude-sonnet-5" : "e.g. gemma4:latest"}>
        <input key={`model-${provider}`} name="model" defaultValue={switched ? "" : settings.model} placeholder={switched ? "Default for this provider" : ""} className={INPUT} />
      </Field>
      {provider === "openrouter" ? (
        <Field label="OpenRouter key" hint={settings.hasKey ? "A key is saved. Leave empty to keep it." : "Stored encrypted in your vault."}>
          <input name="apiKey" type="password" autoComplete="off" className={INPUT} />
        </Field>
      ) : (
        <Field label="Server address" hint="Any OpenAI-compatible server: Ollama, LM Studio, llama.cpp">
          <input name="baseUrl" defaultValue={settings.baseUrl} className={INPUT} />
        </Field>
      )}
    </>
  );
}

export function SettingsDialog(props: { settings: PublicChatSettings; onSaved: (settings: PublicChatSettings) => void; onClose: () => void }) {
  const [provider, setProvider] = useState<ChatProvider>(props.settings.provider);
  const switched = provider !== props.settings.provider;
  const [error, setError] = useState<string>();
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (name: string) => (form.get(name) as string | null)?.trim() || undefined;
    const budget = Number(value("contextWindow"));
    api
      .saveChatSettings({ provider, model: value("model"), effort: value("effort"), apiKey: value("apiKey"), baseUrl: value("baseUrl"), contextWindow: budget > 0 ? budget : undefined })
      .then(props.onSaved)
      .catch((err: Error) => setError(err.message));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/20 p-4 backdrop-blur-sm" role="dialog" aria-label="Settings">
      <form onSubmit={save} className="max-h-full w-full max-w-lg animate-rise space-y-4 overflow-y-auto rounded-2xl bg-stone-50 p-6 shadow-2xl">
        <header className="flex items-center justify-between">
          <h2 className="font-serif text-xl text-stone-800">Settings</h2>
          <button type="button" aria-label="Close" onClick={props.onClose} className="rounded-md p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700">
            <X size={16} />
          </button>
        </header>
        <ProviderPicker value={provider} onChange={setProvider} />
        <ProviderFields provider={provider} settings={props.settings} switched={switched} />
        <Field label="Conversation length (tokens)" hint="A conversation warns at 70% of this and ends at 90%.">
          <input key={`budget-${provider}`} name="contextWindow" type="number" min={1000} step={1000} defaultValue={switched ? "" : props.settings.contextWindow} className={INPUT} />
        </Field>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button tone="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button tone="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}
