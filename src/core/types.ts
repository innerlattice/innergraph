// Ubiquitous language of the core (see SPEC.md). No theory vocabulary lives here.

export type Role = "derivational" | "causal" | "identity";
/** hypothesis: on the map, unconfirmed. accepted: confirmed by the person. superseded: removed. */
export type Status = "hypothesis" | "accepted" | "superseded";
export type ActorId = string; // "user" | `agent:${name}` | `model:${name}`
export type Sign = 1 | -1;
export type Attributes = Record<string, unknown>;

export const USER: ActorId = "user";

/** Pointer into an Entry: blob hash plus a UTF-8 byte range [start, end). */
export interface Evidence {
  entry: string;
  start: number;
  end: number;
}

// ---- Schema -------------------------------------------------------------

interface AttributeDef {
  type: "string" | "number" | "boolean" | "enum";
  values?: string[];
  description?: string;
}

/** How a Node's label reads: a short name, a first-person statement, or an episode title. */
export type LabelStyle = "name" | "statement" | "title";

export const NODE_SHAPES = [
  "ellipse",
  "round-rectangle",
  "round-diamond",
  "round-hexagon",
  "round-octagon",
  "round-triangle",
  "round-tag",
  "rhomboid",
  "barrel",
] as const;

/** Presentation hints. Data, not theory: Clients read them without knowing type names. */
interface NodeDisplay {
  shape?: (typeof NODE_SHAPES)[number];
  color?: string;
}

interface NodeTypeDef {
  description?: string;
  label?: LabelStyle;
  /** Guidance for Actors writing labels of this type, e.g. "a short name like 'The Hider'". */
  labelHint?: string;
  display?: NodeDisplay;
  attributes: Record<string, AttributeDef>;
}

export interface EdgeTypeDef {
  description?: string;
  from: string[] | "*";
  to: string[] | "*";
  role?: Role;
  attributes: Record<string, AttributeDef>;
}

export interface Schema {
  name: string;
  version: number;
  description?: string;
  nodeTypes: Record<string, NodeTypeDef>;
  edgeTypes: Record<string, EdgeTypeDef>;
}

export interface MigrationMap {
  nodeTypes: Record<string, string>;
  edgeTypes: Record<string, string>;
}

// ---- Events ---------------------------------------------------------------

export interface SpanMove {
  from: { start: number; end: number };
  to: { start: number; end: number };
}

export interface SplitPart {
  id: string;
  label: string;
  type?: string;
  attributes?: Attributes;
  evidence: Evidence[];
  edges: string[];
}

export interface EventBodies {
  EntryAdded: {
    entry: string;
    source: string;
    title: string;
    bytes: number;
    /** When set, this Entry is a revision of an earlier one (Entries themselves stay immutable). */
    revises?: string;
    /** Evidence spans of the revised Entry and where the same text sits in this one. */
    remap?: SpanMove[];
  };
  NodeAsserted: {
    id: string;
    type: string;
    label: string;
    attributes: Attributes;
    confidence: number;
    evidence: Evidence[];
    /** Existing Nodes this one may duplicate; set by entity resolution, shown at review. */
    similarTo?: string[];
  };
  EdgeAsserted: {
    id: string;
    type: string;
    from: string;
    to: string;
    sign?: Sign;
    attributes: Attributes;
    confidence: number;
    evidence: Evidence[];
  };
  AttributesChanged: {
    target: string;
    patch: Attributes;
    label?: string;
    confidence?: number;
  };
  StatusChanged: { target: string; status: Status; reason?: string };
  NodesSplit: { source: string; into: SplitPart[] };
  NodesMerged: {
    sources: string[];
    into: { id: string; label: string; type: string; attributes: Attributes };
  };
  SchemaChanged: { schema: Schema; migration: MigrationMap };
  SessionOpened: { purpose: string; entry?: string };
  SessionClosed: Record<string, never>;
}

export type EventType = keyof EventBodies;

export interface VaultEvent<T extends EventType = EventType> {
  id: string;
  hlc: string;
  device: string;
  actor: ActorId;
  session: string;
  parents: string[];
  type: T;
  body: EventBodies[T];
}

/** An Event before the Log assigns id, hlc, device and parents. */
interface EventDraft<T extends EventType = EventType> {
  id?: string;
  actor: ActorId;
  session: string;
  type: T;
  body: EventBodies[T];
}

export type AnyEvent = { [K in EventType]: VaultEvent<K> }[EventType];
export type AnyDraft = { [K in EventType]: EventDraft<K> }[EventType];

export const GRAPH_EVENT_TYPES: readonly EventType[] = [
  "NodeAsserted",
  "EdgeAsserted",
  "AttributesChanged",
  "StatusChanged",
  "NodesSplit",
  "NodesMerged",
];

// ---- Projection -------------------------------------------------------------

export interface GraphNode {
  id: string;
  type: string;
  label: string;
  attributes: Attributes;
  confidence: number;
  status: Status;
  evidence: Evidence[];
  derivedFrom: string[];
  assertedBy: ActorId;
  assertedAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  type: string;
  from: string;
  to: string;
  sign?: Sign;
  attributes: Attributes;
  confidence: number;
  status: Status;
  evidence: Evidence[];
  assertedBy: ActorId;
  assertedAt: string;
  updatedAt: string;
}

export interface Graph {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
}

export interface EntryRecord {
  id: string;
  source: string;
  title: string;
  bytes: number;
  addedAt: string;
  session: string;
  revises?: string;
  revisedBy?: string;
}

export interface ProjectionState {
  graph: Graph;
  schema: Schema | null;
  entries: Record<string, EntryRecord>;
  position: string;
}
