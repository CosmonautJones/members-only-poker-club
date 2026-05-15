/**
 * `/contact` — venue contact page.
 *
 * Replaces the T0 stub with the Slice-1 minimum: a venue heading, the
 * human-readable address (mirrored from `lib/content/nap.ts`), the
 * weekly hours block (added per audit 2026-05-15 P1 #6), and the
 * `LocalBusiness` JSON-LD payload required by ADR-0030 §Decision.
 *
 * Phone is intentionally NOT rendered yet — TODO placeholder in
 * `lib/content/nap.ts` awaiting owner input. Showing fake values would
 * harm NAP consistency on every off-site directory that scrapes them;
 * omission is the safer default.
 *
 * Hours: owner correction 2026-05-15 — the club is 24/7. The day-by-day
 * HOURS_ROWS table (originally added per audit P1 #6) was replaced with
 * a single "Open. Always." statement. The `id="hours"` anchor on the
 * wrapping section is preserved so the footer `/contact#hours` link
 * still scrolls correctly. The schema.org `openingHoursSpecification`
 * lives in `lib/content/nap.ts` and is read by `<LocalBusinessJsonLd />`.
 *
 * Per audit P2 #9: the h1 is intentionally plain Cormorant serif text
 * (matching `/accessibility` and the rest of the marketing pages) — the
 * Chip + Wordmark mark lives in the header above. Both choices are
 * deliberate; pick this one.
 */

import type { Metadata } from 'next';

import { LocalBusinessJsonLd } from '@/components/seo/local-business-jsonld';
import { NAP } from '@/lib/content/nap';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Find Members Only Poker Social Club in Houston, Texas. Address, hours, directions, and how to reach us.',
  openGraph: {
    title: 'Contact',
    description:
      'Find Members Only Poker Social Club in Houston, Texas. Address, hours, directions, and how to reach us.',
    images: [
      {
        url: '/og?title=Contact&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Contact',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Contact',
    description: 'Find Members Only Poker Social Club in Houston, Texas. Address, hours, directions.',
    images: ['/og?title=Contact&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

export default function ContactPage() {
  const { address } = NAP;

  return (
    <div
      id="contact"
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '80px 40px 120px',
      }}
    >
      <LocalBusinessJsonLd />

      <header style={{ textAlign: 'center', marginBottom: 64 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Find The Club
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 72,
            fontWeight: 500,
            lineHeight: 1,
            letterSpacing: '-0.015em',
            marginBottom: 20,
          }}
        >
          {NAP.name}
        </h1>
        <hr className="gold-rule-short" style={{ marginTop: 24 }} />
      </header>

      <section
        aria-label="Venue address"
        style={{
          maxWidth: 520,
          margin: '0 auto',
          textAlign: 'center',
          paddingTop: 24,
          paddingBottom: 24,
          borderTop: '1px solid var(--gold-400)',
          borderBottom: '1px solid var(--gold-400)',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 16 }}>
          Address
        </div>
        <address
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontStyle: 'normal',
            fontSize: 26,
            lineHeight: 1.5,
            color: 'var(--ivory-200)',
          }}
        >
          <div>{address.streetAddress}</div>
          <div>
            {address.addressLocality}, {address.addressRegion} {address.postalCode}
          </div>
          <div
            style={{
              fontSize: 14,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginTop: 12,
            }}
          >
            {address.addressCountry}
          </div>
        </address>
      </section>

      <section
        id="hours"
        aria-label="Hours of operation"
        style={{
          maxWidth: 620,
          margin: '64px auto 0',
          textAlign: 'center',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 16 }}>
          Open Now · Always
        </div>
        <h2
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 52,
            fontWeight: 500,
            lineHeight: 1.05,
            marginBottom: 24,
          }}
        >
          We never close.
          <br />
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            Every day. Every night.
          </em>
        </h2>
        <hr className="gold-rule-short" style={{ margin: '0 auto 24px', maxWidth: 280 }} />
        <p
          style={{
            color: 'var(--ivory-300)',
            fontSize: 16,
            lineHeight: 1.7,
            maxWidth: 520,
            margin: '0 auto',
          }}
        >
          The room runs 24/7. Tournament start times are the only thing on a schedule — see the{' '}
          <a
            href="/games"
            className="gold-text"
            style={{ textDecoration: 'underline' }}
          >
            games page
          </a>{' '}
          for those.
        </p>
      </section>

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
        The club is a private members-only space; the door is unmarked from the street. Approved
        members receive door details and parking notes after their application is reviewed.
      </p>
    </div>
  );
}
