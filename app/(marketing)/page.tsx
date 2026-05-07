/**
 * Home page (`/`).
 *
 * Ported from `_design/project/screens-public-1.jsx HomeScreen`. Sections:
 * Hero → Live Ticker → Value Props → Signage Feature (placeholder) → Hours → CTA.
 *
 * The Signage Feature section's photography (`venue-exterior.png`,
 * `signage.png`) doesn't exist yet — rendered as a styled placeholder
 * so the layout slot is preserved. Real images get swapped in a follow-up
 * once the owner provides them. See journal entry 05.
 *
 * Inline `style={{...}}` is preserved verbatim from the prototype to keep
 * 1:1 visual fidelity for the first owner preview. A follow-up PR
 * refactors to Tailwind utilities where the prototype's responsive
 * attribute selectors don't apply.
 */

import Link from 'next/link';
import { Chip, Icon, Laurel, Suit } from '@/components/marketing/primitives';

const LIVE_GAMES: ReadonlyArray<readonly [string, string, string]> = [
  ["1/2 NL Hold'em", '2 seats open', 'T7'],
  ["2/5 NL Hold'em", 'Waitlist 4', 'T3'],
  ["5/10 NL Hold'em", 'Full · Wait 2', 'T1'],
  ['PLO 2/5', '1 seat open', 'T9'],
  ['Friday Bounty', 'Starts 7:00 PM', '—'],
];

type ValueCard = { num: string; title: string; body: string };

const VALUE_CARDS: ValueCard[] = [
  {
    num: 'I',
    title: 'No Rake',
    body: 'Revenue comes from membership and seat-time. Every dollar at the table stays at the table. The house wins by hosting a room you keep coming back to.',
  },
  {
    num: 'II',
    title: 'Members First',
    body: "Membership is by application. The room stays the size we can keep at the level we want. You'll know the dealers. They'll know your name.",
  },
  {
    num: 'III',
    title: 'Honest Time',
    body: '$12 an hour, billed by the minute. Step away for dinner, your meter pauses. Pay $200, get $300 of credit. Keep it simple.',
  },
];

type HoursRow = readonly [day: string, hours: string, closed?: boolean];

const HOURS_ROWS: HoursRow[] = [
  ['Monday', 'Closed', true],
  ['Tuesday', '4:00 PM — 2:00 AM'],
  ['Wednesday', '4:00 PM — 2:00 AM'],
  ['Thursday', '4:00 PM — 2:00 AM'],
  ['Friday', '2:00 PM — 4:00 AM'],
  ['Saturday', '12:00 PM — 4:00 AM'],
  ['Sunday', '12:00 PM — Midnight'],
];

