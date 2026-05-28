/**
 * `/games` — cash games, weekly tournament rhythm, and upcoming events.
 *
 * Per ADR-0037 (Slice 1), the **upcoming events list** is now read from the
 * `tournaments` table behind the `tournament-schedule-live` feature flag.
 * The editorial "weekly rhythm" section (the five-day SCHEDULE array) stays
 * — it's marketing copy, not data, and the DB row shape doesn't carry the
 * editorial body. The DB drives "what's actually on the next 30 days" while
 * the rhythm copy explains "what to expect on a normal week."
 *
 * Flag-off path: renders the in-page UPCOMING_FALLBACK array (a 4-line
 * static schedule so search engines + skim-readers still see real-looking
 * future events when the live system is paused).
 *
 * Flag-on with query error: renders the explicit "schedule loading" message
 * with the floor phone number. No silent fallback to stale data — per spec
 * §`/games` rendering.
 *
 * The kill-switch is the feature flag; the in-page fallback is the floor
 * (not stale data).
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '@/components/marketing/primitives';
import { isEnabled } from '@/lib/flags';
import { fetchUpcomingTournaments } from '@/lib/tournaments/queries';
import { NAP } from '@/lib/content/nap';
import type { Tournament } from '@/lib/tournaments/types';

// Re-validate every 10 minutes (ADR-0037 §/games rendering). Admin writes
// also call revalidatePath('/games') to invalidate immediately.
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Games',
  description:
    'Tonight at Members Only Poker Social Club: live cash games, weekly tournament schedule, and the full board for tournaments and member events in Houston.',
  openGraph: {
    title: 'Games',
    description:
      'Tonight at Members Only Poker Social Club: live cash games, weekly tournament schedule, and the full board for tournaments and member events in Houston.',
    images: [
      {
        url: '/og?title=Games&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Games',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Games',
    description:
      'Live cash games, tournament schedule, and the full board for member events in Houston.',
    images: ['/og?title=Games&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

const STAKES = [
  {
    num: 'I',
    title: "1/2 No-Limit Hold'em",
    buyin: '$60 min · $300 max',
    body: "The room's starting line. Runs every operating night, often two and three tables deep. The friendliest game in the house, and frequently the most fun.",
  },
  {
    num: 'II',
    title: "2/5 No-Limit Hold'em",
    buyin: '$200 min · $1,000 max',
    body: 'Where the regulars live. Spread most nights, often two tables on weekends. Bring patience and a real stack.',
  },
  {
    num: 'III',
    title: "5/10 No-Limit Hold'em",
    buyin: '$500 min · uncapped',
    body: 'Friday and Saturday by default, weeknights if the list fills. The biggest cash game we run on the regular schedule.',
  },
  {
    num: 'IV',
    title: '2/5 Pot-Limit Omaha',
    buyin: '$200 min · $1,500 max',
    body: 'Four cards, pot-sized bets, and the closest thing this room has to a roller coaster. Runs Wednesday, Friday, Saturday — and any night the list says so.',
  },
  {
    num: 'V',
    title: "1/3 No-Limit Hold'em",
    buyin: '$100 min · $500 max',
    body: 'The bridge stake. A step up from 1/2 without the jump to 2/5. Spread on demand, usually peaks Thursday and Sunday.',
  },
  {
    num: 'VI',
    title: 'Mixed Big Game',
    buyin: 'By arrangement',
    body: 'Larger NLHE, 5/10 PLO, and the occasional 5/10/25 NLHE when the list lines up. Members only, called in advance, seated by the floor.',
  },
] as const;

const SCHEDULE = [
  {
    day: 'Tuesday',
    title: '$150 Bounty',
    meta: '7:00 PM · 20-min levels · 15K starting · $50 on each head',
    body: "The week's warm-up. Every player you knock out pays you fifty dollars on the spot. Re-entry through level six.",
  },
  {
    day: 'Thursday',
    title: '$125 Ladies Night Freezeout',
    meta: '7:00 PM · 20-min levels · 12K starting · Ladies seat-time free all night',
    body: 'Open to all members. The seat-time comp applies to every female member in the building, table or rail. A proper Thursday.',
  },
  {
    day: 'Friday',
    title: '$250 Nightly',
    meta: '7:30 PM · 25-min levels · 20K starting · One re-entry',
    body: "The weekend kicker. Field caps at 120. Final table guaranteed by 1 AM on a normal week. A solid structure for the buy-in — we don't run turbo trash.",
  },
  {
    day: 'Saturday',
    title: '$400 Deepstack',
    meta: '3:00 PM · 30-min levels · 40K starting · Two re-entries',
    body: "The serious one. Twelve-hour structure with breaks that aren't insulting. Last year's average winner cashed $11,200.",
  },
  {
    day: 'Sunday',
    title: 'Cash Only',
    meta: '12:00 PM open · All stakes on demand',
    body: "No tournament. Just cash, all day, until midnight. The room's most patient session and the easiest day to find a seat.",
  },
] as const;

/**
 * 4-line flag-off fallback (per ADR-0037 spec §Existing code being replaced).
 * Visible only when `tournament-schedule-live` is OFF — the live read path
 * is the production source-of-truth once the cron has seeded the table.
 */
