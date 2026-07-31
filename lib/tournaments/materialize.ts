/**
 * Wall-time → UTC conversion + DST-gap detection for the tournament
 * materializer (ADR-0037 §Materializer).
 *
 * Pure functions only — no DB, no env, no auth — so this module is safe to
 * exercise from both server routes and unit tests. The route module
 * (`app/api/cron/tournament-materialize/route.ts`) imports these helpers
 * and owns the side-effecting parts.
 *
 * The materializer projects each active template onto the next 60 days. For
 * every (template, calendar-date) pair whose `day_of_week` matches, it
 * composes the wall-clock instant (date + `time_of_day_local` in `tz_name`)
 * and inserts a row with that instant stored as a UTC `timestamptz` plus
 * the original zone.
 *
 * Spring-forward DST seam: in `America/Chicago`, the local clock skips from
 * 02:00 to 03:00 on the second Sunday of March. A tournament scheduled for
 * `02:30` on that Sunday has no UTC instant — the wall time did not exist.
 * The materializer detects this by round-tripping the computed UTC back
 * through the zone and comparing the wall time: if the round-trip drifted,
 * the original was in the gap and we skip the instance with a structured
 * log. Fall-back ambiguity (the repeated hour in November) does NOT skip —
 * Intl.DateTimeFormat resolves the first occurrence deterministically.
 */

type Parts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const ZONE_PART_KEYS = ['year', 'month', 'day', 'hour', 'minute', 'second'] as const;

function zonedParts(d: Date, tzName: string): Parts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tzName,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const out: Partial<Parts> = {};
  for (const k of ZONE_PART_KEYS) {
    const piece = parts.find((p) => p.type === k);
    if (!piece) {
      throw new Error(`zonedParts: missing ${k} in formatToParts output`);
    }
    let v = parseInt(piece.value, 10);
    // 24-hour Intl quirk on some ICU builds: midnight renders as '24'.
    if (k === 'hour' && v === 24) v = 0;
    out[k] = v;
  }
  return out as Parts;
}

/** Compare two `Parts` for wall-time equality. */
function partsEqual(a: Parts, b: Parts): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

export type WallTimeResolution =
  | { kind: 'ok'; utc: Date }
  | { kind: 'dst_gap'; reason: 'spring_forward'; attempted: Parts };

/**
 * Resolve a wall-clock instant (date + time) in `tzName` to a UTC `Date`.
 *
 * Returns `{ kind: 'ok', utc }` for normal instants. Returns
 * `{ kind: 'dst_gap', reason: 'spring_forward' }` when the wall time never
 * existed in `tzName` (e.g. 2026-03-08 02:30 in America/Chicago).
 *
 * Algorithm:
 *   1. Compose `Date.UTC(y, mo-1, d, h, mn, s)` — treat the wall time as if
 *      it were UTC. This produces a synthetic instant.
 *   2. Render that synthetic instant in `tzName`. The difference between
 *      the rendered wall time and the requested wall time is the zone
 *      offset (in minutes), with sign convention "zone time = utc + offset".
 *   3. Subtract the offset from the synthetic UTC to get the real UTC.
 *   4. Round-trip: render the real UTC in `tzName`. If the resulting wall
 *      time matches the requested wall time, return `ok`. If it differs,
 *      the wall time was in a DST spring-forward gap.
 */
export function resolveWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tzName: string,
  second = 0,
): WallTimeResolution {
  const requested: Parts = { year, month, day, hour, minute, second };

  // Step 1 — synthetic UTC instant.
  const syntheticUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const synthetic = new Date(syntheticUtcMs);

  // Step 2 — render synthetic in tz to discover the offset.
  const rendered = zonedParts(synthetic, tzName);

  // Compute the offset in minutes: rendered = utc + offset → offset = rendered - utc.
  // We do this via a "minute offset" computed as the Δ between rendered Parts
  // (interpreted as UTC values) and the synthetic Parts (which were the UTC
  // values we composed at step 1). Sign convention: positive offset = ahead
  // of UTC; negative = behind.
  const renderedMs = Date.UTC(
    rendered.year,
    rendered.month - 1,
    rendered.day,
    rendered.hour,
    rendered.minute,
    rendered.second,
  );
  const offsetMs = renderedMs - syntheticUtcMs;

  // Step 3 — real UTC = synthetic - offset.
  const realUtc = new Date(syntheticUtcMs - offsetMs);

  // Step 4 — round-trip verification.
  const roundTripped = zonedParts(realUtc, tzName);
  if (!partsEqual(roundTripped, requested)) {
    return { kind: 'dst_gap', reason: 'spring_forward', attempted: requested };
  }

  return { kind: 'ok', utc: realUtc };
}

/**
 * Compose `<slugPrefix>-<YYYY-MM-DD>` using the calendar date (in the
 * template's zone, not UTC) for `date`. Mirror to the DB's
 * `tournaments_template_date_idx` partial unique index expression
 * `date(starts_at AT TIME ZONE tz_name)`.
 */
export function instanceSlug(slugPrefix: string, year: number, month: number, day: number): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${slugPrefix}-${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Iterate every calendar date d ∈ [from, from + days) and yield those whose
 * day-of-week (in the template's zone) matches `dayOfWeek`.
 *
 * `dayOfWeek`: 0=Sunday..6=Saturday (matches Postgres' `extract(dow ...)` and
 * the schema's `tournament_templates.day_of_week` column).
 */
export function* candidateDates(
  from: Date,
  days: number,
  dayOfWeek: number,
  tzName: string,
): Iterable<{ year: number; month: number; day: number }> {
  const ms_per_day = 24 * 60 * 60 * 1000;
  for (let i = 0; i < days; i += 1) {
    const candidate = new Date(from.getTime() + i * ms_per_day);
    const parts = zonedParts(candidate, tzName);
    // Compute DOW in the template's zone by constructing a Date from the
    // zoned wall time (treated as UTC) and reading getUTCDay().
    const wallAsUtc = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
    );
    const dow = wallAsUtc.getUTCDay();
    if (dow === dayOfWeek) {
      yield { year: parts.year, month: parts.month, day: parts.day };
    }
  }
}

/** Parse a `HH:MM:SS` string into `[hour, minute, second]`. */
export function parseTimeOfDayLocal(s: string): { hour: number; minute: number; second: number } {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) {
    throw new Error(`parseTimeOfDayLocal: invalid HH:MM[:SS] string ${JSON.stringify(s)}`);
  }
  return {
    hour: parseInt(m[1]!, 10),
    minute: parseInt(m[2]!, 10),
    second: m[3] ? parseInt(m[3], 10) : 0,
  };
}
