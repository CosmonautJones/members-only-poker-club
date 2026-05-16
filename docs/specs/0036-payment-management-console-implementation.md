---
adr: 0036
slice: 1
risk: high
acceptance_commands:
  - 'pnpm typecheck'
  - 'pnpm lint'
  - 'pnpm format:check'
  - 'pnpm migrate:check'
  - 'pnpm test'
  - 'pnpm test tests/migrations/payments-shape.test.ts'
  - 'pnpm test tests/migrations/memberships-shape.test.ts'
  - 'pnpm test tests/migrations/time-bank-shape.test.ts'
  - 'pnpm test tests/migrations/refund-requests-shape.test.ts'
  - 'pnpm test tests/migrations/stripe-webhook-events-shape.test.ts'
  - 'pnpm test tests/migrations/disputes-shape.test.ts'
  - 'pnpm test tests/migrations/payments-rls-policies-shape.test.ts'
  - 'pnpm test tests/db/rls-payments.test.ts'
  - 'pnpm test tests/db/rls-memberships.test.ts'
  - 'pnpm test tests/db/rls-time-bank.test.ts'
  - 'pnpm test tests/db/rls-refund-requests.test.ts'
  - 'pnpm test tests/db/rls-stripe-webhook-events.test.ts'
  - 'pnpm test tests/db/rls-disputes.test.ts'
  - 'pnpm test tests/payments/authority.test.ts'
  - 'pnpm test tests/payments/server-actions-stubs.test.ts'
  - 'pnpm test tests/payments/console-availability.test.ts'
  - 'pnpm test tests/admin/payments/'
  - 'pnpm test tests/admin/open-refund-flow-action.test.ts'
  - 'pnpm test tests/admin/member-detail-page.test.tsx'
  - 'pnpm test tests/audit/payments-action-taxonomy.test.ts'
  # - 'pnpm test:e2e payments'   # deferred — CI-only per ADR-0017
---

# Spec: Payment management console — Slice 1 (ADR-0036)

- **ADR:** [0036](../adr/0036-payment-management-console.md)
- **Status:** Draft
- **Date:** 2026-05-16

## Goal

Ship **`/admin/payments`** as a `manager+`-gated console shell plus the
full payment-substrate schema (seven new tables + RLS + 22 audit verb
constants + the authority-matrix guard) — wired to real data through the
existing member-detail page and the already-shipped `openRefundFlow`
breadcrumb — so every downstream slice (webhook handler, refund queue,
manual-adjust form, reconciliation viewer, kill-switch panel) has a
landing place AND every code path that would call Stripe lives behind a
**fail-loud `StripeNotConfiguredError`** that renders "Stripe integration
pending — see ADR-0010" without leaking stack details. **No live Stripe
keys are required to ship this slice; ADR-0010's Stripe account
activation is the external trigger that unblocks Slice 2.**

## Schema column naming

The ADR (§Data model) names the payments / memberships / time_wallets /
time_ledger / refund_requests / disputes member FK column `member_id`.
The existing admin code under `app/(admin)/admin/members/[id]/page.tsx`
queries each of those tables via `.eq('profile_id', profileId)`
(lines 519, 553, 603 of that file as of the dispatch). The existing
`privacy_requests` table (migration `0005`) also uses `profile_id`. The
repo-wide convention — and the convention the RLS helper
`auth.role_at_least` is written against in `0002_profiles_and_roles.sql`
— is `profile_id`.

**Decision:** the spec deviates from the ADR's `member_id` and names
every payment-substrate member FK column **`profile_id`** instead. This:

1. Avoids a parallel three-table modify of the already-shipped
   member-detail page (one of AC9's narrow goals — turn the placeholder
   off without renaming queries) and the four migration files that
   would have to land both names.
2. Matches the in-repo `privacy_requests.profile_id` precedent (cycle 4
   admin console).
3. Keeps RLS policies' `profile_id = auth.uid()` predicate symmetric
   with every other admin-gated table in the repo.

The ADR's prose is treated as the design intent ("member-scoped FK to
`profiles(id)`"); the implementation column name is `profile_id`. A
follow-up ADR amendment will record the deviation; for v1, this spec is
the load-bearing source of truth.

**Trigger / `time_wallets` projection:** ADR-0011 design intent stores
the time-bank balance as **minutes** in `time_wallets.balance_minutes`
(integer-minutes domain). The existing member-detail page reads
`time_wallets.balance_cents` and pipes it through `formatMoney(... as
Cents)` (lines 111, 360, 376, 552 of that file). This slice resolves
the drift by:

1. Migrating `time_wallets` with **both** columns: `balance_minutes
   BIGINT NOT NULL DEFAULT 0` (the canonical ledger projection per
   ADR-0011) AND a derived `balance_cents BIGINT GENERATED ALWAYS AS
   (round((balance_minutes / 60.0) * 1200))::bigint STORED` column
   (using `HOURLY_RATE_CENTS = 1200` from `lib/money/types.ts` as the
   conversion constant). The existing page query continues to work
   unchanged; future consumers MAY use either column.
2. The trigger on `time_ledger` insert recomputes `balance_minutes`
   only; `balance_cents` is a generated column that recomputes
   transparently.

The generated-column choice keeps the admin code's `balance_cents` read
working without touching `app/(admin)/admin/members/[id]/page.tsx` for
the schema migration. AC9 will update that page only for the
placeholder-string change, not for the column rename.

## Acceptance criteria

Numbered, testable. Each AC names the file (or source-grep target) that
verifies it. Style mirrors `docs/specs/0035-admin-operations-console-implementation.md`:
exact file paths, function signatures, error branches, a11y contracts.

### Schema layer (Slice A of the ADR's slice plan, scoped to Slice 1 here)

1. **Migration `supabase/migrations/0008_payments.sql`** exists, follows
   the `NNNN_<snake_case>.sql` naming convention (after the existing
   `0001..0007` migrations), and applies cleanly when fed (after
   migrations `0002..0007`) to a fresh pglite instance via `pg.exec()`.
   Contents (matching ADR-0036 §Data model verbatim except for the
   `member_id → profile_id` deviation pinned above):

   ```sql
   CREATE TABLE payments (
     id                bigserial PRIMARY KEY,
     stripe_object_id  text NOT NULL,
     kind              text NOT NULL,             -- 'membership' | 'time_topup' | 'refund' | 'other'
     profile_id        uuid NOT NULL REFERENCES profiles(id),
     amount_cents      bigint NOT NULL,
     currency          text NOT NULL DEFAULT 'usd',
     status            text NOT NULL,             -- 'succeeded'|'failed'|'pending'|'refunded'|'partially_refunded'
     stripe_event_id   text,
     raw_event         jsonb,
     idempotency_key   text,
     created_at        timestamptz NOT NULL DEFAULT now(),
     updated_at        timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT payments_stripe_object_kind_unique UNIQUE (stripe_object_id, kind),
     CONSTRAINT payments_currency_usd_only CHECK (currency = 'usd')
   );
   CREATE INDEX payments_profile_idx       ON payments (profile_id, created_at DESC);
   CREATE INDEX payments_kind_status_idx   ON payments (kind, status, created_at DESC);
   COMMENT ON TABLE payments IS
     'Local mirror of Stripe payment_intent / charge events. Written ONLY by the webhook handler in Slice 2; read by /admin/payments and member-detail page. ADR-0010 / ADR-0011 / ADR-0036.';
   COMMENT ON COLUMN payments.currency IS
     'USD-only per ADR-0004. CHECK constraint enforces the guard; webhook handler raises SEV2 alert if Stripe ever sends a non-usd charge.';
   ```

   Note the **`payments_currency_usd_only` CHECK constraint** is added
   beyond the ADR's prose — ADR-0004's "USD-only guard" must be a DB
   constraint, not just an alert, because the table's only writer is
   the (future) webhook handler and we want belt-and-suspenders.

   Verified by `pnpm test tests/migrations/payments-shape.test.ts`
   (regex-tier + pg-query-emscripten AST tier mirroring
   `tests/migrations/audit-log-shape.test.ts`).

2. **Migration `supabase/migrations/0009_memberships.sql`** exists and
   applies cleanly. Contents:

   ```sql
   CREATE TABLE memberships (
     profile_id              uuid PRIMARY KEY REFERENCES profiles(id),
     stripe_customer_id      text NOT NULL,
     stripe_subscription_id  text,
     status                  text NOT NULL,             -- mirrors Stripe subscription.status
     collection_method       text NOT NULL DEFAULT 'charge_automatically',
     current_period_start    timestamptz,
     current_period_end      timestamptz,
     past_due_since          timestamptz,
     cancel_at_period_end    boolean NOT NULL DEFAULT false,
     raw_event               jsonb,
     created_at              timestamptz NOT NULL DEFAULT now(),
     updated_at              timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX memberships_status_idx ON memberships (status, current_period_end);
   COMMENT ON TABLE memberships IS
     'Local mirror of Stripe Subscription state. Written by webhook handler (Slice 2) and the membership-override server action (Slice 2). Read by /admin/payments and member-detail. ADR-0010 / ADR-0036.';
   ```

   Verified by `pnpm test tests/migrations/memberships-shape.test.ts`.

