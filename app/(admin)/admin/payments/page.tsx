/**
 * `/admin/payments` — manager+ payments overview (ADR-0036 Slice 1, AC26).
 *
 * Server component. Renders three operational cards that surface the
 * health of the (Slice-2-pending) Stripe integration:
 *   1. **Recent payments** — count of `payments` rows created in the
 *      last 14 days. Click → `/admin/payments/refunds` (Slice 2 list).
 *   2. **Webhook health** — count of `stripe_webhook_events` rows
 *      with `processed_at IS NULL`. Click → `/admin/payments/webhooks`
 *      (Slice 2 — 404s gracefully via Next.js's default not-found in
 *      Slice 1).
 *   3. **Open disputes** — count of `disputes` rows with status NOT IN
 *      ('closed', 'won', 'lost'). Click is a no-op anchor (disputes-list
 *      page is post-v1 per ADR-0027 §open-questions).
 *
 * Empty-state copy is LOAD-BEARING — RTL tests grep for the literal
 * strings. Do not paraphrase.
 *
 * Defense-in-depth per AC5 (ADR-0035): the FIRST body statement of this
 * exported function is `await requireRole('manager')`, independently of
 * the layout's gate. Enforced by both the cross-cutting walker
 * (`tests/auth/admin-routes-defense-in-depth.test.ts`) and a payment-
 * specific source-grep (`tests/admin/payments/overview-route-gating.test.tsx`).
 *
 * Visual primitive mirrors `app/(admin)/admin/page.tsx` — Cormorant
 * Garamond numbers, ink-850 card backgrounds, eyebrow-styled labels —
 * so the payments console reads as a sibling of the main dashboard
 * rather than a foreign surface.
 *
 * Why `force-dynamic` (no SSG):
 *   - Webhook-health count drives the kill-switch posture; staleness
 *     defeats the operational purpose.
 *   - The admin dashboard surface assumes manager+ identity per
 *     request; SSG'd HTML cannot encode that.
 *   - No `unstable_cache` wrapper here (unlike the admin dashboard at
 *     AC7): the dashboard's `revalidateTag('admin-dashboard-counts')`
 *     invalidation seam is owned by mutation actions, none of which
 *     ship in Slice 1. A future cycle may add the cache+tag pattern
 *     once webhook handlers (Slice 2) wire in revalidate calls.
 *
 * Graceful degradation: if any of the three count queries returns an
 * error, the affected card falls back to count=0 and renders the empty-
 * state copy. The Slice-1 schema is shipped (t1, t3) so the queries
 * should always succeed, but a future schema-absent rollback would
 * otherwise crash the page — empty-state is the safer fallback.
 *
 * Premortem alignment (R1, admin-client misuse): queries use the
 * cookie-scoped `createClient()` (RLS evaluates against the caller's
 * role). The page never reaches for the service-role admin client —
 * managers see the same operational counts the database itself
 * computes under their identity, no privileged superset.
 */

import Link from 'next/link';

import { requireRole } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';
import { nowUtc } from '@/lib/time/now';

export const dynamic = 'force-dynamic';

// ---- Constants -------------------------------------------------------------

// Recent-payments window in days. ADR-0036 §Information architecture
// pins 14 days as the operational lookback for the dashboard tile —
// long enough to span the Stripe payout cadence (weekly), short enough
// to keep the count tightly scoped to "stuff that happened recently".
const RECENT_PAYMENTS_WINDOW_DAYS = 14;

// Dispute statuses that count as "open". Anything NOT in this list is
// either resolved (closed/won/lost) or in an ephemeral Stripe state
// that we don't need to surface as actionable. The list is pinned
// here (vs. inlined in the query) so a future ADR amendment that
// adds, e.g., 'needs_response' to the open set can be patched in one
// place.
const DISPUTE_CLOSED_STATUSES = ['closed', 'won', 'lost'] as const;

