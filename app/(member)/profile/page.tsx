/**
 * Member profile — visual scaffold.
 *
 * Server component. The (member) layout provides the portal shell;
 * this page renders the member's identity, contact, and account
 * metadata in the same card vocabulary as the dashboard.
 *
 * The cycle-3 test invariants pin two strings — `profile.email` and
 * `profile.role` — must remain in the source. They live in the
 * Contact + Membership cards below. Editing forms are deferred
 * (ADR-0009 ID verify + later membership slices add real edit flows).
 */

import Link from 'next/link';

import { getCurrentProfile } from '@/lib/auth/getCurrentProfile';

const TZ = 'America/Chicago';

function formatJoinDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  }).format(new Date(iso));
}

function formatDob(iso: string | null): string {
  if (!iso) return '—';
  // DOB comes back as YYYY-MM-DD (DATE column). Parsing as UTC midnight
  // and formatting in club tz is the cleanest way to avoid off-by-one
  // when the user's local tz is east of CST.
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function maskPhone(phone: string | null): string {
  if (!phone) return '—';
  // Show only the last 4 digits, with "•••" prefix. We never want a
  // full phone number visible to a shoulder-surfer on a logged-in
  // session; the canonical edit + verify surface lives in ADR-0025.
  const digits = phone.replace(/\D+/g, '');
  if (digits.length < 4) return '•••';
  return `••• ${digits.slice(-4)}`;
}

export default async function ProfilePage() {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const firstName = profile.full_name.split(/\s+/)[0] ?? profile.full_name;
  const initials = profile.full_name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          marginBottom: 32,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            background: 'var(--gold-grad)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Cormorant Garamond, serif',
            color: '#0B0B0B',
            fontWeight: 600,
            fontSize: 32,
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            Member Profile
          </div>
          <h1
            style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontSize: 44,
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            {profile.full_name}
          </h1>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 14,
              marginTop: 8,
            }}
          >
            Member since {formatJoinDate(profile.created_at)} ·{' '}
            <span className="pill" style={{ fontSize: 10, marginLeft: 4 }}>
              {profile.role}
            </span>
          </p>
        </div>
      </div>

      {/* Two columns: Contact + Membership */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 24,
          marginBottom: 24,
        }}
      >
        <Card title="Contact">
          <DefinitionList>
            <Row
              label="Email"
              value={profile.email}
              hint={
                <span>
                  Sign-in address. Editing email is deferred — contact{' '}
                  <Link href="/contact" className="gold-text">
                    support
                  </Link>{' '}
                  if you need to change it.
                </span>
              }
            />
            <Row
              label="Phone"
              value={maskPhone(profile.phone)}
              hint={
                profile.phone
                  ? 'Last four shown; SMS opt-in lands with the messaging cycle (ADR-0025).'
                  : 'No phone on file yet. SMS sign-in + tournament alerts land in ADR-0025.'
              }
            />
          </DefinitionList>
        </Card>

        <Card title="Membership">
          <DefinitionList>
            <Row
              label="Role"
              value={
                <span
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 13,
                    color: 'var(--gold-300)',
                    textTransform: 'lowercase',
                  }}
                >
                  {profile.role}
                </span>
              }
              hint="Roles unlock surfaces: members see the portal; cashier+ sees the till; manager+ sees admin."
            />
            <Row
              label="Date of birth"
              value={formatDob(profile.dob)}
              hint="Used for the 21+ verification at signup. Never shown to other members."
            />
            <Row
              label="Joined"
              value={formatJoinDate(profile.created_at)}
              hint="Founding-member tier eligibility tracks this date — earlier dates = better seat priority in tournament draws."
            />
          </DefinitionList>
        </Card>
      </div>

      {/* Privacy + actions */}
      <Card title="Privacy &amp; data">
        <div style={{ padding: '20px 24px' }}>
          <p
            style={{
              color: 'var(--ivory-300)',
              fontSize: 14,
              lineHeight: 1.6,
              marginTop: 0,
              marginBottom: 20,
            }}
          >
            Hi {firstName} — under ADR-0023 (GDPR/CCPA), you have full
            control over your data. Export a copy of everything we have on
            you, or anonymize your account permanently. Anonymization
            removes your name, email, and phone from our records and signs
            you out; audit-log rows are retained without personally
            identifying values.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/profile/privacy" className="btn btn-sm">
              Privacy &amp; data settings
            </Link>
            <Link href="/privacy" className="btn btn-sm btn-ghost">
              Read the policy
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// Local presentational helpers — pure, no client state.
// ============================================================

function Card({ title, children }: { title: string; children: React.ReactNode }) {
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
      </div>
      {children}
    </div>
  );
}

function DefinitionList({ children }: { children: React.ReactNode }) {
  return (
    <dl
      style={{
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </dl>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr',
        gap: 16,
        padding: '18px 24px',
        borderBottom: '1px solid var(--border-faint)',
      }}
    >
      <dt
        style={{
          fontSize: 11,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          paddingTop: 4,
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0 }}>
        <div
          style={{
            color: 'var(--ivory-200)',
            fontSize: 15,
            wordBreak: 'break-word',
          }}
        >
          {value}
        </div>
        {hint ? (
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 12,
              lineHeight: 1.5,
              marginTop: 4,
            }}
          >
            {hint}
          </div>
        ) : null}
      </dd>
    </div>
  );
}
