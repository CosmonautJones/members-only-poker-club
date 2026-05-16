/**
 * Unit tests for `lib/timestamps/dst-seam.ts` (ADR-0035 AC19, WB.T10).
 *
 * Run locally:    pnpm test tests/timestamps/dst-seam.test.ts
 * Prerequisites:  none — pure function, no I/O, no Postgres.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC19
 *       — DST fall-back banner detection for the audit-log viewer.
 * ADR:  docs/adr/0034-timestamp-and-timezone-policy.md §"Audit log
 *       presentation contract" — fall-back seam triggers the
 *       repeated-hour banner; spring-forward does not.
 *
 * Premortem-risk-6 mitigation: tests cover both the 2026 and 2027
 * fall-back seams plus the 2027 spring-forward (must NOT trigger) and
 * exact-transition-minute edge cases. The helper is pure; assertions
 * compare the boolean against known UTC moments.
 *
 * Why these UTC moments are correct:
 *   - America/Chicago fall-back = first Sunday of November at 02:00 CDT
 *     (UTC−05:00). 02:00 CDT = 07:00 UTC.
 *       * 2025-11-02 02:00 CDT = 2025-11-02T07:00:00Z
 *       * 2026-11-01 02:00 CDT = 2026-11-01T07:00:00Z
 *       * 2027-11-07 02:00 CDT = 2027-11-07T07:00:00Z
 *   - America/Chicago spring-forward = second Sunday of March at 02:00
 *     CST (UTC−06:00). 02:00 CST = 08:00 UTC. Spring-forward must NOT
 *     trigger the helper (ADR-0034 only flags the repeated hour).
 *       * 2027-03-14 02:00 CST = 2027-03-14T08:00:00Z
 */

import { describe, expect, it } from 'vitest';

import { crossesFallbackSeam } from '@/lib/timestamps/dst-seam';

const SEAM_2025 = new Date('2025-11-02T07:00:00.000Z');
const SEAM_2026 = new Date('2026-11-01T07:00:00.000Z');
const SEAM_2027 = new Date('2027-11-07T07:00:00.000Z');

const SPRING_2027 = new Date('2027-03-14T08:00:00.000Z');