// ---- Count fetchers --------------------------------------------------------
//
// Each fetcher returns a `Promise<number>` and gracefully degrades to 0
// on error. Errors here are non-fatal: the empty-state copy still
// renders, and the page never breaks the admin shell for a downstream
// table outage. Real-world errors should not occur post-t4 (the
// schema migration ships in Slice 1), but the fallback is defensive.
//
// IMPLEMENTATION NOTE: the inner queries intentionally use `.then()`
// rather than `await` so the FIRST `await` token in this entire source
// file is the `requireRole('manager')` call inside the exported page
// function — the AC5 defense-in-depth regex fallback in
// `tests/auth/admin-routes-defense-in-depth.test.ts` (and its mirror in
// `tests/admin/payments/overview-route-gating.test.tsx`) walks the file
// source (not just the exported function) for the first `await`. The
// regex check requires that token to be followed by `requireRole(`
// within 40 chars. Switching to `await` here would shadow the page's
// first-await invariant even though semantics would be identical.

function getRecentPaymentCount(): Promise<number> {
  const supabase = createClient();
  // ADR-0034: `nowUtc()` is the sole sanctioned current-instant primitive.
  // We derive the lookback cutoff by subtracting from its epoch ms and
  // letting the resulting `Date` ISO-stringify — no `new Date()` /
  // `Date.now()` call at this site, per the `no-restricted-syntax` rule.
  const cutoffInstant = nowUtc();
  cutoffInstant.setTime(
    cutoffInstant.getTime() - RECENT_PAYMENTS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const cutoff = cutoffInstant.toISOString();
  return Promise.resolve(
    supabase
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', cutoff),
  ).then(({ count, error }) => (error ? 0 : (count ?? 0)));
}

function getUnprocessedWebhookCount(): Promise<number> {
  const supabase = createClient();
  return Promise.resolve(
    supabase
      .from('stripe_webhook_events')
      .select('event_id', { count: 'exact', head: true })
      .is('processed_at', null),
  ).then(({ count, error }) => (error ? 0 : (count ?? 0)));
}

function getOpenDisputeCount(): Promise<number> {
  const supabase = createClient();
  // Postgrest filter: NOT IN (closed, won, lost). The `.not('status',
  // 'in', '(closed,won,lost)')` shape is Postgrest's canonical NOT-IN
  // syntax. Tests mock the fluent chain agnostically so this passes
  // both shape variants.
  return Promise.resolve(
    supabase
      .from('disputes')
      .select('stripe_dispute_id', { count: 'exact', head: true })
      .not('status', 'in', `(${DISPUTE_CLOSED_STATUSES.join(',')})`),
  ).then(({ count, error }) => (error ? 0 : (count ?? 0)));
}

// ---- Card primitives -------------------------------------------------------
//
// Two flavors mirror the admin dashboard:
//   - `LinkCard` for the two cards that navigate (Recent payments,
//     Webhook health) — uses `next/link`'s anchor wrapper so the count
//     becomes the link's accessible name (`aria-label`).
//   - `NoOpCard` for the disputes card — renders as a non-anchor
//     container so a click does nothing (the disputes-list surface is
//     post-v1 per ADR-0027 §open-questions). The count still gets a
//     stable `data-testid` for the RTL count assertion.
//
// Both flavors render the same empty-state copy when count === 0.

type CardCopy = {
  label: string;
  emptyState: string;
};

// LOAD-BEARING LITERALS — RTL tests grep these strings.
// Per the spec, the dispatch envelope shows `**bold**` markdown markers
// for the lead clause ("No payments yet."); the rendered output is the
// plain-text form so the assertions live on a single contiguous text
// node and a future cycle can swap in a markdown renderer without
// touching this file. See
// docs/specs/0036-payment-management-console-implementation.md AC26.
//
// If you change the rendered text, update:
//   tests/admin/payments/overview-page.test.tsx
// and treat the change as an API break (announce in CHANGELOG-Sx).

const RECENT_PAYMENTS_COPY: CardCopy = {
  label: 'Recent payments',
  emptyState:
    'No payments yet. The first payment will arrive once Stripe webhooks are wired (Slice 2).',
};

const WEBHOOK_HEALTH_COPY: CardCopy = {
  label: 'Webhook health',
  emptyState: 'No webhook events received. Webhook handler ships in Slice 2.',
};

const OPEN_DISPUTES_COPY: CardCopy = {
  label: 'Open disputes',
  emptyState:
    'No open disputes. Disputes flow in via the charge.dispute.created webhook (Slice 2).',
};

function cardSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const CARD_BASE_STYLE: React.CSSProperties = {
  display: 'block',
  padding: '24px 28px',
  borderRadius: 8,
  border: '1px solid var(--border-faint)',
  background: 'var(--ink-850)',
  color: 'var(--ivory-200)',
  textDecoration: 'none',
  transition: 'border-color 120ms ease, transform 120ms ease',
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 12,
};

const COUNT_STYLE: React.CSSProperties = {
  fontFamily: 'Cormorant Garamond, serif',
  fontSize: 56,
  fontWeight: 500,
  lineHeight: 1,
  marginBottom: 8,
  color: 'var(--ivory-100, var(--ivory-200))',
};

const DESCRIPTION_STYLE: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--ivory-300)',
  lineHeight: 1.5,
};

