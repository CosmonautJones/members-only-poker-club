/**
 * `/admin/payments/refunds/new` — the manager+-gated refund-initiation
 * form (ADR-0036 Slice 1, spec AC28).
 *
 * Server Component. The first body statement is
 * `await requireRole('manager');` (ADR-0035 AC5 defense-in-depth — also
 * walked by `tests/auth/admin-routes-defense-in-depth.test.ts`).
 *
 * ## Slice 1 posture
 *
 * Every submit hits the t9 server action `initiateRefund` which
 * fail-louds with `StripeNotConfiguredError`. The page renders the
 * minimal form contract NOW so Slice 2 (Stripe activation) can swap
 * the action body without a UI rewrite:
 *
 *   - `targetPaymentId`  — text input (Slice 2 → lookup combobox).
 *   - `amountCents`      — number input (Slice 2 → "remaining
 *                          refundable" hint per ADR-0036 §Edge cases).
 *   - `reason`           — select with the five ADR-pinned values:
 *                          `duplicate`, `fraudulent`,
 *                          `requested_by_customer`, `goodwill`, `other`.
 *   - `refundType`       — radio group: `time_bank`,
 *                          `membership_current`, `membership_previous`.
 *   - `idempotencyKey`   — hidden, populated by `IdempotencyKeyField`
 *                          (client sub-tree, `sessionStorage`-backed
 *                          per synthesis D3 + fail-loud premortem R8).
 *
 * ## PCI-scope reaffirmation (ADR-0022)
 *
 * Card data is never collected on this form. The member is the
 * card-bearer and refunds go to the original payment method via
 * Stripe's refund API in Slice 2. A future contributor adding a
 * "last-4" hint or any card-touching UX must amend ADR-0022 first.
 *
 * ## Error boundary
 *
 * `app/(admin)/admin/payments/refunds/new/error.tsx` catches the
 * `StripeNotConfiguredError` from the server action and renders
 * `error.userMessage` (NEVER `error.message` — premortem R4 binding).
 * Other error types (`InsufficientRoleError`,
 * `InsufficientAuthorityError`, `BadRequest`) propagate to the parent
 * segment boundary at `app/(admin)/admin/error.tsx`.
 *
 * @see docs/specs/0036-payment-management-console-implementation.md AC28
 * @see .conductor/36/premortem-synthesis.md §t11 + D3
 * @see .conductor/36/returns/0007-premortem-fail-loud.md risk 4, 8
 */

import { requireRole } from '@/lib/auth/requireRole';
import {
  initiateRefund,
  type RefundReason,
} from '@/app/(admin)/admin/payments/refunds/new/_actions/initiateRefund';
import type { RefundType } from '@/lib/payments/authority';
import { IdempotencyKeyField } from './_components/IdempotencyKeyField.client';

// The page reads no DB state in Slice 1 (the form is a pure shell);
// `force-dynamic` is set so a future contributor adding a "remaining
// refundable" lookup doesn't accidentally inherit a build-time prerender.
export const dynamic = 'force-dynamic';

// `submitRefundForm` is declared BELOW the default export (see bottom
// of file). The function-declaration hoisting makes the reference
// resolve in `<form action={submitRefundForm}>` without a forward-decl
// snag. This ordering is LOAD-BEARING — the defense-in-depth walker at
// `tests/auth/admin-routes-defense-in-depth.test.ts` scans for the
// FIRST `await` token in source order and requires it to be the
// `await requireRole('manager')` inside the page. Mirrors the same
// adapter-below-action pattern in `_actions/initiateRefund.ts`.

