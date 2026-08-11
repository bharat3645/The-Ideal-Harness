export {
  type DeepScanResult,
  type ExecFn,
  type ExternalScanOptions,
  type ExternalScanResult,
  runOsvScanner,
  runSemgrep,
  scanSkillDir,
} from './external.js';
export { findHiddenChars, type HiddenCharFinding, hasHiddenChars } from './homoglyph.js';
export { type Severity, THREAT_PATTERNS, type ThreatCategory, type ThreatPattern } from './patterns.js';
export { type ScanFinding, type ScanResult, SEVERITY_ORDER, scanSkill } from './scan.js';
