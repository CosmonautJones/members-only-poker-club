// Fixture: lint-FAIL when linted from a path OUTSIDE the override
// globs. The `no-restricted-syntax` rule installed by ADR-0034 AC4
// fires on the naked zero-arg `new Date()` below.
//
// Note: this file LIVES under `tests/**` which IS in the override
// glob (rule disabled there). The test
// `tests/lint/no-naked-date.test.ts` reads this file as text and
// copies it to a tmp path outside the override globs before invoking
// ESLint — see AC4 sub-case 2.
export function getNow(): Date {
  const d = new Date();
  return d;
}
