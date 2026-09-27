import { ItemChip } from "../components/ItemChip";
import { LinkMark } from "../components/ItemMarks";
import type { Navigate } from "../App";
import { type LoopStepView, type LoopView, api } from "../api";
import { Button, Card, Empty, ErrorNote, Page } from "../components/ui";
import { pct } from "../lib/format";
import { implications, loopFocus } from "../lib/loops";
import { useAsync } from "../lib/useAsync";
import { useLive } from "../lib/useLive";

function StepRow(props: { step: LoopStepView; onOpen: (focus: string) => void }) {
  const { step } = props;
  return (
    <li className="space-y-1">
      <p className="flex flex-wrap items-center gap-1.5 text-sm">
        <ItemChip id={step.from} label={step.fromLabel} onClick={() => props.onOpen(step.from)} />
        <LinkMark type={step.type} sign={step.sign} />
        <ItemChip id={step.to} label={step.toLabel} onClick={() => props.onOpen(step.to)} />
        <span className="text-xs text-stone-400">{pct(step.confidence)} sure</span>
      </p>
      {step.quotes.map((q) => (
        <p key={q} className="border-l-2 border-stone-200 pl-3 font-serif text-sm text-stone-500">
          “{q}”
        </p>
      ))}
    </li>
  );
}

function Steps(props: { title: string; steps: LoopStepView[]; onOpen: (focus: string) => void }) {
  if (props.steps.length === 0) return null;
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">{props.title}</h4>
      <ol className="space-y-3">
        {props.steps.map((s) => (
          <StepRow key={s.edge} step={s} onOpen={props.onOpen} />
        ))}
      </ol>
    </section>
  );
}

export function LoopCard(props: { loop: LoopView; onOpen: (focus: string) => void }) {
  const { loop } = props;
  const reinforcing = loop.polarity === "reinforcing";
  return (
    <Card className="space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className={`text-xs font-medium ${reinforcing ? "text-clay-600" : "text-slate-600"}`}>
            {reinforcing ? "Reinforcing loop: it feeds itself" : "Balancing loop: it holds itself steady"}
          </p>
          <h3 className="font-serif text-lg text-stone-800">{[...loop.steps.map((s) => s.fromLabel), loop.steps[0]?.fromLabel].join(" → ")}</h3>
          <p className="text-xs text-stone-400">
            {loop.steps.length} steps, {pct(loop.certainty)} certain
            {loop.linkedLoops > 0 ? `, overlapping ${loop.linkedLoops} other loop${loop.linkedLoops === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <Button onClick={() => props.onOpen(loopFocus(loop))}>Show on map</Button>
      </header>
      <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600">
        {implications(loop).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <Steps title="Steps" steps={loop.steps} onOpen={props.onOpen} />
      <Steps title="Coming in from outside" steps={loop.inputs} onOpen={props.onOpen} />
      <Steps title="What this loop drives" steps={loop.outputs} onOpen={props.onOpen} />
    </Card>
  );
}

export function LoopsView(props: { navigate: Navigate }) {
  const loops = useAsync(api.loops);
  useLive(loops.reload);
  return (
    <Page
      title="Loops"
      subtitle="Chains that come back round, so each thing keeps the next one going. A loop is a pattern to notice, not a problem to fix. Ask the assistant what one might mean for you."
    >
      <ErrorNote error={loops.error} />
      <div className="space-y-4">
        {loops.data?.length === 0 ? <Empty>No loops yet.</Empty> : null}
        {loops.data?.map((loop) => (
          <LoopCard key={loop.edges.join()} loop={loop} onOpen={(focus) => props.navigate("map", focus)} />
        ))}
      </div>
    </Page>
  );
}
