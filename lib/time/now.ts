/**
 * `nowUtc()` — the SOLE sanctioned `new Date()` / `Date.now()` call site
 * in the entire repository (ADR-0034 single-source-of-truth).
 *
 * Returns a fresh `Date` instance representing the current instant. The
 * value's internal representation is UTC milliseconds since epoch —
 * `Date` is timezone-agnostic at storage; presentation tier (see
 * `./display.ts`) is responsible for any zone-aware rendering.
 *
 * Every other call site in application code MUST import this helper
 * rather than calling `new Date()` or `Date.now()` directly. The ESLint
 * rule installed by ADR-0034 Slice 1 task t6 enforces this repo-wide
 * (with `lib/time/**`, `tests/**`, and `scripts/**` exempted via path
 * overrides).
 *
 * The function body is intentionally the literal one-liner below — see
 * ADR-0034 spec AC1 / AC4. Do NOT add caching, offset application, or
 * any other transform; the test suite asserts (a) the returned value
 * equals `vi.setSystemTime`'s set instant exactly, and (b) a fresh
 * `Date` instance is returned on every call.
 */
export function nowUtc(): Date {
  return new Date();
}