const UPCOMING_FALLBACK = [
  { slug: 'tuesday-bounty', name: 'Tuesday Bounty' },
  { slug: 'thursday-ladies-night', name: 'Thursday Ladies Night Freezeout' },
  { slug: 'friday-nightly', name: 'Friday Nightly' },
  { slug: 'saturday-deepstack', name: 'Saturday Deepstack' },
] as const;

type UpcomingState =
  | { kind: 'static_fallback' } // flag off
  | { kind: 'error' } // flag on, query failed
  | { kind: 'empty' } // flag on, query returned 0 rows
  | { kind: 'live'; rows: Tournament[] };

async function loadUpcoming(): Promise<UpcomingState> {
  const live = isEnabled('tournament-schedule-live');
  if (!live) return { kind: 'static_fallback' };

  try {
    const rows = await fetchUpcomingTournaments({ days: 30 });
    if (rows.length === 0) return { kind: 'empty' };
    return { kind: 'live', rows };
  } catch (err) {
    // No silent fallback to stale data per spec. Log so Sentry captures it.
    console.error(
      JSON.stringify({
        event: 'games_page_upcoming_query_error',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { kind: 'error' };
  }
}

const dateLineFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Chicago',
  timeZoneName: 'short',
});

export default async function GamesPage() {
  const upcoming = await loadUpcoming();

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
          Est. MMXXIV · The Schedule
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
          Tonight&rsquo;s game,{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            and every night after.
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
          Cash runs every night we&rsquo;re open. Tournaments run on a rhythm. The live ticker on
          the homepage shows what&rsquo;s actually on the felt right now — this page shows what to
          expect.
        </p>
      </section>

      {/* CASH GAMES */}
      <section style={{ padding: '100px 40px', maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            Cash Games
          </div>
          <h2
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 52,
              fontWeight: 500,
              lineHeight: 1.1,
            }}
          >
            Six stakes,{' '}
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              most nights.
            </em>
          </h2>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 32,
          }}
        >
          {STAKES.map((s) => (
            <div
              key={s.num}
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
                {s.num}
              </div>
              <h3
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 24,
                  marginBottom: 8,
                }}
              >
                {s.title}
              </h3>
              <p
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 12,
                  color: 'var(--gold-300)',
                  letterSpacing: '0.05em',
                  marginBottom: 14,
                }}
              >
                {s.buyin}
              </p>
              <p style={{ color: 'var(--ivory-400)', fontSize: 14, lineHeight: 1.7 }}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* WEEKLY TOURNAMENTS — editorial rhythm */}
      <section
        style={{
          padding: '100px 40px',
          maxWidth: 1080,
          margin: '0 auto',
          borderTop: '1px solid var(--border-faint)',
          borderBottom: '1px solid var(--border-faint)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            Weekly Tournaments
          </div>
          <h2
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 52,
              fontWeight: 500,
              lineHeight: 1.1,
            }}
          >
            Five nights,{' '}
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              five reasons to come early.
            </em>
          </h2>
        </div>
        <div style={{ display: 'grid', gap: 24 }}>
          {SCHEDULE.map((row) => (
            <div
              key={row.day}
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                gap: 32,
                paddingBottom: 24,
                borderBottom: '1px solid var(--border-faint)',
              }}
            >
              <div
                className="gold-text"
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 26,
                  fontStyle: 'italic',
                  letterSpacing: '-0.01em',
                }}
              >
                {row.day}
              </div>
              <div>
                <h3
                  style={{
                    fontFamily: 'Cormorant Garamond, serif',
                    fontSize: 24,
                    marginBottom: 6,
                  }}
                >
                  {row.title}
                </h3>
                <p
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 12,
                    color: 'var(--gold-300)',
                    letterSpacing: '0.05em',
                    marginBottom: 14,
                  }}
                >
                  {row.meta}
                </p>
                <p style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.7 }}>
                  {row.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Upcoming Events — flag-driven, ADR-0037 */}
        <UpcomingEvents state={upcoming} />
      </section>

      {/* WAITLIST / TICKER */}
      <section
        style={{
          padding: '80px 40px',
          maxWidth: 1080,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 48,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            The Waitlist
          </div>
          <h3
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 28,
              marginBottom: 16,
            }}
          >
            Text-alerts. Not voicemail tag.
          </h3>
          <p style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.7 }}>
            Add yourself to any list from your phone. We text when your seat is two away and again
            when it&rsquo;s ready. Reply HOLD and we&rsquo;ll save it ten minutes. Reply DROP and we
            won&rsquo;t take it personally.
          </p>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Live Ticker
          </div>
          <h3
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 28,
              marginBottom: 16,
            }}
          >
            What&rsquo;s really running, right now.
          </h3>
          <p style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.7, marginBottom: 16 }}>
            The home page shows the actual state of the floor — open seats, waitlist depth,
            tournament clocks. It refreshes on its own. Look before you drive.
          </p>
          <Link href="/" className="btn">
            See The Floor <Icon name="arrowRight" size={12} />
          </Link>
        </div>
      </section>

      {/* FORMAT GUIDE */}
      <section
        style={{
          padding: '100px 40px',
          maxWidth: 1080,
          margin: '0 auto',
          borderTop: '1px solid var(--border-faint)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            Format Guide
          </div>
          <h2
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 48,
              fontWeight: 500,
              lineHeight: 1.1,
            }}
          >
            For the player{' '}
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              finding the room.
            </em>
          </h2>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 32,
          }}
        >
          <div>
            <h3
              style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontSize: 24,
                marginBottom: 12,
              }}
            >
              NLHE — No-Limit Hold&rsquo;em
            </h3>
            <p style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.8 }}>
              Two cards down, five cards up, four rounds of betting. You can move all of your chips
              at any time. The dominant game in the room and the easiest to learn — though the
              easiest to lose at, too. Stakes are named for the blinds: 1/2 means the small blind
              posts $1, the big blind posts $2, and the buy-in scales from there.
            </p>
          </div>
          <div>
            <h3
              style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontSize: 24,
                marginBottom: 12,
              }}
            >
              PLO — Pot-Limit Omaha
            </h3>
            <p style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.8 }}>
              Four cards down instead of two. You must use exactly two of them with three from the
              board. Bets are capped at the current size of the pot, not your stack — which sounds
              gentler than it plays. Pots grow fast and equity runs close. Bring a calmer
              disposition than you&rsquo;d need for hold&rsquo;em.
            </p>
          </div>
          <div>
            <h3
              style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontSize: 24,
                marginBottom: 12,
              }}
            >
              Bounty Tournament
            </h3>
            <p style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.8 }}>
              A regular tournament with a twist: a portion of every buy-in goes onto the
              player&rsquo;s head. Knock them out, you collect that bounty in cash, at the table,
              before the next hand. The remainder funds the prize pool the usual way. A faster,
              looser, more sociable kind of evening.
            </p>
          </div>
        </div>
      </section>

      {/* NO RAKE / TIPPING NOTE */}
      <section
        style={{
          padding: '100px 40px 120px',
          maxWidth: 880,
          margin: '0 auto',
          borderTop: '1px solid var(--border-faint)',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 16 }}>
          Two Quiet Notes
        </div>
        <h2
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 48,
            fontWeight: 500,
            lineHeight: 1.1,
            marginBottom: 24,
          }}
        >
          On rake,{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            and on the tip jar.
          </em>
        </h2>
        <div style={{ color: 'var(--ivory-300)', fontSize: 16, lineHeight: 1.8 }}>
          <p style={{ marginBottom: 20 }}>
            The room takes no rake. Not a dollar, not a chip, not a percentage. Pots pay players.
            That&rsquo;s why membership and seat-time exist.
          </p>
          <p>
            Our dealers are salaried, not stipend-and-pray. Tipping is welcome and appreciated but
            never required, never expected, and never tracked against you. A dollar on a winning pot
            is traditional. Zero on a losing one is fine. Dealers will treat you the same either way
            — that&rsquo;s the deal we made with them when we hired them.
          </p>
        </div>
      </section>
    </div>
  );
}

