/**
 * IANA zone branding + validation — ADR-0034.
 *
 * `IanaZone` is a branded string: structurally a `string`, but only
 * constructible via the `as IanaZone` cast at well-known call sites
 * (`CLUB_TZ_DEFAULT`) or via narrowing through the `isValidIanaZone`
 * predicate. The brand prevents accidental passage of an arbitrary
 * string into APIs that demand a real zone (e.g. `formatInZone`).
 *
 * The validation predicate uses `Intl.DateTimeFormat` as the source of
 * truth: Node 20.11+ ships full IANA tzdata, and constructing a
 * formatter with an unknown zone throws `RangeError`. Node is
 * case-sensitive on IANA zone names — `America/chicago` (lowercase c)
 * throws, while `America/Chicago` succeeds — and the predicate
 * faithfully reflects that.
 */

/**
 * Branded string type for a validated IANA timezone identifier. The
 * brand is type-level only (no runtime discriminator) — load-bearing
 * property is "you can't pass an arbitrary string where a zone is
 * required at the type layer," not "the value is observably different
 * at runtime."
 */
export type IanaZone = string & { readonly __brand: 'IanaZone' };

/**
 * The v1 club default display zone. Sourced from `clubs.display_tz` at
 * runtime by future cycles; this constant is the type-level anchor and
 * the substrate fallback before any DB read.
 */
export const CLUB_TZ_DEFAULT = 'America/Chicago' as IanaZone;

/**
 * Pure predicate: does `zone` name an IANA zone the host runtime can
 * resolve? Returns `false` for non-string / empty / case-mismatched /
 * obviously-bogus input, never throws. The function is a TypeScript
 * type guard so a successful check narrows `string` to `IanaZone`.
 *
 * Implementation: attempt to construct an `Intl.DateTimeFormat` with the
 * candidate zone. Node throws `RangeError` for unknown zones. Empty
 * string is rejected explicitly (some Node versions accept empty as a
 * synonym for the host TZ — defense in depth).
 */
export function isValidIanaZone(zone: string): zone is IanaZone {
  if (typeof zone !== 'string' || zone.length === 0) {
    return false;
  }
  try {
    // Construct-and-discard: the constructor throws RangeError on
    // unknown zones; the resulting formatter is intentionally unused.
    Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