type LinkCardProps = {
  href: string;
  copy: CardCopy;
  count: number;
};

function LinkCard({ href, copy, count }: LinkCardProps) {
  const slug = cardSlug(copy.label);
  return (
    <Link href={href} role="link" aria-label={`${copy.label}: ${count}`} style={CARD_BASE_STYLE}>
      <div style={LABEL_STYLE}>{copy.label}</div>
      <div style={COUNT_STYLE} data-testid={`card-count-${slug}`}>
        {count}
      </div>
      <div style={DESCRIPTION_STYLE}>{count === 0 ? copy.emptyState : null}</div>
    </Link>
  );
}

type NoOpCardProps = {
  copy: CardCopy;
  count: number;
};

function NoOpCard({ copy, count }: NoOpCardProps) {
  const slug = cardSlug(copy.label);
  return (
    <div
      aria-label={`${copy.label}: ${count}`}
      style={{ ...CARD_BASE_STYLE, cursor: 'default' }}
      data-testid={`card-${slug}`}
    >
      <div style={LABEL_STYLE}>{copy.label}</div>
      <div style={COUNT_STYLE} data-testid={`card-count-${slug}`}>
        {count}
      </div>
      <div style={DESCRIPTION_STYLE}>{count === 0 ? copy.emptyState : null}</div>
    </div>
  );
}

// ---- Page ------------------------------------------------------------------

export default async function PaymentsOverviewPage() {
  // AC5 defense-in-depth: FIRST body statement is requireRole('manager').
  // The (admin) layout already gated, but the page asserts independently
  // so a future refactor that detaches this route from the (admin) group
  // is caught by `tests/auth/admin-routes-defense-in-depth.test.ts` AND
  // by the payment-specific source-grep in
  // `tests/admin/payments/overview-route-gating.test.tsx`.
  const { profile } = await requireRole('manager');

  // Fetch counts in parallel. Each fetcher gracefully degrades to 0
  // on error so the page render never breaks for a downstream outage.
  const [recentPayments, unprocessedWebhooks, openDisputes] = await Promise.all([
    getRecentPaymentCount(),
    getUnprocessedWebhookCount(),
    getOpenDisputeCount(),
  ]);

  return (
    <section
      aria-label="Payments overview"
      style={{
        maxWidth: 1120,
        margin: '0 auto',
        color: 'var(--ivory-200)',
      }}
    >
      <header style={{ marginBottom: 32 }}>
        <div
          className="eyebrow"
          style={{
            fontSize: 11,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 12,
          }}
        >
          Admin Console
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
          Payments
        </h1>
        <p style={{ color: 'var(--ivory-300)', fontSize: 15, lineHeight: 1.65 }}>
          Signed in as {profile.role}. Slice 1 — Stripe webhooks land in Slice 2; the refund-flow
          form is fail-loud until then.
        </p>
      </header>

      <div
        aria-label="Payments operational counts"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 16,
          marginBottom: 40,
        }}
      >
        <LinkCard
          href="/admin/payments/refunds"
          copy={RECENT_PAYMENTS_COPY}
          count={recentPayments}
        />
        <LinkCard
          href="/admin/payments/webhooks"
          copy={WEBHOOK_HEALTH_COPY}
          count={unprocessedWebhooks}
        />
        <NoOpCard copy={OPEN_DISPUTES_COPY} count={openDisputes} />
      </div>
    </section>
  );
}
