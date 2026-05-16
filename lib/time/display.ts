/**
 * `formatInZone()` — the single sanctioned call site for
 * `Intl.DateTimeFormat({ timeZone })` against already-fetched UTC
 * instants in application code (ADR-0034 §Presentation rules).
 *
 * The helper accepts a `Date` (a UTC instant — see `./now.ts`) and an
 * `IanaZone` (a validated zone — see `./zones.ts`) plus optional
 * `Intl.DateTimeFormatOptions` for caller-supplied formatting choices
 * (e.g. `{ timeZoneName: 'short' }` to surface the CDT/CST abbreviation,
 * `{ dateStyle: 'medium', timeStyle: 'short' }` for human-readable
 * display, etc.). The function is invariant to `process.env.TZ` — the
 * zone argument is the only source of truth.
 *
 * This is NOT a substitute for the pre-formatted SQL columns the audit
 * viewer receives. Per ADR-0034, conversion happens in exactly one tier
 * — the database — for stored timestamps that are queried for display.
 * `formatInZone` is the render surface for in-memory instants that have
 * already been fetched and need re-formatting per user surface (e.g. a
 * client-component re-render after a state change). See AC1 spec note.
 */
import type { IanaZone } from './zones';

export function formatInZone(d: Date, zone: IanaZone, opts?: Intl.DateTimeFormatOptions): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    ...opts,
  });
  return formatter.format(d);
}
