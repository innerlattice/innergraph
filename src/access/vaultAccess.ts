// VaultAccess: atomic verbs over the Log, blobs and the derived Projection tables.
import type { AnyDraft, AnyEvent, Evidence, ProjectionState } from "../core/types.js";
import { newId, sha256 } from "../utilities/crypto.js";
import { HlcClock } from "../utilities/hlc.js";
import type { Db } from "./database.js";
import { checkDraft } from "./invariants.js";
import { applyEvent, fold } from "./projection.js";
import { VIEW_STATUSES, materialize } from "./view.js";

interface EventRow {
  id: string;
  hlc: string;
  device: string;
  actor: string;
  session: string;
  parents: string;
  type: string;
  body: Buffer;
}

function decode(row: EventRow): AnyEvent {
  return {
    id: row.id,
    hlc: row.hlc,
    device: row.device,
    actor: row.actor,
    session: row.session,
    parents: JSON.parse(row.parents) as string[],
    type: row.type,
    body: JSON.parse(row.body.toString("utf8")),
  } as AnyEvent;
}

export class VaultAccess {
  readonly device: string;
  private readonly clock: HlcClock;
  private log: AnyEvent[];
  private head: ProjectionState;

  constructor(
    private readonly db: Db,
    now: () => number = Date.now,
  ) {
    this.device = this.meta("device") ?? this.setMeta("device", newId());
    this.log = this.readLog();
    this.clock = new HlcClock(this.device, now, this.log.at(-1)?.hlc);
    this.head = fold(this.log);
    this.writeDerived(this.head);
  }

  // ---- Log -------------------------------------------------------------------

  append(drafts: AnyDraft[]): AnyEvent[] {
    drafts.forEach(checkDraft);
    // IMMEDIATE takes the write lock first, so another process cannot append in between.
    return this.db.transaction(() => {
      this.refresh();
      const events: AnyEvent[] = [];
      for (const draft of drafts) events.push(this.seal(draft, events.at(-1)?.id ?? this.log.at(-1)?.id));
      events.forEach((e) => this.insert(e));
      events.forEach((e) => applyEvent(this.head, e));
      this.writeDerived(this.head);
      this.log.push(...events);
      return events;
    }).immediate();
  }

  events(upTo?: string): AnyEvent[] {
    this.refresh();
    return upTo === undefined ? [...this.log] : this.log.filter((e) => e.hlc <= upTo);
  }

  state(): ProjectionState {
    this.refresh();
    return this.head;
  }

  stateAt(hlc: string): ProjectionState {
    this.refresh();
    return fold(this.log, hlc);
  }

  /** Picks up Events appended by another process sharing this Vault (e.g. UI and MCP server). */
  private refresh(): void {
    const { n } = this.db.prepare("SELECT count(*) AS n FROM events").get() as { n: number };
    if (n === this.log.length) return;
    this.log = this.readLog();
    this.head = fold(this.log);
    this.clock.receive(this.log.at(-1)?.hlc ?? "");
  }

  // ---- Blobs -------------------------------------------------------------------

  putBlob(bytes: Uint8Array, media: string): string {
    const hash = sha256(bytes);
    this.db.prepare("INSERT OR IGNORE INTO blobs (hash, media, bytes) VALUES (?, ?, ?)").run(hash, media, Buffer.from(bytes));
    return hash;
  }

  readBlob(hash: string): Buffer | undefined {
    const row = this.db.prepare("SELECT bytes FROM blobs WHERE hash = ?").get(hash) as { bytes: Buffer } | undefined;
    return row?.bytes;
  }

  readText(hash: string): string {
    return this.readBlob(hash)?.toString("utf8") ?? "";
  }

  readSpan(evidence: Evidence): string {
    return this.readBlob(evidence.entry)?.subarray(evidence.start, evidence.end).toString("utf8") ?? "";
  }

  // ---- Shared client state (not part of the Log) ------------------------------

  /** Small JSON values shared between Clients, e.g. the graph selection. Never Events. */
  readSetting<T>(key: string): T | undefined {
    const raw = this.meta(`setting:${key}`);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  writeSetting(key: string, value: unknown): void {
    this.setMeta(`setting:${key}`, JSON.stringify(value));
  }

  // ---- Disposable cache ------------------------------------------------------------

  readCache(namespace: string, keys: string[]): Map<string, Buffer> {
    const found = new Map<string, Buffer>();
    const get = this.db.prepare("SELECT value FROM cache WHERE namespace = ? AND key = ?");
    for (const key of keys) {
      const row = get.get(namespace, key) as { value: Buffer } | undefined;
      if (row) found.set(key, row.value);
    }
    return found;
  }

  writeCache(namespace: string, entries: Map<string, Uint8Array>): void {
    const put = this.db.prepare("INSERT OR REPLACE INTO cache (namespace, key, value) VALUES (?, ?, ?)");
    this.db.transaction(() => entries.forEach((value, key) => put.run(namespace, key, Buffer.from(value))))();
  }

  // ---- internals -----------------------------------------------------------------

  private seal(draft: AnyDraft, parent: string | undefined): AnyEvent {
    return {
      ...draft,
      id: draft.id ?? newId(),
      hlc: this.clock.tick(),
      device: this.device,
      parents: parent ? [parent] : [],
    } as AnyEvent;
  }

  private insert(e: AnyEvent): void {
    this.db
      .prepare("INSERT INTO events (id, hlc, device, actor, session, parents, type, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(e.id, e.hlc, e.device, e.actor, e.session, JSON.stringify(e.parents), e.type, Buffer.from(JSON.stringify(e.body)));
  }

  private readLog(): AnyEvent[] {
    const rows = this.db.prepare("SELECT * FROM events ORDER BY hlc").all() as EventRow[];
    return rows.map(decode);
  }

  private meta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  private setMeta(key: string, value: string): string {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
    return value;
  }

  /** Writes the materialized View (all statuses) for SQL consumers; a disposable cache. */
  private writeDerived(state: ProjectionState): void {
    const view = materialize(state, VIEW_STATUSES);
    this.db.exec("DELETE FROM view_nodes; DELETE FROM view_edges; DELETE FROM view_evidence;");
    const node = this.db.prepare("INSERT INTO view_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const edge = this.db.prepare("INSERT INTO view_edges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const evidence = this.db.prepare("INSERT INTO view_evidence VALUES (?, ?, ?, ?)");
    for (const n of Object.values(view.nodes)) {
      node.run(n.id, n.type, n.label, n.status, Number(n.confirmed), n.confidence, JSON.stringify(n.attributes), JSON.stringify(n.derivedFrom));
      n.evidence.forEach((ev) => evidence.run(n.id, ev.entry, ev.start, ev.end));
    }
    for (const e of Object.values(view.edges)) {
      edge.run(e.id, e.type, e.from, e.to, e.sign ?? null, e.status, Number(e.confirmed), e.confidence, JSON.stringify(e.attributes));
      e.evidence.forEach((ev) => evidence.run(e.id, ev.entry, ev.start, ev.end));
    }
  }

}
