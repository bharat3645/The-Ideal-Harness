/**
 * Hidden-character and homoglyph detection for skill vetting.
 *
 * MCP tool-poisoning and skill attacks hide instructions using invisible
 * characters (zero-width, bidi overrides) or letters that look ASCII but are
 * Cyrillic/Greek confusables. Both are deterministic to detect.
 */

export interface HiddenCharFinding {
  readonly index: number;
  readonly codepoint: number;
  readonly kind: 'zero-width' | 'bidi-control' | 'confusable';
  readonly note: string;
}

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
const BIDI_CONTROL = new Set([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]);

// A small confusables map: characters that render like ASCII letters.
const CONFUSABLES: Readonly<Record<number, string>> = {
  1072: 'a', // CYRILLIC a
  1077: 'e', // CYRILLIC e
  1086: 'o', // CYRILLIC o
  1088: 'p', // CYRILLIC r
  1089: 'c', // CYRILLIC s
  1093: 'x', // CYRILLIC h
  1109: 's', // CYRILLIC dze
  1110: 'i', // CYRILLIC i
  959: 'o', // GREEK omicron
  913: 'A', // GREEK Alpha
};

/** Scan text for invisible or confusable characters. */
export function findHiddenChars(text: string): HiddenCharFinding[] {
  const findings: HiddenCharFinding[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const cp = text.codePointAt(i);
    if (cp === undefined) {
      continue;
    }
    if (ZERO_WIDTH.has(cp)) {
      findings.push({ index: i, codepoint: cp, kind: 'zero-width', note: 'zero-width character' });
    } else if (BIDI_CONTROL.has(cp)) {
      findings.push({ index: i, codepoint: cp, kind: 'bidi-control', note: 'bidirectional override (text-spoofing)' });
    } else if (cp in CONFUSABLES) {
      findings.push({
        index: i,
        codepoint: cp,
        kind: 'confusable',
        note: `homoglyph of ASCII "${CONFUSABLES[cp]}"`,
      });
    }
  }
  return findings;
}

export function hasHiddenChars(text: string): boolean {
  return findHiddenChars(text).length > 0;
}