export default function HomePage() {
  return (
    <div>
      {/* HERO */}
      <section
        className="home-hero"
        style={{
          position: 'relative',
          height: 720,
          overflow: 'hidden',
          borderBottom: '1px solid var(--border-faint)',
          background: 'radial-gradient(ellipse at center top, #1a1816 0%, #0b0b0b 70%)',
        }}
      >
        {/* Hero photography placeholder — gradient + grain until owner provides venue-exterior.png */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(11,11,11,0.4) 0%, rgba(11,11,11,0.3) 50%, rgba(11,11,11,0.95) 100%)',
          }}
        />
        <div className="grain" aria-hidden style={{ position: 'absolute', inset: 0 }} />

        <div
          className="home-hero-inner"
          style={{
            position: 'relative',
            maxWidth: 1280,
            margin: '0 auto',
            padding: '120px 40px 0',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 24,
            }}
          >
            <Chip size={84} />
          </div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Est. MMXXIV · Private Social Club
          </div>
          <h1
            className="home-hero-title"
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 96,
              fontWeight: 500,
              lineHeight: 1,
              letterSpacing: '-0.015em',
              marginBottom: 24,
            }}
          >
            A room. A game.
            <br />
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              A chair waiting for you.
            </em>
          </h1>
          <div className="diamond-divider" style={{ maxWidth: 320, margin: '0 auto 24px' }}>
            <Suit kind="diamond" size={10} color="#C9A24A" />
          </div>
          <p
            className="home-hero-lede"
            style={{
              fontSize: 17,
              color: 'var(--ivory-300)',
              maxWidth: 580,
              margin: '0 auto 40px',
              lineHeight: 1.6,
            }}
          >
            Members-funded poker, held to a higher standard. No rake. No tilt. Just twelve tables
            and the people you wanted to play with anyway.
          </p>
          <div
            className="home-hero-cta"
            style={{
              display: 'flex',
              gap: 16,
              justifyContent: 'center',
            }}
          >
            <Link href="/membership" className="btn btn-primary btn-lg">
              Apply for Membership
            </Link>
            <Link href="/games" className="btn btn-lg">
              Tonight&apos;s Games
            </Link>
          </div>
        </div>
      </section>

      {/* LIVE TICKER */}
      <section
        className="home-ticker"
        style={{
          borderBottom: '1px solid var(--border-faint)',
          background: 'var(--ink-850)',
          padding: '20px 40px',
        }}
      >
        <div
          className="home-ticker-row"
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: 32,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexShrink: 0,
            }}
          >
            <span className="pill pill-live">Live · Now</span>
            <span
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
              }}
            >
              The Floor
            </span>
          </div>
          <div
            className="home-ticker-list"
            style={{
              flex: 1,
              display: 'flex',
              gap: 32,
              overflow: 'hidden',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 13,
              color: 'var(--ivory-300)',
            }}
          >
            {LIVE_GAMES.map(([game, status, table], i) => (
              <div
                key={game}
                style={{
                  display: 'flex',
                  gap: 12,
                  whiteSpace: 'nowrap',
                  alignItems: 'center',
                }}
              >
                <span style={{ color: 'var(--gold-300)' }}>{game}</span>
                <span style={{ color: 'var(--text-muted)' }}>·</span>
                <span>{status}</span>
                <span style={{ color: 'var(--text-dim)' }}>{table}</span>
                {i < LIVE_GAMES.length - 1 && (
                  <span
                    style={{
                      color: 'var(--gold-600)',
                      marginLeft: 16,
                    }}
                  >
                    ◆
                  </span>
                )}
              </div>
            ))}
          </div>
          <Link
            href="/games"
            className="home-ticker-fullboard"
            style={{
              color: 'var(--gold-300)',
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              flexShrink: 0,
              textDecoration: 'none',
            }}
          >
            Full board <Icon name="arrowRight" size={12} />
          </Link>
        </div>
      </section>

      {/* VALUE PROPS */}
      <section
        className="home-section"
        style={{
          padding: '120px 40px',
          maxWidth: 1280,
          margin: '0 auto',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 80 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            The Difference
          </div>
          <h2 className="section-title home-h2" style={{ fontSize: 64, marginBottom: 24 }}>
            Built for the people
            <br />
            at the{' '}
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              table
            </em>
            .
          </h2>
          <hr className="gold-rule-short" style={{ marginTop: 32 }} />
        </div>
        <div
          className="home-grid-3"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 32,
          }}
        >
          {VALUE_CARDS.map((card) => (
            <div
              key={card.num}
              style={{
                borderTop: '1px solid var(--gold-400)',
                paddingTop: 32,
              }}
            >
              <div
                className="gold-text"
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 14,
                  letterSpacing: '0.4em',
                  marginBottom: 16,
                }}
              >
                {card.num}
              </div>
              <h3
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 32,
                  marginBottom: 16,
                }}
              >
                {card.title}
              </h3>
              <p
                style={{
                  color: 'var(--ivory-400)',
                  fontSize: 15,
                  lineHeight: 1.7,
                }}
              >
                {card.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* SIGNAGE FEATURE — image placeholder until owner provides photography */}
      <section
        className="home-section-edge"
        style={{
          position: 'relative',
          padding: '100px 0',
          borderTop: '1px solid var(--border-faint)',
          borderBottom: '1px solid var(--border-faint)',
        }}
      >
        <div
          className="home-section-inner home-grid-2"
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            padding: '0 40px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 80,
            alignItems: 'center',
          }}
        >
          <div
            aria-label="Photography placeholder — venue signage"
            style={{
              position: 'relative',
              borderRadius: 8,
              overflow: 'hidden',
              aspectRatio: '1.4 / 1',
              background:
                'linear-gradient(135deg, var(--ink-800) 0%, var(--ink-700) 50%, var(--ink-800) 100%)',
              border: '1px solid var(--border-faint)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                color: 'var(--text-dim)',
                fontSize: 11,
                letterSpacing: '0.32em',
                textTransform: 'uppercase',
              }}
            >
              Photography Coming Soon
            </div>
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(135deg, transparent 60%, rgba(11,11,11,0.4))',
              }}
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>
              The House
            </div>
            <h2 className="section-title home-h2-sm" style={{ fontSize: 56, marginBottom: 24 }}>
              Twelve tables.
              <br />
              <em className="gold-text" style={{ fontStyle: 'italic' }}>
                One standard.
              </em>
            </h2>
            <p
              style={{
                color: 'var(--ivory-300)',
                fontSize: 16,
                lineHeight: 1.7,
                marginBottom: 32,
              }}
            >
              Tournament-grade Copag cards. Cushioned rails. Properly trained dealers — not a
              hobbyist with a button. A bar stocked the way a poker night should be.
            </p>
            <p
              style={{
                color: 'var(--ivory-300)',
                fontSize: 16,
                lineHeight: 1.7,
                marginBottom: 40,
              }}
            >
              We open the doors at 4. Last seat goes at 2. Sundays are cash only. Tuesdays we run
              the bounty. Thursday is ladies night, by which we mean ladies sit free.
            </p>
            <Link href="/club" className="btn">
              Tour The Club <Icon name="arrowRight" size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* HOURS */}
      <section
        className="home-section"
        style={{
          padding: '100px 40px',
          maxWidth: 1280,
          margin: '0 auto',
        }}
      >
        <div
          className="home-grid-hours"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr',
            gap: 80,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>
              Open Tonight
            </div>
            <h2 className="section-title home-h2-sm" style={{ fontSize: 48, marginBottom: 16 }}>
              4:00 PM
              <br />
              <em className="gold-text" style={{ fontStyle: 'italic' }}>
                until last hand
              </em>
            </h2>
          </div>
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {HOURS_ROWS.map(([day, hours, closed]) => (
                  <tr
                    key={day}
                    style={{
                      borderBottom: '1px solid var(--border-faint)',
                    }}
                  >
                    <td
                      style={{
                        padding: '16px 0',
                        fontFamily: 'Cormorant Garamond, serif',
                        fontSize: 22,
                        color: 'var(--ivory-200)',
                      }}
                    >
                      {day}
                    </td>
                    <td
                      style={{
                        padding: '16px 0',
                        textAlign: 'right',
                        color: closed ? 'var(--text-dim)' : 'var(--gold-300)',
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 13,
                        letterSpacing: '0.05em',
                      }}
                    >
                      {hours}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section
        className="home-section"
        style={{
          position: 'relative',
          padding: '120px 40px',
          textAlign: 'center',
          borderTop: '1px solid var(--border-faint)',
        }}
      >
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: 60,
            transform: 'translateX(-50%)',
            opacity: 0.5,
          }}
        >
          <Laurel width={400} opacity={0.3} />
        </div>
        <div
          style={{
            position: 'relative',
            maxWidth: 720,
            margin: '0 auto',
          }}
        >
          <h2
            className="home-cta-title"
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 64,
              fontWeight: 500,
              lineHeight: 1,
              marginBottom: 24,
            }}
          >
            The chair is open.
            <br />
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              Pull it up.
            </em>
          </h2>
          <p
            style={{
              color: 'var(--ivory-300)',
              fontSize: 16,
              marginBottom: 40,
              maxWidth: 520,
              marginLeft: 'auto',
              marginRight: 'auto',
              lineHeight: 1.7,
            }}
          >
            $25 a month with autopay. Apply in five minutes. Approved within twenty-four hours.
          </p>
          <Link href="/signup" className="btn btn-primary btn-lg">
            Apply for Membership <Icon name="arrowRight" size={14} stroke={2} />
          </Link>
        </div>
      </section>
    </div>
  );
}
