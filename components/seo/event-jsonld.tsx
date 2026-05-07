import { JsonLd } from "./json-ld";
import type { Tournament } from "@/lib/tournaments/types";

/**
 * Event JSON-LD payload for a single tournament.
 *
 * Mounted by `app/(marketing)/games/[slug]/page.tsx` so each tournament
 * detail route emits structured-data per ADR-0030 acceptance criterion 6.
 * The Tournament shape is sourced from `lib/tournaments/types.ts`; the
 * fixture data source is replaced when ADR-0012 (Tournament data model)
 * ratifies.
 */
export function EventJsonLd({ tournament }: { tournament: Tournament }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: tournament.name,
    startDate: tournament.startsAt,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    location: {
      "@type": "Place",
      name: tournament.venueName,
      address: tournament.venueAddress,
    },
    offers: {
      "@type": "Offer",
      price: (tournament.buyInCents / 100).toFixed(2),
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
    maximumAttendeeCapacity: tournament.capacity,
  };
  return <JsonLd data={data} />;
}
