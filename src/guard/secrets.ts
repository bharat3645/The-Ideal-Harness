/**
 * Secrets broker — positive, scoped, least-privilege credential injection.
 *
 * A tool that legitimately needs a secret asks the broker by name and scope;
 * the broker returns the value only if the scope is permitted, and records the
 * access. This is the inverse of redaction (which strips secrets out): the
 * broker is the one sanctioned path *in*, keeping secrets out of the general
 * context and logs.
 */

import { err, ok, type Result } from '../core/index.js';

interface SecretEntry {
  readonly value: string;
  readonly allowedScopes: ReadonlySet<string>;
}

export interface AccessRecord {
  readonly name: string;
  readonly scope: string;
  readonly granted: boolean;
}

export class SecretsBroker {
  private readonly store = new Map<string, SecretEntry>();
  private readonly accessLog: AccessRecord[] = [];

  /** Register a secret under a name, restricted to the given scopes. */
  register(name: string, value: string, allowedScopes: readonly string[]): void {
    this.store.set(name, { value, allowedScopes: new Set(allowedScopes) });
  }

  /** Request a secret for a scope. Returns the value only if the scope is allowed. */
  request(name: string, scope: string): Result<string, string> {
    const entry = this.store.get(name);
    if (entry === undefined) {
      this.accessLog.push({ name, scope, granted: false });
      return err(`no secret registered under "${name}"`);
    }
    if (!entry.allowedScopes.has(scope)) {
      this.accessLog.push({ name, scope, granted: false });
      return err(`scope "${scope}" is not permitted to access "${name}"`);
    }
    this.accessLog.push({ name, scope, granted: true });
    return ok(entry.value);
  }

  /** Immutable view of the access log, for the audit ledger. */
  log(): readonly AccessRecord[] {
    return [...this.accessLog];
  }
}
