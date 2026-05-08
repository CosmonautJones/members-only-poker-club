/**
 * `/faq` — Frequently Asked Questions.
 *
 * Slice-1 question set covering the topics surfaced in ADR-0030
 * (acceptance criterion 8): membership, age (21+), BYOB (per
 * ADR-0033), the time-bank intro (per ADR-0011 — high-level only,
 * details deferred), hours, and location. The accordion uses native
 * `<details>` elements so the page is fully usable without JS and
 * remains a server component.
 *
 * Slice-4 expansion to long-tail SEO queries is explicitly out of
 * scope (see ADR-0030 spec "Out of scope").
 */

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'FAQ',
  description:
    'Answers to common questions about membership, age requirements, BYOB, time-bank credits, hours, and how to find Members Only Poker Social Club in Houston.',
  openGraph: {
    title: 'FAQ',
    description:
      'Answers to common questions about membership, age requirements, BYOB, time-bank credits, hours, and how to find Members Only Poker Social Club in Houston.',
    images: [
      {
        url: '/og?title=FAQ&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — FAQ',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FAQ',
    description:
      'Answers to common questions about membership, age, BYOB, the time bank, hours, and location.',
    images: ['/og?title=FAQ&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

type FaqEntry = {
  question: string;
  answer: React.ReactNode;
};

const FAQ_ENTRIES: FaqEntry[] = [
  {
    question: 'How do I join the club?',
    answer: (
      <>
        Membership is by application. Submit the form on the{' '}
        <Link href="/membership" className="gold-text" style={{ textDecoration: 'underline' }}>
          membership page
        </Link>
        ; we review applications within twenty-four hours and follow up with the next step. The club
        stays the size we can keep at the level we want, so the door is intentionally narrow.
      </>
    ),
  },
  {
    question: 'How old do I have to be to join?',
    answer: (
      <>
        You must be <strong>21 or older</strong> to apply, walk in, or be granted membership. The
        21+ rule is enforced at signup (date of birth captured at application) and at the door
        (physical ID check by a staff member or scan at our front-desk station). The rule is house
        policy and applies whether or not the venue is licensed to serve alcohol on premises.
      </>
    ),
  },
  {
    question: 'Is the bar BYOB?',
    answer: (
      <>
        Yes, for now. The club operates as <strong>BYOB</strong> while our TABC liquor-license
        application is in process. Members are welcome to bring their own beverages onto the
        private-club premises. Once the TABC license is issued, the BYOB policy may be retired or
        kept at the owner&rsquo;s discretion. The 21+ door rule is unaffected either way.
      </>
    ),
  },
  {
    question: 'What is the time bank, and how does it work?',
    answer: (
      <>
        Seat-time at the club is billed by the minute against a prepaid <em>time bank</em> rather
        than a hand-by-hand rake. You top up the bank in advance (for example, &dollar;200 buys
        &dollar;300 of credit) and the meter draws down while you&rsquo;re seated; step away for a
        meal and the meter pauses. Full mechanics, refund rules, and member dashboards land with the
        time-bank slice; this page covers the gist so you can decide whether the model is for you.
        (See ADR-0011 for the architectural decisions behind the model.)
      </>
    ),
  },
  {
    question: 'When are you open?',
    answer: (
      <>
        Hours vary by day; we open in the afternoon and run until the last hand. Day-of hours and
        any holiday adjustments live on the{' '}
        <Link href="/contact" className="gold-text" style={{ textDecoration: 'underline' }}>
          contact page
        </Link>{' '}
        — bookmark it. If you&rsquo;re a member, the dashboard surfaces the current hours and any
        wait-list status before you leave the house.
      </>
    ),
  },
  {
    question: 'Where are you located?',
    answer: (
      <>
        We&rsquo;re in <strong>Houston, Texas</strong>. Exact street address, parking notes, and
        directions live on the{' '}
        <Link href="/contact" className="gold-text" style={{ textDecoration: 'underline' }}>
          contact page
        </Link>
        . The club is a private members-only space, so the door is unmarked from the street; members
        get the door details once approved.
      </>
    ),
  },
  {
    question: 'Do you take a rake?',
    answer: (
      <>
        No. Revenue comes from membership dues and seat-time on the time bank. Every dollar at the
        table stays at the table. The house wins by hosting a room you keep coming back to.
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <div
      style={{
        maxWidth: 880,
        margin: '0 auto',
        padding: '80px 40px 120px',
      }}
    >
      <header style={{ textAlign: 'center', marginBottom: 64 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Frequently Asked
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
          Questions
          <br />
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            we get often.
          </em>
        </h1>
        <hr className="gold-rule-short" style={{ marginTop: 24 }} />
        <p
          style={{
            color: 'var(--ivory-300)',
            fontSize: 16,
            lineHeight: 1.7,
            maxWidth: 580,
            margin: '24px auto 0',
          }}
        >
          A handful of the things people ask before they apply. If yours isn&rsquo;t here, the{' '}
          <Link href="/contact" className="gold-text" style={{ textDecoration: 'underline' }}>
            contact page
          </Link>{' '}
          will get you a real answer.
        </p>
      </header>

      <section
        aria-label="Frequently asked questions"
        style={{
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {FAQ_ENTRIES.map((entry, idx) => (
          <details
            key={entry.question}
            style={{
              borderTop: idx === 0 ? '1px solid var(--gold-400)' : '1px solid var(--border-faint)',
              borderBottom: idx === FAQ_ENTRIES.length - 1 ? '1px solid var(--gold-400)' : 'none',
              padding: '24px 0',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                listStyle: 'none',
                fontFamily: 'Cormorant Garamond, serif',
                fontSize: 26,
                color: 'var(--ivory-200)',
                fontWeight: 500,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 24,
              }}
            >
              <span>{entry.question}</span>
              <span
                aria-hidden
                className="gold-text"
                style={{
                  fontSize: 20,
                  flexShrink: 0,
                }}
              >
                +
              </span>
            </summary>
            <div
              style={{
                color: 'var(--ivory-300)',
                fontSize: 15,
                lineHeight: 1.75,
                marginTop: 16,
                maxWidth: 720,
              }}
            >
              {entry.answer}
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
