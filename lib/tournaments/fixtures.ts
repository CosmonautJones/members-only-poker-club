import type { Tournament } from "./types";
import { NAP } from "@/lib/content/nap";

const venueAddress = `${NAP.address.streetAddress}, ${NAP.address.addressLocality}, ${NAP.address.addressRegion} ${NAP.address.postalCode}`;

// TODO(adr-0012): replace with real data source when ADR-0012 ratifies
export const TOURNAMENTS: Tournament[] = [
  {
    slug: "saturday-night-deep-stack",
    name: "Saturday Night Deep Stack",
    startsAt: "2026-06-06T19:00:00-05:00",
    buyInCents: 10_000,
    capacity: 60,
    venueName: NAP.name,
    venueAddress,
  },
  {
    slug: "tuesday-bounty",
    name: "Tuesday Bounty",
    startsAt: "2026-06-09T19:00:00-05:00",
    buyInCents: 5_000,
    capacity: 40,
    venueName: NAP.name,
    venueAddress,
  },
];

export function findTournamentBySlug(slug: string): Tournament | undefined {
  return TOURNAMENTS.find((t) => t.slug === slug);
}
