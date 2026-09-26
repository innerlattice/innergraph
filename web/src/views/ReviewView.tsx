import { useState } from "react";
import { type ProposalView, api } from "../api";
import { Button, Card, Empty, ErrorNote, Page, Quote } from "../components/ui";
import { actorLabel, describeEvent, formatHlc, labelsFrom, spanText } from "../lib/format";
import { useAsync } from "../lib/useAsync";

type Item = ProposalView["items"][number];

export function evidenceOf(item: Item): { start: number; end: number }[] {
  const body = item.event.body as { evidence?: { start: number; end: number }[] };
  return body.evidence ?? [];
}

function ItemRow(props: { item: Item; labels: Record<string, string>; text: string; onDecide: (accept: boolean) => void }) {
  const { item, labels, text, onDecide } = props;
  return (
    <li className="flex items-start justify-between gap-4 border-t border-stone-100 py-3 first:border-0">
      <div className="min-w-0 space-y-1.5">
        <p className="text-sm text-stone-800">{describeEvent(item.event, labels)}</p>
        {item.reasons.length > 0 ? <p className="text-xs text-amber-700">{item.reasons.join(" · ")}</p> : null}
        {evidenceOf(item).map((e) => (
          <Quote key={`${e.start}-${e.end}`}>{spanText(text, e.start, e.end)}</Quote>
        ))}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button onClick={() => onDecide(false)}>Decline</Button>
        <Button tone="primary" onClick={() => onDecide(true)}>
          Accept
        </Button>
      </div>
    </li>
  );
}

export function ProposalCard(props: { proposal: ProposalView; onChange: () => void }) {
  const { proposal, onChange } = props;
  const context = useAsync(async () => {
    const [graph, entry] = await Promise.all([api.graph(), proposal.entry ? api.entry(proposal.entry) : undefined]);
    return { labels: labelsFrom(graph, proposal.items.map((i) => i.event)), text: entry?.text ?? "" };
  }, [proposal.session]);
  const [error, setError] = useState<string>();
  const pending = proposal.items.filter((i) => i.decision === "pending");

  const decide = async (ids: string[], accept: boolean) => {
    try {
      await api.review(proposal.session, accept ? { accept: ids } : { reject: ids });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card>
      <header className="mb-2 flex items-center justify-between gap-4">
        <div>
          <h3 className="font-medium text-stone-800">{proposal.entryTitle ?? proposal.purpose}</h3>
          <p className="text-xs text-stone-500">
            by {actorLabel(proposal.actor)} · {formatHlc(proposal.openedAt)} · {pending.length} waiting
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => decide(pending.map((i) => i.event.id), false)}>Decline all</Button>
          <Button tone="primary" onClick={() => decide(pending.map((i) => i.event.id), true)}>
            Accept all
          </Button>
        </div>
      </header>
      <ErrorNote error={error} />
      <ul>
        {pending.map((item) => (
          <ItemRow key={item.event.id} item={item} labels={context.data?.labels ?? {}} text={context.data?.text ?? ""} onDecide={(accept) => decide([item.event.id], accept)} />
        ))}
      </ul>
    </Card>
  );
}

export function ReviewView() {
  const proposals = useAsync(api.proposals);
  return (
    <Page title="Review" subtitle="Only higher-impact changes wait here: new roots, new loops and refactors. Accepted items stay hypotheses until you mark them otherwise.">
      <ErrorNote error={proposals.error} />
      <div className="space-y-4">
        {proposals.data?.length === 0 ? <Empty>Nothing is waiting for review.</Empty> : null}
        {proposals.data?.map((p) => (
          <ProposalCard key={p.session} proposal={p} onChange={proposals.reload} />
        ))}
      </div>
    </Page>
  );
}
