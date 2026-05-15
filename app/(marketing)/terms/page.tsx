/**
 * `/terms` — Member Agreement, Code of Conduct, House Rules, Liability.
 *
 * Replaces the T0 stub (audit 2026-05-15 P0 #1 follow-up). Drafted
 * 2026-05-15 by research subagent — Texas-private-club enforceable
 * provisions: AAA Commercial arbitration in Harris County, class-action
 * waiver, six-month damages cap, severability, 30-day revision notice,
 * TDA-rules-incorporated-by-reference. NOT legal advice; reviewed by
 * counsel before launch (ADR-0023 follow-up).
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { Icon } from '@/components/marketing/primitives';

export const metadata: Metadata = {
  title: 'Terms',
  description:
    'The Member Agreement for Members Only Poker Social Club: membership terms, code of conduct, house rules, dispute resolution, and assumption of risk.',
  openGraph: {
    title: 'Terms',
    description:
      'The Member Agreement for Members Only Poker Social Club: membership terms, code of conduct, house rules, dispute resolution, and assumption of risk.',
    images: [
      {
        url: '/og?title=Terms&subtitle=Members%20Only%20Poker%20Social%20Club',
        width: 1200,
        height: 630,
        alt: 'Members Only Poker Social Club — Terms',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Terms',
    description:
      'Member Agreement: membership terms, code of conduct, house rules, and the limits of our service.',
    images: ['/og?title=Terms&subtitle=Members%20Only%20Poker%20Social%20Club'],
  },
};

function Article({
  num,
  title,
  children,
}: {
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        padding: '60px 0',
        borderTop: '1px solid var(--border-faint)',
      }}
    >
      <div
        className="gold-text"
        style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 14,
          letterSpacing: '0.4em',
          marginBottom: 10,
        }}
      >
        {num}
      </div>
      <h2
        style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 42,
          fontWeight: 500,
          lineHeight: 1.1,
          marginBottom: 32,
        }}
      >
        {title}
      </h2>
      <div
        style={{
          color: 'var(--ivory-300)',
          fontSize: 15,
          lineHeight: 1.8,
        }}
      >
        {children}
      </div>
    </section>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        fontFamily: 'Cormorant Garamond, serif',
        fontSize: 22,
        color: 'var(--ivory-200)',
        marginTop: 32,
        marginBottom: 12,
      }}
    >
      {children}
    </h3>
  );
}

function BrandedList({ items }: { items: ReadonlyArray<React.ReactNode> }) {
  return (
    <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
      {items.map((item, idx) => (
        <li
          key={idx}
          style={{
            paddingLeft: 24,
            position: 'relative',
            marginBottom: 12,
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

export default function TermsPage() {
  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '80px 40px 120px' }}>
      {/* HERO */}
      <header style={{ textAlign: 'center', marginBottom: 64 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Member Agreement · Effective MMXXIV
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 64,
            fontWeight: 500,
            lineHeight: 1.05,
            letterSpacing: '-0.015em',
            marginBottom: 24,
          }}
        >
          The agreement,{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            in plain English.
          </em>
        </h1>
        <hr className="gold-rule-short" style={{ margin: '0 auto 32px', maxWidth: 320 }} />
        <p
          style={{
            color: 'var(--ivory-300)',
            fontSize: 16,
            lineHeight: 1.7,
            maxWidth: 640,
            margin: '0 auto',
          }}
        >
          This is the contract between you and Members Only Poker Social, LLC, a Texas limited
          liability company operating a private social club at 16525 North Freeway, Houston, Texas
          77090. We wrote it so a member could read it in one sitting. Every word still means what
          it says.
        </p>
      </header>

      {/* I. MEMBERSHIP */}
      <Article num="I" title="Membership">
        <SubHead>I.1 — Who can join</SubHead>
        <p>
          You must be at least 21 years old, present a valid government-issued photo ID, and not
          be currently barred from any licensed or unlicensed card room for cause. Membership is
          at the sole discretion of the Club. We may decline any application without explanation;
          we may also revoke membership for the grounds listed in Article IV.
        </p>

        <SubHead>I.2 — Dues and auto-renewal</SubHead>
        <p>
          Membership dues are twenty-five dollars ($25.00) per month, billed in advance on the day
          of the month you joined, to the payment method on file. Membership renews automatically
          each month until canceled. You authorize that recurring charge when you complete
          enrollment.
        </p>

        <SubHead>I.3 — Cancellation</SubHead>
        <p>
          Cancel any time from your member profile or by writing to
          membership@membersonlypokersocial.com. Cancellation takes effect at the end of the
          current paid month. We do not pro-rate. We do not charge cancellation fees. We do not
          retain you against your will.
        </p>

        <SubHead>I.4 — Non-transferable</SubHead>
        <p>
          Your membership is yours. You cannot sell it, lend it, gift it, or let your cousin use
          it. ID is checked at the door, and a card swiped by someone other than the member named
          on it is grounds for immediate termination of both accounts and forfeiture of any
          seat-time credit remaining.
        </p>

        <SubHead>I.5 — Seat-time credit</SubHead>
        <p>
          Seat-time is billed at twelve dollars ($12.00) per hour, accrued by the minute against
          your seat-time wallet. Deposits of two hundred dollars ($200.00) credit your wallet
          with three hundred dollars ($300.00). Credit does not expire while membership is
          active. On termination, unused dollar-for-dollar deposits — but not bonus credit — are
          refundable on written request within thirty days.
        </p>

        <SubHead>I.6 — Guests</SubHead>
        <p>
          Members in good standing may sponsor one guest per visit, up to four visits per guest
          per calendar year, after which the guest must apply for their own membership.
          Sponsoring members are responsible for their guest&rsquo;s conduct and any unpaid
          seat-time the guest incurs.
        </p>
      </Article>

      {/* II. CODE OF CONDUCT */}
      <Article num="II" title="Code of Conduct">
        <SubHead>II.1 — At the table</SubHead>
        <p style={{ marginBottom: 16 }}>
          Keep the felt civil. The Club is a mixed-company room and we expect members to act like
          it.
        </p>
        <BrandedList
          items={[
            'No profanity at the table when staff or female members are seated or standing within earshot. Self-talk after a bad beat is human; aiming it at a person is not.',
            'No soft-playing — meaning no checking down, no chip-feeding, and no coordinated easy passes among friends. Every hand is played for its full value or it is not played at all.',
            "No string bets. Announce the size or push it forward in one motion. The dealer's ruling stands.",
            'No electronics on the felt during a hand. Phones, watches that talk back, tablets, solver tools — none of it. If your phone is in your hand, your cards are dead. Step away from the table to take a call.',
            'No recording, photographing, or live-streaming other members without their explicit consent. This includes voice, video, and stills. The Club itself records the floor for security; that footage is not published.',
            'One player to a hand. No advice from the rail, no consultation, no hovering reads.',
            'Chip stacks visible at all times. No hiding high denominations behind lower ones. The floor will correct stacks on request.',
          ]}
        />

        <SubHead>II.2 — In the room</SubHead>
        <BrandedList
          items={[
            'Keep your voice at the level of the room. The room sets the tone.',
            'Intoxication that disrupts a game is grounds for a cab ride home and a sit-down with management the next afternoon.',
            'Harassment of staff or members — verbal, physical, sexual, or otherwise — is grounds for immediate and permanent expulsion. We do not negotiate this one.',
            'No outside food or beverage. The bar and kitchen exist for a reason.',
            'The dress code in Article III of the House Rules is part of this agreement. Floor may ask you to change or cover up.',
          ]}
        />
      </Article>

      {/* III. HOUSE RULES */}
      <Article num="III" title="House Rules">
        <SubHead>III.1 — Governing rulebook</SubHead>
        <p>
          All tournaments and cash games at the Club operate under the most recent published rules
          of the Poker Tournament Directors Association (TDA), supplemented by these House Rules
          where the TDA is silent or where local practice requires. Where this agreement and the
          TDA conflict, this agreement controls within the Club.
        </p>

        <SubHead>III.2 — Floor authority</SubHead>
        <p>
          A floor decision is final for the night. The decision will be entered into the night
          log and is reviewable by the General Manager the next business day if a member writes
          within forty-eight hours. Review may correct a ruling for future hands but does not
          retroactively rebuild pots or refund losses.
        </p>

        <SubHead>III.3 — Verbal in turn is binding</SubHead>
        <p>
          A declared action on your turn — call, raise, fold, all-in — is binding and stands. So
          does a clean push across the line. We do not honor angle-shoot &ldquo;I was just
          thinking out loud&rdquo; retractions.
        </p>

        <SubHead>III.4 — Show one, show all</SubHead>
        <p>
          If you choose to show your hand to one player at the table, the dealer will show it to
          the table. There are no private peeks.
        </p>

        <SubHead>III.5 — The clock</SubHead>
        <p>
          Any player may call the clock once a hand has run a reasonable length. The floor will
          give the player on the decision one minute plus a ten-second countdown. Failing to act
          forfeits the hand.
        </p>
      </Article>

      {/* IV. EXPULSION */}
      <Article num="IV" title="Grounds For Expulsion">
        <p style={{ marginBottom: 16 }}>
          Membership may be suspended or permanently terminated, with or without refund, for any
          of the following. This list is not exhaustive — but it covers the conduct that has
          historically forced clubs like ours to act.
        </p>
        <BrandedList
          items={[
            <>
              <strong>Cheating in any form.</strong> Marked cards, hole-card peeking,
              sleight-of-hand, palming, capping, signaling — proven cheating is permanent
              expulsion and may be reported to other Texas card rooms and, where warranted, to law
              enforcement.
            </>,
            <>
              <strong>Collusion.</strong> Coordinated play among two or more participants —
              including chip-dumping, whipsawing, or sharing hole cards — is treated as cheating.
            </>,
            <>
              <strong>Chip-dumping for any reason.</strong> Including for tax, gifting, or
              settlement of outside debts.
            </>,
            <>
              <strong>Intoxication beyond reason.</strong> The Club reserves the right to refuse
              service and to remove a member from a game for the safety of the table.
            </>,
            <>
              <strong>Harassment.</strong> Of staff or members. As described in II.2, this is
              non-negotiable.
            </>,
            <>
              <strong>Theft, vandalism, or fraud</strong> against the Club, a member, or a guest.
            </>,
            <>
              <strong>Chargebacks without first contacting management.</strong> A good-faith
              dispute is welcome; a back-channel reversal is not.
            </>,
            <>
              <strong>Repeated violation</strong> of the Code of Conduct after written warning.
            </>,
          ]}
        />
        <p style={{ marginTop: 16 }}>
          Suspensions are recorded and disclosed if you apply for membership at another Texas card
          room that asks. Permanent expulsions are final.
        </p>
      </Article>

      {/* V. DISPUTE RESOLUTION */}
      <Article num="V" title="Dispute Resolution">
        <SubHead>V.1 — Floor first</SubHead>
        <p>
          Disputes at the table are resolved by the floor on the night. The decision stands for
          that hand. The night log captures it.
        </p>

        <SubHead>V.2 — Management review</SubHead>
        <p>
          Disputes about a floor ruling, a charge, a membership decision, or any other matter
          under this agreement may be submitted in writing to disputes@membersonlypokersocial.com
          within thirty days of the event. The General Manager will respond in writing within
          fourteen days.
        </p>

        <SubHead>V.3 — Binding arbitration</SubHead>
        <p>
          Any dispute that cannot be resolved through V.1 and V.2, and that is not subject to
          small-claims jurisdiction, will be resolved by binding arbitration administered by the
          American Arbitration Association under its Commercial Arbitration Rules, before a
          single arbitrator, in Harris County, Texas. The arbitrator&rsquo;s decision is final
          and enforceable in any court of competent jurisdiction. Each party bears its own fees
          except where the arbitrator awards otherwise.
        </p>

        <SubHead>V.4 — Venue and governing law</SubHead>
        <p>
          This agreement is governed by the laws of the State of Texas, without regard to its
          conflicts-of-law provisions. Exclusive venue for any matter not subject to V.3 lies in
          the state and federal courts seated in Harris County, Texas.
        </p>

        <SubHead>V.5 — No class actions</SubHead>
        <p>
          You and the Club agree to resolve disputes individually. Neither party will bring a
          class, collective, or representative action arising out of this agreement.
        </p>
      </Article>

      {/* VI. LIABILITY */}
      <Article num="VI" title="Assumption Of Risk & Liability">
        <SubHead>VI.1 — The nature of the game</SubHead>
        <p>
          Poker is a game of skill played with money. Variance is real. Losing sessions are part
          of it. By participating, you acknowledge that the outcome of any hand, session, or
          tournament is not guaranteed and that losses are your responsibility alone. The Club,
          its dealers, and other members are not liable for the financial outcome of your play.
        </p>

        <SubHead>VI.2 — Premises liability</SubHead>
        <p>
          The Club maintains its premises in reasonably safe condition consistent with Texas law.
          Members and guests are responsible for their own belongings. Lost or stolen items
          should be reported to the floor immediately and to the general manager in writing
          within forty-eight hours.
        </p>

        <SubHead>VI.3 — Alcohol</SubHead>
        <p>
          The bar serves responsibly. Members are adults and are responsible for the consequences
          of their own consumption, including their ability to drive home. Ask the floor for a
          cab or rideshare any time. We will not let you leave the building behind the wheel of a
          car if we believe you&rsquo;re not fit to.
        </p>

        <SubHead>VI.4 — Cap on damages</SubHead>
        <p>
          To the maximum extent permitted by Texas law, the Club&rsquo;s aggregate liability to
          any member for any claim under this agreement is limited to the dues and seat-time
          deposits paid by that member to the Club in the six months preceding the claim.
        </p>
      </Article>

      {/* VII. PRIVACY */}
      <Article num="VII" title="Privacy">
        <p style={{ marginBottom: 16 }}>
          The Club collects identity, contact, payment, and play-history data for the operation
          of membership, compliance with Texas law, and the administration of the room. We do not
          sell member data. We do not share member identities with outside parties except as
          required by law or to investigate suspected cheating or collusion across affiliated
          Texas rooms. The full Privacy Policy — including data retention, deletion rights, and
          security disclosures — is incorporated into this agreement by reference.
        </p>
        <Link href="/privacy" className="btn">
          The Full Privacy Policy <Icon name="arrowRight" size={12} />
        </Link>
      </Article>

      {/* VIII. MISCELLANY */}
      <Article num="VIII" title="Miscellany">
        <SubHead>VIII.1 — Changes to this agreement</SubHead>
        <p>
          The Club may revise this agreement. Material changes will be sent to the email on file
          with at least thirty days&rsquo; notice. Continuing your membership past the effective
          date means you accept the revised terms. Cancel any time before then if you don&rsquo;t.
        </p>

        <SubHead>VIII.2 — Severability</SubHead>
        <p>
          If any provision of this agreement is found unenforceable, the remainder stays in
          effect. The unenforceable provision will be enforced to the greatest extent the law
          allows.
        </p>

        <SubHead>VIII.3 — Entire agreement</SubHead>
        <p>
          This document, together with the House Rules and Privacy Policy referenced within, is
          the entire agreement between you and the Club regarding your membership and supersedes
          any prior understanding.
        </p>

        <SubHead>VIII.4 — Contact</SubHead>
        <p>
          Members Only Poker Social, LLC
          <br />
          16525 North Freeway, Houston, Texas 77090
          <br />
          membership@membersonlypokersocial.com
        </p>
      </Article>

      {/* SIGN-OFF */}
      <section
        style={{
          marginTop: 80,
          padding: '40px 0',
          borderTop: '1px solid var(--gold-400)',
          borderBottom: '1px solid var(--gold-400)',
        }}
      >
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 14,
            fontStyle: 'italic',
            lineHeight: 1.7,
            textAlign: 'center',
          }}
        >
          By completing your membership application, by swiping your member card, or by taking a
          seat at any table in the Club, you acknowledge that you have read, understood, and
          agreed to this Member Agreement.
        </p>
      </section>
    </div>
  );
}
