import type { Navigate } from "../App";
import { ArrowDown } from "lucide-react";
import { type Schema, api } from "../api";
import { edgeLook } from "../design/graph";
import { ExploreButton } from "../components/ExploreButton";
import { EdgeGlyph } from "../components/GraphGlyph";
import { linkWord } from "../components/ItemMarks";
import { AddedBy, Eyebrow } from "../components/ItemMeta";
import { TipBody } from "../components/Tooltip";
import { ErrorNote, StatusPill } from "../components/ui";
import { humanise } from "../../../src/core/edgeText";
import { entryFocus } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { EvidenceCard, StaleNote } from "./NodePanel";
import { type Done, ItemActions } from "./ItemControls";
import { ICON } from "../design/tokens";

export interface EdgePanelProps {
  id: string;
  labels: Record<string, string>;
  readOnly: boolean;
  version?: string;
  onDone: (done: Done) => void;
  onSelect: (id: string) => void;
  navigate: Navigate;
  schema?: Schema | null;
}

/** One Edge: its endpoints, evidence and the review actions its status allows. */
export function EdgePanel(props: EdgePanelProps) {
  const view = useAsync(() => api.edge(props.id), [props.id, props.version]);
  if (!view.data) return <ErrorNote error={view.error} />;
  const { edge, fromLabel, toLabel, evidence } = view.data;
  const look = edgeLook(props.schema, edge.type, edge.sign);
  const relation = linkWord(props.schema ?? null, edge.type, edge.sign);
  const done = (d: Done) => (view.reload(), props.onDone(d));
  return (
    <div className="space-y-5 p-5">
      <header className="space-y-1">
        <Eyebrow
          mark={<EdgeGlyph look={look} />}
          kind={relation}
          confidence={edge.confidence}
          tip={<TipBody title={humanise(relation)} text={edge.sign ? look.description : props.schema?.edgeTypes[edge.type]?.description} />}
        />
        <div className="flex items-start gap-2">
          <h3 className="flex min-w-0 flex-1 flex-col items-start font-serif text-xl leading-snug text-stone-800">
            <button type="button" className="text-left hover:underline" onClick={() => props.onSelect(edge.from)}>
              {fromLabel}
            </button>
            <span className="my-0.5 inline-flex items-center gap-1 pl-0.5 font-sans text-sm text-stone-400 italic">
              <ArrowDown size={ICON.sm} aria-hidden />
              {humanise(edge.type)}
            </span>
            <button type="button" className="text-left hover:underline" onClick={() => props.onSelect(edge.to)}>
              {toLabel}
            </button>
          </h3>
          <ExploreButton subject="edge" kind="Link" name={`${fromLabel} ${relation} ${toLabel}`} target={`${edge.id} from ${edge.from} to ${edge.to}`} />
        </div>
        <StatusPill removed={edge.removed} />
      </header>
      {edge.removed ? <p className="text-sm text-stone-500">Removed. Restore puts it back as it was.</p> : null}
      {props.readOnly ? null : <ItemActions ids={[edge.id]} items={[edge]} onDone={done} />}
      <section className="space-y-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">Evidence</h4>
        {evidence.map((e) => (
          <EvidenceCard key={`${e.entry}-${e.start}`} evidence={e} onOpen={() => props.navigate("entries", entryFocus(e.entry, e.start, e.end))} />
        ))}
        <StaleNote count={edge.staleEvidence} />
      </section>
      <AddedBy actor={edge.assertedBy} />
    </div>
  );
}
