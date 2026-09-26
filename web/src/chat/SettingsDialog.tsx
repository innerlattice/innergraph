// Which model the assistant uses: OpenRouter (hosted, one key for most models) or a local
// OpenAI-compatible server (Ollama, LM Studio). The key is write-only; it never comes back.
import { X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { type ChatProvider, type PublicChatSettings, api } from "../api";

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
      .saveChatSettings({ provider, model: value("model"), apiKey: value("apiKey"), baseUrl: value("baseUrl"), contextWindow: budget > 0 ? budget : undefined })
      .then(props.onSaved)
      .catch((err: Error) => setError(err.message));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/20 p-4 backdrop-blur-sm" role="dialog" aria-label="Settings">
      <form onSubmit={save} className="w-full max-w-md animate-rise space-y-4 rounded-2xl bg-stone-50 p-6 shadow-2xl">
        <header className="flex items-center justify-between">
          <h2 className="font-serif text-xl text-stone-800">Settings</h2>
          <button type="button" aria-label="Close" onClick={props.onClose} className="rounded-md p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700">
            <X size={16} />
          </button>
        </header>
        <fieldset className="flex gap-2">
          {(["openrouter", "local"] as const).map((p) => (
            <label key={p} className={`flex-1 rounded-xl border px-3 py-2 text-sm transition ${provider === p ? "border-clay-300 bg-clay-50 text-stone-800" : "border-stone-200 text-stone-500"}`}>
              <input type="radio" name="provider" className="sr-only" checked={provider === p} onChange={() => setProvider(p)} />
              {p === "openrouter" ? "OpenRouter" : "Local model"}
              <span className="block text-xs text-stone-400">{p === "openrouter" ? "Hosted, many models" : "Stays on this device"}</span>
            </label>
          ))}
        </fieldset>
        <Field label="Model" hint={provider === "openrouter" ? "e.g. anthropic/claude-sonnet-5" : "e.g. gemma4:latest"}>
          <input key={`model-${provider}`} name="model" defaultValue={switched ? "" : props.settings.model} placeholder={switched ? "Default for this provider" : ""} className={INPUT} />
        </Field>
        {provider === "openrouter" ? (
          <Field label="OpenRouter key" hint={props.settings.hasKey ? "A key is saved. Leave empty to keep it." : "Stored encrypted in your vault."}>
            <input name="apiKey" type="password" autoComplete="off" className={INPUT} />
          </Field>
        ) : (
          <Field label="Server address" hint="Any OpenAI-compatible server: Ollama, LM Studio, llama.cpp">
            <input name="baseUrl" defaultValue={props.settings.baseUrl} className={INPUT} />
          </Field>
        )}
        <Field label="Conversation length (tokens)" hint="A conversation warns at 70% of this and ends at 90%.">
          <input key={`budget-${provider}`} name="contextWindow" type="number" min={1000} step={1000} defaultValue={switched ? "" : props.settings.contextWindow} className={INPUT} />
        </Field>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose} className="rounded-full px-4 py-1.5 text-sm text-stone-600 hover:bg-stone-200">
            Cancel
          </button>
          <button type="submit" className="rounded-full bg-clay-500 px-4 py-1.5 text-sm text-white hover:bg-clay-600">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
