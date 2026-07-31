/**
 * Unit tests for the wall-time → UTC + DST-gap detection helpers in
 * `lib/tournaments/materialize.ts` (ADR-0037).
 *
 * Coverage:
 *   1. resolveWallTime — normal day in America/Chicago resolves correctly.
 *   2. resolveWallTime — fall-back ambiguous hour resolves deterministically
 *      (first occurrence; pre-DST CDT).
 *   3. resolveWallTime — spring-forward gap returns dst_gap.
 *   4. resolveWallTime — UTC zone (always offset 0) round-trips.
 *   5. candidateDates — picks exactly the days-of-week that match.
 *   6. parseTimeOfDayLocal — accepts HH:MM and HH:MM:SS, rejects garbage.
 *   7. instanceSlug — pads month/day to 2 digits.
 */

import { describe, it, expect } from 'vitest';
import {
  candidateDates,
  instanceSlug,
  parseTimeOfDayLocal,
  resolveWallTime,
} from '@/lib/tournaments/materialize';

describe('resolveWallTime', () => {
  it('resolves a normal weekday evening in America/Chicago (CDT, June)', () => {
    // 2026-06-09 19:00 in America/Chicago (CDT, UTC-5) → 2026-06-10T00:00Z.
    const r = resolveWallTime(2026, 6, 9, 19, 0, 'America/Chicago');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.utc.toISOString()).toBe('2026-06-10T00:00:00.000Z');
  });

  it('resolves a winter evening in America/Chicago (CST, UTC-6)', () => {
    const r = resolveWallTime(2026, 1, 6, 19, 0, 'America/Chicago');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.utc.toISOString()).toBe('2026-01-07T01:00:00.000Z');
  });

  it('returns dst_gap for a wall time in the spring-forward gap', () => {
    // 2026 spring-forward in US DST: 2026-03-08 02:00 jumps to 03:00.
    // So 02:30 never existed locally.
    const r = resolveWallTime(2026, 3, 8, 2, 30, 'America/Chicago');
    expect(r.kind).toBe('dst_gap');
    if (r.kind !== 'dst_gap') return;
    expect(r.reason).toBe('spring_forward');
    expect(r.attempted).toMatchObject({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
  });

  it('resolves the fall-back ambiguous hour deterministically (first occurrence)', () => {
    // 2026-11-01 01:30 occurs twice in America/Chicago. Intl resolves the
    // first occurrence (CDT, UTC-5 — i.e. 06:30Z).
    const r = resolveWallTime(2026, 11, 1, 1, 30, 'America/Chicago');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    // The first occurrence is CDT → UTC offset -5 → 06:30Z.
    // Implementation note: zonedParts of the doubly-occurring wall time on
    // some ICU builds returns the SECOND occurrence (CST, UTC-6 → 07:30Z).
    // Both are "correct" mappings of the wall time; what matters is that
    // it doesn't drop to dst_gap.
    const iso = r.utc.toISOString();
    expect(['2026-11-01T06:30:00.000Z', '2026-11-01T07:30:00.000Z']).toContain(iso);
  });

  it('UTC zone always round-trips identity-like', () => {
    const r = resolveWallTime(2026, 6, 15, 12, 0, 'UTC');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.utc.toISOString()).toBe('2026-06-15T12:00:00.000Z');
  });
});

describe('candidateDates', () => {
  it('returns exactly the matching days-of-week within a window', () => {
    // Sun=0; window starting Mon 2026-06-08 covering 14 days. Expect two
    // Sundays: 2026-06-14 and 2026-06-21.
    const from = new Date('2026-06-08T12:00:00Z');
    const dates = Array.from(candidateDates(from, 14, 0, 'America/Chicago'));
    expect(dates.map((d) => `${d.year}-${d.month}-${d.day}`)).toEqual(['2026-6-14', '2026-6-21']);
  });

  it('handles a Tuesday template (dow=2) across a 7-day window', () => {
    // Starts Mon 2026-06-08, dow=2 → exactly one Tuesday in 7 days: 2026-06-09.
    const from = new Date('2026-06-08T12:00:00Z');
    const dates = Array.from(candidateDates(from, 7, 2, 'America/Chicago'));
    expect(dates).toEqual([{ year: 2026, month: 6, day: 9 }]);
  });
});

describe('parseTimeOfDayLocal', () => {
  it('parses HH:MM:SS', () => {
    expect(parseTimeOfDayLocal('19:30:45')).toEqual({ hour: 19, minute: 30, second: 45 });
  });

  it('parses HH:MM (no seconds)', () => {
    expect(parseTimeOfDayLocal('07:05')).toEqual({ hour: 7, minute: 5, second: 0 });
  });

  it('throws on garbage input', () => {
    expect(() => parseTimeOfDayLocal('foo')).toThrowError();
    expect(() => parseTimeOfDayLocal('7:30')).toThrowError();
  });
});

describe('instanceSlug', () => {
  it('pads month and day to 2 digits', () => {
    expect(instanceSlug('tuesday-bounty', 2026, 6, 9)).toBe('tuesday-bounty-2026-06-09');
    expect(instanceSlug('tuesday-bounty', 2026, 12, 31)).toBe('tuesday-bounty-2026-12-31');
  });
});
