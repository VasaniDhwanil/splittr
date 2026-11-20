/**
 * Text that leaves through /api/mcp is read by a model, so anything a person
 * could not see on screen is removed first: an invisible instruction is
 * invisible to the user and perfectly legible to their agent.
 *
 * An explicit list, not whole Unicode categories: stripping every format
 * character would break emoji (U+200D joins them, U+FE0F selects the emoji
 * form), and "unassigned" depends on the runtime's Unicode version.
 */
const INVISIBLE = new RegExp(
  '[' +
    '\\u{E0000}-\\u{E007F}' + // tag characters
    '\\u202A-\\u202E\\u2066-\\u2069' + // bidi embeddings, overrides, isolates
    '\\u200B\\u200C\\u2060-\\u2064\\uFEFF' + // zero-width space/non-joiner, word joiner, invisible operators, BOM
    '\\u{E000}-\\u{F8FF}\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}' + // private use
    ']',
  'gu'
);

const CONTROL = /[\x00-\x1f\x7f]/g;

/** Any string on its way to an agent: visible characters only, bounded. */
export function cleanForAgent(raw: unknown, maxLength: number): string {
  const visible = String(raw ?? '')
    .replace(INVISIBLE, '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Cap by character so an emoji is never cut in half
  return [...visible].slice(0, maxLength).join('').trim();
}

export const WITHHELD = '[withheld: looks like instructions]';

const INSTRUCTION_PATTERNS = [
  /\b(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|preceding)\b/i,
  /\b(system|assistant|developer)\s*:/i,
  /\byou\s+are\s+now\b/i,
  /\bnew\s+instructions?\b/i,
  /<\/?\s*(system|instructions?)\s*>/i,
];

/**
 * A cheap filter for the laziest injection attempts. Trivially bypassed, so
 * nothing relies on it: the protections that count are not returning
 * strangers' names at all and requiring approval for every write.
 */
export function looksLikeInstructions(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}

/** Text written by someone other than the caller, ready for an untrusted_ field. */
export function untrusted(raw: unknown, maxLength: number): string {
  const text = cleanForAgent(raw, maxLength);
  return looksLikeInstructions(text) ? WITHHELD : text;
}
