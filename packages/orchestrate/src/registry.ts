/**
 * Self-registering tool registry (hermes idea).
 *
 * A single source of truth for the tools available to the agent loop. Registers
 * by name, rejects duplicates (a silent overwrite hides bugs), and lists specs
 * for tool documentation.
 */

import { err, ok, type Result } from '@ideal-harness/core';

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();

  register(spec: ToolSpec): Result<ToolSpec, string> {
    if (this.tools.has(spec.name)) {
      return err(`tool "${spec.name}" is already registered`);
    }
    this.tools.set(spec.name, spec);
    return ok(spec);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  list(): readonly ToolSpec[] {
    return [...this.tools.values()];
  }
}
