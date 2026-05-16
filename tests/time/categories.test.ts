/**
 * Unit tests for the four category-tagged constructors — ADR-0034
 * Slice 1 AC2 (sub-case group "categories").
 *
 * Per Open Question 2's default, the brand is TypeScript-only: no
 * runtime discriminator on Moment (a Moment IS a Date with a phantom
 * brand). The other three categories (WallClockIntent, VendorMoment,
 * JurisdictionalDate) ARE shape-discriminated at runtime — they carry
 * an explicit `__brand` string field — which is enough to satisfy the
 * AC2 load-bearing property "the four categories are not
 * interchangeable" without relying on the in-band `tsc --noEmit`
 * fixture (which is fragile across tsc versions).
 *
 * This file uses runtime discriminator assertions; the optional
 * `tests/time/categories.type-fixture.ts.skip` is intentionally NOT
 * shipped — the spec permits dropping it and AC2 is satisfied either
 * way.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  momentUtc,
  wallClockIntent,
  vendorMoment,
  jurisdictionalDate,
  CLUB_TZ_DEFAULT,
} from '@/lib/time';
import type { IanaZone } from '@/lib/time';

const PINNED = '2026-05-11T00:00:00.000Z';

describe('time categories', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PINNED));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('momentUtc(d)', () => {
    it('wraps a Date as a category-1 Moment (the underlying value remains a Date)', () => {
      const instant = new Date('2026-07-15T18:00:00Z');
      const m = momentUtc(instant);
      // Moment is a Date with a phantom type brand — at runtime it IS
      // the same Date instance.
      expect(m).toBeInstanceOf(Date);
      expect(m.getTime()).toBe(instant.getTime());
    });
  });

  describe('wallClockIntent(utc, tz)', () => {
    it('returns an object carrying its (utc, tz) pair and a WallClockIntent brand', () => {
      const utc = new Date('2026-03-08T08:00:00Z');
      const tz = 'America/Chicago' as IanaZone;
      const w = wallClockIntent(utc, tz);
      expect(w.utc).toBe(utc);
      expect(w.tz).toBe(tz);
      expect(w.__brand).toBe('WallClockIntent');
    });

    it('preserves the tz argument verbatim (no host-TZ leakage)', () => {
      const utc = new Date('2026-07-15T18:00:00Z');
      const w = wallClockIntent(utc, CLUB_TZ_DEFAULT);
      expect(w.tz).toBe('America/Chicago');
    });
  });

  describe('vendorMoment(d, vendorTz?)', () => {
    it("defaults vendorTz to 'UTC' (ADR-0034 Stripe deployment requirement)", () => {
      const d = new Date('2026-07-15T18:00:00Z');
      const v = vendorMoment(d);
      expect(v.utc).toBe(d);
      expect(v.vendorTz).toBe('UTC');
      expect(v.__brand).toBe('VendorMoment');
    });

    it('preserves an explicit vendorTz argument', () => {
      const d = new Date('2026-07-15T18:00:00Z');
      const v = vendorMoment(d, 'America/Chicago' as IanaZone);
      expect(v.vendorTz).toBe('America/Chicago');
    });
  });

  describe('jurisdictionalDate(d, jurisdiction)', () => {
    it('wraps an ISO YYYY-MM-DD string — the wrapped value is a STRING, NOT a Date (calendar dates have no instant)', () => {
      const j = jurisdictionalDate('2026-04-15', 'US-FED');
      expect(typeof j.date).toBe('string');
      expect(j.date).toBe('2026-04-15');
      expect(j.date).not.toBeInstanceOf(Date);
      expect(j.jurisdiction).toBe('US-FED');
      expect(j.__brand).toBe('JurisdictionalDate');
    });

    it('preserves an arbitrary jurisdiction handle verbatim (opaque to the helper)', () => {
      const j = jurisdictionalDate('2027-01-01', 'US-TX');
      expect(j.jurisdiction).toBe('US-TX');
    });
  });

  describe('the four categories are not interchangeable (runtime discriminator stand-in)', () => {
    it('produces values whose runtime brand fields (or instance type) distinguish them', () => {
      const sameInstant = new Date('2026-07-15T18:00:00Z');
      const m = momentUtc(sameInstant);
      const w = wallClockIntent(sameInstant, CLUB_TZ_DEFAULT);
      const v = vendorMoment(sameInstant);
      const j = jurisdictionalDate('2026-07-15', 'US-TX');

      // Moment is a Date instance; the other three are plain objects
      // with distinct __brand values.
      expect(m instanceof Date).toBe(true);
      expect(w instanceof Date).toBe(false);
      expect(v instanceof Date).toBe(false);
      expect(j instanceof Date).toBe(false);

      // The three object-shaped brands carry distinct __brand strings.
      const brands = new Set([w.__brand, v.__brand, j.__brand]);
      expect(brands.size).toBe(3);
      expect(brands.has('WallClockIntent')).toBe(true);
      expect(brands.has('VendorMoment')).toBe(true);
      expect(brands.has('JurisdictionalDate')).toBe(true);

      // The wrapped-value shapes differ: WallClockIntent has `tz`,
      // VendorMoment has `vendorTz`, JurisdictionalDate has `date`
      // (string) and `jurisdiction`. These are mutually-exclusive
      // discriminators — a switch on `__brand` narrows the union
      // unambiguously.
      expect('tz' in w).toBe(true);
      expect('vendorTz' in v).toBe(true);
      expect('date' in j).toBe(true);
      expect('jurisdiction' in j).toBe(true);
    });
  });
});
