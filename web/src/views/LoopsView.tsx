import type { Navigate } from "../App";
import { type LoopStepView, type LoopView, api } from "../api";
import { Button, Card, Empty, ErrorNote, Page } from "../components/ui";
import { implications, loopFocus, pct } from "../lib/loops";
import { useAsync } from "../lib/useAsync";

function Sign(props: { sign: 1 | -1 }) {
  return props.sign === 1 ? (
    <span className="font-bold text-orange-700" title="increases">+</span>
  ) : (
    <span className="font-bold text-sky-700" title="decreases">−</span>
  );
}

export function StepRow(props: { step: LoopStepView }) {
  const { step } = props;
  return (
    <li className="space-y-1">
      <p className="text-sm text-stone-800">
        {step.fromLabel} <span className="text-stone-400">—</span>
        <Sign sign={step.sign} />
        <span className="text-stone-400">→</span> {step.toLabel} <span className="text-xs text-stone-400">· {pct(step.confidence)}</span>
      </p>
      {step.quotes.map((q) => (
        <p key={q} className="border-l-2 border-stone-200 pl-3 font-serif text-sm text-stone-500">
          “{q}”
        </p>
      ))}
    </li>
  );
}

function Steps(props: { title: string; steps: LoopStepView[] }) {
  if (props.steps.length === 0) return null;
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-stone-400">{props.title}</h4>
      <ol className="space-y-3">
        {props.steps.map((s) => (
          <StepRow key={s.edge} step={s} />
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
          <p className={`text-xs font-medium ${reinforcing ? "text-orange-700" : "text-sky-700"}`}>{reinforcing ? "Reinforcing loop" : "Balancing loop"}</p>
          <h3 className="font-serif text-lg text-stone-800">{[...loop.steps.map((s) => s.fromLabel), loop.steps[0]?.fromLabel].join(" → ")}</h3>
          <p className="text-xs text-stone-400">
            {loop.steps.length} steps · certainty {pct(loop.certainty)}
            {loop.linkedLoops > 0 ? ` · shares nodes with ${loop.linkedLoops} other loop${loop.linkedLoops === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <Button onClick={() => props.onOpen(loopFocus(loop))}>Show on map</Button>
      </header>
      <ul className="list-disc space-y-1 pl-5 text-sm text-stone-600">
        {implications(loop).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <Steps title="Steps" steps={loop.steps} />
      <Steps title="Coming in from outside" steps={loop.inputs} />
      <Steps title="What this loop drives" steps={loop.outputs} />
    </Card>
  );
}

export function LoopsView(props: { navigate: Navigate }) {
  const loops = useAsync(api.loops);
  return (
    <Page title="Loops" subtitle="Cycles over causal edges. A loop is a pattern to notice, not a problem to fix. Ask the assistant what one might mean for you.">
      <ErrorNote error={loops.error} />
      <div className="space-y-4">
        {loops.data?.length === 0 ? <Empty>No feedback loops yet.</Empty> : null}
        {loops.data?.map((loop) => (
          <LoopCard key={loop.edges.join()} loop={loop} onOpen={(focus) => props.navigate("map", focus)} />
        ))}
      </div>
    </Page>
  );
}