describe('crossesFallbackSeam', () => {
  describe('fall-back seam detection', () => {
    it('returns true when the range crosses the 2026 fall-back seam', () => {
      const from = new Date('2026-11-01T06:00:00.000Z'); // 01:00 CDT
      const to = new Date('2026-11-01T08:00:00.000Z'); // 02:00 CST (post-fallback)
      expect(crossesFallbackSeam(from, to)).toBe(true);
    });

    it('returns true when the range crosses the 2027 fall-back seam', () => {
      const from = new Date('2027-11-07T06:00:00.000Z');
      const to = new Date('2027-11-07T08:00:00.000Z');
      expect(crossesFallbackSeam(from, to)).toBe(true);
    });

    it('returns true for a wide range straddling 2026-11-01 (typical filter)', () => {
      const from = new Date('2026-10-15T00:00:00.000Z');
      const to = new Date('2026-11-15T00:00:00.000Z');
      expect(crossesFallbackSeam(from, to)).toBe(true);
    });
  });

  describe('spring-forward does NOT trigger', () => {
    it('returns false for a range that crosses 2027 spring-forward only', () => {
      // 01:00 CST through 04:00 CDT on the spring-forward day.
      const from = new Date('2027-03-14T07:00:00.000Z');
      const to = new Date('2027-03-14T10:00:00.000Z');
      // Sanity: the range really does contain the spring-forward moment.
      expect(from.getTime() <= SPRING_2027.getTime()).toBe(true);
      expect(to.getTime() >= SPRING_2027.getTime()).toBe(true);
      expect(crossesFallbackSeam(from, to)).toBe(false);
    });

    it('returns false for a wide March-only range (spring-forward inside)', () => {
      const from = new Date('2027-03-01T00:00:00.000Z');
      const to = new Date('2027-04-01T00:00:00.000Z');
      expect(crossesFallbackSeam(from, to)).toBe(false);
    });
  });

  describe('non-DST-transition ranges', () => {
    it('returns false for a range entirely in CDT summer', () => {
      const from = new Date('2026-07-01T00:00:00.000Z');
      const to = new Date('2026-08-01T00:00:00.000Z');
      expect(crossesFallbackSeam(from, to)).toBe(false);
    });

    it('returns false for a range entirely in CST winter (post-fallback, pre-spring)', () => {
      const from = new Date('2026-12-01T00:00:00.000Z');
      const to = new Date('2027-02-01T00:00:00.000Z');
      expect(crossesFallbackSeam(from, to)).toBe(false);
    });

    it('returns false for a one-day range deep in summer', () => {
      const from = new Date('2026-06-15T00:00:00.000Z');
      const to = new Date('2026-06-16T00:00:00.000Z');
      expect(crossesFallbackSeam(from, to)).toBe(false);
    });
  });

  describe('exact-transition-minute edge cases', () => {
    it('returns true when the range starts exactly at the 2026 fall-back seam', () => {
      const to = new Date('2026-11-02T00:00:00.000Z');
      expect(crossesFallbackSeam(SEAM_2026, to)).toBe(true);
    });

    it('returns true when the range ends exactly at the 2026 fall-back seam', () => {
      const from = new Date('2026-10-31T00:00:00.000Z');
      expect(crossesFallbackSeam(from, SEAM_2026)).toBe(true);
    });

    it('returns true for a zero-duration range that lands on the seam', () => {
      expect(crossesFallbackSeam(SEAM_2026, SEAM_2026)).toBe(true);
    });

    it('returns false when the range ends one millisecond before the seam', () => {
      const from = new Date('2026-10-31T00:00:00.000Z');
      const to = new Date(SEAM_2026.getTime() - 1);
      expect(crossesFallbackSeam(from, to)).toBe(false);
    });

    it('returns false when the range starts one millisecond after the seam', () => {
      const from = new Date(SEAM_2026.getTime() + 1);
      const to = new Date('2026-11-15T00:00:00.000Z');
      expect(crossesFallbackSeam(from, to)).toBe(false);
    });
  });

  describe('multi-year ranges', () => {
    it('returns true for a range covering multiple fall-back seams (2025–2027)', () => {
      const from = new Date('2025-06-01T00:00:00.000Z');
      const to = new Date('2027-12-01T00:00:00.000Z');
      expect(crossesFallbackSeam(from, to)).toBe(true);
      // Sanity: all three seams really are inside the range.
      for (const seam of [SEAM_2025, SEAM_2026, SEAM_2027]) {
        expect(from.getTime() <= seam.getTime()).toBe(true);
        expect(seam.getTime() <= to.getTime()).toBe(true);
      }
    });

    it('returns true for a year-boundary-spanning range that just catches one seam', () => {
      // 2026-11-01 07:00 UTC sits inside; range straddles year boundary.
      const from = new Date('2026-10-30T00:00:00.000Z');
      const to = new Date('2027-02-01T00:00:00.000Z');
      expect(crossesFallbackSeam(from, to)).toBe(true);
    });
  });

  describe('defensive input handling', () => {
    it('returns false for an inverted range (from > to)', () => {
      const from = new Date('2026-12-01T00:00:00.000Z');
      const to = new Date('2026-10-01T00:00:00.000Z');
      // Even though the seam moment sits between these two values, an
      // inverted range is not a valid filter and must not trigger the
      // banner.
      expect(crossesFallbackSeam(from, to)).toBe(false);
    });

    it('returns false when either endpoint is an invalid Date', () => {
      const valid = new Date('2026-11-01T00:00:00.000Z');
      const invalid = new Date('not a date');
      expect(crossesFallbackSeam(invalid, valid)).toBe(false);
      expect(crossesFallbackSeam(valid, invalid)).toBe(false);
      expect(crossesFallbackSeam(invalid, invalid)).toBe(false);
    });
  });
});
