// Fixture: lint-PASS. Uses the sanctioned `nowUtc()` helper rather than
// a naked `new Date()` / `Date.now()`. Exercised by
// `tests/lint/no-naked-date.test.ts` (AC4 sub-case 1).
import { nowUtc } from '@/lib/time';

export function getCurrentInstant(): Date {
  return nowUtc();
}
