/**
 * Unit tests for formatInZone() — ADR-0034 Slice 1 AC2
 * (sub-case group "formatInZone").
 *
 * Exercises the helper across the America/Chicago DST transitions in
 * 2026 — spring-forward (2026-03-08 02:00 CST to 03:00 CDT) and
 * fall-back (2026-11-01 02:00 CDT to 01:00 CST). The load-bearing
 * assertions are:
 *
 *   - the 02:00 to 03:00 wall-clock hour on spring-forward is SKIPPED
 *     (07:59Z formats as 01:59 CST; 08:00Z as 03:00 CDT — never 02:xx).
 *   - the 01:00 to 02:00 wall-clock hour on fall-back is REPEATED
 *     (06:30Z and 07:30Z both format to wall-clock 01:30 but the
 *     underlying instants differ by 1h — this is the ambiguous-hour
 *     property the audit-render banner exists to disambiguate).
 *   - the helper is invariant to process.env.TZ — the zone argument
 *     is the only source of truth.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatInZone, CLUB_TZ_DEFAULT } from '@/lib/time';

const PINNED = '2026-05-11T00:00:00.000Z';

/**
 * Extract HH:mm from formatInZone(d, zone, { hour, minute, hour12:
 * false }) — defensive parse in case the host locale wraps the time
 * in any non-digit separator.
 */
function hourMinute(d: Date, zone: typeof CLUB_TZ_DEFAULT): string {
  const s = formatInZone(d, zone, { hour: '2-digit', minute: '2-digit', hour12: false });
  const match = /\d{2}:\d{2}/.exec(s);
  if (!match) throw new Error(`unexpected formatInZone output: ${JSON.stringify(s)}`);
  return match[0];
}

describe('formatInZone() — DST transitions in America/Chicago', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PINNED));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TZ;
  });

  describe('spring-forward seam (2026-03-08)', () => {
    it('01:30 CST before the jump formats to 01:30', () => {
      const d = new Date('2026-03-08T07:30:00Z');
      expect(hourMinute(d, CLUB_TZ_DEFAULT)).toBe('01:30');
    });

    it('07:59Z (just before the jump) formats to 01:59 (still CST)', () => {
      const d = new Date('2026-03-08T07:59:00Z');
      expect(hourMinute(d, CLUB_TZ_DEFAULT)).toBe('01:59');
    });

    it('08:00Z (at the jump) formats to 03:00 (now CDT — the 02:00 to 03:00 wall-clock hour is skipped)', () => {
      const d = new Date('2026-03-08T08:00:00Z');
      expect(hourMinute(d, CLUB_TZ_DEFAULT)).toBe('03:00');
    });
  });

  describe('fall-back seam (2026-11-01)', () => {
    it('06:30Z (01:30 CDT repeat-1) and 07:30Z (01:30 CST repeat-2) both format to wall-clock 01:30', () => {
      const repeat1 = new Date('2026-11-01T06:30:00Z');
      const repeat2 = new Date('2026-11-01T07:30:00Z');
      const r1 = hourMinute(repeat1, CLUB_TZ_DEFAULT);
      const r2 = hourMinute(repeat2, CLUB_TZ_DEFAULT);
      expect(r1).toBe('01:30');
      expect(r2).toBe('01:30');
      expect(r1).toBe(r2);
      // The underlying instants differ by one hour — this is the
      // ambiguous-wall-clock property the audit-render banner
      // disambiguates.
      expect(repeat2.getTime() - repeat1.getTime()).toBe(60 * 60 * 1000);
    });
  });

  describe('offset annotation via { timeZoneName: "short" }', () => {
    it('produces CST before the spring-forward jump', () => {
      const d = new Date('2026-03-08T07:59:00Z');
      const s = formatInZone(d, CLUB_TZ_DEFAULT, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      });
      expect(s).toMatch(/\bCST\b/);
      expect(s).not.toMatch(/\bCDT\b/);
    });

    it('produces CDT after the spring-forward jump', () => {
      const d = new Date('2026-03-08T08:00:00Z');
      const s = formatInZone(d, CLUB_TZ_DEFAULT, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      });
      expect(s).toMatch(/\bCDT\b/);
      expect(s).not.toMatch(/\bCST\b/);
    });
  });

  describe('invariance to process.env.TZ', () => {
    it('produces identical wall-clock output regardless of host TZ', () => {
      const sample = new Date('2026-07-15T18:00:00Z');
      const baseline = hourMinute(sample, CLUB_TZ_DEFAULT);

      process.env.TZ = 'UTC';
      const underUtc = hourMinute(sample, CLUB_TZ_DEFAULT);

      process.env.TZ = 'America/Los_Angeles';
      const underLa = hourMinute(sample, CLUB_TZ_DEFAULT);

      expect(underUtc).toBe(baseline);
      expect(underLa).toBe(baseline);
      // Sanity: the actual value is 13:00 CDT in mid-summer.
      expect(baseline).toBe('13:00');
    });
  });
});
