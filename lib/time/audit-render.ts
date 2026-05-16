/**
 * `formatAuditRowDualZone()` — audit-log presentation contract helper
 * (ADR-0034 §"Audit log presentation contract", spec AC3).
 *
 * Returns the pre-formatted UTC + club-zone string pair, the in-effect
 * short-zone abbreviation, and a `dstSeam` flag for the audit viewer's
 * banner logic. No DOM, no React, no rendering — the (deferred) audit
 * viewer (ADR-0006 Slice 4) consumes the plain object this returns and
 * writes pure JSX over the result.
 *
 * Contract fields:
 *   - `utc`     — ISO 8601 UTC, second precision, no milliseconds:
 *                 `YYYY-MM-DDTHH:mm:ssZ`. (The audit viewer's primary
 *                 sort axis is UTC; ms-resolution adds visual noise
 *                 without operational value in v1.)
 *   - `club`    — `YYYY-MM-DD HH:mm:ss` in `clubZone`. No `T`
 *                 separator, no trailing zone designator — the offset
 *                 is in a separate column on the viewer.
 *   - `offset`  — short-zone abbreviation in `clubZone` at `utc`. For
 *                 America/Chicago this is `'CDT'` (UTC-05:00) or
 *                 `'CST'` (UTC-06:00). Non-CT zones return whatever
 *                 `Intl.DateTimeFormat({ timeZoneName: 'short' })`
 *                 produces for the zone (e.g. `'BST'` for
 *                 Europe/London in summer).
 *   - `dstSeam` — `'spring-forward'` if the row falls within the
 *                 1-hour UTC window around the spring-forward instant
 *                 for `clubZone` in `utc`'s year; `'fall-back'`
 *                 analogously; `null` otherwise. Detection algorithm:
 *                 compute the short-zone abbreviation at `utc` vs
 *                 `utc - 1h`; if they differ, `utc` is on a seam.
 *                 Direction is inferred from the gain: CDT-gained ⇒
 *                 spring-forward, CST-gained ⇒ fall-back. The 1-hour
 *                 window catches the case where the viewer renders a
 *                 row that occurred just outside the transition
 *                 instant but still within the user-visible
 *                 ambiguous-or-skipped hour.
 */
import type { IanaZone } from './zones';

export type AuditRowDualZone = {
  utc: string;
  club: string;
  /**
   * Short-zone abbreviation in `clubZone` at `utc`. For America/Chicago
   * this is `'CDT'` (UTC-05:00) or `'CST'` (UTC-06:00). Non-CT zones
   * return whatever `Intl.DateTimeFormat({ timeZoneName: 'short' })`
   * produces (e.g. `'BST'` for Europe/London in summer). The type is
   * widened to `string` because the CDT/CST values are semantic
   * documentation, not a runtime guarantee — collapsing to `string`
   * matches the actual runtime contract.
   */
  offset: string;
  dstSeam: 'spring-forward' | 'fall-back' | null;
};

/**
 * Extract the short-zone abbreviation (e.g. `'CDT'`, `'CST'`, `'BST'`)
 * that `Intl.DateTimeFormat` produces for `date` rendered in `zone`.
 * Uses `formatToParts` so the abbreviation is isolated from the rest
 * of the string regardless of locale or other format options.
 */
function shortZoneAbbrev(date: Date, zone: IanaZone): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'short',
  });
  const parts = formatter.formatToParts(date);
  const tzPart = parts.find((p) => p.type === 'timeZoneName');
  return tzPart?.value ?? '';
}

/**
 * Format `date` rendered in `zone` as `YYYY-MM-DD HH:mm:ss`. Built
 * from `formatToParts` rather than a single `format()` call so the
 * separator and ordering are independent of locale defaults.
 */
function formatClubLocal(date: Date, zone: IanaZone): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // `Intl.DateTimeFormat` with `hour12: false` may emit `'24'` for
  // midnight in some locales / Node versions; normalize to `'00'`.
  const rawHour = get('hour');
  const hour = rawHour === '24' ? '00' : rawHour;
  const minute = get('minute');
  const second = get('second');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * Format `date` as `YYYY-MM-DDTHH:mm:ssZ` (ISO 8601 UTC, second
 * precision). `toISOString()` produces millisecond precision —
 * truncate by replacing the `.sssZ` tail with `Z`.
 */
