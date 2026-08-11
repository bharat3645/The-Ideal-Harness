/**
 * Shared network-egress policy gate for the web module's outbound calls.
 *
 * `web_fetch`/`web_docs` are new MCP tool NAMES, but they do the exact thing
 * the native `WebFetch` tool does — fetch a URL. Evaluating them under the
 * literal `WebFetch` rule means an operator's existing WebFetch policy (the
 * default ask, or any allow/deny they've added) applies uniformly; a
 * differently-named tool must not become a quiet side door around it.
 */

import { DEFAULT_RULES, evaluateTiered, type PolicyDecision, type PolicyRule } from '../guard/index.js';

export function gateWebFetch(url: string, tiers: readonly (readonly PolicyRule[])[] = [DEFAULT_RULES]): PolicyDecision {
  return evaluateTiered({ tool: 'WebFetch', input: { url } }, tiers);
}
