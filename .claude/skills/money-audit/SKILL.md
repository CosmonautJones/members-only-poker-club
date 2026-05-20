---
name: money-audit
description: Use when writing or reviewing code that touches money — payments tables, refunds, time-bank ledgers, balance calculations, currency handling, Stripe webhook handlers, cents arithmetic, or anything that mutates `payments`/`memberships`/`time_wallets`/`time_ledger`/`refund_requests`. Critical for spec-writers, schema authors, and code reviewers; auto-loads to prevent money-bug classes that don't show up in typecheck or lint.
---

# money-audit — money-handling discipline

This skill loads whenever code touches money. The class of bugs this catches is invisible to typecheck and lint — they show up as off-by-one cents in production, lost refunds, or silent constraint drift.

## Headline rules

1. **All amounts are integer cents.** Never floats. Never minor-unit-aware libraries. The column type is `bigint` (for balances that can grow large) or `integer` (for single-transaction amounts). NEVER `numeric(n, 2)` — that opens a float-precision can of worms.
2. **USD-only is structural, not a default.** Every currency-bearing table ships BOTH a column DEFAULT `'usd'` AND a row-level `CHECK (currency = 'usd')` constraint. The CHECK is the load-bearing enforcement.
3. **Balance columns are GENERATED ALWAYS AS ... STORED, never trigger-maintained.** Direct UPDATEs raise "column ... can only be updated to DEFAULT" — manual sync drift is structurally impossible.
4. **Rate constants pin in SQL, not imported from TS.** The migration cannot depend on application-layer constants — premortem R11. Rate changes require coordinated migration + lib edit + shape-test update.
5. **Idempotency keys are UNIQUE partial indexes WHERE NOT NULL** so the webhook path (which writes via `stripe_event_id`) and the API path (which writes via `idempotency_key`) don't collide.
6. **Every money row has audit-trail attribution.** Either `idempotency_key IS NOT NULL` (API-initiated) OR `stripe_event_id IS NOT NULL` (webhook-initiated). CHECK constraint enforces this.
7. **Append-only ledgers have no UPDATE/DELETE trigger paths.** The `time_ledger` trigger fires on AFTER INSERT only — no UPDATE/DELETE variant. Shape test grep'd to catch drift.
8. **Refund amounts are strictly positive.** `CHECK (amount_cents > 0)`, not `>= 0`. Negative-asserts pin this.

## Shape-test patterns that catch drift

When writing the paired shape test for a money migration, include grep negative-asserts:

```ts
// 'usd' is a CHECK, not an IN
expect(sql).not.toMatch(/currency\s+IN\s*\(/i);

// time_ledger is append-only — no UPDATE/DELETE trigger paths
expect(sql).not.toMatch(/UPDATE\s+time_ledger/i);
expect(sql).not.toMatch(/DELETE\s+FROM\s+time_ledger/i);

// balance_cents must be GENERATED, not trigger-maintained
expect(sql).toMatch(/balance_cents\s+bigint\s+GENERATED\s+ALWAYS/i);

// refund amount is strict positive
expect(sql).toMatch(/amount_cents\s+integer.*CHECK.*amount_cents\s*>\s*0/i);
expect(sql).not.toMatch(/amount_cents\s*>=\s*0/i);
```

## GENERATED column probe before committing

If the substrate (pglite) might not support a Postgres feature, write a throwaway probe migration BEFORE committing the choice. ADR-0036 t2 ran a probe to confirm pglite 0.4.5 accepts `GENERATED ALWAYS AS ... STORED` before the t2 migration committed. The fallback (BEFORE INSERT/UPDATE trigger maintaining the column) is documented in the plan but NOT shipped — the GENERATED path is structurally safer.

## Webhook + API idempotency

The same money table receives writes from two sources:

- **API path:** `idempotency_key` UUID generated client-side, dedup at action-layer.
- **Webhook path:** `stripe_event_id` from the Stripe-issued event, dedup at webhook-handler.

Both keys must be unique. Use partial UNIQUE indexes:

```sql
CREATE UNIQUE INDEX payments_idempotency_key_unique
  ON payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX payments_stripe_event_id_unique
  ON payments (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;
```

The CHECK that one-or-the-other is non-NULL closes the audit-trail gap:

```sql
CONSTRAINT payments_idem_or_audit_trail CHECK (
  idempotency_key IS NOT NULL OR stripe_event_id IS NOT NULL
)
```

## The fail-loud refund pattern

Refund actions should:
1. Compute the refund amount in cents.
2. Validate against the original payment row.
3. Write the `refund_requests` row FIRST (audit-trail before action).
4. Call `stripe.refunds.create()` AFTER the audit-trail commits.
5. If Stripe is not configured (no live key), `assertStripeConfigured()` throws `StripeNotConfiguredError` AFTER step 3 — so the manager-facing surface is wired end-to-end and the refund attempt is auditable even when Stripe is blocked.

This is the ADR-0036 fail-loud posture. Don't invert the order — audit-trail-before-action is non-negotiable.

## Authority matrix lives in lib, NOT in RLS

Refund and money-altering operations are gated by the authority matrix in `lib/payments/authority.ts`, not by RLS policies. RLS protects READ access; the authority matrix protects WRITE intent. COMMENT ON TABLE pins this so future reviewers don't try to add WRITE policies to enforce manager-only refunds.

## Cited evidence

- ADR-0004 USD-only — currency CHECK is structural, not default
- ADR-0036 Slice 1 premortem R1 — `IN (...)` widening would silently break the invariant
- ADR-0036 Slice 1 premortem R11 — SQL rate constant prevents app-layer/migration desync
- ADR-0036 Slice 1 premortem R2 — append-only invariant on time_ledger
- ADR-0036 Slice 1 t2 — pglite 0.4.5 probe before committing GENERATED choice
- ADR-0036 Slice 1 — fail-loud refund + audit-before-action pattern
