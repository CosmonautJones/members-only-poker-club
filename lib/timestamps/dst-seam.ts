// Pure helper. No 'server-only' — the result is the same regardless of
// runtime and the function is safe to call from client RSCs that render
// the audit-log viewer's DST banner.
//
// Spec: docs/specs/0035-admin-operations-console-implementation.md AC19
// Task: .conductor/0035 t8 (WB.T10)
// ADR:  docs/adr/0034-timestamp-and-timezone-policy.md
//
// The America/Chicago fall-back DST transition happens annually on the
// first Sunday of November at 02:00 local CDT, when clocks rewind to
// 01:00 CST. CDT is UTC−05:00, so the UTC instant of the transition is
// the first Sunday of November at 07:00 UTC.
//
// `crossesFallbackSeam(fromUtc, toUtc)` returns true when the closed
// interval [fromUtc, toUtc] contains at least one such transition. Per
// AC19 the bounds are inclusive — `fromUtc <= seamUtc <= toUtc`.

/**
 * Return the UTC `Date` of the America/Chicago fall-back DST transition
 * for a given calendar year. The transition is the first Sunday of
 * November at 02:00 CDT → 01:00 CST, which is 07:00 UTC.
 */
function fallbackSeamUtcForYear(year: number): Date {
  // `Date.UTC(year, 10, 1)` is November 1st at 00:00 UTC. Its weekday in
  // UTC is the same as its weekday in Central (the entire day spans both
  // 2026-11-01 UTC and 2026-11-01 Central). Use `getUTCDay()` so we are
  // not at the mercy of the host TZ.
  const nov1 = new Date(Date.UTC(year, 10, 1, 0, 0, 0, 0));
  const dow = nov1.getUTCDay(); // 0 = Sunday
  const firstSundayDay = 1 + ((7 - dow) % 7);
  return new Date(Date.UTC(year, 10, firstSundayDay, 7, 0, 0, 0));
}

/**
 * Return true iff the closed interval [fromUtc, toUtc] contains the
 * America/Chicago fall-back DST seam moment for at least one year in
 * the range. Returns false for invalid inputs (NaN dates, inverted
 * ranges).
 *
 * Spring-forward transitions are intentionally NOT detected — only the
 * repeated-hour fall-back triggers the audit-log viewer banner per
 * ADR-0034 §"Audit log presentation contract".
 */
export function crossesFallbackSeam(fromUtc: Date, toUtc: Date): boolean {
  const fromMs = fromUtc.getTime();
  const toMs = toUtc.getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return false;
  if (fromMs > toMs) return false;

  const startYear = fromUtc.getUTCFullYear();
  const endYear = toUtc.getUTCFullYear();
  for (let year = startYear; year <= endYear; year += 1) {
    const seamMs = fallbackSeamUtcForYear(year).getTime();
    if (fromMs <= seamMs && seamMs <= toMs) return true;
  }
  return false;
}
