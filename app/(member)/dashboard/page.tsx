/**
 * Member dashboard — visual scaffold.
 *
 * Server component. The (member) layout provides the sidebar nav,
 * topbar, and gating; this page just renders the dashboard content.
 *
 * Composite surface drawing from multiple ADRs. Most data sources are
 * still blocked on external triggers (ADR-0009 KYC, ADR-0010 Stripe,
 * ADR-0011 time-bank). Cards render their empty-state copy until the
 * owning ADR ships. When real data lands, swap the placeholder values
 * inline — the visual structure does not need to change.
 *
 * Sign-out lives in the layout sidebar (POST /logout). CSRF defense is
 * the form-only contract pinned by /tests/auth/member-layout.test.ts —
 * no anchor element may reference the logout route directly.
 */

import Link from 'next/link';

import { getCurrentProfile } from '@/lib/auth/getCurrentProfile';
import { nowUtc } from '@/lib/time';

const TZ = 'America/Chicago';

function greetingFor(date: Date): string {
  // Render the hour in club-local time (ADR-0034). The (member) layout
  // doesn't pre-compute this so the greeting feels live on each load.
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: TZ,
    }).format(date),
  );
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Up late';
}

function clubDateLabel(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: TZ,
  }).format(date);
}

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  // The (member) layout already redirected if profile is null,
  // but TypeScript doesn't know that. Defensive narrow:
  if (!profile) return null;

  const firstName = profile.full_name.split(/\s+/)[0] ?? profile.full_name;
  const now = nowUtc();
  const greeting = greetingFor(now);
  const dateLabel = clubDateLabel(now);

  return (
    <div>
      {/* Welcome */}
      <div style={{ marginBottom: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Welcome back
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 44,
            lineHeight: 1.1,
            margin: 0,
          }}
        >
          {greeting},{' '}
          <em className="gold-text" style={{ fontStyle: 'italic' }}>
            {firstName}
          </em>
          .
        </h1>
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: 14,
            marginTop: 8,
          }}
        >
          {dateLabel} · We never close. Every day. Every night.
        </p>
      </div>

      {/* Hero row — membership + seat-time */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.3fr 1fr',
          gap: 24,
          marginBottom: 24,
        }}
      >
        <PlaceholderCard
          eyebrow="Membership Card"
          status="Pending activation"
          headline="Your seat is reserved."
          body="Pricing and billing are being finalized with the owner. Once Stripe is configured, you'll see your membership card, next billing date, and tier here."
          ctaLabel="Read the agreement"
          ctaHref="/member-agreement"
          tall
        />
        <PlaceholderCard
          eyebrow="Seat-Time Wallet"
          status="Coming soon"
          headline="—"
          body="Prepaid seat-time hours will show here. Top up from $60 to $500 packs; pay-as-you-play sessions tick the balance down as you sit."
          mono
        />
      </div>

      {/* Stats row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard label="Next Bill" value="—" sub="Pending Stripe setup" />
        <StatCard label="This Month" value="0h" sub="of seat-time" />
        <StatCard label="Lifetime Hours" value="0" sub="since join" />
        <StatCard label="Sessions" value="0" sub="all-time" />
      </div>

      {/* Lower row — sessions + tonight */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: 24,
        }}
      >
        <SectionCard
          title="Recent Sessions"
          aside={
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.16em',
              }}
            >
              No sessions yet
            </span>
          }
        >
          <div
            style={{
              padding: '40px 24px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: 14,
            }}
          >
            <p style={{ margin: 0 }}>
              Your first night is on the horizon. Sessions show up here once the cashier console
              (ADR-0027) logs you in for a seat.
            </p>
          </div>
        </SectionCard>

        <SectionCard title="Account">
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
            }}
          >
            <AccountRow label="Email" value={profile.email} href="/profile" />
            <AccountRow
              label="Member since"
              value={new Intl.DateTimeFormat('en-US', {
                month: 'long',
                year: 'numeric',
                timeZone: TZ,
              }).format(new Date(profile.created_at))}
            />
            <AccountRow label="Role" value={profile.role} pill />
            <AccountRow
              label="Privacy &amp; data"
              value="Export · Delete"
              href="/profile/privacy"
            />
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}

// ============================================================
// Local presentational helpers — pure, no client state.
// ============================================================

function PlaceholderCard({
  eyebrow,
  status,
  headline,
  body,
  ctaLabel,
  ctaHref,
  tall,
  mono,
}: {
  eyebrow: string;
  status: string;
  headline: string;
  body: string;
  ctaLabel?: string;
  ctaHref?: string;
  tall?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        background: 'radial-gradient(ellipse at top, #1A1816 0%, #0B0B0B 80%)',
        border: '1px solid var(--border-faint)',
        borderRadius: 'var(--r-lg)',
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        minHeight: tall ? 260 : 200,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 20,
        }}
      >
        <div className="eyebrow" style={{ fontSize: 11 }}>
          {eyebrow}
        </div>
        <span className="pill" style={{ fontSize: 10 }}>
          {status}
        </span>
      </div>
      <div
        className={mono ? '' : 'gold-text'}
        style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: mono ? 56 : 36,
          fontWeight: 600,
          lineHeight: 1.05,
          marginBottom: 12,
          color: mono ? 'var(--text-dim)' : undefined,
        }}
      >
        {headline}
      </div>
      <p
        style={{
          color: 'var(--ivory-300)',
          fontSize: 14,
          lineHeight: 1.6,
          margin: 0,
          flex: 1,
        }}
      >
        {body}
      </p>
      {ctaLabel && ctaHref ? (
        <div style={{ marginTop: 20 }}>
          <Link href={ctaHref} className="btn btn-sm">
            {ctaLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-faint)',
        borderRadius: 'var(--r-md)',
        padding: 20,
      }}
    >
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>
        {label}
      </div>
      <div
        className="gold-text"
        style={{
          fontFamily: 'Cormorant Garamond, serif',
          fontSize: 32,
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function SectionCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-faint)',
        borderRadius: 'var(--r-md)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border-faint)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h3
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 22,
            margin: 0,
            fontWeight: 500,
          }}
        >
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

function AccountRow({
  label,
  value,
  href,
  pill,
}: {
  label: string;
  value: string;
  href?: string;
  pill?: boolean;
}) {
  const valueEl = pill ? (
    <span className="pill" style={{ fontSize: 10 }}>
      {value}
    </span>
  ) : (
    <span style={{ color: 'var(--ivory-200)', fontSize: 13 }}>{value}</span>
  );
  return (
    <li
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '14px 24px',
        borderBottom: '1px solid var(--border-faint)',
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      {href ? (
        <Link href={href} className="gold-text" style={{ fontSize: 13 }}>
          {value} →
        </Link>
      ) : (
        valueEl
      )}
    </li>
  );
}
