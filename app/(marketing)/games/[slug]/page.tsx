/**
 * /games/[slug] — tournament detail route.
 *
 * Per ADR-0037, reads from the `tournaments` table via
 * `fetchTournamentBySlug`. Canceled or unknown slugs render 404 (the
 * query helper already collapses canceled rows to `null` so the
 * notFound() path covers both).
 *
 * The previous fixture-backed lookup is retired by this slice; the
 * cron-materialized + admin-edited DB is the source of truth.
 *
 * SEO: Event JSON-LD is mounted with the tournament's `startsAt` (UTC
 * timestamp) and the NAP-composed venue address.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EventJsonLd } from '@/components/seo/event-jsonld';
import { fetchTournamentBySlug } from '@/lib/tournaments/queries';
import { formatMoney, type Cents } from '@/lib/money/types';

export const dynamic = 'force-dynamic';

type PageParams = { params: { slug: string } };

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  let tournament: Awaited<ReturnType<typeof fetchTournamentBySlug>> = null;
  try {
    tournament = await fetchTournamentBySlug(params.slug);
  } catch {
    // Errors during metadata generation should not crash the page. Falling
    // through with `tournament === null` produces the "not found" metadata.
  }

  if (!tournament) {
    return {
      title: 'Tournament not found',
      description: 'The tournament you are looking for is not on the schedule.',
    };
  }
  const buyInDisplay = formatMoney(tournament.buyInCents as Cents);
  const description = `${tournament.name} at ${tournament.venueName}. Buy-in ${buyInDisplay}, ${tournament.capacity} seats.`;
  return {
    title: tournament.name,
    description,
    openGraph: {
      title: tournament.name,
      description,
      images: [
        {
          url: `/og?title=${encodeURIComponent(tournament.name)}&subtitle=Tournament`,
          width: 1200,
          height: 630,
          alt: `${tournament.name} — Members Only Poker Social Club`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: tournament.name,
      description,
      images: [`/og?title=${encodeURIComponent(tournament.name)}&subtitle=Tournament`],
    },
  };
}

// Club-local rendering per ADR-0034: `formatInZone` would be ideal here,
// but the tournament row carries its own `tz_name` (which may diverge from
// the club default once we have multi-venue support). For now, the
// tournament's own zone wins.
function formatStartTime(startsAtIso: string, tzName: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tzName,
    timeZoneName: 'short',
  }).format(new Date(startsAtIso));
}

export default async function TournamentPage({ params }: PageParams) {
  const tournament = await fetchTournamentBySlug(params.slug);
  if (!tournament) notFound();

  const startsAtDisplay = formatStartTime(tournament.startsAt, tournament.tzName);
  const buyIn = formatMoney(tournament.buyInCents as Cents);

  return (
    <div
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '80px 40px 120px',
      }}
    >
      <EventJsonLd tournament={tournament} />

      <header style={{ textAlign: 'center', marginBottom: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Tournament
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 64,
            fontWeight: 500,
            lineHeight: 1,
            letterSpacing: '-0.015em',
            marginBottom: 20,
          }}
        >
          {tournament.name}
        </h1>
        <hr className="gold-rule-short" style={{ marginTop: 24 }} />
      </header>

      <dl
        aria-label="Tournament details"
        style={{
          maxWidth: 520,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          rowGap: 20,
          columnGap: 32,
          paddingTop: 24,
          paddingBottom: 24,
          borderTop: '1px solid var(--gold-400)',
          borderBottom: '1px solid var(--gold-400)',
        }}
      >
        <dt className="eyebrow" style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>
          Starts
        </dt>
        <dd
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 20,
            color: 'var(--ivory-200)',
            margin: 0,
          }}
        >
          <time dateTime={tournament.startsAt}>{startsAtDisplay}</time>
        </dd>

        <dt className="eyebrow" style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>
          Buy-in
        </dt>
        <dd
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 20,
            color: 'var(--ivory-200)',
            margin: 0,
          }}
        >
          {buyIn}
        </dd>

        <dt className="eyebrow" style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>
          Capacity
        </dt>
        <dd
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 20,
            color: 'var(--ivory-200)',
            margin: 0,
          }}
        >
          {tournament.capacity} seats
        </dd>

        <dt className="eyebrow" style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>
          Venue
        </dt>
        <dd
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 20,
            color: 'var(--ivory-200)',
            margin: 0,
          }}
        >
          {tournament.venueName}
        </dd>
      </dl>

      <p
        style={{
          color: 'var(--ivory-300)',
          fontSize: 15,
          lineHeight: 1.7,
          maxWidth: 520,
          margin: '40px auto 0',
          textAlign: 'center',
        }}
      >
        Registration and full structure sheet land with the ADR-0012 tournament slice. Members can
        confirm a seat from the dashboard once registration opens.
      </p>
    </div>
  );
}
