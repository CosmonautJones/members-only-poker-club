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
  // TODO(travis): replace placeholder before merge — use schema.org OpeningHoursSpecification day-of-week format
  openingHoursSpecification: [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: 'Monday',
      opens: '00:00',
      closes: '00:00',
    },
  ],
} as const;

export type NAPShape = typeof NAP;
