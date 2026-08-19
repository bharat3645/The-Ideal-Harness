/**
 * Optional SQLite-FTS5 search backend for episodic recall — issue #19's
 * scaling half.
 *
 * Uses Node's OWN built-in `node:sqlite` (landed unflagged well within this
 * project's Node >=21 floor's forward-compat window; concretely available
 * from Node ~22.5 on). This is deliberately NOT an npm package and NOT a
 * `devDependency` entry — it is zero additional footprint beyond what Node
 * itself already ships, which is a step lighter than the option originally
 * approved (an optional `better-sqlite3` devDependency): no native compile,
 * no prebuilt-binary download, nothing in `package.json` to review at all.
 *
 * Every failure mode — the module absent (Node <22.5, or this project's own
 * floor, Node 21), or FTS5 not compiled into a particular SQLite build —
 * degrades to `null`, never a thrown error. Callers (`search.ts`) fall back
 * to the always-available hand-rolled `Bm25Index` (`bm25.ts`). Same
 * "optional engine tier, presence-detected, never a hard failure" contract
 * `web-tree-sitter` already established for `memory`'s structural tier and
 * `ws` established for `web`'s browse daemon — see `decisions.md` D041.
 */

import { tokenize } from './bm25.js';
import type { Observation } from './store.js';

interface PreparedStatementLike {
  run(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}

interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): PreparedStatementLike;
  close(): void;
}

type SqliteModule = { DatabaseSync: new (location: string) => DatabaseSyncLike };

// Lazily-loaded, cached across calls. `undefined` = not yet attempted,
// `null` = attempted and unavailable (module absent or FTS5 not compiled in).
let sqliteModule: SqliteModule | null | undefined;

async function loadSqlite(): Promise<SqliteModule | null> {
  if (sqliteModule !== undefined) {
    return sqliteModule;
  }
  try {
    // Dynamic + optional: a Node version without node:sqlite (this project's
    // own floor, Node 21) must build and run cleanly — this import only
    // resolves the fast path when the runtime actually has it.
    const mod = (await import('node:sqlite')) as unknown as SqliteModule;
    // Probe FTS5 specifically: node:sqlite existing doesn't guarantee the
    // bundled SQLite was compiled with the FTS5 extension. A tier that
    // cannot do what it claims must not pretend it can (same rule
    // treesitter.ts's per-file parse-failure degrade already follows).
    const probe = new mod.DatabaseSync(':memory:');
    try {
      probe.exec('CREATE VIRTUAL TABLE __ih_fts5_probe USING fts5(x)');
    } finally {
      probe.close();
    }
    sqliteModule = mod;
  } catch {
    sqliteModule = null;
  }
  return sqliteModule;
}

/** True when this runtime can actually run the FTS5 backend. Never throws. */
export async function fts5Available(): Promise<boolean> {
  return (await loadSqlite()) !== null;
}

export interface Fts5Hit {
  readonly id: string;
  readonly score: number;
}

/**
 * Turn a free-text query into a safe FTS5 MATCH expression: every token from
 * this project's own tokenizer (shared with `bm25.ts`, so both backends agree
 * on what a "term" is) is wrapped as a literal double-quoted phrase and
 * OR-joined. Wrapping in quotes forces FTS5 to treat each token as literal
 * text rather than its own query-operator syntax (AND/OR/NOT/NEAR/prefix `*`/
 * column filters) — an unescaped user query handed straight to MATCH would
 * otherwise let query syntax (or a syntax error) leak in from ordinary text
 * like `"error: foo-bar"`. OR-joined to match this project's existing
 * `Bm25Index.search`'s "any term overlap contributes" semantics, not a
 * require-every-term AND.
 */
function toFts5Query(query: string): string {
  const terms = tokenize(query);
  return terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' OR ');
}

/**
 * Build a fresh in-memory FTS5 index over `observations` and run one query
 * against it. Returns `null` when the FTS5 tier is unavailable on this
 * runtime — callers must fall back to `bm25.ts`'s hand-rolled index.
 *
 * Rebuilt per call rather than incrementally maintained: still a genuine
 * scaling win over the hand-rolled tier (a real database engine's own
 * indexed MATCH vs. an O(n) JS-level per-term document scan), and keeps this
 * module stateless — no index lifecycle to keep in sync with `EpisodicStore`
 * across `add`/`replaceAll`/consolidation, which would otherwise need its
 * own correctness argument. Incremental maintenance is a real future
 * optimization, not a correctness requirement, so left for if/when profiling
 * actually shows the rebuild cost matters at the store sizes this project's
 * own consolidation/decay (`decisions.md` D036) already caps growth at.
 *
 * FTS5's own `bm25()` ranking function returns NEGATIVE scores where more
 * negative means more relevant (SQLite's documented convention) — negated
 * here so higher score = more relevant, matching `bm25.ts`'s `Bm25Index`
 * convention and this project's `SearchHit` contract throughout.
 */
export async function searchFts5(
  observations: readonly Observation[],
  query: string,
  limit: number,
): Promise<Fts5Hit[] | null> {
  const mod = await loadSqlite();
  if (mod === null) {
    return null;
  }
  const matchQuery = toFts5Query(query);
  if (matchQuery === '') {
    return [];
  }
  const db = new mod.DatabaseSync(':memory:');
  try {
    db.exec('CREATE VIRTUAL TABLE obs USING fts5(id UNINDEXED, text)');
    const insert = db.prepare('INSERT INTO obs (id, text) VALUES (?, ?)');
    for (const observation of observations) {
      insert.run(observation.id, observation.text);
    }
    const rows = db
      .prepare('SELECT id, bm25(obs) AS rank FROM obs WHERE obs MATCH ? ORDER BY rank LIMIT ?')
      .all(matchQuery, limit) as Array<{ id: string; rank: number }>;
    return rows.map((row) => ({ id: row.id, score: -row.rank }));
  } finally {
    db.close();
  }
}
