/**
 * `/membership` — pricing + benefits + how-to-apply page.
 *
 * Replaces the T0 stub (audit 2026-05-15 P0 #1 follow-up). Content
 * researched 2026-05-15 against actual Houston-area private club
 * stakes/structures (TCH Houston, Champions Social, Prime Social) and
 * Texas Penal Code §47.02(b) operating-defense framing. Brand voice
 * matches `app/(marketing)/page.tsx` (homepage) — short sentences,
 * Roman-numeral ordering, gold accent italics, em-dashes.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '@/components/marketing/primitives';

export const metadata: Metadata = {
  title: 'Membership',
  description:
    'How to join Members Only Poker Social Club: apply online, get reviewed within twenty-four hours, and start playing legal member-funded poker in Houston.',
  openGraph: {
    title: 'Membership',
    description:
      'How to join Members Only Poker Social Club: apply online, get reviewed within twenty-four hours, and start playing legal member-funded poker in Houston.',
    images: [
      {
        url: '/og?title=Membership&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Membership',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Membership',
    description:
      'Apply online, reviewed within twenty-four hours, then play member-funded poker in Houston.',
    images: ['/og?title=Membership&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

const BENEFITS = [
  {
    num: 'I',
    title: 'Priority Seating',
    body: 'Members are seated in the order their text-alert pinged in. The list is the list. No floor favorites.',
  },
  {
    num: 'II',
    title: 'The Waitlist In Your Pocket',
    body: "Text-alerts for open seats and starting tournaments. You don't wait at the rail unless you want to.",
  },
  {
    num: 'III',
    title: 'Dealers Who Know You',
    body: "Our dealers are trained, paid a living wage, and stay long enough to learn your name. They'll know what you drink before the rack is set.",
  },
  {
    num: 'IV',
    title: 'BYOB, For Now',
    body: 'The Club operates BYOB while our TABC liquor-license application is in process. Members are welcome to bring their own beverages. The 21+ door rule is unaffected either way — see the FAQ for the full policy.',
  },
  {
    num: 'V',
    title: 'Late Kitchen',
    body: 'Charcuterie, steak sandwiches, and a late-night menu that lasts as long as the last hand. We feed the room, not just the high stakes.',
  },
  {
    num: 'VI',
    title: 'Ladies Night, Properly',
    body: "Thursdays, ladies' seat-time is on the house. No gimmicks, no photographers — just an open table and an honest welcome.",
  },
] as const;

const APPLY_STEPS = [
  {
    num: 'I',
    title: 'Fill The Form',
    body: 'Name, date of birth, contact, a referring member if you have one. Five minutes if you take your time.',
  },
  {
    num: 'II',
    title: 'Verify ID',
    body: "Upload a government-issued photo ID. We need to confirm you're 21 and that you are who you say you are. Files are encrypted and only retained as long as the law requires.",
  },
  {
    num: 'III',
    title: 'Twenty-Four Hour Review',
    body: "A real human reads every application. Most are approved within a day. We'll email you either way.",
  },
  {
    num: 'IV',
    title: 'First Visit',
    body: 'Bring your ID. Your first seat-time hour is on us. The host walks you in, introduces you to the floor, and shows you where the coffee lives.',
  },
] as const;

export default function MembershipPage() {
  return (
    <div>
      {/* HERO */}
      <section
        style={{
          padding: '120px 40px 80px',
          maxWidth: 1080,
          margin: '0 auto',
          textAlign: 'center',
          borderBottom: '1px solid var(--border-faint)',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Est. MMXXIV · Application Required
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 72,
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: '-0.015em',
            marginBottom: 24,
          }}
        >
          A membership,{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            not a cover charge.
          </em>
        </h1>
        <hr className="gold-rule-short" style={{ margin: '0 auto 32px', maxWidth: 320 }} />
        <p
          style={{
            color: 'var(--ivory-300)',
            fontSize: 17,
            maxWidth: 620,
            margin: '0 auto',
            lineHeight: 1.7,
          }}
        >
          Twenty-five dollars a month gets you a chair at a room that was built around the people
          sitting in it. The math is simple. The room takes nothing from the pot. Ever.
        </p>
      </section>

      {/* WHY MEMBERSHIP — LEGAL FRAMING */}
      <section
        style={{
          padding: '100px 40px',
          maxWidth: 880,
          margin: '0 auto',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 16 }}>
          Why A Members-Only Room
        </div>
        <h2
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 52,
            fontWeight: 500,
            lineHeight: 1.1,
            marginBottom: 32,
          }}
        >
          The law is the reason.{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            The standard is the point.
          </em>
        </h2>
        <div style={{ color: 'var(--ivory-300)', fontSize: 16, lineHeight: 1.8 }}>
          <p style={{ marginBottom: 20 }}>
            Live poker is legal in Texas inside a private place, played among members who all keep
            an equal share of the chance to win or lose. The operator — that&rsquo;s us — cannot
            profit from the outcome of any hand. No rake. No percentage. No chip drop. Texas Penal
            Code §47.02(b), for the curious.
          </p>
          <p style={{ marginBottom: 20 }}>
            What that means in practice: the house earns from membership dues and seat-time, and
            only from those. We are paid to host a room you want to come back to. The cards have
            nothing to do with our rent.
          </p>
          <p>
            It also means we know everyone who walks in. There is no door-pay, no walk-up, no
            stranger at the felt. Membership is the room.
          </p>
        </div>
      </section>

      {/* PRICING */}
      <section
        style={{
          padding: '100px 40px',
          maxWidth: 1080,
          margin: '0 auto',
          borderTop: '1px solid var(--border-faint)',
          borderBottom: '1px solid var(--border-faint)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            The Dues
          </div>
          <h2
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 52,
              fontWeight: 500,
              lineHeight: 1.1,
            }}
          >
            Twenty-five a month.{' '}
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              Autopay only.
            </em>
          </h2>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 32,
          }}
        >
          {[
            {
              num: 'I',
              title: 'Monthly Membership',
              price: '$25',
              unit: '/ month',
              items: [
                'Autopay required — card on file',
                'Cancel any time before the next billing cycle',
                'Non-transferable, single member',
                'Guest privileges (see house rules)',
              ],
            },
            {
              num: 'II',
              title: 'Seat Time',
              price: '$12',
              unit: '/ hour',
              items: [
                'Billed by the minute. Step away, your meter pauses',
                'Pay $200, get $300 of credit on your seat-time wallet',
                'Credit never expires while membership is active',
                "No charge to railbird a friend's tournament",
              ],
            },
          ].map((card) => (
            <div
              key={card.num}
              style={{
                borderTop: '1px solid var(--gold-400)',
                padding: '32px',
                background: 'var(--ink-850)',
              }}
            >
              <div
                className="gold-text"
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 14,
                  letterSpacing: '0.4em',
                  marginBottom: 12,
                }}
              >
                {card.num}
              </div>
              <h3
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 28,
                  marginBottom: 12,
                }}
              >
                {card.title}
              </h3>
              <p
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  marginBottom: 20,
                }}
              >
                <span
                  className="gold-text"
                  style={{ fontSize: 48, fontWeight: 500, letterSpacing: '-0.01em' }}
                >
                  {card.price}
                </span>{' '}
                <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>{card.unit}</span>
              </p>
              <ul
                style={{
                  color: 'var(--ivory-300)',
                  fontSize: 14,
                  lineHeight: 1.7,
                  paddingLeft: 0,
                  listStyle: 'none',
                }}
              >
                {card.items.map((item) => (
                  <li
                    key={item}
                    style={{
                      paddingLeft: 20,
                      position: 'relative',
                      marginBottom: 8,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        left: 0,
                        color: 'var(--gold-400)',
                      }}
                    >
                      ◆
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p
          style={{
            marginTop: 40,
            color: 'var(--text-muted)',
            fontSize: 14,
            fontStyle: 'italic',
            textAlign: 'center',
            maxWidth: 720,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          We do not, will not, and cannot take a rake. If a dealer ever pulls a chip out of a pot
          for the house, the drink is on us and dinner is too.
        </p>
      </section>

      {/* BENEFITS */}
      <section
        style={{
          padding: '100px 40px',
          maxWidth: 1280,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            What Membership Buys You
          </div>
          <h2
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 52,
              fontWeight: 500,
              lineHeight: 1.1,
            }}
          >
            The room,{' '}
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              and the room&rsquo;s memory.
            </em>
          </h2>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 32,
          }}
        >
          {BENEFITS.map((b) => (
            <div
              key={b.num}
              style={{
                borderTop: '1px solid var(--gold-400)',
                paddingTop: 24,
              }}
            >
              <div
                className="gold-text"
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 12,
                  letterSpacing: '0.4em',
                  marginBottom: 10,
                }}
              >
                {b.num}
              </div>
              <h3
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 24,
                  marginBottom: 12,
                }}
              >
                {b.title}
              </h3>
              <p style={{ color: 'var(--ivory-400)', fontSize: 14, lineHeight: 1.7 }}>{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW TO APPLY */}
      <section
        style={{
          padding: '100px 40px',
          maxWidth: 1080,
          margin: '0 auto',
          borderTop: '1px solid var(--border-faint)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            How To Apply
          </div>
          <h2
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 52,
              fontWeight: 500,
              lineHeight: 1.1,
            }}
          >
            Four steps.{' '}
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              One day.
            </em>
          </h2>
        </div>
        <ol style={{ listStyle: 'none', paddingLeft: 0, display: 'grid', gap: 32 }}>
          {APPLY_STEPS.map((step) => (
            <li
              key={step.num}
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 1fr',
                gap: 24,
                paddingBottom: 24,
                borderBottom: '1px solid var(--border-faint)',
              }}
            >
              <div
                className="gold-text"
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 32,
                  letterSpacing: '0.2em',
                }}
              >
                {step.num}
              </div>
              <div>
                <h3
                  style={{
                    fontFamily: 'Cormorant Garamond, serif',
                    fontSize: 26,
                    marginBottom: 10,
                  }}
                >
                  {step.title}
                </h3>
                <p style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.7 }}>
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <Link href="/signup" className="btn btn-primary btn-lg">
            Begin Application <Icon name="arrowRight" size={14} />
          </Link>
        </div>
      </section>

      {/* TEASERS */}
      <section
        style={{
          padding: '80px 40px 120px',
          maxWidth: 1080,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 48,
          borderTop: '1px solid var(--border-faint)',
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Conduct
          </div>
          <h3
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 28,
              marginBottom: 16,
            }}
          >
            The room runs on a few quiet rules.
          </h3>
          <p style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.7, marginBottom: 20 }}>
            No soft-playing. No phones on the felt. No recording other members. We keep the bar
            civil and the table cleaner. The full text is plain English and short.
          </p>
          <Link href="/terms" className="btn">
            Read The Member Agreement <Icon name="arrowRight" size={12} />
          </Link>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Questions
          </div>
          <h3
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 28,
              marginBottom: 16,
            }}
          >
            Most of yours have been asked before.
          </h3>
          <p style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.7, marginBottom: 20 }}>
            Stakes, structures, dress code, guests, comps, what happens when you forget to update
            your card on file. We wrote it all down.
          </p>
          <Link href="/faq" className="btn">
            Visit The FAQ <Icon name="arrowRight" size={12} />
          </Link>
        </div>
      </section>
    </div>
  );
}
