/**
 * Memory MCP face. The server holds a CodeGraph + EpisodicStore for its
 * lifetime so files indexed via `add_file` are queryable via `query_graph`, and
 * observations written via `memory_write` are recalled via `memory_search`.
 */

import {
  asNumber,
  asString,
  createMcpServer,
  HARNESS_VERSION,
  lockPathFor,
  type McpTool,
  withFileLock,
} from '../../core/index.js';
import { redactSecrets, wrapUntrusted } from '../../guard/index.js';
import { reconcileClaims, type ToolCallEvidence } from '../curator.js';
import { consolidate } from '../episodic/consolidate.js';
import { episodicSnapshotPath, loadEpisodicSnapshot, saveEpisodicSnapshot } from '../episodic/persist.js';
import { searchObservations } from '../episodic/search.js';
import { EpisodicStore, type ObservationType } from '../episodic/store.js';
import { CodeGraph } from '../structural/graph.js';
import { graphSnapshotPath, loadGraphSnapshot, saveGraphSnapshot } from '../structural/persist.js';
import { resolveWorkspace } from '../workspace.js';

/** Default `memory_write` count between automatic consolidation passes (issue #16 — src/memory decisions.md entry). */
export const DEFAULT_CONSOLIDATE_EVERY = 25;

/**
 * Resolve the auto-consolidation trigger from `IDEAL_HARNESS_MEMORY_CONSOLIDATE_EVERY`.
 * Mirrors `resolveSpendCap`'s contract below: an unset env var uses the default; an
 * invalid one (non-finite, non-positive) is never silently accepted — warn and fall back
 * to the default rather than disabling the trigger (0 or NaN would mean "never
 * consolidate," the opposite of this issue's intent).
 */
function resolveConsolidateEvery(): number {
  const raw = process.env.IDEAL_HARNESS_MEMORY_CONSOLIDATE_EVERY;
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_CONSOLIDATE_EVERY;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    process.stderr.write(
      `ideal-harness-memory: ignoring invalid IDEAL_HARNESS_MEMORY_CONSOLIDATE_EVERY="${raw}" (using default ${DEFAULT_CONSOLIDATE_EVERY})\n`,
    );
    return DEFAULT_CONSOLIDATE_EVERY;
  }
  return n;
}

/**
 * Lock-protected graph I/O (issue #17 / `decisions.md` D039). When provided,
 * `add_file` reloads the freshest on-disk graph under an exclusive lock,
 * indexes into THAT (not the long-held in-memory `graph`), saves, and
 * resyncs `graph` in place — closing the lost-update race where two
 * concurrent processes each hold a stale in-memory copy and the second
 * writer's save silently drops the first writer's newly-indexed files.
 * Omitted (the default), behavior is unchanged from before #17.
 */
export interface GraphIo {
  readonly load: () => CodeGraph;
  readonly save: (graph: CodeGraph) => boolean;
  readonly lockPath: string;
}

/** Same pattern as `GraphIo`, for the episodic store — see issue #17 / D039. */
export interface EpisodicIo {
  readonly load: () => EpisodicStore;
  readonly save: (store: EpisodicStore) => boolean;
  readonly lockPath: string;
}