3. **Migration `supabase/migrations/0010_time_wallets.sql`** exists and
   applies cleanly. Contents:

   ```sql
   CREATE TABLE time_wallets (
     profile_id        uuid PRIMARY KEY REFERENCES profiles(id),
     balance_minutes   bigint NOT NULL DEFAULT 0,
     balance_cents     bigint GENERATED ALWAYS AS (
                         (round((balance_minutes::numeric / 60.0) * 1200))::bigint
                       ) STORED,
     last_activity_at  timestamptz,
     updated_at        timestamptz NOT NULL DEFAULT now()
   );
   COMMENT ON TABLE time_wallets IS
     'Per-member time-bank balance. balance_minutes is the canonical ledger projection (ADR-0011); balance_cents is a generated read-only projection at $12/hour for the existing admin member-detail page (ADR-0036 §Schema column naming). The time_ledger trigger maintains balance_minutes; balance_cents recomputes transparently.';
   COMMENT ON COLUMN time_wallets.balance_cents IS
     'GENERATED ALWAYS AS — DO NOT WRITE. Derived from balance_minutes at HOURLY_RATE_CENTS=1200 per lib/money/types.ts.';
   ```

   **Generated-column compatibility note:** pglite supports
   `GENERATED ALWAYS AS ... STORED` from Postgres 12+. If
   `pnpm migrate:check` flags the syntax on the hosted side, the
   worker may fall back to a plain `bigint` column populated by the
   trigger (see AC5); the spec accepts either implementation but
   prefers the generated column for write-side simplicity.

   Verified by `pnpm test tests/migrations/time-bank-shape.test.ts`
   and the `beforeAll` of `pnpm test tests/db/rls-time-bank.test.ts`.

4. **Migration `supabase/migrations/0011_time_ledger.sql`** exists and
   applies cleanly. Contents:

   ```sql
   CREATE TABLE time_ledger (
     id                   bigserial PRIMARY KEY,
     profile_id           uuid NOT NULL REFERENCES profiles(id),
     action               text NOT NULL,
       -- 'purchase' | 'promo_bonus' | 'refund' | 'redemption'
       -- | 'manual_credit' | 'manual_debit' | 'dormancy_conversion' | 'escheatment'
     amount_minutes       bigint NOT NULL,
     source_payment_id    bigint REFERENCES payments(id),
     reason               text,
     actor_id             uuid REFERENCES profiles(id),
     idempotency_key      text NOT NULL,
     created_at           timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT time_ledger_idempotency_key_unique UNIQUE (idempotency_key)
   );
   CREATE INDEX time_ledger_profile_idx ON time_ledger (profile_id, created_at DESC);
   CREATE INDEX time_ledger_action_idx  ON time_ledger (action, created_at DESC);
   COMMENT ON TABLE time_ledger IS
     'Append-only ledger of every time-bank credit and debit. The wallet balance is a derived projection (time_wallets.balance_minutes) maintained by a trigger. ADR-0011 / ADR-0036.';
   ```

   Verified by `pnpm test tests/migrations/time-bank-shape.test.ts`
   (which covers both `time_wallets` and `time_ledger` shape +
   trigger — see AC5).

5. **Trigger on `time_ledger` → `time_wallets.balance_minutes`** ships
   in `supabase/migrations/0012_time_ledger_balance_trigger.sql`. The
   trigger is `AFTER INSERT ON time_ledger FOR EACH ROW` and runs:

   ```sql
   CREATE OR REPLACE FUNCTION public.time_ledger_recompute_wallet()
   RETURNS TRIGGER AS $$
   BEGIN
     -- Wallet is upserted; balance_minutes is the running sum across the ledger.
     INSERT INTO time_wallets (profile_id, balance_minutes, last_activity_at, updated_at)
       VALUES (
         NEW.profile_id,
         COALESCE((SELECT SUM(amount_minutes) FROM time_ledger WHERE profile_id = NEW.profile_id), 0),
         now(),
         now()
       )
     ON CONFLICT (profile_id) DO UPDATE
       SET balance_minutes  = EXCLUDED.balance_minutes,
           last_activity_at = EXCLUDED.last_activity_at,
           updated_at       = EXCLUDED.updated_at;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   CREATE TRIGGER time_ledger_balance_trigger
     AFTER INSERT ON time_ledger
     FOR EACH ROW
     EXECUTE FUNCTION public.time_ledger_recompute_wallet();
   ```

   The function is `SECURITY DEFINER` so the recompute can write the
   wallet row even when the inserting session is RLS-scoped (the
   wallet INSERT/UPDATE is the system's invariant, not the actor's
   action). The trigger has no `UPDATE`/`DELETE` variant — ledger rows
   are append-only per ADR-0011; corrections are new rows with
   negative `amount_minutes`.

   Verified by the wallet-recompute sub-cases of
   `pnpm test tests/migrations/time-bank-shape.test.ts`: seed a profile,
   INSERT a `purchase` ledger row with `amount_minutes=180`, assert
   `time_wallets.balance_minutes=180`; INSERT a `redemption` row with
   `amount_minutes=-60`, assert balance is now 120; INSERT a
   `manual_credit` row idempotency-keyed identically to a prior row,
   assert the unique constraint blocks the duplicate.

6. **Migration `supabase/migrations/0013_disputes.sql`** exists and
   applies cleanly. Contents:

   ```sql
   CREATE TABLE disputes (
     stripe_dispute_id  text PRIMARY KEY,
     payment_intent_id  text NOT NULL,
     profile_id         uuid REFERENCES profiles(id),
     amount_cents       bigint NOT NULL,
     status             text NOT NULL,
     reason             text,
     outcome            text,
     created_at         timestamptz NOT NULL DEFAULT now(),
     updated_at         timestamptz NOT NULL DEFAULT now()
   );
   COMMENT ON TABLE disputes IS
     'Minimal mirror of Stripe disputes. Populated by webhook handler (Slice 2 of ADR-0036). Dispute response UI is deferred per ADR-0027 §open-questions; this table exists so /admin/payments can show an open-disputes count.';
   ```

   Verified by `pnpm test tests/migrations/disputes-shape.test.ts`.

7. **Migration `supabase/migrations/0014_stripe_webhook_events.sql`**
   exists and applies cleanly. Contents:

   ```sql
   CREATE TABLE stripe_webhook_events (
     event_id        text PRIMARY KEY,           -- Stripe's evt_*
     event_type      text NOT NULL,
     livemode        boolean NOT NULL,
     payload         jsonb NOT NULL,
     received_at     timestamptz NOT NULL DEFAULT now(),
     processed_at    timestamptz,
     processing_ms   integer,
     error           text
   );
   CREATE INDEX stripe_webhook_events_received_idx
     ON stripe_webhook_events (received_at DESC);
   CREATE INDEX stripe_webhook_events_unprocessed_idx
     ON stripe_webhook_events (received_at)
     WHERE processed_at IS NULL;
   COMMENT ON TABLE stripe_webhook_events IS
     'Stripe webhook event log + idempotency anchor. PK on event_id; duplicate deliveries hit ON CONFLICT and short-circuit (ADR-0005). Written ONLY by /api/webhooks/stripe (Slice 2). Read by /admin/payments and (Slice 2) /admin/payments/webhooks.';
   ```

   Verified by `pnpm test tests/migrations/stripe-webhook-events-shape.test.ts`.

8. **Migration `supabase/migrations/0015_refund_requests.sql`** exists
   and applies cleanly. Contents:

   ```sql
   CREATE TABLE refund_requests (
     id                bigserial PRIMARY KEY,
     target_payment_id bigint NOT NULL REFERENCES payments(id),
     profile_id        uuid NOT NULL REFERENCES profiles(id),
     actor_id          uuid NOT NULL REFERENCES profiles(id),
     refund_type       text NOT NULL,
       -- 'time_bank' | 'membership_current' | 'membership_previous'
     amount_cents      bigint NOT NULL,
     reason            text NOT NULL,
       -- 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'goodwill' | 'other'
     reason_note       text,
     status            text NOT NULL DEFAULT 'pending',
       -- 'pending' | 'stripe_pending' | 'settled' | 'failed' | 'denied'
     stripe_refund_id  text,
     stripe_error      jsonb,
     idempotency_key   text NOT NULL,
     created_at        timestamptz NOT NULL DEFAULT now(),
     settled_at        timestamptz,
     CONSTRAINT refund_requests_idempotency_key_unique UNIQUE (idempotency_key),
     CONSTRAINT refund_requests_amount_positive CHECK (amount_cents > 0)
   );
   CREATE INDEX refund_requests_profile_idx ON refund_requests (profile_id, created_at DESC);
   CREATE INDEX refund_requests_status_idx  ON refund_requests (status, created_at DESC);
   COMMENT ON TABLE refund_requests IS
     'Refund operations. Slice 1 ships the schema + RLS; the writer (server action) lands in Slice 2. v1 idempotency anchor is the form-mount UUID (ADR-0005). ADR-0027 authority matrix is enforced by lib/payments/authority.ts in lib code, NOT by RLS — RLS only constrains who can INSERT at all (manager+). ADR-0036.';
   ```

   The `refund_requests_amount_positive` CHECK is an ADR-0004
   defensive — partial refunds are valid but zero/negative is a
   form-validation bug worth catching at the DB layer.

   Verified by `pnpm test tests/migrations/refund-requests-shape.test.ts`.

