// Fixture: lint-FAIL when linted from a path OUTSIDE the override
// globs. The `no-restricted-syntax` rule fires on the naked
// `Date.now()` call below (ADR-0034 AC4 sub-case 3).
//
// This file lives under `tests/**` (rule disabled there); the test
// copies it to a tmp path outside the override globs before invoking
// ESLint.
export function getNowMs(): number {
  const t = Date.now();
  return t;
}
