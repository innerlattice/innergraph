// How to reach the map from other agents (Claude Desktop, Claude Code, Codex, Hermes Agent): each
// one's snippet, ready to copy into its config. The server writes them, since it knows the command
// that runs this app as an MCP server and where the Vault is.
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { type ConnectInfo, api } from "../api";
import { IconButton } from "../components/IconButton";

function Snippet(props: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard
      ?.writeText(props.code)
      .then(() => setCopied(true))
      .catch(() => undefined);
  return (
    <div className="relative rounded-xl bg-stone-100/70 shadow-inset">
      <pre className="overflow-x-auto p-3 pr-10 font-mono text-xs leading-relaxed text-stone-700">{props.code}</pre>
      <IconButton label={copied ? "Copied" : "Copy"} icon={copied ? Check : Copy} tone="well" onClick={copy} className="absolute top-2 right-2" />
    </div>
  );
}

export function ConnectAgents() {
  const [info, setInfo] = useState<ConnectInfo>();
  const [picked, setPicked] = useState(0);
  useEffect(() => {
    api
      .connect()
      .then(setInfo)
      .catch(() => undefined);
  }, []);
  const agent = info?.agents[picked];
  if (!agent) return null;
  return (
    <section className="space-y-3 border-t border-stone-200 pt-4" aria-label="Connect other agents">
      <div>
        <h3 className="text-sm text-stone-700">Connect other agents</h3>
        <p className="text-xs text-stone-400">
          Let another assistant read and add to this map over MCP. Each one records under its own name, so you can see and undo what it changed.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {info.agents.map((a, i) => (
          <button
            key={a.id}
            type="button"
            aria-pressed={i === picked}
            onClick={() => setPicked(i)}
            className={`rounded-full px-3 py-1 text-xs transition ${i === picked ? "bg-clay-50 text-stone-800 shadow-raised ring-1 ring-clay-300" : "bg-stone-100/70 text-stone-500 hover:bg-stone-100"}`}
          >
            {a.name}
          </button>
        ))}
      </div>
      <p className="text-xs text-stone-500">{agent.how}</p>
      <Snippet key={agent.id} code={agent.snippet} />
      {info.version ? <p className="text-right text-micro text-stone-400">Inner Graph {info.version}</p> : null}
    </section>
  );
}