function UpcomingEvents({ state }: { state: UpcomingState }) {
  return (
    <div style={{ marginTop: 48 }}>
      <div className="eyebrow" style={{ marginBottom: 16 }}>
        Upcoming Events
      </div>
      {state.kind === 'live' && (
        <ul style={{ listStyle: 'none', paddingLeft: 0 }} aria-label="Upcoming tournaments">
          {state.rows.map((t) => (
            <li key={t.slug} style={{ marginBottom: 12 }}>
              <Link
                href={`/games/${t.slug}`}
                className="gold-text"
                style={{
                  fontSize: 14,
                  letterSpacing: '0.05em',
                  textDecoration: 'underline',
                }}
              >
                {t.name} · {dateLineFormatter.format(new Date(t.startsAt))}{' '}
                <Icon name="arrowRight" size={10} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {state.kind === 'static_fallback' && (
        <ul style={{ listStyle: 'none', paddingLeft: 0 }} aria-label="Upcoming tournaments">
          {UPCOMING_FALLBACK.map((t) => (
            <li key={t.slug} style={{ marginBottom: 8 }}>
              <Link
                href={`/games/${t.slug}`}
                className="gold-text"
                style={{
                  fontSize: 14,
                  letterSpacing: '0.05em',
                  textDecoration: 'underline',
                }}
              >
                {t.name} <Icon name="arrowRight" size={10} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {state.kind === 'empty' && (
        <p role="status" style={{ color: 'var(--ivory-400)', fontSize: 14, lineHeight: 1.6 }}>
          No tournaments are scheduled in the next 30 days. The weekly rhythm above shows what to
          expect on a normal week — call the floor at {NAP.telephone} for tonight&rsquo;s lineup.
        </p>
      )}
      {state.kind === 'error' && (
        <p role="status" style={{ color: 'var(--ivory-400)', fontSize: 14, lineHeight: 1.6 }}>
          Our live schedule is loading. Refresh in a moment, or call the floor at {NAP.telephone}{' '}
          for tonight&rsquo;s lineup.
        </p>
      )}
    </div>
  );
}
