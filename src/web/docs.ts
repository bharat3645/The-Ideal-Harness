/**
 * Live package docs — grounding against hallucinated/stale-training-data
 * APIs, scoped to what a static fetch can honestly provide (a Context7-style
 * live-docs sub-tool, per VISION §7's v0.4 line item). Reads the npm
 * registry's public metadata endpoint directly; no API key, no dependency.
 *
 * This does not replace reading real source or type definitions — it answers
 * one narrow, high-value question fast: "does this package/version/API still
 * look like what the model remembers," using the description, homepage, and
 * README the registry already serves for every package.
 */

import type { PolicyDecision, PolicyRule } from '../guard/index.js';
import { gateWebFetch } from './gate.js';

export interface PackageDocsOptions {
  readonly timeoutMs?: number;
  readonly policyTiers?: readonly (readonly PolicyRule[])[];
  readonly readmeMaxChars?: number;
}

export interface PackageDocsResult {
  readonly ok: boolean;
  readonly ran: boolean;
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly homepage?: string;
  readonly repository?: string;
  readonly readme?: string;
  readonly error?: string;
  readonly decision: PolicyDecision;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_README_MAX_CHARS = 20_000;
const VALID_PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function registryUrl(name: string): string {
  // Scoped packages (`@scope/name`) must keep their literal `/` — encode only
  // the two segments, not the separator, or the registry 404s the request.
  const encoded = name
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `https://registry.npmjs.org/${encoded}`;
}

interface NpmRegistryDoc {
  readonly description?: string;
  readonly homepage?: string;
  readonly readme?: string;
  readonly repository?: string | { readonly url?: string };
  readonly 'dist-tags'?: { readonly latest?: string };
  readonly versions?: Record<string, { readonly description?: string; readonly homepage?: string }>;
}

/** Fetch npm registry metadata for a package. Policy-gated like `fetchPage`. Never throws. */
export async function fetchPackageDocs(name: string, options: PackageDocsOptions = {}): Promise<PackageDocsResult> {
  if (!VALID_PACKAGE_NAME.test(name)) {
    const decision = gateWebFetch(registryUrl(name), options.policyTiers);
    return { ok: false, ran: false, name, error: 'invalid package name', decision };
  }
  const url = registryUrl(name);
  const decision = gateWebFetch(url, options.policyTiers);
  if (decision.action !== 'allow') {
    return { ok: false, ran: false, name, decision };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const readmeMaxChars = options.readmeMaxChars ?? DEFAULT_README_MAX_CHARS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, ran: true, name, error: `HTTP ${response.status}`, decision };
    }
    const doc = (await response.json()) as NpmRegistryDoc;
    const latest = doc['dist-tags']?.latest;
    const versionDoc = latest !== undefined ? doc.versions?.[latest] : undefined;
    const repository = typeof doc.repository === 'string' ? doc.repository : doc.repository?.url;
    return {
      ok: true,
      ran: true,
      name,
      ...(latest !== undefined ? { version: latest } : {}),
      ...((doc.description ?? versionDoc?.description) !== undefined
        ? { description: (doc.description ?? versionDoc?.description) as string }
        : {}),
      ...((doc.homepage ?? versionDoc?.homepage) !== undefined
        ? { homepage: (doc.homepage ?? versionDoc?.homepage) as string }
        : {}),
      ...(repository !== undefined ? { repository } : {}),
      ...(typeof doc.readme === 'string' ? { readme: doc.readme.slice(0, readmeMaxChars) } : {}),
      decision,
    };
  } catch (error) {
    return { ok: false, ran: true, name, error: error instanceof Error ? error.message : String(error), decision };
  } finally {
    clearTimeout(timer);
  }
}
