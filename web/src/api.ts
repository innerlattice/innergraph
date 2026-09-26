// Typed client for the local HTTP API. Types come straight from the core.
import type { Loop, RootTrace } from "../../src/engines/analysisEngine";
import type { EdgeView, EntryView, EvidenceHit, LoopStepView, LoopView, NodeView, Selection } from "../../src/managers/exploreManager";
import type { GraphView, ViewEdge, ViewNode, ViewStatus } from "../../src/access/view";
import type { ChangeResult, GraphAt, UndoResult } from "../../src/managers/mapManager";
import type { ChangeAction, ChangeRow, SessionChanges } from "../../src/managers/changeFeed";
import type { DuplicateGroup } from "../../src/managers/resolve";
import type { IngestResult, RevisionResult } from "../../src/managers/ingestManager";
import type { RelatedItem } from "../../src/managers/recallCorpus";
import type { AnyEvent, EntryRecord, Graph, GraphEdge, GraphNode, Schema, Status } from "../../src/core/types";
import type { Job } from "../../src/utilities/jobQueue";

export type { ChangeAction, ChangeRow, DuplicateGroup, EdgeView, GraphView, LoopStepView, LoopView, SessionChanges, UndoResult, ViewEdge, ViewNode, ViewStatus };
export type { AnyEvent, EntryRecord, EntryView, EvidenceHit, Graph, GraphEdge, GraphNode, IngestResult, Job, Loop, NodeView, RelatedItem, RevisionResult, RootTrace, Schema, Selection, Status };

export interface VaultStatus {
  model: string;
  hosted: boolean;
  schema: Schema | null;
}

export class ApiError extends Error {}

export async function request<T>(path: string, body?: unknown, fetchImpl: typeof fetch = fetch, method = "POST"): Promise<T> {
  const init: RequestInit = body === undefined ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetchImpl(`/api${path}`, init);
  const data = await res.json();
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  status: () => request<VaultStatus>("/status"),
  graph: (withRemoved = false) => request<Graph>(withRemoved ? "/graph?superseded=1" : "/graph"),
  edge: (id: string) => request<EdgeView>(`/edges/${enc(id)}`),
  duplicates: () => request<DuplicateGroup[]>("/duplicates"),
  mergeDuplicates: (groups?: DuplicateGroup[]) => request<unknown[]>("/duplicates/merge", { groups }),
  undo: (eventId: string) => request<UndoResult>("/undo", { eventId }),
  restore: (id: string) => request<UndoResult>("/restore", { id }),
  revertPreview: (t: string) => request<UndoResult["summary"]>(`/revert/preview?t=${enc(t)}`),
  revert: (t: string) => request<UndoResult>("/revert", { t }),
  graphAt: (t: string) => request<GraphAt>(`/graph/at?t=${enc(t)}`),
  positions: () => request<string[]>("/positions"),
  node: (id: string, statuses?: ViewStatus[]) => request<NodeView>(`/nodes/${enc(id)}${statuses ? `?statuses=${statuses.join(",")}` : ""}`),
  view: (statuses?: ViewStatus[], t?: string) => request<GraphView>(`/view?${statuses ? `statuses=${statuses.join(",")}&` : ""}${t ? `t=${enc(t)}` : ""}`),
  roots: (id: string) => request<RootTrace>(`/nodes/${enc(id)}/roots`),
  relatedToNode: (id: string) => request<RelatedItem[]>(`/nodes/${enc(id)}/related`),
  loops: () => request<LoopView[]>("/loops"),
  entries: () => request<EntryRecord[]>("/entries"),
  entry: (id: string) => request<EntryView>(`/entries/${enc(id)}`),
  search: (q: string) => request<EvidenceHit[]>(`/search?q=${enc(q)}`),
  timeline: () => request<AnyEvent[]>("/timeline"),
  job: (id: string) => request<Job>(`/jobs/${enc(id)}`),
  changes: (limit = 30) => request<SessionChanges[]>(`/changes?limit=${limit}`),
  addEntry: (input: { content: string; title?: string; format?: string }) => request<IngestResult>("/entries", input),
  rename: (id: string, label: string) => request<ChangeResult>(`/items/${enc(id)}/attributes`, { label }),
  split: (id: string, labels: string[]) => request<ChangeResult>(`/nodes/${enc(id)}/split`, { parts: labels.map((label) => ({ label })) }),
  revise: (id: string, content: string, interpret: boolean) => request<RevisionResult>(`/entries/${enc(id)}/revise`, { content, interpret }),
  remove: (ids: string[]) => request<ChangeResult>("/remove", { ids }),
  confirm: (ids: string[]) => request<ChangeResult>("/confirm", { ids }),
  undoSession: (session: string) => request<UndoResult>("/undo-session", { session }),
  selection: () => request<Selection>("/selection"),
  setSelection: (ids: string[]) => request<Selection>("/selection", { ids }, fetch, "PUT"),
  merge: (sources: string[], label: string) => request<ChangeResult>("/merge", { sources, into: { label } }),
};
