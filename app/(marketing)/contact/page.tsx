/**
 * `/contact` — venue contact page.
 *
 * Replaces the T0 stub with the Slice-1 minimum: a venue heading, the
 * human-readable address (mirrored from `lib/content/nap.ts`), and the
 * `LocalBusiness` JSON-LD payload required by ADR-0030 §Decision.
 *
 * Phone and full opening hours are intentionally NOT rendered yet — both
 * are TODO placeholders in `lib/content/nap.ts` awaiting owner input.
 * Showing fake values would harm NAP consistency on every off-site
 * directory that scrapes them; omission is the safer default.
 *
 * The full marketing copy / map / parking note for this page is owned by
 * the parent slice `slice-1/marketing-home-mvp` and lands in a follow-up.
 */

import type { Metadata } from 'next';

import { LocalBusinessJsonLd } from '@/components/seo/local-business-jsonld';
import { NAP } from '@/lib/content/nap';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Find Members Only Poker Social Club in Houston, Texas. Address, directions, and how to reach us.',
  openGraph: {
    title: 'Contact',
    description:
      'Find Members Only Poker Social Club in Houston, Texas. Address, directions, and how to reach us.',
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
    description: 'Find Members Only Poker Social Club in Houston, Texas. Address and directions.',
    images: ['/og?title=Contact&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

export default function ContactPage() {
  const { address } = NAP;

  return (
    <div
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
