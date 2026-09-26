// Resource: one SQLCipher-encrypted SQLite file per Vault.
import Database from "better-sqlite3-multiple-ciphers";

export type Db = Database.Database;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  hlc TEXT NOT NULL,
  device TEXT NOT NULL,
  actor TEXT NOT NULL,
  session TEXT NOT NULL,
  parents TEXT NOT NULL,
  type TEXT NOT NULL,
  body BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS events_hlc ON events(hlc);
CREATE INDEX IF NOT EXISTS events_type ON events(type);
CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, media TEXT NOT NULL, bytes BLOB NOT NULL);
-- Derived, disposable caches of the Graph Projection at head.
CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, type TEXT, label TEXT, status TEXT, confidence REAL, attributes TEXT, derived_from TEXT);
CREATE TABLE IF NOT EXISTS edges (id TEXT PRIMARY KEY, type TEXT, src TEXT, dst TEXT, sign INTEGER, status TEXT, confidence REAL, attributes TEXT);
CREATE TABLE IF NOT EXISTS evidence (target TEXT, entry TEXT, start INTEGER, end INTEGER);
-- Disposable computed values (e.g. embeddings), keyed by namespace and content hash.
CREATE TABLE IF NOT EXISTS cache (namespace TEXT NOT NULL, key TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (namespace, key));
`;

export function openDatabase(file: string, key: string): Db {
  const db = new Database(file);
  db.pragma("cipher='sqlcipher'");
  db.pragma("legacy=4");
  db.pragma(`key="x'${assertHexKey(key)}'"`);
  db.pragma("journal_mode = WAL");
  db.exec(DDL);
  return db;
}

function assertHexKey(key: string): string {
  if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error("Vault key must be 64 hex characters");
  return key;
}
