/**
 * @ideal-harness/guard — the enforcement floor.
 *
 * Deterministic, below-the-LLM controls: a deny-wins policy engine with
 * Anthropic-aligned defaults, prompt-injection wrapping, always-on secret
 * redaction, a scoped secrets broker, a skill-vetting scanner, a drift-guard
 * with an authority ladder, and an OS sandbox command builder.
 */

export {
  applyFloorMode,
  BYPASS_ENV_VAR,
  BYPASS_PERMISSION_MODE,
  type BypassSignals,
  DEFAULT_FLOOR_MODE,
  FLOOR_MODE_ENV_VAR,
  type FloorMode,
  floorMode,
  skipPermissionsActive,
} from './bypass.js';
export {
  ABSENCE_PROOF_FLOOR,
  AUTHORITY_ORDER,
  type Authority,
  type SourceFile,
  type SymbolVerdict,
  verifyPlan,
  verifySymbol,
} from './drift.js';
export { looksLikeInjection, type WrapOptions, wrapUntrusted } from './injection.js';
export {
  type AppendOptions,
  appendJournalEntry,
  type BuildEntryInput,
  buildJournalEntry,
  type GuardJournalEntry,
  JOURNAL_ENV_VAR,
  JOURNAL_SUBJECT_MAX,
  journalPath,
  parseJournal,
} from './journal.js';
export {
  type AllowProposal,
  commandShape,
  DEFAULT_MIN_COUNT,
  formatProposals,
  learnFromJournal,
  proposeAllowRules,
} from './learn.js';
export * from './policy/index.js';
export { type RedactionPattern, type RedactionResult, redactSecrets, SECRET_PATTERNS } from './redact.js';
export { buildSandboxCommand, type Platform, type SandboxCommand, type SandboxOptions, scrubEnv } from './sandbox.js';
export { type ScrubResult, scrubToolOutput } from './scrub.js';
export { type AccessRecord, SecretsBroker } from './secrets.js';
export * from './vet/index.js';
