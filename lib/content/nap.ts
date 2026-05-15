/**
 * NAP — Name, Address, Phone — single source of truth for local SEO.
 *
 * Used by:
 *  - LocalBusiness JSON-LD at /contact (ADR-0030 §Decision)
 *  - The marketing footer
 *  - Any future content surface that displays venue contact info
 *
 * Off-site listings (Google Business Profile, Apple Business Connect, Yelp)
 * must mirror these values for NAP consistency (ADR-0030 §Consequences).
 */
export const NAP = {
  name: 'Members Only Poker Social Club',
  address: {
    streetAddress: '16525 North Fwy',
    addressLocality: 'Houston',
    addressRegion: 'TX',
    postalCode: '77090',
    addressCountry: 'US',
  },
  // TODO(travis): replace placeholder before merge
  telephone: '+1-000-000-0000',
  // 24/7 schedule (owner correction 2026-05-15). schema.org idiom for
  // continuous operation: a single OpeningHoursSpecification entry
  // listing all seven days with `opens: 00:00` and `closes: 23:59`.
  // Google's structured-data validator accepts this; Apple Business
  // Connect prefers per-day entries with the same range — if/when we
  // add an Apple feed, generate seven rows from this shape rather than
  // hand-maintain two lists.
  openingHoursSpecification: [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: '00:00',
      closes: '23:59',
    },
  ],
} as const;

export type NAPShape = typeof NAP;
