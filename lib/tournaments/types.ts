/**
 * Shared Tournament interface used by both:
 *  - lib/tournaments/fixtures.ts (Slice 1 fixture data for SEO Event JSON-LD)
 *  - components/seo/event-jsonld.tsx (Event JSON-LD shape)
 *
 * When ADR-0012 (Tournament data model) ratifies, this interface relocates
 * to its canonical home (likely `lib/tournaments/index.ts` or similar) and
 * the fixture is replaced by the real data source. The shape itself should
 * remain compatible — keep this interface tight.
 */
export interface Tournament {
  slug: string;
  name: string;
  startsAt: string; // ISO 8601 datetime
  buyInCents: number;
  capacity: number;
  venueName: string;
  venueAddress: string;
}
