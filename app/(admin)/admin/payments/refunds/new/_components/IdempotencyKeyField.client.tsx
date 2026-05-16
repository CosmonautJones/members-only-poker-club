'use client';

/**
 * `IdempotencyKeyField` — Slice-1 client sub-tree that mints + persists
 * the form-mount UUID v4 that the t9 server action consumes as the
 * idempotency anchor for Slice 2's `refund_requests.idempotency_key`
 * unique constraint (ADR-0005 §cashier-redemption pattern).
 *
 * ## Why sessionStorage instead of `useState(() => crypto.randomUUID())`
 *
 * Synthesis decision D3 + fail-loud premortem R8 (binding):
 *
 *   `useState(() => crypto.randomUUID())` re-runs its initializer on
 *   StrictMode mount→unmount→mount and on any navigation that remounts
 *   the form. The second mount produces a DIFFERENT UUID. Once Slice 2
 *   wires the real Stripe call, a manager who hits a transient 503 and
 *   retries the form (legitimate intent) would carry a fresh
 *   `idempotency_key` on the second submit — Stripe accepts both calls
 *   as distinct contexts, the customer is double-refunded. The
 *   database-layer `refund_requests_idempotency_key_unique` constraint
 *   cannot save the day because the two keys differ.
 *
 * Mitigation: persist the UUID in `sessionStorage` keyed by the
 * structural identity of the refund attempt (target payment + amount).
 * Remount of the same form re-reads the same key. The key is naturally
 * scoped to the browser tab via sessionStorage semantics and naturally
 * expires when the tab closes — no GC story needed.
 *
 * ## Storage key shape
 *
 * `refund-${targetPaymentId}-${amountCents}` — composite of the two
 * identifying inputs the user has typed so far. When the user changes
 * either field after the form mounts, the storage key changes too and a
 * fresh UUID is minted. That is the correct behavior: a different
 * (target, amount) pair is a different refund attempt and MUST get its
 * own idempotency anchor.
 *
 * Slice 1 ships the component with empty-string defaults for both
 * inputs — the form is a hidden field with no live target/amount
 * bindings yet. Slice 2 (combobox + remaining-refundable hint) will
 * lift these to state and pass them down as props so the key derives
 * from the live form values. The current contract leaves the prop
 * shape forward-compatible.
 *
 * ## What this file does NOT do
 *
 * - It does NOT call the server action. The hidden input is part of
 *   the parent `<form>` and is submitted as a regular form field via
 *   Next.js's server-action FormData encoding.
 * - It does NOT validate UUID shape — `crypto.randomUUID()` is
 *   guaranteed v4 per the WebCrypto spec, and the Zod schema in
 *   `initiateRefund.ts` re-validates server-side.
 * - It does NOT clear the storage entry on successful submit; Slice 2
 *   will own that lifecycle (clear-on-200 from the action result).
 */

import { useEffect, useState } from 'react';

export interface IdempotencyKeyFieldProps {
  /** Current `targetPaymentId` form value (Slice 1: empty string). */
  targetPaymentId?: string;
  /** Current `amountCents` form value (Slice 1: empty string). */
  amountCents?: string;
}

/**
 * Compose the sessionStorage key for the (target, amount) pair. Pinned
 * here as a pure function so the test fixture and the runtime use the
 * same shape (premortem R8 mitigation — drift requires editing both
 * call sites).
 */
function storageKeyFor(targetPaymentId: string, amountCents: string): string {
  return `refund-${targetPaymentId}-${amountCents}`;
}

export function IdempotencyKeyField({
  targetPaymentId = '',
  amountCents = '',
}: IdempotencyKeyFieldProps): JSX.Element {
  // Initial render: empty string. The actual UUID lands on the first
  // useEffect tick (post-mount, client-side only) so SSR HTML never
  // commits a UUID — preventing hydration mismatch from the
  // non-deterministic `crypto.randomUUID()` call.
  const [key, setKey] = useState<string>('');

  useEffect(() => {
    // sessionStorage is undefined during SSR; this effect only runs
    // client-side per React's useEffect guarantee. Defensive check
    // anyway in case a future renderer (e.g. a static export tool)
    // mocks `useEffect` to run during the build pass.
    if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
      return;
    }

    const sk = storageKeyFor(targetPaymentId, amountCents);
    const existing = window.sessionStorage.getItem(sk);
    if (existing !== null && existing !== '') {
      setKey(existing);
      return;
    }

    // No persisted key for this (target, amount) — mint + store.
    // `crypto.randomUUID()` is available on `window.crypto` in all
    // modern browsers + happy-dom; no polyfill needed for Slice 1.
    const fresh = window.crypto.randomUUID();
    window.sessionStorage.setItem(sk, fresh);
    setKey(fresh);
  }, [targetPaymentId, amountCents]);

  // The hidden input always renders; its `value` flips from '' to the
  // UUID once the post-mount effect runs. React will rehydrate the
  // value attribute cleanly because the SSR markup never had a UUID
  // baked in.
  return <input type="hidden" name="idempotencyKey" value={key} readOnly />;
}

export default IdempotencyKeyField;