export default async function RefundNewPage(): Promise<JSX.Element> {
  // ADR-0035 AC5: FIRST awaited statement.
  await requireRole('manager');

  return (
    <section
      aria-label="Initiate refund"
      style={{ maxWidth: 720, margin: '0 auto', color: 'var(--ivory-200)' }}
    >
      <header style={{ marginBottom: 24 }}>
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
          Admin Console — Payments
        </div>
        <h1
          style={{
            fontFamily: 'Cormorant Garamond, serif',
            fontSize: 40,
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: '-0.015em',
            margin: 0,
          }}
        >
          Initiate refund
        </h1>
        <p style={{ color: 'var(--ivory-300)', fontSize: 14, lineHeight: 1.65, marginTop: 8 }}>
          Card data is never collected on this form. The member is the card-bearer; refunds go to
          the original payment method.
        </p>
      </header>

      <form
        action={submitRefundForm}
        style={{
          display: 'grid',
          gap: 20,
          padding: 24,
          background: 'var(--ink-850)',
          border: '1px solid var(--border-faint)',
          borderRadius: 8,
        }}
      >
        {/* targetPaymentId — Slice 2 swaps for a server-side lookup combobox */}
        <div style={{ display: 'grid', gap: 6 }}>
          <label htmlFor="targetPaymentId" style={labelStyle}>
            Target payment ID
          </label>
          <input
            id="targetPaymentId"
            name="targetPaymentId"
            type="text"
            required
            autoComplete="off"
            aria-describedby="targetPaymentId-hint"
            style={inputStyle}
          />
          <span id="targetPaymentId-hint" style={hintStyle}>
            Internal `payments.id` (bigint). Slice 2 replaces this with a combobox lookup.
          </span>
        </div>

        {/* amountCents */}
        <div style={{ display: 'grid', gap: 6 }}>
          <label htmlFor="amountCents" style={labelStyle}>
            Amount (cents)
          </label>
          <input
            id="amountCents"
            name="amountCents"
            type="number"
            min={1}
            step={1}
            required
            aria-describedby="amountCents-hint"
            style={inputStyle}
          />
          <span id="amountCents-hint" style={hintStyle}>
            Integer cents (USD). $25.00 = 2500. Slice 2 will display a remaining-refundable hint.
          </span>
        </div>

        {/* reason */}
        <div style={{ display: 'grid', gap: 6 }}>
          <label htmlFor="reason" style={labelStyle}>
            Reason
          </label>
          <select id="reason" name="reason" required defaultValue="" style={inputStyle}>
            <option value="" disabled>
              Select a reason…
            </option>
            <option value="duplicate">duplicate</option>
            <option value="fraudulent">fraudulent</option>
            <option value="requested_by_customer">requested_by_customer</option>
            <option value="goodwill">goodwill</option>
            <option value="other">other</option>
          </select>
        </div>

        {/* refundType radio group */}
        <fieldset style={{ display: 'grid', gap: 8, border: 0, padding: 0, margin: 0 }}>
          <legend style={labelStyle}>Refund type</legend>
          <label style={radioLabelStyle}>
            <input type="radio" name="refundType" value="time_bank" defaultChecked />
            <span>time_bank — credit hours back to the member&apos;s time bank</span>
          </label>
          <label style={radioLabelStyle}>
            <input type="radio" name="refundType" value="membership_current" />
            <span>membership_current — refund the current membership period</span>
          </label>
          <label style={radioLabelStyle}>
            <input type="radio" name="refundType" value="membership_previous" />
            <span>membership_previous — refund a previous membership period (owner-only)</span>
          </label>
        </fieldset>

        {/* Hidden idempotency-key — sessionStorage-backed (D3) */}
        <IdempotencyKeyField />

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            type="submit"
            className="btn"
            style={{
              padding: '12px 22px',
              border: '1px solid var(--border-faint)',
              background: 'rgba(201, 162, 74, 0.08)',
              color: 'var(--ivory-100)',
              fontSize: 12,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            Initiate refund
          </button>
        </div>
      </form>
    </section>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontWeight: 500,
};

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  background: 'var(--ink-900)',
  border: '1px solid var(--border-faint)',
  borderRadius: 4,
  color: 'var(--ivory-200)',
  fontSize: 14,
  fontFamily: 'inherit',
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ivory-400)',
  lineHeight: 1.5,
};

const radioLabelStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'baseline',
  fontSize: 13,
  color: 'var(--ivory-300)',
  cursor: 'pointer',
};

/**
 * FormData → InitiateRefundParams adapter (inline server action).
 *
 * Declared AFTER the page's default export (function-declaration
 * hoisting keeps the `<form action={submitRefundForm}>` reference
 * resolved). The ordering matters for the
 * `tests/auth/admin-routes-defense-in-depth.test.ts` walker, which
 * scans for the FIRST `await` token in source order — it must be the
 * `await requireRole('manager')` inside `RefundNewPage`, NOT this
 * adapter's `await initiateRefund(...)`. Mirrors the
 * `_actions/initiateRefund.ts` adapter-below-action pattern.
 *
 * ## Responsibilities
 *
 * `<form action={fn}>` in Next.js App Router invokes `fn(formData)`
 * with a raw `FormData`. The t9 server action takes a typed params
 * object (cleaner Slice-2 test-injection shape — see
 * `initiateRefund.ts` JSDoc). This wrapper performs ONE concern only —
 * translate `FormData` field names to the typed shape — and propagates
 * the action's typed errors so the segment error boundary catches
 * `StripeNotConfiguredError` unchanged.
 *
 * ## Server-action packaging
 *
 * The wrapper carries the `'use server'` directive so Next.js packages
 * it as a server action. The page module itself is a Server Component
 * (no top-of-file `'use server'`), so co-locating the wrapper here is
 * the canonical Next.js pattern for "form-specific FormData decoder."
 *
 * ## Type narrowing
 *
 * Minimal — the t9 action's Zod schema re-validates server-side. We
 * DO NOT pre-parse `amountCents` to `number` here in a way that
 * short-circuits the action's `BadRequest` path; `NaN` propagates so
 * Zod's `.finite()` refinement surfaces the malformed-input case.
 *
 * @internal only consumed by the `<form action={...}>` prop above.
 */
async function submitRefundForm(formData: FormData): Promise<void> {
  'use server';

  // `FormData.get()` returns `string | File | null`. Every input in
  // this form is a text-like control (text, number, select, radio,
  // hidden) so every entry is `string | null`. The typed helper below
  // collapses File + null to empty string — the t9 action's Zod
  // schema then surfaces empty-string inputs as BadRequest, which is
  // the correct Slice-1 failure mode.
  const str = (key: string): string => {
    const v = formData.get(key);
    return typeof v === 'string' ? v : '';
  };

  const amountRaw = str('amountCents');
  const amountCents = amountRaw === '' ? Number.NaN : Number(amountRaw);

  await initiateRefund({
    targetPaymentId: str('targetPaymentId'),
    amountCents,
    reason: str('reason') as RefundReason,
    refundType: str('refundType') as RefundType,
    idempotencyKey: str('idempotencyKey'),
    // `reasonNote` is reserved for Slice 2 — no UI input yet, so omit.
  });
}
