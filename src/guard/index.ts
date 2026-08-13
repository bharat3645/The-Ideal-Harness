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
  type TieredSourceSymbols,
  verifyPlan,
  verifyPlanStructural,
  verifySymbol,
  verifySymbolStructural,
} from './drift.js';
export { type ExecResult, execCommand } from './exec.js';
export { looksLikeInjection, type WrapOptions, wrapUntrusted } from './injection.js';
export {
  type AppendOptions,
  appendJournalEntry,
  type BuildEntryInput,
  buildJournalEntry,
  type ChainVerification,
  chainHash,
  type GuardJournalEntry,
  JOURNAL_ENV_VAR,
  JOURNAL_GENESIS_HASH,
  JOURNAL_SUBJECT_MAX,
  journalPath,
  parseJournal,
  verifyJournalChain,
} from './journal.js';
export {
  type AllowProposal,
  type AskDigestEntry,
  commandShape,
  DEFAULT_MIN_COUNT,
  formatAskDigest,
  formatProposals,
  learnFromJournal,
  proposeAllowRules,
  ratifyFromJournal,
  ratifyShape,
  summarizeAsks,
} from './learn.js';
export {
  activeLeaseRules,
  type CapabilityLease,
  consumeLease,
  type GrantLeaseInput,
  grantLease,
  isLeaseLive,
  leasesPath,
  leaseToRule,
  loadLeases,
  pruneExpired,
  revokeLease,
  saveLeases,
} from './leases.js';
export * from './policy/index.js';
export { PROFILE_ENV_VAR, PROFILES, type Profile, type ProfileName, resolveProfile } from './profiles.js';
export { type RedactionPattern, type RedactionResult, redactSecrets, SECRET_PATTERNS } from './redact.js';
export {
  consumeLeaseIfDecided,
  type ResolvedTiers,
  type ResolveOperatorTiersOptions,
  resolveOperatorTiers,
} from './resolve.js';
export {
  buildSandboxCommand,
  type Platform,
  type SandboxCommand,
  type SandboxOptions,
  sandboxToolAvailable,
  scrubEnv,
} from './sandbox.js';
export { type ScrubResult, scrubToolOutput } from './scrub.js';
export { type AccessRecord, SecretsBroker } from './secrets.js';
export * from './vet/index.js';