export function buildMemoryTools(
  graph: CodeGraph,
  store: EpisodicStore,
  /** Persist callback invoked after every graph mutation (no-op success by default, for pure tests). Ignored when `graphIo` is provided. */
  persistGraph: () => boolean = () => true,
  /** Persist callback invoked after every episodic mutation (no-op success by default, for pure tests). Ignored when `episodicIo` is provided. */
  persistEpisodic: () => boolean = () => true,
  /**
   * Auto-consolidate every N `memory_write` calls (issue #15). Operator-tunable via
   * `IDEAL_HARNESS_MEMORY_CONSOLIDATE_EVERY`; `startMemoryMcp` passes the resolved value.
   * Deterministic and always announced (stderr + the triggering write's own response) —
   * never silent background magic, per this project's standing principle.
   */
  consolidateEvery: number = DEFAULT_CONSOLIDATE_EVERY,
  /** See `GraphIo`'s docs. Undefined preserves pre-#17 in-memory-only behavior (what every pure unit test uses). */
  graphIo?: GraphIo,
  /** See `EpisodicIo`'s docs. Undefined preserves pre-#17 in-memory-only behavior. */
  episodicIo?: EpisodicIo,
): McpTool[] {
  let writesSinceConsolidate = 0;

  /**
   * Apply `mutate` to the freshest known episodic store and report whether
   * it durably persisted. With `episodicIo`: locks, reloads fresh from disk,
   * mutates THAT, saves, and resyncs `store` so every other handler sees the
   * merged result too. Without it: mutates `store` directly and reports via
   * `persistEpisodic()`, unchanged from pre-#17 behavior.
   */
  const mutateEpisodic = async <T>(
    mutate: (target: EpisodicStore) => T,
  ): Promise<{ result: T; persisted: boolean }> => {
    if (episodicIo === undefined) {
      return { result: mutate(store), persisted: persistEpisodic() };
    }
    return withFileLock(episodicIo.lockPath, () => {
      const fresh = episodicIo.load();
      const result = mutate(fresh);
      const persisted = episodicIo.save(fresh);
      store.replaceAll(fresh.all());
      return { result, persisted };
    });
  };

  return [
    {
      name: 'add_file',
      description: 'Index a source file into the code graph (tree-sitter tier when available, else regex).',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
      },
      handler: async (args) => {
        const path = asString(args, 'path');
        const content = asString(args, 'content', '');
        if (graphIo === undefined) {
          const outcome = await graph.addFileAuto(path, content);
          const persisted = outcome.skipped ? true : persistGraph();
          return {
            text: JSON.stringify({ indexed: path, nodes: graph.allNodes().length, ...outcome, persisted }),
            ...(persisted ? {} : { isError: true }),
          };
        }
        try {
          return await withFileLock(graphIo.lockPath, async () => {
            const fresh = graphIo.load();
            const outcome = await fresh.addFileAuto(path, content);
            // Skipped (unchanged content, matched by hash): nothing to save, and
            // no need to touch disk at all — mirrors the no-lock branch above.
            const persisted = outcome.skipped ? true : graphIo.save(fresh);
            graph.loadFrom(fresh);
            return {
              text: JSON.stringify({ indexed: path, nodes: graph.allNodes().length, ...outcome, persisted }),
              ...(persisted ? {} : { isError: true }),
            };
          });
        } catch (error) {
          return { text: JSON.stringify({ error: `graph locked: ${String(error)}` }), isError: true };
        }
      },
    },
    {
      name: 'query_graph',
      description: 'Retrieve a token-budgeted structural subgraph relevant to a query (symbols + file:line).',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, tokenBudget: { type: 'number' } },
        required: ['query'],
      },
      handler: (args) => {
        const result = graph.querySubgraph(asString(args, 'query', ''), asNumber(args, 'tokenBudget', 2000));
        return { text: result.text };
      },
    },
    {
      name: 'memory_write',
      description:
        'Write an episodic observation (bugfix/feature/decision/security_alert/failure/note). ' +
        'Pass `evidence` (the output of `reconcile` for this claim) to stamp provenance on the record.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          text: { type: 'string' },
          ts: { type: 'number' },
          evidence: {
            type: 'object',
            properties: { overlap: { type: 'number' }, matchedTool: { type: 'string' } },
          },
        },
        required: ['type', 'text', 'ts'],
      },
      handler: async (args) => {
        // Redact secrets BEFORE they are persisted. A secret in long-term memory
        // that auto-injects into future sessions is the exact nightmare we refuse
        // to create — mask it at the write boundary, below the model.
        const { text: safe, count } = redactSecrets(asString(args, 'text', ''));
        const evidence = args.evidence as { overlap?: number; matchedTool?: string } | undefined;
        const observation = {
          type: asString(args, 'type') as ObservationType,
          text: safe,
          ts: asNumber(args, 'ts'),
          ...(evidence && typeof evidence.overlap === 'number'
            ? {
                evidence: {
                  overlap: evidence.overlap,
                  ...(evidence.matchedTool ? { matchedTool: evidence.matchedTool } : {}),
                },
              }
            : {}),
        };

        try {
          const { result, persisted } = await mutateEpisodic((fresh) => {
            const record = fresh.add(observation);

            // Auto-consolidation (issue #15): every `consolidateEvery` writes, dedupe +
            // prune before persisting, so a long session doesn't pay an ever-growing
            // full-array re-serialization on every single write. Deterministic (a plain
            // per-process counter, not a timer) and always announced — never silent
            // background magic. Permanent types (decision/failure/security_alert) are
            // exempt inside `consolidate()` itself, so they survive every auto-triggered
            // pass too. Runs against `fresh` (the just-reloaded state under lock, per
            // issue #17), not a possibly-stale in-memory copy.
            writesSinceConsolidate += 1;
            let consolidated: { before: number; after: number; deduped: number; pruned: number } | undefined;
            if (writesSinceConsolidate >= consolidateEvery) {
              writesSinceConsolidate = 0;
              const before = fresh.all().length;
              const cResult = consolidate(fresh.all());
              fresh.replaceAll(cResult.kept);
              consolidated = {
                before,
                after: cResult.kept.length,
                deduped: cResult.dedupedCount,
                pruned: cResult.prunedCount,
              };
              process.stderr.write(
                `ideal-harness-memory: auto-consolidated after ${consolidateEvery} writes (env: IDEAL_HARNESS_MEMORY_CONSOLIDATE_EVERY) — ${consolidated.before} -> ${consolidated.after} record(s) (deduped ${consolidated.deduped}, pruned ${consolidated.pruned})\n`,
              );
            }
            return { record, consolidated };
          });
          return {
            text: JSON.stringify({
              ...result.record,
              redactedSecrets: count,
              persisted,
              ...(result.consolidated ? { consolidated: result.consolidated } : {}),
            }),
            ...(persisted ? {} : { isError: true }),
          };
        } catch (error) {
          return { text: JSON.stringify({ error: `episodic store locked: ${String(error)}` }), isError: true };
        }
      },
    },
    {
      name: 'memory_consolidate',
      description: 'Dedupe near-identical observations and prune low-signal ones once the store grows large.',
      inputSchema: {
        type: 'object',
        properties: { maxCount: { type: 'number' } },
      },
      handler: async (args) => {
        const maxCount = asNumber(args, 'maxCount', 2000);
        try {
          const { result, persisted } = await mutateEpisodic((fresh) => {
            const before = fresh.all().length;
            const cResult = consolidate(fresh.all(), { maxCount });
            fresh.replaceAll(cResult.kept);
            return { before, after: cResult.kept.length, deduped: cResult.dedupedCount, pruned: cResult.prunedCount };
          });
          return { text: JSON.stringify({ ...result, persisted }), ...(persisted ? {} : { isError: true }) };
        } catch (error) {
          return { text: JSON.stringify({ error: `episodic store locked: ${String(error)}` }), isError: true };
        }
      },
    },
    {
      name: 'memory_search',
      description: 'Recall episodic observations by BM25 relevance (not recency).',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
      handler: (args) => {
        const hits = searchObservations(store.all(), asString(args, 'query', ''), {
          limit: asNumber(args, 'limit', 10),
        });
        // Recalled memory is untrusted: it may carry instructions written in a
        // past session. Fence it so the model treats it as data, not commands.
        return { text: wrapUntrusted(JSON.stringify(hits), { source: 'memory' }) };
      },
    },
    {
      name: 'reconcile',
      description: 'Reconcile claimed work against tool-call evidence; returns which claims are corroborated.',
      inputSchema: {
        type: 'object',
        properties: {
          claims: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'array', items: { type: 'object' } },
        },
        required: ['claims', 'evidence'],
      },
      handler: (args) => {
        const claims = (args.claims as string[]) ?? [];
        const evidence = (args.evidence as ToolCallEvidence[]) ?? [];
        return { text: JSON.stringify(reconcileClaims(claims, evidence)) };
      },
    },
  ];
}

