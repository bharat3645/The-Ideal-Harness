/**
 * Episodic memory store + the claude-mem observation contract.
 *
 * Observations are structured records of what happened (a bugfix, a decision, a
 * security alert). They are captured (often via a lifecycle hook compressing
 * tool events into `<observation>` XML) and recalled by relevance. The store is
 * in-memory + serializable for v0.1; a SQLite backend is a v0.2 swap.
 */

export type ObservationType = 'bugfix' | 'feature' | 'decision' | 'security_alert' | 'note';

export interface Observation {
  readonly id: string;
  /** Unix ms. Passed in by the caller (the harness has no wall-clock in pure code). */
  readonly ts: number;
  readonly type: ObservationType;
  readonly text: string;
  readonly tags?: readonly string[];
  /** Workspace namespace this record belongs to (isolation defence-in-depth). */
  readonly workspace?: string;
}

const VALID_TYPES = new Set<ObservationType>(['bugfix', 'feature', 'decision', 'security_alert', 'note']);

/**
 * Episodic store bound to a single workspace. Every record it creates is stamped
 * with that workspace key, so a persisted/loaded store can be filtered down to
 * exactly its workspace — a misplaced or merged DB cannot leak foreign records.
 */
export class EpisodicStore {
  private readonly observations: Observation[] = [];
  private counter = 0;

  constructor(private readonly workspaceKey: string = 'default') {}

  add(observation: Omit<Observation, 'id' | 'workspace'> & { id?: string }): Observation {
    this.counter += 1;
    const record: Observation = {
      ...observation,
      id: observation.id ?? `obs-${this.counter}`,
      workspace: this.workspaceKey,
    };
    this.observations.push(record);
    return record;
  }

  all(): readonly Observation[] {
    return this.observations;
  }

  toJSON(): readonly Observation[] {
    return this.observations;
  }
}

/**
 * Defence-in-depth: keep only records that belong to `key`. Used when loading a
 * persisted store so a misplaced/merged DB cannot surface another workspace's data.
 */
export function filterByWorkspace(observations: readonly Observation[], key: string): Observation[] {
  return observations.filter((o) => (o.workspace ?? 'default') === key);
}

/**
 * Parse the claude-mem `<observation>` XML contract:
 *   <observation type="bugfix" ts="...">text</observation>
 * Unknown/missing types fall back to `note`.
 */
export function parseObservations(xml: string): Array<Omit<Observation, 'id'>> {
  const out: Array<Omit<Observation, 'id'>> = [];
  const block = /<observation([^>]*)>([\s\S]*?)<\/observation>/g;
  for (const match of xml.matchAll(block)) {
    const attrs = match[1] ?? '';
    const typeAttr = attrs.match(/type\s*=\s*"([^"]*)"/)?.[1] ?? 'note';
    const tsAttr = Number(attrs.match(/ts\s*=\s*"(\d+)"/)?.[1] ?? '0');
    const type = (VALID_TYPES.has(typeAttr as ObservationType) ? typeAttr : 'note') as ObservationType;
    out.push({ type, ts: Number.isFinite(tsAttr) ? tsAttr : 0, text: (match[2] ?? '').trim() });
  }
  return out;
}
