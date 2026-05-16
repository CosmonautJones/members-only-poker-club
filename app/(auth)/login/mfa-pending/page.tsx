/**
 * `/login/mfa-pending` — static fallback for ADR-0035 AC4 / Open Q 7.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TODO(adr-0002-cycle-4): when MFA actually ships, convert this page to
 * HTTP 410 Gone (or redirect to `/login/mfa-challenge`). The
 * `MFA_CHALLENGE_READY` constant in `lib/auth/mfa-availability.ts` flips
 * to `true` in the same diff. Leaving this page live AFTER MFA ships
 * trains staff to call the owner on its sight when the actual remedy is
 * "complete MFA enrollment yourself" — premortem R13. See ADR-0035 Open
 * Question 7.
 * ════════════════════════════════════════════════════════════════════════
 *
 * Rendered when `requireRole('manager' | 'owner')` detects an aal1
 * session AND `MFA_CHALLENGE_READY === false`. The page tells the user:
 *
 *   1. MFA enrollment is required for admin surfaces.
 *   2. Their email + current role (so they can confirm they're signed
 *      in as the right account before the owner approves them — R13
 *      mitigation: never leave the actor guessing whose session got
 *      blocked).
 *   3. Contact the club owner to proceed (no self-serve enrollment yet).
 *
 * Server component — no `'use client'`. The actor's email + role come
 * from `getCurrentProfile()` (cookie-scoped Supabase client; RLS
 * scopes the row). Audit emission: every hit fires the
 * `admin.session.mfa_pending_blocked` audit event via a one-off
 * `audit_log` INSERT through the cookie-scoped client (RLS-scoped).
 * Failure to write the audit row does NOT block the render — the page
 * is a graceful fallback and the actor must still see the explanation.
 *
 * See `app/(auth)/layout.tsx` for the shared brand chrome.
 */

import 'server-only';

import { getCurrentProfile } from '@/lib/auth/getCurrentProfile';
import { createClient } from '@/lib/supabase/server';

export const metadata = {
  title: 'MFA Enrollment Required',
  description:
    'Multi-factor authentication is required to access admin surfaces. Please contact the club owner to proceed.',
};

// Force dynamic rendering — the page reads cookies/session and writes
// an audit row on every hit. Static generation would serve a stale
// "you are signed in as X" string and skip the audit emission, both of
// which defeat the page's purpose.
export const dynamic = 'force-dynamic';

async function emitMfaPendingBlockedAudit(actorId: string): Promise<void> {
  // Best-effort audit emission. The render must succeed even when this
  // INSERT fails — the page is a fallback, not a critical mutation
  // path. We swallow errors here ON PURPOSE (the only place in this
  // codebase that does so for audit rows) because:
  //   1. The redirect into this page is itself a forensic event already
  //      captured server-side by Next's request log;
  //   2. Failing the render would leave the actor on a 500 page with no
  //      explanation of WHY they're being blocked — that's worse than a
  //      missed audit row;
  //   3. t17 will replace this best-effort path with the proper
  //      `withAudit` wiring once the helper has a cookie-scoped tx
  //      shim.
  try {
    const supabase = createClient();
    // Cookie-scoped client → RLS evaluates against the actor's
    // session, so the row is attributed to them (actor_id = auth.uid()).
    // We rely on the audit_log INSERT policy from migration 0003 — the
    // user can write a row about themselves; manager+ reads it via the
    // admin audit-log surface (AC19 / AC20).
    await supabase.from('audit_log').insert({
      actor_id: actorId,
      action: 'admin.session.mfa_pending_blocked',
      target_type: 'profile',
      target_id: actorId,
      before: null,
      after: { reason: 'aal1_session_blocked_pending_mfa' },
    });
  } catch {
    // Intentional swallow — see contract above. Do NOT add logging
    // here that could leak the actor's id into a marketing-bundle
    // log sink; the render itself is the visible signal.
  }
}

function roleLabel(role: string): string {
  // Capitalize for display (the role_t enum stores lowercase values).
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export default async function MfaPendingPage() {
  const profile = await getCurrentProfile();

  // Emit the audit event on every hit (R13 mitigation). If no profile
  // (session lapsed between requireRole's check and this render),
  // skip emission — the row would have actor_id=NULL and the audit
  // log treats NULL as 'system', which is misleading here.
  if (profile) {
    await emitMfaPendingBlockedAudit(profile.id);
  }

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '0 auto',
        padding: '80px 40px 120px',
        textAlign: 'left',
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Access Restricted
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 48,
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: '-0.015em',
            marginBottom: 16,
          }}
        >
          MFA enrollment required
        </h1>
        <p
          style={{
            color: 'var(--ivory-300)',
            fontSize: 15,
            lineHeight: 1.65,
          }}
        >
          The administrative consoles require multi-factor authentication.
          Your account is signed in but has not yet enrolled a second
          factor, so this surface is blocked.
        </p>
      </header>

      {profile ? (
        <section
          aria-label="Signed-in account"
          style={{
            padding: '20px 24px',
            border: '1px solid var(--border-faint)',
            borderRadius: 6,
            background: 'rgba(255, 255, 255, 0.02)',
            marginBottom: 32,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 8,
            }}
          >
            Signed in as
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--ivory-100)',
                wordBreak: 'break-all',
              }}
            >
              {profile.email}
            </div>
            <span
              role="status"
              aria-label={`Current role: ${roleLabel(profile.role)}`}
              style={{
                fontSize: 11,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid var(--border-faint)',
                color: 'var(--ivory-200)',
              }}
            >
              {roleLabel(profile.role)}
            </span>
          </div>
        </section>
      ) : null}

      <p
        style={{
          color: 'var(--ivory-400)',
          fontSize: 14,
          lineHeight: 1.7,
        }}
      >
        Please contact the club owner to proceed.
      </p>
    </div>
  );
}