export function startMemoryMcp(): Promise<void> {
  // Bind to exactly one workspace for the server's whole life. No tool can target
  // another project, so a confused or injected model cannot reach another repo's
  // memory. Unresolved workspace → ephemeral (fail-closed), never a shared store.
  const ws = resolveWorkspace();
  // Persistent workspaces resume from their last indexed snapshot instead of
  // cold-indexing from zero every session — the actual "any size codebase"
  // lever: paid once, not every session, and addFileAuto only re-extracts
  // what actually changed since the snapshot was written.
  const graph = ws.persistent && ws.storeDir ? loadGraphSnapshot(ws.storeDir, ws.key) : new CodeGraph(ws.key);
  const store = ws.persistent && ws.storeDir ? loadEpisodicSnapshot(ws.storeDir, ws.key) : new EpisodicStore(ws.key);
  process.stderr.write(
    `ideal-harness-memory: workspace ${ws.key}${
      ws.persistent
        ? ` (store: ${ws.storeDir}, ${graph.allNodes().length} node(s), ${store.all().length} observation(s) resumed)`
        : ' (ephemeral — not persisted)'
    }\n`,
  );
  const persistGraph = (): boolean => {
    if (!ws.persistent || !ws.storeDir) {
      return true; // ephemeral workspace: nothing to persist, not a failure
    }
    const ok = saveGraphSnapshot(graph, ws.storeDir);
    if (!ok) {
      process.stderr.write('ideal-harness-memory: could not persist graph snapshot\n');
    }
    return ok;
  };
  const persistEpisodic = (): boolean => {
    if (!ws.persistent || !ws.storeDir) {
      return true; // ephemeral workspace: nothing to persist, not a failure
    }
    const ok = saveEpisodicSnapshot(store, ws.storeDir);
    if (!ok) {
      process.stderr.write('ideal-harness-memory: could not persist episodic snapshot\n');
    }
    return ok;
  };
  const consolidateEvery = resolveConsolidateEvery();

  // Issue #17 / decisions.md D039: only wire lock-protected reload-mutate-write
  // for a PERSISTENT workspace — an ephemeral one has no shared file for a second
  // process to race on in the first place, so there's nothing to lock.
  const graphIo =
    ws.persistent && ws.storeDir
      ? {
          load: () => loadGraphSnapshot(ws.storeDir as string, ws.key),
          save: (g: CodeGraph) => saveGraphSnapshot(g, ws.storeDir as string),
          lockPath: lockPathFor(graphSnapshotPath(ws.storeDir)),
        }
      : undefined;
  const episodicIo =
    ws.persistent && ws.storeDir
      ? {
          load: () => loadEpisodicSnapshot(ws.storeDir as string, ws.key),
          save: (s: EpisodicStore) => saveEpisodicSnapshot(s, ws.storeDir as string),
          lockPath: lockPathFor(episodicSnapshotPath(ws.storeDir)),
        }
      : undefined;

  return createMcpServer({
    name: 'ideal-harness-memory',
    version: HARNESS_VERSION,
    tools: buildMemoryTools(graph, store, persistGraph, persistEpisodic, consolidateEvery, graphIo, episodicIo),
  }).listen();
}
