/**
 * Unit tests for formatAuditRowDualZone() — ADR-0034 Slice 1 AC3
 * (all 8 sub-cases).
 *
 * The helper is the v1 contract the (deferred) admin audit viewer
 * (ADR-0006 Slice 4) consumes. The contract:
 *
 *   - `utc`     ISO 8601 second precision: YYYY-MM-DDTHH:mm:ssZ
 *   - `club`    YYYY-MM-DD HH:mm:ss in clubZone (no T, no zone tail)
 *   - `offset`  short-zone abbreviation (CST/CDT for America/Chicago;
 *                whatever Intl produces for other zones — Node version
 *                dependent for non-CT zones)
 *   - `dstSeam` 'spring-forward' | 'fall-back' | null based on whether
 *                the row falls within the 1-hour UTC window around the
 *                transition instant for clubZone in utc's year.
 *
 * Sub-case 8 (non-CT zone Europe/London) intentionally asserts the
 * `club` time and the "we got SOME offset value" property; the exact
 * `BST` vs `GMT+1` short-zone string varies by Node version's bundled
 * ICU/CLDR data (Node 22 on Windows produces 'GMT+1' for London BST;
 * other Node builds may produce 'BST'). The load-bearing property is
 * "the helper returns the correct wall-clock time and dstSeam:null
 * outside the seam" — the abbreviation itself is the secondary signal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatAuditRowDualZone, CLUB_TZ_DEFAULT } from '@/lib/time';
import type { IanaZone } from '@/lib/time';

const PINNED = '2026-05-11T00:00:00.000Z';

describe('formatAuditRowDualZone() — AC3', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PINNED));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TZ;
  });

  it('sub-case 1: mid-summer non-seam → 13:00 CDT, dstSeam null', () => {
    const result = formatAuditRowDualZone(new Date('2026-07-15T18:00:00Z'), CLUB_TZ_DEFAULT);
    expect(result).toEqual({
      utc: '2026-07-15T18:00:00Z',
      club: '2026-07-15 13:00:00',
      offset: 'CDT',
      dstSeam: null,
    });
  });

  it('sub-case 2: mid-winter non-seam → 12:00 CST, dstSeam null', () => {
    const result = formatAuditRowDualZone(new Date('2026-01-15T18:00:00Z'), CLUB_TZ_DEFAULT);
    expect(result).toEqual({
      utc: '2026-01-15T18:00:00Z',
      club: '2026-01-15 12:00:00',
      offset: 'CST',
      dstSeam: null,
    });
  });

  it('sub-case 3: spring-forward seam, just before (within window, pre-jump)', () => {
    const result = formatAuditRowDualZone(new Date('2026-03-08T07:59:59Z'), CLUB_TZ_DEFAULT);
    expect(result.utc).toBe('2026-03-08T07:59:59Z');
    expect(result.club).toBe('2026-03-08 01:59:59');
    expect(result.offset).toBe('CST');
    expect(result.dstSeam).toBe('spring-forward');
  });

  it('sub-case 4: spring-forward seam, just after (within window, post-jump)', () => {
    const result = formatAuditRowDualZone(new Date('2026-03-08T08:00:01Z'), CLUB_TZ_DEFAULT);
    expect(result.utc).toBe('2026-03-08T08:00:01Z');
    expect(result.club).toBe('2026-03-08 03:00:01');
    expect(result.offset).toBe('CDT');
    expect(result.dstSeam).toBe('spring-forward');
  });

  it('sub-case 5: spring-forward, OUTSIDE the window → dstSeam null', () => {
    // 05:00Z on 2026-03-08 is 23:00 the previous day in CST — well
    // before the 08:00Z spring-forward instant and outside the 1-hour
    // window the helper checks.
    const result = formatAuditRowDualZone(new Date('2026-03-08T05:00:00Z'), CLUB_TZ_DEFAULT);
    expect(result.offset).toBe('CST');
    expect(result.dstSeam).toBeNull();
  });

  it('sub-case 6: fall-back repeat-1 (06:30Z) → 01:30 CDT, dstSeam fall-back', () => {
    const result = formatAuditRowDualZone(new Date('2026-11-01T06:30:00Z'), CLUB_TZ_DEFAULT);
    expect(result.utc).toBe('2026-11-01T06:30:00Z');
    expect(result.club).toBe('2026-11-01 01:30:00');
    expect(result.offset).toBe('CDT');
    expect(result.dstSeam).toBe('fall-back');
  });

  it('sub-case 7: fall-back repeat-2 (07:30Z) → 01:30 CST, dstSeam fall-back — identical club string to repeat-1 (ambiguous-hour load-bearing property)', () => {
    const result = formatAuditRowDualZone(new Date('2026-11-01T07:30:00Z'), CLUB_TZ_DEFAULT);
    expect(result.utc).toBe('2026-11-01T07:30:00Z');
    expect(result.club).toBe('2026-11-01 01:30:00');
    expect(result.offset).toBe('CST');
    expect(result.dstSeam).toBe('fall-back');

    // Load-bearing cross-check: the two repeats produce IDENTICAL
    // `club` strings — this is the ambiguity the audit viewer's
    // dstSeam banner exists to flag.
    const repeat1 = formatAuditRowDualZone(new Date('2026-11-01T06:30:00Z'), CLUB_TZ_DEFAULT);
    expect(repeat1.club).toBe(result.club);
    expect(repeat1.utc).not.toBe(result.utc);
  });

  it('sub-case 8: non-CT zone (Europe/London BST in summer) → 19:00 local, dstSeam null', () => {
    const result = formatAuditRowDualZone(
      new Date('2026-07-15T18:00:00Z'),
      'Europe/London' as IanaZone,
    );
    expect(result.utc).toBe('2026-07-15T18:00:00Z');
    expect(result.club).toBe('2026-07-15 19:00:00');
    // Node's bundled ICU may emit 'BST' or 'GMT+1' depending on
    // version; the load-bearing property is "we get a non-empty
    // short-zone string". The audit-viewer JSX accepts whatever the
    // host produces.
    expect(typeof result.offset).toBe('string');
    expect(result.offset.length).toBeGreaterThan(0);
    expect(result.offset).toMatch(/^(BST|GMT\+1|GMT\+01:00)$/);
    expect(result.dstSeam).toBeNull();
  });
});
