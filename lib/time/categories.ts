/**
 * Four timestamp categories — ADR-0034 §"Timestamp categories".
 *
 * Every timestamp field in the system MUST be classified as one of:
 *
 *   1. **Moment** — a single absolute instant. Storage `timestamptz`
 *      UTC; math UTC elapsed time. (e.g. `audit_log.created_at`,
 *      `payments.created_at`.)
 *   2. **Wall-clock intent** — civil-time anchored to a wall clock that
 *      may move under DST or legislative change. Storage `timestamptz`
 *      UTC PLUS a `tz_name` IANA-zone column on the same row. (e.g.
 *      `tournaments.starts_at` — column not yet shipped; arrives with
 *      ADR-0012 Slice 3.)
 *   3. **Vendor-derived moment** — an instant supplied by an external
 *      system whose own timezone configuration is part of the seam.
 *      Storage `timestamptz` UTC, unmodified from vendor. The vendor's
 *      account TZ is a documented deployment dependency (Stripe = UTC
 *      per ADR-0008 amendment).
 *   4. **Jurisdictional date** — a calendar date whose meaning is set
 *      by a regulator. Storage `date` (NOT `timestamptz`) plus an
 *      explicit jurisdiction config. (e.g. TX escheatment cutoff, GDPR
 *      deletion deadlines.)
 *
 * The branded types in this file enforce — at compile time — that the
 * four categories are not interchangeable. Per Open Question 2's
 * default, the brand is TypeScript-only: no runtime discriminator,
 * zero runtime cost, defended at the type layer. A worker who tries
 * to pass a `Moment` where a `WallClockIntent` is expected will see a
 * `tsc --noEmit` error.
 *
 * Slice 1 ships the brands; the DB write paths that consume them ship
 * with their respective owning ADRs (Wall-clock intent — ADR-0012
 * Slice 3; Vendor-derived moment — ADR-0004 / ADR-0025).
 */
import type { IanaZone } from './zones';

/** Category 1 — an absolute instant. */
export type Moment = Date & { readonly __brand: 'Moment' };

/**
 * Category 2 — civil-time anchored to a wall clock. Wraps a UTC instant
 * plus the IANA zone the wall-clock was authored in, so a future
 * legislative-DST change can re-resolve the wall-clock from the same
 * (utc, tz) pair.
 */
export type WallClockIntent = {
  readonly utc: Date;
  readonly tz: IanaZone;
  readonly __brand: 'WallClockIntent';
};

/**
 * Category 3 — a vendor-supplied instant. `vendorTz` is documented for
 * the audit surface (it defaults to `'UTC' as IanaZone` per ADR-0034's
 * Stripe-deployment requirement); it is NOT used for arithmetic — the
 * UTC instant is the only source of truth.
 */
export type VendorMoment = {
  readonly utc: Date;
  readonly vendorTz: IanaZone;
  readonly __brand: 'VendorMoment';
};

/**
 * Category 4 — a calendar date plus its governing jurisdiction. The
 * wrapped value is intentionally a `string` (`YYYY-MM-DD`), not a
 * `Date`: calendar dates have no instant. `jurisdiction` is an opaque
 * string handle (`'US-TX'`, `'US-FED'`, etc.) the consumer interprets
 * against its own calendar config.
 */
export type JurisdictionalDate = {
  readonly date: string;
  readonly jurisdiction: string;
  readonly __brand: 'JurisdictionalDate';
};

/** Construct a Category-1 Moment from a Date. */
export function momentUtc(d: Date): Moment {
  return d as Moment;
}

/**
 * Construct a Category-2 WallClockIntent from a (utc, tz) pair. No DB
 * write path consumes this brand in Slice 1; shipping the brand now
 * means the type contract exists when the admin schedule UI lands
 * (ADR-0012 Slice 3).
 */
export function wallClockIntent(utc: Date, tz: IanaZone): WallClockIntent {
  return { utc, tz, __brand: 'WallClockIntent' };
}

/**
 * Construct a Category-3 VendorMoment from a vendor-supplied Date and
 * the vendor's configured account TZ. `vendorTz` defaults to
 * `'UTC' as IanaZone` — the ADR-0034 deployment requirement for Stripe
 * accounts.
 */
export function vendorMoment(d: Date, vendorTz: IanaZone = 'UTC' as IanaZone): VendorMoment {
  return { utc: d, vendorTz, __brand: 'VendorMoment' };
}

/**
 * Construct a Category-4 JurisdictionalDate from an ISO `YYYY-MM-DD`
 * string and a jurisdiction handle. The wrapped value stays a string —
 * calendar dates have no instant.
 */
export function jurisdictionalDate(d: string, jurisdiction: string): JurisdictionalDate {
  return { date: d, jurisdiction, __brand: 'JurisdictionalDate' };
}
