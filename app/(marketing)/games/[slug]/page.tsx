/**
 * /games/[slug] — tournament detail route.
 *
 * Replaces the T0 stub with a Slice-1 RSC implementation that:
 *  - Looks up the tournament by slug from the `lib/tournaments/fixtures.ts`
 *    seed data (replaced when ADR-0012 ratifies the Tournament data model).
 *  - Calls `notFound()` if the slug is unknown so 404s render correctly.
 *  - Renders the tournament name, start time, buy-in, and capacity in a
 *    minimal but on-brand layout (parent slice owns the full design).
 *  - Mounts `<EventJsonLd>` so the page emits schema.org Event structured
 *    data per ADR-0030 §Decision (acceptance criterion 6).
 *  - Exports `generateMetadata` so the per-tournament title fills the
 *    layout's `%s | ...` template (T2 + T8 of ADR-0030).
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EventJsonLd } from '@/components/seo/event-jsonld';
import { findTournamentBySlug } from '@/lib/tournaments/fixtures';

type PageParams = { params: { slug: string } };

export function generateMetadata({ params }: PageParams): Metadata {
  const tournament = findTournamentBySlug(params.slug);
  if (!tournament) {
    return {
      title: 'Tournament not found',
      description: 'The tournament you are looking for is not on the schedule.',
    };
  }
  const description = `${tournament.name} at ${tournament.venueName}. Buy-in $${(tournament.buyInCents / 100).toFixed(0)}, ${tournament.capacity} seats.`;
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

const buyInFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

export default function TournamentPage({ params }: PageParams) {
  const tournament = findTournamentBySlug(params.slug);
  if (!tournament) {
    notFound();
  }

  const startsAtDate = new Date(tournament.startsAt);
  const buyIn = buyInFormatter.format(tournament.buyInCents / 100);

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
          <time dateTime={tournament.startsAt}>{dateFormatter.format(startsAtDate)}</time>
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
