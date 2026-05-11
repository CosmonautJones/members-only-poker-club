/**
 * Export-shape snapshot for `lib/time/` — ADR-0034 Slice 1 AC1.
 *
 * The `lib/time/index.ts` re-export surface IS the v1 public API.
 * Adding new exports requires either a new AC in a later slice or a
 * spec amendment in this slice; this snapshot test fails loudly if a
 * worker adds a symbol without updating the expected list below.
 *
 * The expected list is the union of runtime exports (functions and
 * constants) from index.ts. Type-only exports (IanaZone, Moment,
 * WallClockIntent, VendorMoment, JurisdictionalDate, AuditRowDualZone)
 * are erased at runtime and do NOT appear in Object.keys(* as Time).
 * That's intentional — the snapshot pins the JS-shape contract; the
 * type contract is pinned by pnpm typecheck over the rest of the
 * suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Time from '@/lib/time';

const PINNED = '2026-05-11T00:00:00.000Z';

describe('@/lib/time export surface (AC1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PINNED));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports exactly the v1 surface — Object.keys snapshot', () => {
    const expected = [
      'CLUB_TZ_DEFAULT',
      'formatAuditRowDualZone',
      'formatInZone',
      'isValidIanaZone',
      'jurisdictionalDate',
      'momentUtc',
      'nowUtc',
      'vendorMoment',
      'wallClockIntent',
    ].sort();
    const actual = Object.keys(Time).sort();
    expect(actual).toEqual(expected);
  });

  it('CLUB_TZ_DEFAULT is the literal America/Chicago string', () => {
    expect(Time.CLUB_TZ_DEFAULT).toBe('America/Chicago');
  });

  it('every runtime export is callable / readable (no broken re-exports)', () => {
    expect(typeof Time.nowUtc).toBe('function');
    expect(typeof Time.isValidIanaZone).toBe('function');
    expect(typeof Time.formatInZone).toBe('function');
    expect(typeof Time.formatAuditRowDualZone).toBe('function');
    expect(typeof Time.momentUtc).toBe('function');
    expect(typeof Time.wallClockIntent).toBe('function');
    expect(typeof Time.vendorMoment).toBe('function');
    expect(typeof Time.jurisdictionalDate).toBe('function');
    expect(typeof Time.CLUB_TZ_DEFAULT).toBe('string');
  });
});
