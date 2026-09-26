// Typed client for the local HTTP API. Types come straight from the core.
import type { Loop, RootTrace } from "../../src/engines/analysisEngine";
import type { EntryView, EvidenceHit, NodeView } from "../../src/managers/exploreManager";
import type { IngestResult, ProposalView, ReviewDecision } from "../../src/managers/ingestManager";
import type { ChangeResult, GraphAt } from "../../src/managers/mapManager";
import type { RelatedItem } from "../../src/managers/recallCorpus";
import type { AnyEvent, EntryRecord, Graph, Schema, Status } from "../../src/core/types";
import type { Job } from "../../src/utilities/jobQueue";

export type { AnyEvent, EntryRecord, EntryView, EvidenceHit, Graph, IngestResult, Job, Loop, NodeView, ProposalView, RelatedItem, RootTrace, Schema, Status };

export interface VaultStatus {
  model: string;
  hosted: boolean;
  schema: Schema | null;
}

export class ApiError extends Error {}

export async function request<T>(path: string, body?: unknown, fetchImpl: typeof fetch = fetch): Promise<T> {
  const init: RequestInit = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetchImpl(`/api${path}`, init);
  const data = await res.json();
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  status: () => request<VaultStatus>("/status"),
  graph: () => request<Graph>("/graph"),
  graphAt: (t: string) => request<GraphAt>(`/graph/at?t=${enc(t)}`),
  positions: () => request<string[]>("/positions"),
  node: (id: string) => request<NodeView>(`/nodes/${enc(id)}`),
  roots: (id: string) => request<RootTrace>(`/nodes/${enc(id)}/roots`),
  relatedToNode: (id: string) => request<RelatedItem[]>(`/nodes/${enc(id)}/related`),
  loops: () => request<Loop[]>("/loops"),
  entries: () => request<EntryRecord[]>("/entries"),
  entry: (id: string) => request<EntryView>(`/entries/${enc(id)}`),
  search: (q: string) => request<EvidenceHit[]>(`/search?q=${enc(q)}`),
  timeline: () => request<AnyEvent[]>("/timeline"),
  job: (id: string) => request<Job>(`/jobs/${enc(id)}`),
  proposals: () => request<ProposalView[]>("/proposals"),
  addEntry: (input: { content: string; title?: string; format?: string }) => request<IngestResult>("/entries", input),
  review: (session: string, decision: ReviewDecision) => request<ProposalView>(`/proposals/${enc(session)}/review`, decision),
  setStatus: (id: string, status: Status) => request<ChangeResult>(`/items/${enc(id)}/status`, { status }),
  rename: (id: string, label: string) => request<ChangeResult>(`/items/${enc(id)}/attributes`, { label }),
  split: (id: string, labels: string[]) => request<ChangeResult>(`/nodes/${enc(id)}/split`, { parts: labels.map((label) => ({ label })) }),
  merge: (sources: string[], label: string) => request<ChangeResult>("/merge", { sources, into: { label } }),
};
