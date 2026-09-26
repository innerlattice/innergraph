// The review queue: everything waiting for the person, grouped, with a plain explanation of
// what each action does. Opened from the status bar.
import type { ReactNode } from "react";
import { type DuplicateGroup, type ItemChange, type MapGraphView, type ViewEdge, type ViewNode, api } from "../api";
import { Button } from "../components/ui";
import { humanise } from "../lib/elements";
import { PendingChanges, ReviewActions, type Reviewed } from "./ReviewControls";

type Item = ViewNode | ViewEdge;

export interface ReviewQueue {
  held: Item[];
  proposed: Item[];
  changes: ItemChange[];
  duplicates: DuplicateGroup[];
}

export function reviewQueue(view: MapGraphView | undefined, duplicates: DuplicateGroup[] = []): ReviewQueue {
  const items = [...Object.values(view?.nodes ?? {}), ...Object.values(view?.edges ?? {})].filter((i) => i.status === "proposed");
  const changes = [...new Map(Object.values(view?.changes ?? {}).flat().map((c) => [c.event.id, c])).values()];
  return { held: items.filter((i) => i.held), proposed: items.filter((i) => !i.held), changes, duplicates };
}

export function queueSize(q: ReviewQueue): number {
  return q.held.length + q.proposed.length + q.changes.length + q.duplicates.length;
}

function Section(props: { title: string; explain: string; count: number; actions?: ReactNode; children: ReactNode }) {
  if (props.count === 0) return null;
  return (
    <section className="space-y-3 border-t border-stone-100 pt-4 first:border-0 first:pt-0">
      <header className="space-y-1">
        <h4 className="flex items-baseline justify-between text-sm font-medium text-stone-800">
          {props.title} <span className="text-xs font-normal text-stone-400">{props.count}</span>
        </h4>
        <p className="text-xs leading-relaxed text-stone-500">{props.explain}</p>
      </header>
      {props.actions}
      {props.children}
    </section>
  );
}

function ItemRow(props: { item: Item; labels: Record<string, string>; reasons?: string[]; onFocus: (id: string) => void }) {
  const { item } = props;
  return (
    <li>
      <button type="button" onClick={() => props.onFocus(item.id)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-stone-100">
        <span className="block text-sm text-stone-800">{props.labels[item.id] ?? item.id}</span>
        <span className="text-xs text-stone-400">
          {humanise(item.type)}
          {props.reasons?.length ? <span className="text-amber-700"> · {props.reasons.join("; ")}</span> : null}
        </span>
      </button>
    </li>
  );
}

function DuplicateRow(props: { group: DuplicateGroup; labels: Record<string, string>; onFocus: (ids: string[]) => void; onDone: () => void }) {
  const keep = props.labels[props.group.ids[0]] ?? props.group.ids[0];
  return (
    <li className="space-y-1.5 rounded-md border border-stone-200 p-2">
      <button type="button" onClick={() => props.onFocus(props.group.ids)} className="block text-left text-sm text-stone-800 hover:underline">
        “{keep}” is recorded {props.group.ids.length} times
      </button>
      <Button onClick={() => api.mergeDuplicates([props.group]).then(props.onDone)}>Merge into one</Button>
    </li>
  );
}

export interface ReviewPanelProps {
  view?: MapGraphView;
  duplicates?: DuplicateGroup[];
  labels: Record<string, string>;
  onFocus: (ids: string[]) => void;
  onDone: (done: Reviewed) => void;
  onClose: () => void;
}

export function ReviewPanel(props: ReviewPanelProps) {
  const q = reviewQueue(props.view, props.duplicates);
  const focus = (id: string) => props.onFocus([id]);
  const refresh = () => props.onDone({ kind: "approve", ids: [] });
  return (
    <div className="space-y-5 p-5">
      <header className="flex items-center justify-between">
        <h3 className="font-serif text-xl text-stone-800">Review</h3>
        <Button onClick={props.onClose}>Close</Button>
      </header>
      {queueSize(q) === 0 ? <p className="text-sm text-stone-500">Nothing is waiting for you.</p> : null}
      <Section title="Waiting for you" count={q.held.length} explain="Bigger suggestions (a new root cause, a new loop, a refactor) stay off the map until you approve them." actions={<ReviewActions ids={q.held.map((i) => i.id)} onDone={props.onDone} labels={{ approve: "Approve all", decline: "Decline all" }} />}>
        <ul>{q.held.map((i) => <ItemRow key={i.id} item={i} labels={props.labels} reasons={props.view?.reasons[i.id]} onFocus={focus} />)}</ul>
      </Section>
      <Section title="Proposed" count={q.proposed.length} explain="Suggestions already on the map as tentative (dashed outline). Approve the ones that fit; decline the ones that don't. Both can be undone." actions={<ReviewActions ids={q.proposed.map((i) => i.id)} onDone={props.onDone} labels={{ approve: "Approve all", decline: "Decline all" }} />}>
        <ul>{q.proposed.map((i) => <ItemRow key={i.id} item={i} labels={props.labels} onFocus={focus} />)}</ul>
      </Section>
      <Section title="Changes to existing items" count={q.changes.length} explain="Suggested edits to things already on the map, such as a rename or a retraction.">
        <PendingChanges changes={q.changes} labels={props.labels} onDone={props.onDone} />
      </Section>
      <Section title="Possible duplicates" count={q.duplicates.length} explain="The same thing recorded more than once. Merging keeps the first one, moves the others' evidence and connections onto it, and can be undone.">
        <ul className="space-y-2">{q.duplicates.map((g) => <DuplicateRow key={g.ids.join()} group={g} labels={props.labels} onFocus={props.onFocus} onDone={refresh} />)}</ul>
      </Section>
    </div>
  );
}