9. **Migration `supabase/migrations/0016_payments_rls.sql`** exists
   and applies cleanly. This is the final migration in the slice; it
   enables RLS on all seven new tables and creates the policies
   verbatim from ADR-0036 §RLS policies (with the `member_id →
   profile_id` substitution). Contents:

   ```sql
   -- enable + force RLS on every payment-substrate table
   ALTER TABLE payments              ENABLE ROW LEVEL SECURITY;
   ALTER TABLE payments              FORCE  ROW LEVEL SECURITY;
   ALTER TABLE memberships           ENABLE ROW LEVEL SECURITY;
   ALTER TABLE memberships           FORCE  ROW LEVEL SECURITY;
   ALTER TABLE time_wallets          ENABLE ROW LEVEL SECURITY;
   ALTER TABLE time_wallets          FORCE  ROW LEVEL SECURITY;
   ALTER TABLE time_ledger           ENABLE ROW LEVEL SECURITY;
   ALTER TABLE time_ledger           FORCE  ROW LEVEL SECURITY;
   ALTER TABLE refund_requests       ENABLE ROW LEVEL SECURITY;
   ALTER TABLE refund_requests       FORCE  ROW LEVEL SECURITY;
   ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
   ALTER TABLE stripe_webhook_events FORCE  ROW LEVEL SECURITY;
   ALTER TABLE disputes              ENABLE ROW LEVEL SECURITY;
   ALTER TABLE disputes              FORCE  ROW LEVEL SECURITY;

   -- payments: members read self; cashier+ read all
   CREATE POLICY payments_self_or_cashier_read ON payments
     FOR SELECT USING (profile_id = auth.uid() OR auth.role_at_least('cashier'));

   -- memberships: members read self; cashier+ read all; manager+ write
   CREATE POLICY memberships_self_or_cashier_read ON memberships
     FOR SELECT USING (profile_id = auth.uid() OR auth.role_at_least('cashier'));
   CREATE POLICY memberships_manager_write ON memberships
     FOR UPDATE USING (auth.role_at_least('manager'))
                WITH CHECK (auth.role_at_least('manager'));

   -- time_wallets: members read self; cashier+ read all
   CREATE POLICY time_wallets_self_or_cashier_read ON time_wallets
     FOR SELECT USING (profile_id = auth.uid() OR auth.role_at_least('cashier'));

   -- time_ledger: members read self; cashier+ read all; cashier+ INSERT
   CREATE POLICY time_ledger_self_or_cashier_read ON time_ledger
     FOR SELECT USING (profile_id = auth.uid() OR auth.role_at_least('cashier'));
   CREATE POLICY time_ledger_cashier_insert ON time_ledger
     FOR INSERT WITH CHECK (auth.role_at_least('cashier'));

   -- refund_requests: manager+ read AND insert
   CREATE POLICY refund_requests_manager_read ON refund_requests
     FOR SELECT USING (auth.role_at_least('manager'));
   CREATE POLICY refund_requests_manager_insert ON refund_requests
     FOR INSERT WITH CHECK (auth.role_at_least('manager'));

   -- stripe_webhook_events: manager+ read; service-role writes only
   CREATE POLICY stripe_webhook_events_manager_read ON stripe_webhook_events
     FOR SELECT USING (auth.role_at_least('manager'));

   -- disputes: manager+ read; service-role writes only
   CREATE POLICY disputes_manager_read ON disputes
     FOR SELECT USING (auth.role_at_least('manager'));
   ```

   No DELETE policies anywhere — the substrate is append-only-or-
   service-role per ADR-0006 and ADR-0011. No UPDATE policies on
   `payments` / `time_ledger` / `disputes` — they are write-once
   from the service-role webhook handler. `memberships` has UPDATE
   for `manager+` to support the membership-override surface
   (Slice 2 wiring).

   Verified by `pnpm test tests/migrations/payments-rls-policies-shape.test.ts`
   (asserts every `ENABLE ROW LEVEL SECURITY` + every policy name
   exists by regex against the migration file) and by the `beforeAll`
   of each `tests/db/rls-<table>.test.ts` (AC10).

10. **`pnpm migrate:check`** passes on all nine new migrations
    (`0008..0016`). They are purely additive at the table / index /
    constraint / policy level — no existing migration is rewritten;
    drift is resolved forward per ADR-0018. Pglite `GENERATED ALWAYS
    AS ... STORED` compatibility is assumed (Postgres 12+); if the
    migrate-safety scanner flags `ENABLE ROW LEVEL SECURITY` on a
    newly-created table as needing acknowledgement, the worker adds
    a `migration-review: rls-enable-approved` comment justifying the
    posture (these are NEW tables — no prior unscoped writers exist
    that the RLS could break).

### RLS contract tests

