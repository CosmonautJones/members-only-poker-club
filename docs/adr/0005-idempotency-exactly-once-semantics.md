# ADR-0005: Idempotency & exactly-once semantics

- **Status:** Accepted
- **Date:** 2026-05-04
- **Slice:** 2 (Stripe webhooks), 3 (cashier redemption)

## Context

Two scenarios make naive "create a payment row when a payment happens" code wrong:

1. **Stripe webhooks fire at-least-once.** The same `payment_intent.succeeded` event can arrive twice (network retry, Stripe redelivery). If we naively credit the time-bank twice, the member gets free time.
2. **Cashiers double-click the "redeem 60 minutes" button.** Two requests fire; the time-bank gets debited twice. The member loses 60 minutes they didn't spend.

The fix is well-known: idempotency keys. Pick a deterministic key per logical operation, store it, refuse the second one.

## Decision

Every server action and webhook handler that mutates money carries an **idempotency key** that uniquely identifies the *intent*, not the *attempt*.

### Stripe webhooks

- `idempotency_key = stripe_event.id`
- Stored on `payments.raw_event->>'id'` and on `time_ledger.idempotency_key` for any ledger row written as a side effect.
- Insertion uses `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING`. If a duplicate event arrives, the insert is a no-op and the handler returns 200 without re-running side effects (SMS, email, downstream writes).

### Cashier redemptions

- The `redeemTimeAction` server action requires the client to send a UUID v4 generated *before* the user clicks the button (e.g., `useId()` in React, or a fresh `crypto.randomUUID()` in a `useState` on form mount).
- Stored on `time_ledger.idempotency_key` with a unique index.
- A retry of the same form post returns the same outcome (`{ success: true, ledger_id: ... }`) without writing again.

### Stripe API calls

- Every Stripe API call we make (PaymentIntent create, Subscription update, etc.) sends `Stripe-Idempotency-Key` header set to a UUID derived from the operation: `sha256(action_name + actor_id + payload_hash)`. Stripe's own idempotency layer prevents duplicate charges.

### Schema

```sql
alter table time_ledger add constraint time_ledger_idempotency_key_unique unique (idempotency_key);
alter table payments     add constraint payments_stripe_event_unique     unique (stripe_object_id, kind);
```

## Consequences

**Positive:**

- A retried webhook can never double-credit.
- A double-clicked redeem button is a no-op the second time.
- Replaying webhooks for backfill (e.g., during DR drill) is safe.

**Negative:**

- Every money-touching action must remember to send a key. Mitigation: `lib/money/withIdempotency<T>(key, fn): Promise<T>` wrapper that throws if `key` is missing; lint rule that grep's for `INSERT INTO (time_ledger|payments)` without an `idempotency_key` column.
- Idempotency-key storage grows unbounded. Acceptable at our scale; Slice 4 adds a 90-day TTL purge job.
- A *truly* malicious actor could replay a webhook with the same `event.id` and a different body (Stripe's signature wouldn't match — but if they bypass signature verification somehow). Mitigation: signature verification is the first thing the handler does; the idempotency check is the second.

## Alternatives considered

- **Optimistic concurrency only** (compare-and-set on a version column). Doesn't help with webhook duplicates because there's no "previous state" to compare to before the first event arrives.
- **At-most-once via 5-minute deduplication window.** Fragile; an event delivered 6 minutes apart double-fires.
- **Stripe's `idempotency_key` only (no DB-side dedup).** Stripe's key works for outgoing API calls but not incoming webhooks.
