// Defences against ReDoS (regex denial of service) on user-supplied patterns.
//
// 1. `isSafeRegex` is a write-time heuristic that rejects patterns with
//    obviously dangerous shapes: nested quantifiers (e.g. `(a+)+`,
//    `(a*)*`, `(.+)+`) and patterns longer than a conservative cap. It does
//    not claim to catch every pathological regex — that would require re2 or
//    a proper static analyser — but it catches the common catastrophic
//    backtracking patterns cheaply.
// 2. `MATCH_INPUT_CAP` is applied at match time: any input string is
//    truncated before being fed to `RegExp.test`, bounding the work a
//    malicious pattern can do on a given row.
//
// See the improvement plan (H5) for the follow-up: swap to re2 or run
// matching in a worker with a hard timeout.

export const PATTERN_MAX_LENGTH = 500;
export const MATCH_INPUT_CAP = 1000;

// Nested quantifiers: a group immediately followed by + or * where the
// group itself contains a quantifier. Flags an `(...)` or `(?:...)`
// containing +, *, or {n,} and suffixed by another quantifier.
const NESTED_QUANTIFIER = /\((?:[^()]*[+*]|[^()]*\{\d+,?\d*\})[^()]*\)[+*]/;

export function isSafeRegex(pattern: string): { ok: true } | { ok: false; reason: string } {
  if (pattern.length === 0) return { ok: false, reason: 'Pattern is empty' };
  if (pattern.length > PATTERN_MAX_LENGTH) {
    return { ok: false, reason: `Pattern exceeds ${PATTERN_MAX_LENGTH} characters` };
  }
  try {
    new RegExp(pattern);
  } catch {
    return { ok: false, reason: 'Invalid regex syntax' };
  }
  if (NESTED_QUANTIFIER.test(pattern)) {
    return {
      ok: false,
      reason:
        'Pattern contains a nested quantifier (e.g. (a+)+) which is vulnerable to catastrophic backtracking',
    };
  }
  return { ok: true };
}

export function capInput(input: string): string {
  return input.length > MATCH_INPUT_CAP ? input.slice(0, MATCH_INPUT_CAP) : input;
}