11. **`tests/db/rls-payments.test.ts`** asserts the policy matrix from
    ADR §RLS policies for `payments`:
    - **member-self-read:** seed two profiles A and B; INSERT one
      payment row for A (via service-role); set `auth.uid()` to A
      (via `tests/db/_fixtures/auth-stub`); SELECT returns A's row;
      set `auth.uid()` to B; SELECT returns no rows.
    - **cashier-read-all:** with `role = 'cashier'`, SELECT returns
      both A's and B's rows.
    - **manager-read-all:** with `role = 'manager'`, SELECT returns
      both.
    - **member-insert-denied:** member-role session attempting
      `INSERT INTO payments ...` raises an RLS denial (SQLSTATE
      `42501` or empty-rowcount per the pglite/Supabase RLS posture).
    - **cashier-insert-denied:** cashier-role session attempting
      `INSERT INTO payments ...` raises an RLS denial (writes are
      service-role-only; the absence of an INSERT policy is the
      enforcement).
    - **service-role-bypass:** service-role session writes succeed
      (this is the webhook handler's path).
    Test scaffolding mirrors `tests/db/rls-privacy-requests.test.ts`
    (pglite + `setupAppAuthenticatedRole` + the auth-stub fixture).

12. **`tests/db/rls-memberships.test.ts`** asserts the policy matrix
    for `memberships`:
    - member-self-read, cashier-read-all, manager-read-all
      (mirrors AC11).
    - member-update-denied (no UPDATE policy for members).
    - cashier-update-denied (the UPDATE policy gates `manager+`).
    - manager-update-allowed (the membership-override surface lands
      in Slice 2; the policy must allow it now).
    - service-role-write-allowed.

13. **`tests/db/rls-time-bank.test.ts`** asserts the policy matrix
    for **both** `time_wallets` and `time_ledger` (the two tables
    share the policy posture and are exercised by the trigger; one
    test file covers both):
    - member-self-read-wallet, member-self-read-ledger.
    - cashier-read-all-wallet, cashier-read-all-ledger.
    - cashier-insert-ledger-allowed (per the
      `time_ledger_cashier_insert` policy; Slice 2 wires the
      manual-adjust server action against this).
    - member-insert-ledger-denied.
    - cashier-insert-triggers-wallet-recompute: after a successful
      `cashier+` INSERT, `time_wallets.balance_minutes` is the
      running sum of the inserted rows (cross-cutting integration
      with AC5's trigger).
    - service-role-write-allowed.

14. **`tests/db/rls-refund-requests.test.ts`** asserts the
    manager-only-read-and-write posture from the ADR:
    - manager-read-allowed, manager-insert-allowed.
    - cashier-read-denied, cashier-insert-denied.
    - member-read-denied (NOT even self-read; the manager+
      threshold is the documented posture because the table is
      operational, not member-facing).
    - service-role-bypass on both read and write.

15. **`tests/db/rls-stripe-webhook-events.test.ts`** asserts:
    - manager-read-allowed.
    - cashier-read-denied, member-read-denied.
    - service-role-write-allowed (the webhook handler in Slice 2
      uses the service-role client).
    - manager-write-denied (no INSERT/UPDATE policy for
      `manager+`; writes are service-role-only).

16. **`tests/db/rls-disputes.test.ts`** asserts the same matrix as
    AC15 (manager-read, service-role-write, denials for everyone
    else).

### Authority enforcement (the runtime guard)

17. **`lib/payments/authority.ts`** exports the verbatim contract
    from ADR §Authority enforcement:

    ```ts
    import 'server-only';
    import type { Cents } from '@/lib/money/types';
    import type { Role } from '@/lib/auth/types';

    export type RefundType =
      | 'time_bank'
      | 'membership_current'
      | 'membership_previous';

    export class InsufficientAuthorityError extends Error {
      public readonly name = 'InsufficientAuthorityError';
      constructor(
        public readonly actorRole: Role,
        public readonly required: Role,
        public readonly refundType: RefundType,
        public readonly amountCents: Cents,
      ) {
        super(
          `Role '${actorRole}' cannot issue a ${refundType} refund of ` +
            `${amountCents}c; requires '${required}'.`,
        );
      }
    }

    export function requiredRoleFor(
      refundType: RefundType,
      amountCents: Cents,
    ): Role;

    export async function assertRefundAuthority(opts: {
      actorRole: Role;
      amountCents: Cents;
      refundType: RefundType;
      monthsBack?: number;
    }): Promise<void>;
    ```

    Properties:
    - `import 'server-only';` first line.
    - `requiredRoleFor` body is the ADR §Authority enforcement
      reference implementation verbatim — `time_bank` ≤ 2500c =
      `cashier`, ≤ 20000c = `manager`, > 20000c = `owner`;
      `membership_current` = `manager`; `membership_previous` =
      `owner`; exhaustiveness `never` assertion in the default
      branch.
    - `assertRefundAuthority` computes `required =
      requiredRoleFor(...)` then `if (!roleAtLeast(actorRole,
      required)) throw new InsufficientAuthorityError(...)`. The
      `roleAtLeast` helper comes from `@/lib/auth/types` (cycle-1
      Role ladder); if missing, the worker imports the ROLE_RANK
      table from the existing `requireRole.ts` site and inlines a
      typed helper here.
    - The function NEVER reads the DB, NEVER calls Stripe, NEVER
      writes audit. It is a pure runtime guard.

    Verified by `pnpm test tests/payments/authority.test.ts` (AC18).

18. **`tests/payments/authority.test.ts`** covers **every cell** of
    the ADR §Authority lookup table — one test per (role,
    refundType, amount-bucket) tuple. The table has 8 distinct
    (refundType, amount-bucket) tuples × 4 roles (`member`,
    `cashier`, `manager`, `owner`) = 32 cases, of which ~16 are
    allow paths and ~16 are deny paths. Cases enumerated:

    | refundType | amount | member | cashier | manager | owner |
    |---|---|---|---|---|---|
    | time_bank | 2500c (≤ $25) | deny | allow | allow | allow |
    | time_bank | 20000c ($200) | deny | deny | allow | allow |
    | time_bank | 50000c ($500) | deny | deny | deny | allow |
    | time_bank | 1c (boundary) | deny | allow | allow | allow |
    | time_bank | 2501c (just over $25 boundary) | deny | deny | allow | allow |
    | time_bank | 20001c (just over $200 boundary) | deny | deny | deny | allow |
    | membership_current | 100c | deny | deny | allow | allow |
    | membership_current | 10000000c | deny | deny | allow | allow |
    | membership_previous | 100c | deny | deny | deny | allow |
    | membership_previous | 10000000c | deny | deny | deny | allow |

    Each row × `actorRole` combination is one `it(...)` block.
    Allow paths assert `await expect(assertRefundAuthority({...})).resolves.toBeUndefined()`;
    deny paths assert `rejects.toBeInstanceOf(InsufficientAuthorityError)`
    AND assert the error's `actorRole`, `required`, `refundType`,
    `amountCents` properties match the expected denial. A final
    `requiredRoleFor` block asserts the boundary math directly
    (`requiredRoleFor('time_bank', 2500 as Cents) === 'cashier'`,
    `requiredRoleFor('time_bank', 2501 as Cents) === 'manager'`,
    etc.).

### Fail-loud server-action stubs

19. **`lib/payments/_errors.ts`** exports the load-bearing
    error class:

    ```ts
    import 'server-only';

    export class StripeNotConfiguredError extends Error {
      public readonly name = 'StripeNotConfiguredError';
      /** Stable UI message — rendered verbatim. */
      public readonly userMessage =
        'Stripe integration pending — see ADR-0010';
      constructor(public readonly missingEnvVar: string) {
        super(
          `Stripe integration not configured: env var '${missingEnvVar}' is unset. ` +
            `ADR-0010 is blocked on Stripe account activation.`,
        );
      }
    }
    ```

    The class is exported from its own module (not from
    `authority.ts`) so the import graph stays tidy. The `userMessage`
    is a stable, public, render-safe string — pages that catch the
    error display `e.userMessage` and NOT `e.message` (which contains
    the env-var name and ADR reference suitable for logs but not for
    end-users in a public surface).

    Verified by `pnpm test tests/payments/server-actions-stubs.test.ts`
    (AC22) — sub-cases assert constructor signature, name property,
    `userMessage` literal string match, and that
    `JSON.stringify(error)` does NOT include the missingEnvVar
    (Sentry redaction posture).

20. **`lib/payments/stripe-client.ts`** exports the env-probe:

    ```ts
    import 'server-only';
    import { StripeNotConfiguredError } from './_errors';

    /**
     * Throws StripeNotConfiguredError if STRIPE_SECRET_KEY is unset
     * or empty. Call this as the FIRST runtime statement of any
     * server action that would call the Stripe SDK. ADR-0036 Slice 1
     * ships this as a stub; Slice 2 wires the real `new Stripe(...)`
     * client construction here.
     */
    export function assertStripeConfigured(): void {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key || key.trim() === '') {
        throw new StripeNotConfiguredError('STRIPE_SECRET_KEY');
      }
    }

    /**
     * Slice 1 stub. Slice 2 replaces with `new Stripe(key, {
     * apiVersion: '...' })`. Calling this in Slice 1 always throws
     * StripeNotConfiguredError because no env var is set in the
     * Slice 1 environments.
     */
    export function getStripeClient(): never {
      assertStripeConfigured();
      // Unreachable in Slice 1; Slice 2 replaces with the real client.
      throw new StripeNotConfiguredError('STRIPE_SECRET_KEY');
    }
    ```

    Verified by `pnpm test tests/payments/server-actions-stubs.test.ts`
    (AC22) — sub-cases assert: `STRIPE_SECRET_KEY` unset → throws;
    set to empty string → throws; set to `'sk_test_xxx'` → does NOT
    throw from `assertStripeConfigured` (it throws from
    `getStripeClient` in Slice 1 because the real client isn't
    wired yet — Slice 2 unwires this).

21. **`app/(admin)/admin/payments/refunds/new/_actions/initiateRefund.ts`**
    exists as the fail-loud server action. Signature:

    ```ts
    'use server';
    import 'server-only';

    export interface InitiateRefundParams {
      targetPaymentId: string;   // bigint as string — form submits as text
      amountCents: number;       // form-validated; passed as Cents internally
      reason: 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'goodwill' | 'other';
      reasonNote?: string;
      refundType: 'time_bank' | 'membership_current' | 'membership_previous';
      idempotencyKey: string;    // form-mount UUID v4
    }

    export interface InitiateRefundResult {
      ok: true;
      refundRequestId: string;
    }

    export async function initiateRefund(
      params: InitiateRefundParams,
    ): Promise<InitiateRefundResult>;
    ```

    Body contract (Slice 1 implementation):
    1. `import 'server-only';` first line.
    2. `'use server';` directive at top.
    3. First runtime statement: `const { profile: actor } = await requireRole('manager');`.
    4. Validate `params` via Zod (`zod` already in deps); reject with
       `BadRequest` on shape mismatch (mirrors AC17 of ADR-0035 spec
       — input validation rejects BEFORE the audit transaction).
    5. Compute `assertRefundAuthority({ actorRole: actor.role,
       amountCents: cents(params.amountCents), refundType:
       params.refundType })` — throws `InsufficientAuthorityError`
       if the actor cannot issue the requested refund.
    6. Inside `withAudit('admin.refund.denied', 'refund_request',
       'pending', ...)`: write an audit row with
       `before = null`,
       `after = { reason: 'stripe_not_configured', refund_type:
       params.refundType, amount_cents: params.amountCents }`,
       `actorId = actor.id`. The `targetId` is the literal string
       `'pending'` (NOT `null`) because `withAudit`'s
       `target_id` is `text NOT NULL` per ADR-0006 — the slice-1
       fail-loud path has no `refund_requests` row to point at yet.
       (See Open Question 1 for the alternative of inserting a
       `denied`-status row.)
    7. **After the audit transaction commits**, call
       `assertStripeConfigured()` — this throws
       `StripeNotConfiguredError`. The throw propagates to the
       Next.js error boundary, which renders `e.userMessage`
       verbatim per AC23.
    8. **Audit ordering is critical:** the audit row writes
       FIRST, the env-probe throws SECOND. This guarantees the
       `admin.refund.denied` breadcrumb fires even on the fail-loud
       path — exactly what the dispatch envelope requires.

    Slice 2 will rewrite this action: the env-probe moves before the
    audit (because the audit row will be `admin.refund.initiated`,
    not `admin.refund.denied`), the authority guard runs second, the
    DB INSERT into `refund_requests` runs third, the Stripe API call
    runs fourth. Slice 1 inverts steps 6 and 7 to satisfy the
    "audit row fires even on fail-loud" requirement.

    Verified by `pnpm test tests/payments/server-actions-stubs.test.ts`
    (AC22).

22. **`tests/payments/server-actions-stubs.test.ts`** covers:
    - `StripeNotConfiguredError` constructor signature
      (`new StripeNotConfiguredError('STRIPE_SECRET_KEY').missingEnvVar
      === 'STRIPE_SECRET_KEY'`).
    - `assertStripeConfigured()` throws when env unset; throws when
      env is empty string; succeeds when env is `'sk_test_xxx'`
      (test sets `process.env.STRIPE_SECRET_KEY` in a `beforeEach`
      / restores in `afterEach`).
    - `initiateRefund(...)` with a valid `manager+` actor + valid
      params + unset env: throws `StripeNotConfiguredError` AND
      the `admin.refund.denied` audit row is written via mocked
      `withAudit` with the exact `after` payload pinned in AC21
      step 6.
    - `initiateRefund(...)` with a `cashier` actor: throws
      `InsufficientRoleError` (the `requireRole('manager')` gate
      fires before the env-probe); NO audit row written (the
      `requireRole` denial happens before the audit transaction).
    - `initiateRefund(...)` with a `manager` actor but
      `refundType='membership_previous'`: throws
      `InsufficientAuthorityError` (the authority guard fires
      before the env-probe); NO `admin.refund.denied` audit row.
      (See Open Question 2 — the over-authority audit row is
      separate from the env-unset audit row.)
    - Source-grep shape: the action's file starts with
      `import 'server-only';`, contains `'use server';`, contains
      the literal `await requireRole('manager')`, contains the
      literal `assertStripeConfigured`, contains the literal
      `admin.refund.denied`.

### Audit verb taxonomy

23. **`lib/audit/actions.ts`** ships as a NEW file (no prior version
    exists in the repo per the dispatch envelope grep). Contents:

    ```ts
    /**
     * Canonical audit-action verb constants per ADR-0006 + ADR-0036
     * §Audit event taxonomy. Every state-changing path that writes
     * to audit_log MUST import its action string from here — a lint
     * rule (paralleling ADR-0006's audit-policy) flags raw string
     * literals matching the dotted-verb pattern against this file.
     */

    // ----- Refund flow (Slice 1 ships the constants; the writers
    // ----- ship across Slices 1-2 of ADR-0036) -----------------
    export const ADMIN_REFUND_INITIATED   = 'admin.refund.initiated' as const;
    export const ADMIN_REFUND_COMPLETED   = 'admin.refund.completed' as const;
    export const ADMIN_REFUND_FAILED      = 'admin.refund.failed'    as const;
    export const ADMIN_REFUND_DENIED      = 'admin.refund.denied'    as const;
    export const ADMIN_REFUND_SETTLED     = 'admin.refund.settled'   as const;
    export const ADMIN_REFUND_FLOW_OPENED = 'admin.refund.flow_opened' as const;

    // ----- Membership state overrides (writers in Slice 2) -----
    export const ADMIN_MEMBERSHIP_STATUS_OVERRIDDEN = 'admin.membership.status_overridden' as const;
    export const ADMIN_MEMBERSHIP_CANCELED          = 'admin.membership.canceled'          as const;
    export const ADMIN_MEMBERSHIP_REACTIVATED       = 'admin.membership.reactivated'       as const;
    export const ADMIN_MEMBERSHIP_GRACE_EXTENDED    = 'admin.membership.grace_extended'    as const;

    // ----- Time-bank manual adjustments (writers in Slice 2) -----
    export const ADMIN_TIME_BANK_MANUAL_CREDIT = 'admin.time_bank.manual_credit' as const;
    export const ADMIN_TIME_BANK_MANUAL_DEBIT  = 'admin.time_bank.manual_debit'  as const;

    // ----- Kill-switch toggling (writer in Slice 2) -----
    export const ADMIN_KILL_SWITCH_TOGGLED = 'admin.kill_switch.toggled' as const;

    // ----- Stripe webhook handler lifecycle (writers in Slice 2) -----
    export const WEBHOOK_STRIPE_RECEIVED            = 'webhook.stripe.received'            as const;
    export const WEBHOOK_STRIPE_PROCESSED           = 'webhook.stripe.processed'           as const;
    export const WEBHOOK_STRIPE_FAILED              = 'webhook.stripe.failed'              as const;
    export const WEBHOOK_STRIPE_SKIPPED_KILL_SWITCH = 'webhook.stripe.skipped_kill_switch' as const;

    // ----- Webhook-driven side effects (writers in Slice 2) -----
    export const PAYMENT_SUCCEEDED      = 'payment.succeeded'       as const;
    export const PAYMENT_FAILED         = 'payment.failed'          as const;
    export const MEMBERSHIP_PAST_DUE    = 'membership.past_due'     as const;
    export const DISPUTE_OPENED         = 'dispute.opened'          as const;
    export const DISPUTE_CLOSED         = 'dispute.closed'          as const;

    /**
     * Union type of every canonical action string. New action verbs
     * MUST be added here AND to this union AND to ADR-0006 §audit
     * taxonomy AND to the matching ADR (ADR-0036 §Audit event
     * taxonomy for payment-related verbs).
     */
    export type PaymentsAuditAction =
      | typeof ADMIN_REFUND_INITIATED
      | typeof ADMIN_REFUND_COMPLETED
      | typeof ADMIN_REFUND_FAILED
      | typeof ADMIN_REFUND_DENIED
      | typeof ADMIN_REFUND_SETTLED
      | typeof ADMIN_REFUND_FLOW_OPENED
      | typeof ADMIN_MEMBERSHIP_STATUS_OVERRIDDEN
      | typeof ADMIN_MEMBERSHIP_CANCELED
      | typeof ADMIN_MEMBERSHIP_REACTIVATED
      | typeof ADMIN_MEMBERSHIP_GRACE_EXTENDED
      | typeof ADMIN_TIME_BANK_MANUAL_CREDIT
      | typeof ADMIN_TIME_BANK_MANUAL_DEBIT
      | typeof ADMIN_KILL_SWITCH_TOGGLED
      | typeof WEBHOOK_STRIPE_RECEIVED
      | typeof WEBHOOK_STRIPE_PROCESSED
      | typeof WEBHOOK_STRIPE_FAILED
      | typeof WEBHOOK_STRIPE_SKIPPED_KILL_SWITCH
      | typeof PAYMENT_SUCCEEDED
      | typeof PAYMENT_FAILED
      | typeof MEMBERSHIP_PAST_DUE
      | typeof DISPUTE_OPENED
      | typeof DISPUTE_CLOSED;
    ```

    Total: 22 constants (the 21 net-new payment-related ones from
    the ADR taxonomy table, PLUS `ADMIN_REFUND_FLOW_OPENED` which
    promotes the existing literal in
    `app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts`
    to a constant). The dispatch envelope's "22 audit verb
    constants" requirement is satisfied with this single file.

    Verified by `pnpm test tests/audit/payments-action-taxonomy.test.ts`
    (AC25).

24. **`app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts`**
    is amended to import the canonical action string instead of
    inlining the literal:

    ```ts
    import { ADMIN_REFUND_FLOW_OPENED } from '@/lib/audit/actions';
    // ...
    await withAudit({
      action: ADMIN_REFUND_FLOW_OPENED,   // was: 'admin.refund.flow_opened'
      // ...
    });
    ```

    The existing source-grep test at
    `tests/admin/open-refund-flow-action.test.ts:480` —
    `expect(src).toMatch(/admin\.refund\.flow_opened/)` — continues
    to pass because the string still appears in the file (as the
    value of the constant). No behavioral change; only the
    indirection moves.

25. **`tests/audit/payments-action-taxonomy.test.ts`** asserts:
    - All 22 constants are exported and have the exact literal
      string values pinned in AC23.
    - The `PaymentsAuditAction` union is the discriminated union
      of all 22 `typeof` aliases.
    - **Drift guard:** parse `docs/adr/0036-payment-management-console.md`
      §Audit event taxonomy table, extract every `action` cell,
      assert that each one is exported as a constant in
      `lib/audit/actions.ts`. If the ADR table and the constants
      file drift, the test fails — the constants are the source
      of truth at the type level, the ADR is the source of truth
      at the prose level, and the test bridges them.
    - **No-literal-leak guard:** source-grep `app/`,
      `lib/payments/`, `lib/audit/` (excluding `lib/audit/actions.ts`
      itself and test files) for any literal matching
      `/['"](admin\.refund|admin\.membership|admin\.time_bank|admin\.kill_switch|webhook\.stripe|payment\.succeeded|payment\.failed|membership\.past_due|dispute\.opened|dispute\.closed)\.[a-z_]+['"]/`
      — fails on any match. This is the audit-policy lint analog
      from ADR-0006 mentioned in ADR-0036 §Audit event taxonomy
      ("a lint rule paralleling ADR-0006's audit-policy flags
      writes to the seven payment-related tables that don't go
      through `withAudit`").

### `/admin/payments` overview surface

26. **`app/(admin)/admin/payments/page.tsx`** renders the overview
    page. Properties:
    - `export const dynamic = 'force-dynamic';`
    - **First body statement is `await requireRole('manager');`** —
      defense-in-depth, asserted by the existing
      `tests/auth/admin-routes-defense-in-depth.test.ts` (which
      walks the `app/(admin)/**/page.tsx` set automatically).
    - Renders three cards (per ADR-0036 §Information architecture
      "The `/admin/payments` overview" and the dispatch envelope's
      decision point 5):
      - **Recent payments** card — count of `payments` rows
        created in the last 14 days. Query:
        `SELECT count(*) FROM payments WHERE created_at >= now() - interval '14 days'`.
        Empty-state copy (zero-result): "**No payments yet.**
        The first payment will arrive once Stripe webhooks are
        wired (Slice 2)." Click navigates to
        `/admin/payments/refunds` (Slice 2 will replace with a
        recent-payments list).
      - **Webhook health** card — count of unprocessed events:
        `SELECT count(*) FROM stripe_webhook_events WHERE processed_at IS NULL`.
        Empty-state copy: "**No webhook events received.** Webhook
        handler ships in Slice 2." Click navigates to
        `/admin/payments/webhooks` (Slice 2 surface — for Slice 1
        the link is a stub that 404s gracefully via Next.js's
        default not-found).
      - **Open disputes** card — count of disputes with
        non-`closed` status:
        `SELECT count(*) FROM disputes WHERE status <> 'closed' AND status <> 'won' AND status <> 'lost'`.
        Empty-state copy: "**No open disputes.** Disputes flow
        in via the `charge.dispute.created` webhook (Slice 2)."
        Click is a no-op anchor in Slice 1 (the disputes-list
        page is post-v1 per ADR-0027 §open-questions).

    Each card uses the same visual primitive as the cards on
    `app/(admin)/admin/page.tsx` (the existing admin dashboard) —
    the worker mirrors the JSX structure for layout consistency.
    Empty-state strings are pinned (load-bearing copy — tests grep
    for the literal text).

    Verified by `pnpm test tests/admin/payments/overview-page.test.tsx`
    (RTL): mock the three queries to return `count=0`; assert each
    card renders with its empty-state copy; mock to return non-zero
    counts; assert each card renders with the number; assert
    `requireRole('manager')` is called via mock; assert the page
    is in the `(admin)` segment so the layout's gate also fires.

27. **Route gating contract:** `cashier` and `member` sessions
    requesting `/admin/payments` are redirected by the admin
    layout's `requireRole('manager')` per ADR-0035 AC4 (the page's
    own first-await defense-in-depth is a backup, not the primary
    gate). Verified by
    `pnpm test tests/admin/payments/overview-route-gating.test.tsx`:
    asserts that the page module imports `requireRole` from
    `@/lib/auth/requireRole` and that the first awaited call in
    the default export body is `requireRole('manager')`. (The
    existing `admin-routes-defense-in-depth.test.ts` would catch
    this too; this AC adds a payment-specific test for the
    discoverability of the contract.)

### Fail-loud refund-form surface

28. **`app/(admin)/admin/payments/refunds/new/page.tsx`** exists as
    the manager+-gated refund-initiation form shell. Properties:
    - First body statement: `await requireRole('manager');`.
    - Renders a minimal form with three fields:
      - `targetPaymentId` (text input — Slice 2 replaces with a
        lookup combobox).
      - `amountCents` (number input — Slice 2 adds a
        "remaining refundable" hint per ADR-0036 §Edge cases).
      - `reason` (select with the ADR's five values:
        `duplicate`, `fraudulent`, `requested_by_customer`,
        `goodwill`, `other`).
      - `refundType` (radio group: `time_bank`,
        `membership_current`, `membership_previous`).
      - Hidden `idempotencyKey` field, populated via a
        client-component `useState(() => crypto.randomUUID())`
        initializer per ADR-0005 §cashier-redemption pattern.
        (The form-mount UUID is the load-bearing idempotency
        anchor; even though Slice 1 never reaches Stripe, the
        key is part of the form contract so the Slice 2 server
        action can rely on it without a UI rewrite.)
    - Form submission posts to the `initiateRefund` server action
      from AC21.
    - **Error boundary at `app/(admin)/admin/payments/refunds/new/error.tsx`**
      catches `StripeNotConfiguredError` thrown by the server
      action and renders the `userMessage` verbatim. Body:

      ```tsx
      'use client';
      export default function Error({
        error,
        reset,
      }: { error: Error & Record<string, unknown>; reset: () => void }) {
        const userMessage =
          (error as { userMessage?: string }).userMessage ??
          'An unexpected error occurred. Please try again.';
        return (
          <section role="alert" aria-live="polite">
            <h2>Refund not initiated</h2>
            <p>{userMessage}</p>
            <button onClick={reset}>Dismiss</button>
          </section>
        );
      }
      ```

      The error boundary renders the **`userMessage`** field on the
      error object (not `error.message`, which contains the env-var
      name and stack-bearing text per AC19). Other error types
      (`InsufficientRoleError`, `InsufficientAuthorityError`,
      `BadRequest`) fall through to the parent error boundary at
      `app/(admin)/error.tsx` (cycle-1 admin error boundary).

    Verified by `pnpm test tests/admin/payments/refund-new-page.test.tsx`
    (RTL): renders all five form fields; the idempotency-key hidden
    field has a UUID-v4-shaped value (regex
    `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`);
    form submission calls `initiateRefund` with the form values;
    when `initiateRefund` throws `StripeNotConfiguredError`, the
    error boundary's literal copy "Refund not initiated" + the
    `userMessage` ("Stripe integration pending — see ADR-0010")
    appear in the rendered output; **the error boundary does NOT
    leak `error.message`** (positive assertion: the rendered
    output does NOT match `/STRIPE_SECRET_KEY|env var|stack/`).

### Pre-wiring updates

29. **`lib/payments/console-availability.ts`**'s
    `PAYMENTS_CONSOLE_READY` constant flips from `false` to `true`:

    ```ts
    export const PAYMENTS_CONSOLE_READY: boolean = true;
    ```

    The constant's JSDoc is amended to record the flip:
    > Q4 default — see `docs/adr/0035-admin-operations-console.md`
    > §Open Questions Q4: this slice (ADR-0036 v1) ships
    > `PAYMENTS_CONSOLE_READY=true`. The `openRefundFlow` action
    > now redirects to `/admin/payments/[id]/refund` instead of the
    > degraded `/admin/members/[id]?refund=pending-adr-0036` target.

    Verified by `pnpm test tests/payments/console-availability.test.ts`:
    asserts `PAYMENTS_CONSOLE_READY === true`; asserts the JSDoc
    contains "ADR-0036 v1"; asserts the file still has
    `import 'server-only';` as its first line.

30. **`tests/admin/open-refund-flow-action.test.ts` is amended**
    to add the inverse assertion. The existing AC17.1 sub-case
    ("AC17 happy path PAYMENTS_CONSOLE_READY=false") is preserved
    AS-IS — it tests the historical degraded-redirect branch via
    `vi.mock('@/lib/payments/console-availability', () => ({
    PAYMENTS_CONSOLE_READY: false }))`. The existing AC17.2
    sub-case ("AC17 canonical redirect PAYMENTS_CONSOLE_READY=true")
    is also preserved AS-IS — it already exercises the canonical
    path via a `vi.doMock` override.

    The amendment adds a new top-level `describe(...)` block:

    ```ts
    describe('openRefundFlow — AC30 default constant flipped post-ADR-0036', () => {
      it('default (no vi.mock override) returns canonical redirect target', async () => {
        // Re-import without the file-level vi.mock override.
        vi.resetModules();
        vi.unmock('@/lib/payments/console-availability');
        // ... rest of harness mirrors AC17.2 ...
        const result = await reImported.openRefundFlow(...);
        expect(result.redirectTo).toBe(`/admin/payments/${target1}/refund`);
      });
    });
    ```

    This documents that the module-level constant has flipped and
    the file-level `vi.mock(..., PAYMENTS_CONSOLE_READY: false)`
    override is the only thing keeping AC17.1 green. If the
    override is removed and the test still passes, the constant
    has been flipped correctly. The amendment is the
    "spec-writer-required inverse assertion" the dispatch envelope
    calls out.

31. **`app/(admin)/admin/members/[id]/page.tsx` `fetchRecentPayments`
    placeholder branch is updated.** The current implementation
    (lines 596-627 of that file) returns
    `{ kind: 'schema-absent', placeholder: 'Payment integration pending — see ADR-0010 / 0036.' }`
    when the `payments` table is absent. After Slice 1 of ADR-0036
    lands, the `payments` table exists; the `isMissingTableError`
    branch will not fire in production. The implementation does
    NOT need code changes — the branch becomes dead code that the
    test at `tests/admin/member-detail-page.test.tsx:408-413`
    still exercises via a deliberate `42P01` error injection.

    **The test is amended** instead. The current line:
    ```ts
    expect(screen.getByText(/Payment integration pending — see ADR-0010 \/ 0036\./i)).toBeTruthy();
    ```
    is the `42P01`-injection-only sub-case (per the surrounding test
    body it explicitly sets `tableResolvers.set('payments', { data: null, error: { code: '42P01' } })`).
    This sub-case is preserved AS-IS — it documents the legacy
    placeholder behavior that survives in the codebase as
    defense against a future schema regression.

    A **new** sub-case is added in the same file asserting the
    post-ADR-0036 default behavior (no error injection):

    ```ts
    it('renders "No recent payments." empty-state when the payments table exists and is empty', async () => {
      mocks.tableResolvers.set('payments', { data: [], error: null });
      await renderPage();
      expect(screen.queryByText(/Payment integration pending/i)).toBeNull();
      expect(screen.getByText(/No recent payments\./i)).toBeTruthy();
    });
    ```

    Per the existing test at line 416-419 ("renders 'No recent
    payments.' when the payments table exists but is empty"), this
    sub-case may already be in place — the worker SHOULD verify
    and only add if missing. The AC's load-bearing requirement is
    that **both** branches are covered: the legacy `42P01`-injection
    path AND the post-ADR-0036 empty-list path.

### Route map

32. **`docs/route-map.md`** is updated. The existing
    `Staff` table row (line 57):
    ```
    | — | `/admin/refunds` | (new — Slice 4) | manager+ | 010, 011, 027 |
    ```
    is replaced with the rows ADR-0036 Slice 1 ships:

    ```
    | — | `/admin/payments` | (new — Slice 4 via ADR-0036 Slice 1) | manager+ | 010, 011, 022, 027, 036 |
    | — | `/admin/payments/refunds/new` | (new — Slice 4 via ADR-0036 Slice 1; fail-loud until ADR-0010 Stripe activation) | manager+ | 010, 022, 027, 036 |
    ```

    A footnote is added beneath the table:

    > The full ADR-0036 surface (refunds queue + history,
    > per-member payment view, manual time-bank adjust, membership
    > state override, reconciliation viewer, webhook event log,
    > kill-switch panel) lands in Slices 2–5 of ADR-0036, gated on
    > Stripe account activation per ADR-0010. The `/admin/refunds`
    > legacy row is superseded by the `/admin/payments/**` tree.

    Verified by a source-grep test
    `tests/docs/route-map-payments.test.ts`: parses
    `docs/route-map.md`; asserts the two new rows exist; asserts
    the legacy `/admin/refunds` row no longer appears (or appears
    only inside a `~~strikethrough~~`); asserts the footnote text
    contains "Slices 2–5 of ADR-0036". (If the worker prefers a
    cheaper alternative, the test may be merged into the existing
    `tests/docs/route-map.test.ts` if such a file exists; if it
    does not, the new test file is the deliverable.)

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`. The dependency
order mirrors ADR-0036 §Migration ordering exactly (and the
dispatch envelope's required AC1 sequence). Each task is roughly
one day of focused work; the planner is free to split or merge.

- **T1 — Schema migration scaffold:** create stubs for `0008..0016`
  with empty `BEGIN; ROLLBACK;` blocks so `pnpm migrate:check`
  has files to scan. Add `tests/migrations/*-shape.test.ts` skeletons
  that import `pg-query-emscripten`. (Mirrors `tests/migrations/admin-privacy-requests-shape.test.ts`.)
- **T2 — `0008_payments.sql` + shape test:** AC1.
- **T3 — `0009_memberships.sql` + shape test:** AC2.
- **T4 — `0010_time_wallets.sql` + `0011_time_ledger.sql` + shape test:** AC3, AC4.
- **T5 — `0012_time_ledger_balance_trigger.sql` + trigger sub-cases:** AC5.
- **T6 — `0013_disputes.sql` + shape test:** AC6.
- **T7 — `0014_stripe_webhook_events.sql` + shape test:** AC7.
- **T8 — `0015_refund_requests.sql` + shape test:** AC8.
- **T9 — `0016_payments_rls.sql` + shape test:** AC9.
- **T10 — RLS contract tests (parallelizable):** AC11–AC16. Six
  test files; can be a fan-out of six small tasks.
- **T11 — `lib/payments/authority.ts` + tests:** AC17, AC18.
- **T12 — `lib/payments/_errors.ts` + `lib/payments/stripe-client.ts`:** AC19, AC20.
- **T13 — `initiateRefund` server action + `server-actions-stubs.test.ts`:** AC21, AC22.
- **T14 — `lib/audit/actions.ts` + `openRefundFlow.ts` amendment + taxonomy test:** AC23, AC24, AC25.
- **T15 — `/admin/payments` overview page + tests:** AC26, AC27.
- **T16 — `/admin/payments/refunds/new` page + error boundary + tests:** AC28.
- **T17 — Flip `PAYMENTS_CONSOLE_READY` + inverse-assertion amendment to `open-refund-flow-action.test.ts`:** AC29, AC30.
- **T18 — Amend `tests/admin/member-detail-page.test.tsx` for the new branch:** AC31.
- **T19 — `docs/route-map.md` update + source-grep test:** AC32.
- **T20 — Migration ordering integration test:** asserts that running
  `0001..0016` in order against pglite produces the expected final
  schema (no FK constraints unresolved, no policy missing).
  Verified via a `tests/migrations/integration-payments-slice.test.ts`
  that does a full `cat` of all 16 migrations and asserts the final
  state. This is the single load-bearing integration test for the
  schema slice; runs in CI as `pnpm test tests/migrations/`.

## Touched-files inventory

Best estimate of files created or modified. Workers may exceed if
needed (e.g. adding fixture helpers, splitting tests for clarity).

### Create

- `supabase/migrations/0008_payments.sql` (AC1)
- `supabase/migrations/0009_memberships.sql` (AC2)
- `supabase/migrations/0010_time_wallets.sql` (AC3)
- `supabase/migrations/0011_time_ledger.sql` (AC4)
- `supabase/migrations/0012_time_ledger_balance_trigger.sql` (AC5)
- `supabase/migrations/0013_disputes.sql` (AC6)
- `supabase/migrations/0014_stripe_webhook_events.sql` (AC7)
- `supabase/migrations/0015_refund_requests.sql` (AC8)
- `supabase/migrations/0016_payments_rls.sql` (AC9)
- `lib/payments/_errors.ts` (AC19)
- `lib/payments/stripe-client.ts` (AC20)
- `lib/payments/authority.ts` (AC17)
- `lib/audit/actions.ts` (AC23)
- `app/(admin)/admin/payments/page.tsx` (AC26)
- `app/(admin)/admin/payments/refunds/new/page.tsx` (AC28)
- `app/(admin)/admin/payments/refunds/new/error.tsx` (AC28)
- `app/(admin)/admin/payments/refunds/new/_actions/initiateRefund.ts` (AC21)
- `tests/migrations/payments-shape.test.ts` (AC1)
- `tests/migrations/memberships-shape.test.ts` (AC2)
- `tests/migrations/time-bank-shape.test.ts` (AC3, AC4, AC5)
- `tests/migrations/disputes-shape.test.ts` (AC6)
- `tests/migrations/stripe-webhook-events-shape.test.ts` (AC7)
- `tests/migrations/refund-requests-shape.test.ts` (AC8)
- `tests/migrations/payments-rls-policies-shape.test.ts` (AC9)
- `tests/migrations/integration-payments-slice.test.ts` (T20)
- `tests/db/rls-payments.test.ts` (AC11)
- `tests/db/rls-memberships.test.ts` (AC12)
- `tests/db/rls-time-bank.test.ts` (AC13)
- `tests/db/rls-refund-requests.test.ts` (AC14)
- `tests/db/rls-stripe-webhook-events.test.ts` (AC15)
- `tests/db/rls-disputes.test.ts` (AC16)
- `tests/payments/authority.test.ts` (AC18)
- `tests/payments/server-actions-stubs.test.ts` (AC22)
- `tests/payments/console-availability.test.ts` (AC29)
- `tests/admin/payments/overview-page.test.tsx` (AC26)
- `tests/admin/payments/overview-route-gating.test.tsx` (AC27)
- `tests/admin/payments/refund-new-page.test.tsx` (AC28)
- `tests/audit/payments-action-taxonomy.test.ts` (AC25)
- `tests/docs/route-map-payments.test.ts` (AC32; or merge into existing route-map test)

### Modify

- `lib/payments/console-availability.ts` — flip the constant and amend JSDoc (AC29)
- `app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts` — replace literal with `ADMIN_REFUND_FLOW_OPENED` constant (AC24)
- `tests/admin/open-refund-flow-action.test.ts` — add inverse-assertion describe block (AC30)
- `tests/admin/member-detail-page.test.tsx` — add or verify the empty-state sub-case (AC31)
- `docs/route-map.md` — replace `/admin/refunds` row with `/admin/payments/**` rows + footnote (AC32)

### Touched but not modified (depended upon)

- `lib/audit/withAudit.ts` — every state-changing action in this slice writes through this helper
- `lib/auth/requireRole.ts` — every `/admin/payments/**` route + server action calls this first
- `lib/money/types.ts` — `Cents` branded type; `formatMoney`; `HOURLY_RATE_CENTS` (referenced in the `time_wallets.balance_cents` generated column expression)
- `lib/auth/types.ts` — `Role` type imported by `authority.ts`
- `tests/db/_fixtures/auth-stub.ts` — RLS test scaffolding
- `tests/db/_fixtures/profiles.ts` — `seedProfile` helper
- `tests/db/_fixtures/rls-helpers.ts` — `setupAppAuthenticatedRole`, `asAuthenticated`, `asServiceRole`

## Risk flags

Linked ADRs and why each is risky in this slice. Premortem is
**mandatory** for every flagged ADR per the conductor cycle.

- **ADR-0003 (authorization model — RLS):** seven new tables, fifteen
  policies, four distinct read-thresholds (member-self, cashier+,
  manager+, service-role-only). Any policy gap is a data-leak vector
  (a `cashier` reading `refund_requests`, a `member` reading another
  member's `payments`). Mitigation: AC11–AC16 cover every policy
  matrix cell with a contract test; the migration's `FORCE ROW LEVEL
  SECURITY` clause closes the service-role-can-still-see-everything
  hole on tables the webhook handler writes to.

- **ADR-0004 (money handling — integer cents, USD-only):** every
  cents-bearing column is `bigint`, never `numeric` or `float`. The
  `payments.currency` CHECK constraint (`= 'usd'`) is the new
  defensive added beyond the ADR's alert-only posture. The
  `time_wallets.balance_cents` generated column uses the
  `HOURLY_RATE_CENTS = 1200` constant from `lib/money/types.ts`; if
  that constant ever changes (a future ADR-0011 amendment), the
  migration is the source of drift, NOT the code. Mitigation:
  AC18's authority-matrix tests cover the $25 / $200 boundary cells
  explicitly with `2500c`, `2501c`, `20000c`, `20001c` inputs.
  Premortem must include "what happens if the trigger underflows
  `bigint`" (answer: impossible at v1 scale, but a CHECK constraint
  `>= -2^63` is free).

- **ADR-0005 (idempotency):** every refund-requests row carries an
  `idempotency_key`; the `refund_requests_idempotency_key_unique`
  constraint is the database-layer dedup. Even though Slice 1 ships
  ZERO writers against this table (the writer lands in Slice 2 once
  Stripe keys arrive), the constraint MUST be in place from day one
  so a future deploy-mid-flight retry — when the writer finally
  ships — can rely on the constraint to roll back the duplicate
  insert. Mitigation: AC8 pins the constraint; AC18 verifies the
  authority guard runs BEFORE any DB write so a denied attempt
  doesn't consume an idempotency key. The form-mount UUID-v4
  contract (AC28's hidden field) means the same user
  re-submitting the same form re-uses the same key — the
  Slice-2-correct behavior is preserved by the Slice-1 form.

- **ADR-0006 (audit log — append-only):** 22 new audit-action verb
  constants in `lib/audit/actions.ts`. The fail-loud refund stub
  STILL writes an `admin.refund.denied` audit row even when the
  Stripe env-probe throws — this is the "audit row fires even on
  fail-loud" load-bearing contract from the dispatch envelope.
  Mitigation: AC21 step 6 + step 7 pin the audit-before-throw
  ordering; AC22's mocked-`withAudit` assertion verifies the audit
  row writes before the `StripeNotConfiguredError` propagates.
  AC25's drift-guard test bridges the ADR prose taxonomy to the
  exported constants.

- **ADR-0027 (support / refund authority matrix):** `lib/payments/authority.ts`
  is the runtime enforcement of the ADR-0027 prose matrix. The
  matrix in ADR-0036 (and replicated in AC18's test table) is the
  single source of truth — any change requires an ADR amendment +
  a code change + an updated test. Mitigation: AC18 covers all 32
  cells; the `requiredRoleFor` boundary tests (`2500c` → cashier,
  `2501c` → manager) catch the most error-prone arithmetic.
  Premortem must address "what if a future code change accidentally
  uses `<` instead of `<=`" — the boundary tests catch this.

- **ADR-0022 (PCI scope — SAQ A):** Slice 1 ships **ZERO** card-data
  UI. No PAN, no CVV, no expiry, no card brand, no last-4. The
  refund-form (AC28) takes only a `targetPaymentId` (a `bigint` —
  our internal `payments.id`, never a Stripe object ID directly
  exposed to the form input — though Slice 1 accepts a text input
  that Slice 2 will replace with a server-side lookup). The
  membership state override surface (deferred to Slice 2) similarly
  never renders card data — card management is always a deep link
  to the Stripe Billing Portal per the ADR. Mitigation: this spec
  affirms the boundary explicitly; the (future) deep-link helper
  for the Billing Portal is deferred to Slice 2 per the Out-of-scope
  list. A premortem question to address: "could a future worker
  add a 'last-4' display field to the refund form 'for UX'?" Answer:
  no — the spec pins the form fields to the four listed in AC28,
  and any addition requires an ADR-0022 amendment.

## Out of scope

This slice deliberately does not ship the following (explicit per
the dispatch envelope; deferred either to Slice 2+ of ADR-0036 or
to other ADRs):

- **Webhook handler `/api/webhooks/stripe`** — deferred until
  ADR-0010 keys arrive. Slice 2 of ADR-0036 ships this; until then,
  every webhook-driven write to `payments`, `memberships`,
  `time_ledger`, `stripe_webhook_events`, `disputes`, and
  `refund_requests` is service-role-only and is not exercised
  by Slice 1.
- **Real `stripe.refunds.create` call** — server action throws
  `StripeNotConfiguredError` instead (AC21). Slice 2 wires the
  real Stripe SDK call once `STRIPE_SECRET_KEY` is set.
- **`/admin/payments/refunds` queue / history list** — deferred to
  Slice 2 of ADR-0036.
- **`/admin/payments/refunds/[id]` single-refund detail** —
  deferred to Slice 2.
- **`/admin/payments/members/[id]` per-member payment view** —
  deferred to Slice 2 (the existing
  `app/(admin)/admin/members/[id]/page.tsx` covers the cycle-1
  "Recent payments" placeholder removal in AC31).
- **`/admin/payments/members/[id]/adjust` time-bank adjustment
  form** — deferred to Slice 2.
- **`/admin/payments/members/[id]/membership` membership state
  override** — deferred to Slice 2.
- **`/admin/payments/reconciliation`** — needs Stripe API access;
  deferred to Slice 3 of ADR-0036.
- **`/admin/payments/webhooks` event log** — needs the webhook
  handler first; deferred to Slice 4.
- **`/admin/payments/kill-switches` panel** — deferred to Slice 2;
  the kill-switch audit verb constant ships in AC23 for
  forward-compat.
- **Stripe Billing Portal deep-link helper** — deferred to Slice 2
  once Stripe `customer_id` is populated by the webhook handler.
- **Receipt email integration** (Resend per ADR-0025) — deferred.
  Slice 2 of ADR-0036 wires the `charge.refunded` webhook → Resend
  send.
- **Property-based ledger arithmetic tests** (`fast-check`) —
  deferred per ADR-0021 §open-questions. The wallet trigger has
  example-based tests in AC5 / AC13 but no property-based
  invariant coverage in Slice 1.
- **Owner approval queue UX** — explicitly post-v1 per ADR-0036
  §Open questions. v1 (Slice 2 of ADR-0036) blocks over-authority
  refunds with `InsufficientAuthorityError`; the in-app queue is a
  future enhancement.
- **Automated reconciliation job** — deferred per ADR-0036
  §Open questions.
- **Bulk refund operations** — declined per ADR-0036
  §Open questions.
- **In-app Stripe dispute response UI** — deferred per ADR-0027
  §open-questions.
- **Automated webhook event replay** — deferred per ADR-0036
  §Open questions.
- **Card-management UI of any kind** — locked out structurally
  per ADR-0022. Slice 2's Billing Portal deep-link is the only
  card-touching feature ever planned.
- **Refund reason taxonomy beyond the five values pinned in AC8 /
  AC21** — deferred per ADR-0036 §Open questions until a tax
  reporting need surfaces.

## Open questions

These are resolved during planning (planner phase of the conductor
cycle). Each is sufficiently narrow that planner can pick a default
without re-prompting the user.

1. **Fail-loud audit-row `target_id` value.** AC21 step 6 pins the
   `targetId` to the literal string `'pending'` because
   `audit_log.target_id` is `text NOT NULL` per ADR-0006 — there's
   no refund_requests row to point at yet. Alternative: INSERT a
   `denied`-status `refund_requests` row first (capturing the form
   values + the `idempotency_key`), then point the audit row at
   that row's id. The "row first" alternative preserves the
   idempotency-key consumption (a same-key retry hits the unique
   constraint) but commits a denied-state row even when the
   actor's intent was completed (Stripe was simply unavailable).
   **Recommended default:** the AC21 stance — `target_id =
   'pending'`, no `refund_requests` row written on the fail-loud
   path. Slice 2 writes the row only on the happy path (Stripe
   call succeeded or returned a specific error). Planner to
   confirm.

2. **Authority-denial vs Stripe-not-configured audit row distinction.**
   AC22 pins that when an actor's `requireRole` or
   `assertRefundAuthority` denies, NO `admin.refund.denied` audit
   row is written (the `requireRole` denial happens before
   `withAudit` is even called; the authority guard runs before
   the audit-tx too). When `assertStripeConfigured` denies (the
   fail-loud path), the `admin.refund.denied` row IS written with
   `reason: 'stripe_not_configured'`. The dispatch envelope's AC7
   wording — "Audit row `admin.refund.denied` writes through
   `withAudit` even on the fail-loud path" — matches this stance.
   Planner: confirm the asymmetry is intentional (yes — over-authority
   is "user error caught at the gate"; not-configured is "system
   error caught after the gate"). Slice 2 will add a
   `admin.refund.authority_denied` constant if forensics ever
   need to distinguish; for Slice 1, the absence of a row IS the
   signal.

3. **`time_wallets.balance_cents` generated-column compatibility.**
   AC3's `GENERATED ALWAYS AS ... STORED` is Postgres 12+ syntax.
   pglite supports it; hosted Supabase Postgres is 15+, so it
   supports it. But the `pnpm migrate:check` scanner may flag
   generated columns as a novel pattern. Planner: confirm scanner
   posture; if it flags, fall back to a plain `bigint` column
   populated by the trigger (the AC5 trigger updates BOTH columns
   in that fallback). **Recommended:** generated column;
   fall-back-to-trigger is a one-line scanner-comment exception.

4. **`assertStripeConfigured` env-var name.** The AC20 contract
   reads `process.env.STRIPE_SECRET_KEY`. The repo's secret
   convention (per ADR-0007) is `*_SECRET_KEY` with an underscore.
   `next.config` may add a `NEXT_PUBLIC_` prefix variant (which
   would be a leak — secret keys are server-only). Planner:
   confirm no `NEXT_PUBLIC_STRIPE_*` env var exists in the repo;
   if it does, the env-probe explicitly rejects it. Slice 2's
   ADR-0007 wiring will add `STRIPE_WEBHOOK_SECRET` as a separate
   env var (also probed at webhook-handler init).

5. **Route-map test placement.** AC32's
   `tests/docs/route-map-payments.test.ts` may not be the right
   location if no `tests/docs/` directory exists yet (it does not
   per the dispatch envelope's tree-walk). Planner: create
   `tests/docs/` as a new test category, OR fold the assertion
   into an existing test file. **Recommended:** create
   `tests/docs/` — future doc-drift tests (e.g. ADR-table
   verifications, route-map drift) belong there.