function formatUtcSecondPrecision(date: Date): string {
  // `toISOString()` always produces `YYYY-MM-DDTHH:mm:ss.sssZ`.
  const iso = date.toISOString();
  return `${iso.slice(0, 19)}Z`;
}

export function formatAuditRowDualZone(utc: Date, clubZone: IanaZone): AuditRowDualZone {
  const utcStr = formatUtcSecondPrecision(utc);
  const clubStr = formatClubLocal(utc, clubZone);
  const offset = shortZoneAbbrev(utc, clubZone);

  // DST-seam detection: compare the in-effect short-zone abbreviation
  // at `utc` against the abbreviations at `utc - 1h` AND `utc + 1h`.
  // The transition is on a seam whenever the at-utc abbreviation
  // differs from EITHER neighbor — that covers both the pre-instant
  // and post-instant sides of the centered 1-hour window the spec
  // commits to in AC3 (e.g. `2026-03-08T07:59:59Z` is still CST while
  // `utc+1h` is CDT; `2026-03-08T08:00:01Z` is already CDT while
  // `utc-1h` is CST — both are inside the 30-minute-each-side window
  // around the 08:00Z spring-forward instant).
  //
  // Direction inference: the spring-forward jump moves clocks INTO
  // daylight time (the abbreviation gains a `D`, or the BST/GMT
  // pattern moves from G→B). Heuristic: if the daylight-flavored
  // abbreviation appears LATER in time (i.e. at-utc is daylight and
  // a neighbor before it is standard; OR at-utc is standard and a
  // neighbor before it is daylight ⇒ fall-back), label accordingly.
  // For non-CT zones the label is best-effort (load-bearing property
  // is "the row IS on a seam" — direction is the secondary signal).
  const minusOneHour = new Date(utc.getTime() - 60 * 60 * 1000);
  const plusOneHour = new Date(utc.getTime() + 60 * 60 * 1000);
  const abbrevAtUtc = offset;
  const abbrevMinusOne = shortZoneAbbrev(minusOneHour, clubZone);
  const abbrevPlusOne = shortZoneAbbrev(plusOneHour, clubZone);

  const looksDaylight = (s: string): boolean => /D/.test(s) || s === 'BST';
  const looksStandard = (s: string): boolean => /S/.test(s) || s === 'GMT';

  let dstSeam: 'spring-forward' | 'fall-back' | null = null;

  if (abbrevAtUtc.length > 0 && abbrevAtUtc !== abbrevMinusOne && abbrevMinusOne.length > 0) {
    // The transition instant lies at or just before `utc` — `utc-1h`
    // was on the other side of the seam.
    if (looksDaylight(abbrevAtUtc) && looksStandard(abbrevMinusOne)) {
      dstSeam = 'spring-forward';
    } else if (looksStandard(abbrevAtUtc) && looksDaylight(abbrevMinusOne)) {
      dstSeam = 'fall-back';
    } else if (abbrevAtUtc > abbrevMinusOne) {
      dstSeam = 'spring-forward';
    } else {
      dstSeam = 'fall-back';
    }
  } else if (abbrevAtUtc.length > 0 && abbrevAtUtc !== abbrevPlusOne && abbrevPlusOne.length > 0) {
    // The transition instant lies at or just after `utc` — `utc+1h`
    // will be on the other side of the seam.
    if (looksStandard(abbrevAtUtc) && looksDaylight(abbrevPlusOne)) {
      dstSeam = 'spring-forward';
    } else if (looksDaylight(abbrevAtUtc) && looksStandard(abbrevPlusOne)) {
      dstSeam = 'fall-back';
    } else if (abbrevPlusOne > abbrevAtUtc) {
      dstSeam = 'spring-forward';
    } else {
      dstSeam = 'fall-back';
    }
  }

  return {
    utc: utcStr,
    club: clubStr,
    offset,
    dstSeam,
  };
}
