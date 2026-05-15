/**
 * `/club` — The Room / House Rules / Dress Code page.
 *
 * Replaces the T0 stub (audit 2026-05-15 P0 #1 follow-up). Content
 * researched 2026-05-15: room amenities and dress-code patterns match
 * the upscale-private-club genre (Champions Social, TCH Houston) without
 * copying their copy. House Rules link out to /terms for the full TDA
 * referenced rulebook.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '@/components/marketing/primitives';

export const metadata: Metadata = {
  title: 'Our Club',
  description:
    'Inside Members Only Poker Social Club: fifteen tournament-grade tables, trained dealers, and a private members-only room in Houston, Texas.',
  openGraph: {
    title: 'Our Club',
    description:
      'Inside Members Only Poker Social Club: fifteen tournament-grade tables, trained dealers, and a private members-only room in Houston, Texas.',
    images: [
      {
        url: '/og?title=Our%20Club&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Our Club',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Our Club',
    description:
      'Inside Members Only Poker Social Club: fifteen tables, trained dealers, a private room in Houston.',
    images: ['/og?title=Our%20Club&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

const ROOM_FEATURES = [
  {
    num: 'I',
    title: 'Tournament-Grade Felt',
    body: "Fifteen full-size tables. Cushioned padded rails so an eight-hour session doesn't cost you your elbows. Cup holders that hold a proper rocks glass.",
  },
  {
    num: 'II',
    title: 'Copag Plastic Cards',
    body: 'Casino-grade Copag 4-color decks, rotated regularly. No bent corners. No marked backs. New deck on request.',
  },
  {
    num: 'III',
    title: 'Trained, Salaried Dealers',
    body: "Every dealer in this room has been through a real curriculum and a real audition. They don't live on tokes alone — which is why they're still here in year three.",
  },
  {
    num: 'IV',
    title: 'BYOB',
    body: "The Club operates BYOB until our TABC liquor-license application is approved. Members bring their own beverages; staff handles glassware and opening. No glass on the felt — the lounge is where the bottles live.",
  },
  {
    num: 'V',
    title: 'The Lounge',
    body: 'Leather banquettes off the floor. A spot to take a phone call, watch the game, or wait for a seat without standing at the rail.',
  },
  {
    num: 'VI',
    title: 'The Cage',
    body: 'Chips in, chips out, by a window with two staff and a camera. Members can pre-load credit to their seat-time wallet from the lobby.',
  },
] as const;

const RULES_BRIEF = [
  'One player per hand. Help is not allowed, even from a friend.',
  'Verbal in turn is binding. So is a clean bet over the line.',
  'No string bets. Announce or push it in one motion.',
  'No phones on the felt during a hand. Calls go to the lounge.',
  'No recording other members without their consent. Ever.',
  'Show one, show all. The same goes for stories.',
] as const;

const DRESS_CODE = [
  'Closed-toe shoes during tournaments. Always, on tournament nights.',
  'No sleeveless shirts on men.',
  'No caps or hoods at the $5/$10 and higher tables.',
  "No apparel with another card room's logo. We'll lend you a tee.",
  'Sunglasses are fine. Mirrored reflectors are not.',
] as const;

function BrandedList({ items }: { items: ReadonlyArray<string> }) {
  return (
    <ul style={{ paddingLeft: 0, listStyle: 'none', color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.8 }}>
      {items.map((item) => (
        <li
          key={item}
          style={{
            paddingLeft: 24,
            position: 'relative',
            marginBottom: 10,
          }}
        >
          <span
            aria-hidden
            style={{ position: 'absolute', left: 0, color: 'var(--gold-400)' }}
          >
            ◆
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function ClubPage() {
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
          Est. MMXXIV · 16525 North Freeway
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
          A room built for{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            the long session.
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
          Fifteen tables. Dark wood. Warm lamps. Leather that&rsquo;s already breaking in. The room
          sits north of the city, off the freeway, behind a door that locks. Inside, it&rsquo;s
          quiet enough to think.
        </p>
      </section>

      {/* THE ROOM */}
      <section style={{ padding: '100px 40px', maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            The Room
          </div>
          <h2
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 52,
              fontWeight: 500,
              lineHeight: 1.1,
            }}
          >
            Fifteen tables.{' '}
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              One standard.
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
          {ROOM_FEATURES.map((f) => (
            <div key={f.num} style={{ borderTop: '1px solid var(--gold-400)', paddingTop: 24 }}>
              <div
                className="gold-text"
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 12,
                  letterSpacing: '0.4em',
                  marginBottom: 10,
                }}
              >
                {f.num}
              </div>
              <h3
                style={{
                  fontFamily: 'Cormorant Garamond, serif',
                  fontSize: 24,
                  marginBottom: 12,
                }}
              >
                {f.title}
              </h3>
              <p style={{ color: 'var(--ivory-400)', fontSize: 14, lineHeight: 1.7 }}>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOUSE RULES — BRIEF */}
      <section
        style={{
          padding: '100px 40px',
          maxWidth: 880,
          margin: '0 auto',
          borderTop: '1px solid var(--border-faint)',
          borderBottom: '1px solid var(--border-faint)',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 16 }}>
          House Rules · The Short Version
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
          TDA at the table.{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            Common sense everywhere else.
          </em>
        </h2>
        <p style={{ color: 'var(--ivory-300)', fontSize: 16, lineHeight: 1.8, marginBottom: 24 }}>
          Tournaments and cash games run on the Tournament Directors Association rulebook, current
          edition. Floor decisions are final on the night, written in the log, and reviewed the
          next morning if anyone needs them to be.
        </p>
        <BrandedList items={RULES_BRIEF} />
        <div style={{ marginTop: 32 }}>
          <Link href="/terms" className="btn">
            The Full House Rules <Icon name="arrowRight" size={12} />
          </Link>
        </div>
      </section>

      {/* DRESS CODE */}
      <section style={{ padding: '100px 40px', maxWidth: 880, margin: '0 auto' }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>
          Dress Code
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
          Smart casual.{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            Nothing precious.
          </em>
        </h2>
        <p style={{ color: 'var(--ivory-300)', fontSize: 16, lineHeight: 1.8, marginBottom: 24 }}>
          You don&rsquo;t need a jacket. We&rsquo;d rather you be comfortable for ten hours. But
          the room has a tone, and the room keeps it.
        </p>
        <BrandedList items={DRESS_CODE} />
      </section>

      {/* LOCATION & PARKING */}
      <section
        style={{
          padding: '100px 40px',
          maxWidth: 1280,
          margin: '0 auto',
          borderTop: '1px solid var(--border-faint)',
          borderBottom: '1px solid var(--border-faint)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 64,
          alignItems: 'center',
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            Where We Are
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
            North Houston.{' '}
            <em className="gold-text" style={{ fontStyle: 'italic' }}>
              Off the freeway.
            </em>
          </h2>
          <div style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.8 }}>
            <p style={{ marginBottom: 16 }}>
              16525 North Freeway, Houston, TX 77090. A straight shot down I-45 from the Loop, ten
              minutes from The Woodlands, twenty from Bush Intercontinental.
            </p>
            <p style={{ marginBottom: 16 }}>
              Free self-parking in a lit, fenced, camera-covered lot. Valet on Fridays and
              Saturdays — included, no tip required (though they&rsquo;ll appreciate one).
            </p>
            <p>
              The building is unmarked from the road except for a small brass chip on the door. If
              you&rsquo;re standing at it, you&rsquo;re in the right place.
            </p>
          </div>
        </div>
        <div
          aria-label="Map placeholder — venue location"
          style={{
            position: 'relative',
            borderRadius: 8,
            overflow: 'hidden',
            aspectRatio: '1.2 / 1',
            background:
              'linear-gradient(135deg, var(--ink-800) 0%, var(--ink-700) 50%, var(--ink-800) 100%)',
            border: '1px solid var(--border-faint)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              color: 'var(--text-dim)',
              fontSize: 11,
              letterSpacing: '0.32em',
              textTransform: 'uppercase',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            16525 N FWY · HOUSTON TX 77090
          </span>
        </div>
      </section>

      {/* KITCHEN */}
      <section style={{ padding: '100px 40px', maxWidth: 1080, margin: '0 auto' }}>
        <div className="eyebrow" style={{ marginBottom: 16, textAlign: 'center' }}>
          The Kitchen
        </div>
        <h2
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 48,
            fontWeight: 500,
            lineHeight: 1.1,
            marginBottom: 24,
            textAlign: 'center',
          }}
        >
          A small menu,{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            cooked properly.
          </em>
        </h2>
        <p
          style={{
            color: 'var(--ivory-300)',
            fontSize: 16,
            lineHeight: 1.8,
            marginBottom: 40,
            textAlign: 'center',
            maxWidth: 720,
            margin: '0 auto 40px',
          }}
        >
          The kitchen is modest by design. We&rsquo;d rather do twelve things well than forty
          things adequately. The menu changes when the chef finds something worth changing it for.
        </p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 48,
          }}
        >
          <div>
            <h3
              style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontSize: 24,
                marginBottom: 16,
              }}
            >
              Plates
            </h3>
            <BrandedList
              items={[
                'Charcuterie board · house condiments, mustard, bread',
                'Ribeye sandwich · au jus, horseradish, frites',
                'Wedge salad · blue, bacon, scallion',
                'Roasted chicken half · seasonal sides',
              ]}
            />
          </div>
          <div>
            <h3
              style={{
                fontFamily: 'Cormorant Garamond, serif',
                fontSize: 24,
                marginBottom: 16,
              }}
            >
              Late Night
            </h3>
            <BrandedList
              items={[
                'Smash burger · onion, american, crisp',
                'Chili · cup or bowl, Texas-style, no beans',
                'Fries, properly salted',
                'A short dessert list, depending on the night',
              ]}
            />
          </div>
        </div>
        <p
          style={{
            marginTop: 32,
            color: 'var(--text-muted)',
            fontSize: 14,
            fontStyle: 'italic',
            textAlign: 'center',
          }}
        >
          Food at the table is allowed between hands. Plates go to the lounge.
        </p>
      </section>

      {/* ATMOSPHERE */}
      <section
        style={{
          padding: '100px 40px',
          maxWidth: 880,
          margin: '0 auto',
          borderTop: '1px solid var(--border-faint)',
        }}
      >
        <div className="eyebrow" style={{ marginBottom: 16 }}>
          The Feel
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
          Dim warm lamps. Quiet wood.{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            The good kind of hush.
          </em>
        </h2>
        <div style={{ color: 'var(--ivory-300)', fontSize: 16, lineHeight: 1.8 }}>
          <p style={{ marginBottom: 20 }}>
            Most poker rooms are lit like dental offices. Ours is lit like a library that serves
            whiskey. Brass-shaded pendants over the felt. Tobacco-stained leather without the
            tobacco. Old prints on the walls — Cardiff, Monte Carlo, a Lake Charles oil from
            before the storm.
          </p>
          <p>
            The conversation hums. The shuffle is louder than the music. Someone at the four-table
            is telling a story you&rsquo;ve heard before and will hear again, and you laugh anyway
            because tonight it lands. That&rsquo;s the room. That&rsquo;s the point.
          </p>
        </div>
      </section>
    </div>
  );
}
