# ADR-0036: Payment management console

- **Status:** Accepted
- **Date:** 2026-05-15
- **Ratified:** 2026-05-15
- **Slice:** 4 (refund tooling + reconciliation viewer + kill-switch panel); Slice 2/3 prerequisites land webhook handler and schema
- **content_signature:** a53419ddf6ee

> One-sentence summary: A `/admin/payments/**` console gives manager+ staff a single surface to issue refunds within an authority-matrix-enforced workflow, view per-member time-bank ledgers, reconcile local state against Stripe, inspect webhook health, and toggle payment kill-switches — with zero card-data on our side, every money move idempotency-keyed, and every action audit-logged.

## Context

The payment subsystem is fully *designed* across ADR-0010 (membership subscriptions), ADR-0011 (time-bank ledger), ADR-0022 (PCI SAQ A boundary), ADR-0027 (support-ops refund authority matrix), ADR-0004 (cents arithmetic), and ADR-0005 (idempotency). What does not yet exist is the **operational surface** that lets a manager actually *use* that design: issue a refund, see why Stripe says a member is past-due when our DB says current, confirm a webhook landed, or pull the lever marked `kill-stripe-webhook` at 11 PM on a Saturday.

ADR-0027 defines the refund authority matrix but treats the tooling as a given. ADR-0011 specifies the time-bank ledger schema but does not specify the admin viewer that staff use to read it. ADR-0020 introduces kill-switches but the payment-flow toggles are not yet wired. The Stripe SDK is installed (`stripe@^17.4.0`, `@stripe/stripe-js@^4.10.0` per `package.json`) and the Stripe-side decisions (Products, Prices, collection_method, dunning cadence) are committed, but **no webhook handler exists** and **no admin payment routes exist**. ADR-0035 (admin operations console) ships the shell + auth gate that this ADR plugs into.

This ADR collapses the design surface into a concrete, shippable console. It is the layer where ADR-0027's prose authority matrix becomes a runtime guard, where ADR-0005's idempotency requirement becomes a unique index on `refund_requests.idempotency_key`, where ADR-0006's audit-log convention becomes ~20 declared action verbs, and where ADR-0022's PCI boundary becomes an explicit rule: every card-management UI is a deep link to the Stripe Billing Portal, never a form we render. The console exists to make every dollar that moves through Stripe *legible* and *reversible* by an authorized human.

The choice to lock this to admin-only is deliberate. Member-facing payment surfaces (subscribe, top-up, view receipts, change billing method) belong to the flows in ADR-0010 and ADR-0011 and are explicitly *not* in scope here. This separation matters: an admin can issue a refund without the member being online; a member never initiates a refund themselves (they request one via the support inbox per ADR-0027 §tier-2, and a manager actions it through this console). One console, one role-gated audience, one authority chain.

The cost of getting this wrong is high: a duplicate refund double-credits a member's card, a missed webhook event leaves `memberships.status` permanently out of sync with Stripe, an over-authority refund slips past the matrix because the guard wasn't called. The mitigations — idempotency keys, audit transactions, authority guards, kill-switches — are all individually decided in earlier ADRs; this ADR is where they compose.

## Decision

**We will build a `/admin/payments/**` console that gives manager+ staff a single surface to issue refunds, view ledgers, reconcile against Stripe, and toggle payment kill-switches, with all card data remaining outside our PCI scope per ADR-0022.**

The console is composed of seven surfaces under one route tree, gated by ADR-0003 role precedence (`manager+` minimum; some surfaces `owner`-only). Every mutation is wrapped in a server action that runs an authority guard (ADR-0027), generates or accepts an idempotency key (ADR-0005), and writes an `audit_log` row in the same transaction as the state change (ADR-0006). Every render of money calls `formatMoney` (ADR-0004). Every render of a timestamp shows UTC primary with Central annotation (ADR-0034 §audit-log-presentation-contract). No surface displays PAN, CVV, or expiry; card management is a deep link to the Stripe Billing Portal (ADR-0022).

## Information architecture

```
/admin/payments                            overview (recent refunds, webhook health, dispute count)
/admin/payments/refunds                    refund queue + history (filterable by status, actor, date)
/admin/payments/refunds/new                initiate refund (form; takes target payment_intent or member)
/admin/payments/refunds/[id]               single-refund detail (state, audit trail, Stripe link)
/admin/payments/members/[id]               per-member payment view (memberships + Stripe + ledger)
/admin/payments/members/[id]/adjust        manual time-bank credit/debit (authority-gated form)
/admin/payments/members/[id]/membership    membership state override (manager+: cancel / extend / reactivate)
/admin/payments/reconciliation             Stripe vs local drift report (read-only)
/admin/payments/webhooks                   webhook event log (last 50 + lag metrics)
/admin/payments/kill-switches              payment kill-switch panel (subset of /admin/flags)
```

| Route | Role gate | Data source | Mutations | Audit events |
|---|---|---|---|---|
| `/admin/payments` | `manager+` | local DB (last 14d) + Stripe `disputes.list` | none | none |
| `/admin/payments/refunds` | `manager+` | `refund_requests` join `payments` | none | none |
| `/admin/payments/refunds/new` | `manager+` (gated by authority guard) | `payments` lookup + Stripe `refunds.create` | `refunds.create` | `admin.refund.initiated`, `admin.refund.completed` (or `admin.refund.denied`) |
| `/admin/payments/refunds/[id]` | `manager+` | `refund_requests` + `audit_log` + Stripe `refunds.retrieve` | none | none |
| `/admin/payments/members/[id]` | `manager+` (or `cashier` for read-only ledger) | `memberships`, `payments`, `time_wallets`, `time_ledger`, Stripe `customers.retrieve` | none | none |
| `/admin/payments/members/[id]/adjust` | `cashier+` (authority-capped) | `time_wallets`, `time_ledger` | `INSERT time_ledger` | `admin.time_bank.manual_credit` or `admin.time_bank.manual_debit` |
| `/admin/payments/members/[id]/membership` | `manager+` | `memberships` + Stripe `subscriptions.update`/`.cancel` | `subscriptions.update`, `subscriptions.cancel`, or local-only state write | `admin.membership.status_overridden`, `admin.membership.canceled`, `admin.membership.reactivated`, `admin.membership.grace_extended` |
| `/admin/payments/reconciliation` | `manager+` | local DB + Stripe `payment_intents.list`, `subscriptions.list` | none | none |
| `/admin/payments/webhooks` | `manager+` | `stripe_webhook_events` table | none | none |
| `/admin/payments/kill-switches` | `manager+` | `feature_flags` filtered to `kill-stripe-*`, `kill-refunds`, `kill-time-topup` | `UPDATE feature_flags` | `admin.kill_switch.toggled` |

The `/admin/payments` overview is intentionally read-only and dense: three cards (recent refunds, webhook health, open disputes count) plus a "drift" indicator if reconciliation found any. Every card links to its full surface. This is the page a manager loads on a slow afternoon to confirm "is the money working?".

## Refund approval workflow (the core)

A refund is the highest-stakes operation in this console. It moves real money out of a Stripe account and credits the member's card. Authority matters; idempotency matters; the audit trail matters.

### State diagram

```
[draft]   manager fills the new-refund form
   |
   v
[checking_authority]   server action runs assertRefundAuthority()
   |
   +--- denied ---> [denied]   audit: admin.refund.denied; UI shows InsufficientAuthorityError
   |
   v
[approved_local]   refund_requests row INSERT with idempotency_key (UUID v4 from form mount)
   |
   v
[stripe_calling]   stripe.refunds.create(...) with Stripe-Idempotency-Key header = idempotency_key
   |
   +--- Stripe 4xx ---> [failed]   audit: admin.refund.failed; refund_requests.status='failed'
   |                                Stripe error message stored; manager sees actionable error
   |
   v
[stripe_accepted]   Stripe returns refund.id with status='pending' or 'succeeded'
   |                refund_requests.stripe_refund_id = refund.id
   |                refund_requests.status = stripe status
   |                audit: admin.refund.completed (or admin.refund.pending)
   |                time_ledger 'refund' entry written if time-bank refund
   |
   v
[webhook_confirming]   wait for charge.refunded webhook to confirm settlement
   |
   v
[settled]   refund_requests.status='settled'; receipt email fired via Resend (ADR-0025)
            audit: admin.refund.settled
```

### Sequence diagram

```
Manager UI                Server Action            Stripe API                 DB                       Webhook
    |                          |                       |                       |                           |
    |--submit refund(form)---->|                       |                       |                           |
    |   {payment_id, amount,   |                       |                       |                           |
    |    reason, idem_key}     |                       |                       |                           |
    |                          |                       |                       |                           |
    |                          |--assertAuthority()--->|                       |                           |
    |                          |   (in-process check   |                       |                           |
    |                          |    against ADR-0027)  |                       |                           |
    |                          |                       |                       |                           |
    |                          |--BEGIN tx------------------------------->     |                           |
    |                          |                       |                       |                           |
    |                          |--INSERT refund_requests--------------->       |                           |
    |                          |   (idempotency_key unique)                    |                           |
    |                          |                       |                       |                           |
    |                          |--INSERT audit_log (admin.refund.initiated)--> |                           |
    |                          |                       |                       |                           |
    |                          |--refunds.create()---->|                       |                           |
    |                          |   Stripe-Idempotency- |                       |                           |
    |                          |   Key: <idem_key>     |                       |                           |
    |                          |                       |                       |                           |
    |                          |<------refund object---|                       |                           |
    |                          |                       |                       |                           |
    |                          |--UPDATE refund_requests SET stripe_refund_id->|                           |
    |                          |                       |                       |                           |
    |                          |--INSERT audit_log (admin.refund.completed)--->|                           |
    |                          |                       |                       |                           |
    |                          |--INSERT time_ledger (kind='refund')------>    |                           |
    |                          |   (only if time-bank refund; idempotency_key=refund_request_id)           |
    |                          |                       |                       |                           |
    |                          |--COMMIT tx---------------------------------->|                           |
    |                          |                       |                       |                           |
    |<------success------------|                       |                       |                           |
    |                          |                       |                       |                           |
    |                          |                       |                       |    charge.refunded ------>|
    |                          |                       |                       |                  (webhook)|
    |                          |                       |    UPDATE refund_requests SET status='settled' <--|
    |                          |                       |    INSERT audit_log (admin.refund.settled) <------|
    |                          |                       |    fire receipt email via Resend           <------|
```

The transaction boundary matters. If the Stripe call succeeds but the DB transaction fails to commit (network, deploy mid-flight), Stripe has issued the refund but our state is inconsistent. **Idempotency is the recovery mechanism:** a retry of the same server action carries the same `idempotency_key`; the Stripe call returns the already-existing refund object; the second `INSERT refund_requests` either succeeds (if first DB tx never landed) or fails the unique constraint (if first tx did land), and the handler renders the existing row.

### Edge cases

- **Partial refund** — `amount_cents` is supplied in the form; defaults to the full payment amount but is editable down. The authority guard runs against the *requested* amount, not the original payment.
- **Refund of an already-refunded payment** — Stripe enforces "cannot refund more than charged"; our UI surfaces remaining refundable amount on the form. If a second refund_request targets the same `payment_intent_id` with the same `idempotency_key`, the unique index blocks the duplicate; if the keys differ (legitimately separate operation), Stripe enforces the cap and we surface the error.
- **Refund after subscription canceled** — allowed; refunds the underlying `payment_intent`, not the subscription. Authority check applies (`membership_previous` if `created_at` is in a previous billing cycle).
- **Refund of a time-bank top-up** — writes a `refund` row to `time_ledger` (ADR-0011) in the same transaction. If the member has already redeemed against the balance, the ledger may go negative; the surface flags this for the manager.
- **Stripe failure mid-transaction** — see above. Idempotency recovers; the manager sees an actionable error ("Stripe declined — code: `charge_already_refunded`") and the audit row distinguishes `initiated` from `completed`.
- **Over-authority request** — guard throws `InsufficientAuthorityError`; UI displays "this refund requires owner approval — contact the owner directly". Owner approval queue UX is **deferred to post-v1** (open question); v1 just blocks the action with an explanatory error per ADR-0027.

## Authority enforcement

The runtime enforcement of ADR-0027's refund authority matrix lives in a single helper:

```typescript
// lib/payments/authority.ts
import type { Cents } from '@/lib/money/types';
import type { Role } from '@/lib/auth/roles';

export type RefundType =
  | 'time_bank'              // top-up refund (writes time_ledger 'refund' entry)
  | 'membership_current'     // current-month membership charge
  | 'membership_previous';   // previous-month membership charge

export class InsufficientAuthorityError extends Error {
  constructor(
    public actorRole: Role,
    public required: Role,
    public refundType: RefundType,
    public amountCents: Cents,
  ) {
    super(
      `Role '${actorRole}' cannot issue a ${refundType} refund of ` +
      `${amountCents}c; requires '${required}'.`
    );
    this.name = 'InsufficientAuthorityError';
  }
}

export async function assertRefundAuthority(opts: {
  actorRole: Role;
  amountCents: Cents;
  refundType: RefundType;
  monthsBack?: number; // for membership_previous, how far back
}): Promise<void> {
  const { actorRole, amountCents, refundType } = opts;
  const required = requiredRoleFor(refundType, amountCents);
  if (!roleAtLeast(actorRole, required)) {
    throw new InsufficientAuthorityError(actorRole, required, refundType, amountCents);
  }
}

function requiredRoleFor(refundType: RefundType, amountCents: Cents): Role {
  if (refundType === 'time_bank') {
    if (amountCents <= 2500)   return 'cashier';   // ≤ $25
    if (amountCents <= 20000)  return 'manager';   // $25–$200
    return 'owner';                                // > $200
  }
  if (refundType === 'membership_current')  return 'manager';
  if (refundType === 'membership_previous') return 'owner';
  // exhaustiveness check
  const _: never = refundType;
  return _;
}
```

### Authority lookup table (canonical — matches ADR-0027 §refund-authority)

| Operation | Amount | Cashier | Manager | Owner |
|---|---|---|---|---|
| Manual time-bank credit | ≤ $25 | ✓ | ✓ | ✓ |
| Manual time-bank credit | $25–$200 | — | ✓ | ✓ |
| Manual time-bank credit | > $200 | — | — | ✓ |
| Time-bank top-up refund (Stripe) | ≤ $25 | ✓ | ✓ | ✓ |
| Time-bank top-up refund (Stripe) | $25–$200 | — | ✓ | ✓ |
| Time-bank top-up refund (Stripe) | > $200 | — | — | ✓ |
| Membership refund — current month | any | — | ✓ | ✓ |
| Membership refund — prior months | any | — | — | ✓ |
| Membership state override | any | — | ✓ | ✓ |
| Kill-switch toggle (payment) | n/a | — | ✓ | ✓ |
| Manual debit (correction) | ≤ $25 | ✓ | ✓ | ✓ |
| Manual debit (correction) | $25–$200 | — | ✓ | ✓ |

The guard is called **before** any Stripe API call, **before** any DB write. The guard is unit-tested against every cell of the matrix (see Testing strategy). The matrix is the single source of truth: changes here require an ADR-0027 amendment plus a code change plus the updated tests.

## Stripe integration surface

Every Stripe API call and webhook event the console depends on:

### Reads (no idempotency key required — these are GETs)

- `stripe.customers.retrieve(customer_id)` — load Stripe customer for per-member view
- `stripe.subscriptions.list({ customer })` — show all subscriptions for a member
- `stripe.subscriptions.retrieve(sub_id)` — single subscription state
- `stripe.paymentIntents.list({ customer })` — payment history for reconciliation viewer
- `stripe.paymentIntents.retrieve(pi_id)` — single PI for refund form pre-fill
- `stripe.refunds.list({ payment_intent })` — existing refunds against a PI (for "remaining refundable" UI)
- `stripe.refunds.retrieve(re_id)` — single refund detail
- `stripe.disputes.list({ limit: 50 })` — open disputes count on overview

### Writes (every call carries `Stripe-Idempotency-Key`)

- `stripe.refunds.create({ payment_intent, amount, reason, metadata: { refund_request_id } }, { idempotencyKey })` — the refund itself; key derived from `refund_requests.idempotency_key`
- `stripe.subscriptions.update(sub_id, { cancel_at_period_end: true }, { idempotencyKey })` — soft cancel from membership-override surface
- `stripe.subscriptions.update(sub_id, { collection_method, default_payment_method }, { idempotencyKey })` — bill-method change initiated by manager on member's behalf (rare; usually members do this themselves via Billing Portal)
- `stripe.subscriptions.cancel(sub_id, { invoice_now: false, prorate: false }, { idempotencyKey })` — hard cancel (rare; manager-only)

Card-management writes (`paymentMethods.update`, `paymentMethods.detach`, address updates) are **not implemented**; admin redirects the member to the Stripe Billing Portal (ADR-0022).

### Webhook events consumed

| Event | Idempotency key | DB writes | Audit events |
|---|---|---|---|
| `payment_intent.succeeded` | `event.id` | `INSERT payments` (status='succeeded'); if metadata.kind='time_topup' also `INSERT time_ledger` (purchase + optional promo_bonus) | `webhook.stripe.received`, `payment.succeeded` |
| `payment_intent.payment_failed` | `event.id` | `INSERT payments` (status='failed') | `webhook.stripe.received`, `payment.failed` |
| `customer.subscription.created` | `event.id` | `INSERT memberships` or `UPDATE memberships` | `webhook.stripe.received`, `membership.created` |
| `customer.subscription.updated` | `event.id` | `UPDATE memberships SET status, collection_method, current_period_end` | `webhook.stripe.received`, `membership.updated` |
| `customer.subscription.deleted` | `event.id` | `UPDATE memberships SET status='canceled'` | `webhook.stripe.received`, `membership.canceled_by_stripe` |
| `invoice.payment_failed` | `event.id` | `UPDATE memberships SET past_due_since=now()` | `webhook.stripe.received`, `membership.past_due` |
| `charge.refunded` | `event.id` | `UPDATE refund_requests SET status='settled'`; fire receipt email | `webhook.stripe.received`, `admin.refund.settled` |
| `charge.dispute.created` | `event.id` | `INSERT disputes` (lightweight: id, payment_intent, amount, status, reason) | `webhook.stripe.received`, `dispute.opened` |
| `charge.dispute.closed` | `event.id` | `UPDATE disputes SET status, outcome` | `webhook.stripe.received`, `dispute.closed` |

Every webhook is signature-verified first (Stripe's `constructEvent` with the webhook secret per ADR-0007), then idempotency-checked via `INSERT INTO stripe_webhook_events (event_id) ON CONFLICT DO NOTHING RETURNING id`. If `ON CONFLICT` fires (duplicate event), the handler short-circuits and returns 200 — no side effects re-run (ADR-0005). If signature verification fails, return 400 and log to Sentry with tag `webhook_signature_failure`. If processing throws, the row is left with `processed_at = null` and a Slice-4 retry job (post-v1; v1 is alert-and-investigate) picks it up.

The `kill-stripe-webhook` flag (ADR-0020) short-circuits the handler **after** signature verification but **before** side effects, returning 200 (so Stripe stops retrying). When the flag is later disabled, queued events are still in Stripe's redelivery queue and can be replayed via Stripe Dashboard or by re-firing from the events log (manual v1; automated replay is post-v1).

## Data model

This ADR creates or amends the following tables. Tables marked **decided in earlier ADR, not yet migrated** ship in Slice A of this ADR (the schema slice that unblocks everything downstream).

### `payments` (created here, decided in ADR-0010/0011)

```sql
create table payments (
  id                   bigserial primary key,
  stripe_object_id     text not null,                -- payment_intent_id, charge_id, etc.
  kind                 text not null,                -- 'membership' | 'time_topup' | 'refund' | 'other'
  member_id            uuid not null references profiles(id),
  amount_cents         bigint not null,
  currency             text not null default 'usd',  -- guard column; raises alert if not 'usd' per ADR-0004
  status               text not null,                -- 'succeeded' | 'failed' | 'pending' | 'refunded' | 'partially_refunded'
  stripe_event_id      text,                         -- the webhook event.id that wrote this row
  raw_event            jsonb,                        -- full Stripe event payload (for forensics)
  idempotency_key      text,                         -- = stripe_event_id for webhook-written rows
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint payments_stripe_object_kind_unique unique (stripe_object_id, kind)
);
create index payments_member_idx       on payments (member_id, created_at desc);
create index payments_kind_status_idx  on payments (kind, status, created_at desc);
```

### `memberships` (created here, decided in ADR-0010)

```sql
create table memberships (
  member_id              uuid primary key references profiles(id),
  stripe_customer_id     text not null,
  stripe_subscription_id text,                                  -- null if never subscribed
  status                 text not null,                         -- mirrors Stripe subscription.status
  collection_method      text not null default 'charge_automatically',  -- or 'send_invoice'
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  past_due_since         timestamptz,                           -- nullable; set by invoice.payment_failed
  cancel_at_period_end   boolean not null default false,
  raw_event              jsonb,                                 -- last Stripe sub object (debugging aid)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index memberships_status_idx on memberships (status, current_period_end);
```

### `time_wallets` (created here, decided in ADR-0011)

```sql
create table time_wallets (
  member_id          uuid primary key references profiles(id),
  balance_minutes    bigint not null default 0,
  last_activity_at   timestamptz,                       -- ADR-0011 dormancy clock
  updated_at         timestamptz not null default now()
);
```

### `time_ledger` (created here, decided in ADR-0011)

```sql
create table time_ledger (
  id                  bigserial primary key,
  member_id           uuid not null references profiles(id),
  action              text not null,                    -- 'purchase' | 'promo_bonus' | 'refund' | 'redemption' | 'manual_credit' | 'manual_debit' | 'dormancy_conversion' | 'escheatment'
  amount_minutes      bigint not null,                  -- positive = credit, negative = debit
  source_payment_id   bigint references payments(id),   -- null for manual entries
  reason              text,                             -- free text for manual entries
  actor_id            uuid references profiles(id),     -- null = system (webhook-driven)
  idempotency_key     text not null,
  created_at          timestamptz not null default now(),

  constraint time_ledger_idempotency_key_unique unique (idempotency_key)
);
create index time_ledger_member_idx on time_ledger (member_id, created_at desc);
create index time_ledger_action_idx on time_ledger (action, created_at desc);
```

A Postgres trigger on `time_ledger` recomputes `time_wallets.balance_minutes` as the running sum. The trigger fires in the same transaction as the ledger insert; consistency is enforced by the DB, not by application code.

### `refund_requests` (NEW — owned by this ADR)

```sql
create table refund_requests (
  id                bigserial primary key,
  target_payment_id bigint not null references payments(id),
  member_id         uuid not null references profiles(id),
  actor_id          uuid not null references profiles(id),  -- the staff member who initiated
  refund_type       text not null,                          -- 'time_bank' | 'membership_current' | 'membership_previous'
  amount_cents      bigint not null,
  reason            text not null,                          -- enum: 'duplicate' | 'fraudulent' | 'requested_by_customer' | 'goodwill' | 'other'
  reason_note       text,                                   -- free-text supplement
  status            text not null default 'pending',        -- 'pending' | 'stripe_pending' | 'settled' | 'failed' | 'denied'
  stripe_refund_id  text,
  stripe_error      jsonb,                                  -- on failure
  idempotency_key   text not null,
  created_at        timestamptz not null default now(),
  settled_at        timestamptz,

  constraint refund_requests_idempotency_key_unique unique (idempotency_key)
);
create index refund_requests_member_idx on refund_requests (member_id, created_at desc);
create index refund_requests_status_idx on refund_requests (status, created_at desc);
```

### `stripe_webhook_events` (NEW — owned by this ADR)

```sql
create table stripe_webhook_events (
  event_id        text primary key,                       -- Stripe's evt_*
  event_type      text not null,                          -- 'payment_intent.succeeded' etc.
  livemode        boolean not null,
  payload         jsonb not null,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,                            -- null until handler completes
  processing_ms   integer,                                -- time from received to processed
  error           text                                    -- error message if processing failed
);
create index stripe_webhook_events_received_idx on stripe_webhook_events (received_at desc);
create index stripe_webhook_events_unprocessed_idx on stripe_webhook_events (received_at) where processed_at is null;
```

### `disputes` (NEW — owned by this ADR; minimal mirror)

```sql
create table disputes (
  stripe_dispute_id  text primary key,
  payment_intent_id  text not null,
  member_id          uuid references profiles(id),       -- best-effort join via customer_id
  amount_cents       bigint not null,
  status             text not null,                      -- mirrors Stripe dispute.status
  reason             text,
  outcome            text,                               -- on close
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```

The disputes table is intentionally minimal; **dispute response UI is deferred per ADR-0027 §open-questions.** This table exists so the overview page can show a count and link out to the Stripe Dashboard.

### RLS policies

```sql
alter table payments              enable row level security;
alter table memberships           enable row level security;
alter table time_wallets          enable row level security;
alter table time_ledger           enable row level security;
alter table refund_requests       enable row level security;
alter table stripe_webhook_events enable row level security;
alter table disputes              enable row level security;

-- payments: members read self; cashier+ read all; only service-role writes
create policy payments_self_read on payments
  for select using (member_id = auth.uid() or auth.role_at_least('cashier'));

-- memberships: members read self; manager+ read/write all
create policy memberships_self_read on memberships
  for select using (member_id = auth.uid() or auth.role_at_least('cashier'));
create policy memberships_manager_write on memberships
  for update using (auth.role_at_least('manager'));

-- time_wallets: members read self; cashier+ read all
create policy time_wallets_self_read on time_wallets
  for select using (member_id = auth.uid() or auth.role_at_least('cashier'));

-- time_ledger: members read self; cashier+ read all; cashier+ insert (bounded by authority)
create policy time_ledger_self_read on time_ledger
  for select using (member_id = auth.uid() or auth.role_at_least('cashier'));
create policy time_ledger_cashier_insert on time_ledger
  for insert with check (auth.role_at_least('cashier'));

-- refund_requests: manager+ only (read or write)
create policy refund_requests_manager_read on refund_requests
  for select using (auth.role_at_least('manager'));
create policy refund_requests_manager_insert on refund_requests
  for insert with check (auth.role_at_least('manager'));

-- stripe_webhook_events: manager+ read; service-role writes only
create policy stripe_webhook_events_manager_read on stripe_webhook_events
  for select using (auth.role_at_least('manager'));

-- disputes: manager+ read; service-role writes only
create policy disputes_manager_read on disputes
  for select using (auth.role_at_least('manager'));
```

### Migration ordering (Slice A)

1. `payments` (no FK to refund_requests yet)
2. `memberships`
3. `time_wallets`
4. `time_ledger` (FK to `payments`)
5. `disputes`
6. `stripe_webhook_events`
7. `refund_requests` (FK to `payments`)
8. Trigger: `time_ledger` → `time_wallets.balance_minutes` recompute
9. RLS policies on all of the above

Each migration is its own file under `supabase/migrations/` per ADR-0018, run sequentially. Slices B–E do not add tables; they add routes, server actions, and UI.

## Idempotency

Every refund_requests row carries an `idempotency_key`, generated client-side as a UUID v4 in the refund form's `useState` initializer (per ADR-0005's cashier-redemption pattern). Server-side, that same key is:

1. Inserted into `refund_requests.idempotency_key` (unique index — second attempt with same key 23505s, handler treats it as success and returns the existing row)
2. Passed to Stripe as `{ idempotencyKey }` option on `stripe.refunds.create(...)` — Stripe's own dedup ensures the refund isn't double-issued even if our DB transaction retries
3. Used as the `time_ledger.idempotency_key` for the corresponding `refund` ledger entry (so the ledger entry is also idempotent against the same key)

Manual time-bank adjustments use the same pattern: form-mount UUID → `time_ledger.idempotency_key`. Kill-switch toggles do not need idempotency (it's an UPDATE on a single row; the desired state is the desired state — no money moves).

Stripe webhook events use `event.id` as the key, written into `stripe_webhook_events.event_id` as the primary key. Duplicate deliveries hit the PK constraint and are treated as no-ops per ADR-0005.

## PCI scope reinforcement

**The console renders only Stripe IDs (customer IDs, payment_intent IDs, subscription IDs, refund IDs) and amounts. It never renders, requests, or transmits PAN, CVV, or expiry.** Card brand and last-4 (if shown for member identification) come from Stripe's API responses on the server and are passed to the client only as already-redacted display strings (`"Visa ending in 4242"`).

Card-management actions — replace card, update billing address, change default payment method on a subscription — are **deep links to the member's Stripe Billing Portal session** generated via `stripe.billingPortal.sessions.create({ customer })`. Per ADR-0022, we never build a custom card-edit UI. The admin's role is to *generate a portal link and send it to the member* (via email through Resend, or read it to them over the phone); the admin does not type a card number into anything on our domain.

This decision is non-negotiable for v1. The cost of building a custom card UI is not the engineering effort — it's the jump from SAQ A to SAQ A-EP or SAQ D, which would impose quarterly ASV scans, an annual external pen-test, and a 200+ question annual self-assessment. We stay in SAQ A.

## Audit event taxonomy

Every state-changing action in this console writes an `audit_log` row in the same transaction as the change (ADR-0006). The canonical `action` values:

| Action | Target type | Written by | Notes |
|---|---|---|---|
| `admin.refund.initiated` | `refund_request` | manager+ server action | written before Stripe call |
| `admin.refund.completed` | `refund_request` | manager+ server action | written after Stripe success |
| `admin.refund.failed` | `refund_request` | manager+ server action | written on Stripe 4xx |
| `admin.refund.denied` | `refund_request` (id=null) | manager+ server action | over-authority attempts |
| `admin.refund.settled` | `refund_request` | webhook handler | on `charge.refunded` |
| `admin.membership.status_overridden` | `membership` | manager+ server action | manual status write |
| `admin.membership.canceled` | `membership` | manager+ server action | calls Stripe `subscriptions.cancel` or `update(cancel_at_period_end)` |
| `admin.membership.reactivated` | `membership` | manager+ server action | un-sets `cancel_at_period_end` |
| `admin.membership.grace_extended` | `membership` | manager+ server action | manual `past_due_since` reset |
| `admin.time_bank.manual_credit` | `time_ledger` | cashier+ server action | authority-capped |
| `admin.time_bank.manual_debit` | `time_ledger` | cashier+ server action | authority-capped |
| `admin.kill_switch.toggled` | `feature_flags` | manager+ server action | wraps ADR-0020 toggle |
| `webhook.stripe.received` | `stripe_webhook_events` | webhook handler | one per event, written after signature verify |
| `webhook.stripe.processed` | `stripe_webhook_events` | webhook handler | written after side effects complete |
| `webhook.stripe.failed` | `stripe_webhook_events` | webhook handler | written if handler throws |
| `webhook.stripe.skipped_kill_switch` | `stripe_webhook_events` | webhook handler | written when `kill-stripe-webhook` is on |
| `payment.succeeded` | `payments` | webhook handler | side effect of `payment_intent.succeeded` |
| `payment.failed` | `payments` | webhook handler | side effect of `payment_intent.payment_failed` |
| `membership.past_due` | `membership` | webhook handler | side effect of `invoice.payment_failed` |
| `dispute.opened` | `dispute` | webhook handler | side effect of `charge.dispute.created` |
| `dispute.closed` | `dispute` | webhook handler | side effect of `charge.dispute.closed` |

Twenty-two action verbs. Each is a constant in `lib/audit/actions.ts` to prevent typos; a lint rule (paralleling ADR-0006's `audit-policy`) flags writes to the seven payment-related tables that don't go through `withAudit`.

## Observability

### Sentry

- Tags on every payment-related transaction: `payment_op` (refund_initiate / refund_complete / membership_override / manual_adjust / kill_switch_toggle / webhook_process), `refund_type` (when applicable), `actor_role` (cashier / manager / owner), `stripe_event_type` (when applicable).
- `beforeSend` redacts `stripe_customer_id`, `stripe_payment_intent_id`, `stripe_subscription_id`, `card_last4` from event payloads (ADR-0014 §privacy — these aren't PAN but they're correlatable PII).
- New error fingerprints: `InsufficientAuthorityError`, `StripeRefundFailed`, `WebhookSignatureFailed`, `WebhookProcessingFailed`.

### PostHog

- `refund_initiated` — props: `refund_type`, `amount_cents_bucket` (0-25 / 25-100 / 100-500 / 500+), `actor_role`
- `refund_completed` — same props plus `latency_ms`
- `refund_denied` — props: `refund_type`, `actor_role`, `required_role`
- `kill_switch_toggled` — props: `flag_key`, `new_state`
- `membership_state_overridden` — props: `from_status`, `to_status`, `actor_role`
- `webhook_processed` — props: `event_type`, `latency_ms`, `success`

### Alerts (ADR-0015)

- **SEV1** — Stripe webhook processing failure rate > 10% over 5 min, OR webhook lag (received → processed) > 5 min for any single event, OR `kill-stripe-webhook` toggled by anyone (notify owner immediately so they know it's intentional, not a security incident).
- **SEV2** — refund failure rate > 5% / hour, drift count from reconciliation viewer > 5 members at end of day, dispute opened.
- **SEV3** — manual time-bank adjustments > 10/day (unusual volume; might indicate a UX bug pushing staff to work around the system).

## Failure modes

| Failure | Detection | Recovery | Runbook |
|---|---|---|---|
| Stripe API down (refund) | server action catches Stripe error; refund_requests.status='failed' | idempotency-keyed retry: manager re-submits; same idem_key returns existing failed row → manager retries via "retry" button which uses the same key (Stripe redrives) | `runbook-refund-flow.md` |
| Webhook delivery lag | Sentry alert (lag > 5 min); `/admin/payments/webhooks` shows queue depth | Stripe Dashboard → Resend events; OR enable `kill-stripe-webhook` if cascading | `runbook-stripe-webhook-down.md` |
| Refund succeeds in Stripe but DB tx fails | Sentry exception; reconciliation viewer shows drift (Stripe has refund, local doesn't) | manager replays from refund form with same idempotency_key — Stripe returns existing refund, DB tx re-runs and succeeds; OR webhook handler eventually catches up via `charge.refunded` event | `runbook-refund-flow.md` |
| Webhook signature verification fails | Sentry alert tagged `webhook_signature_failure`; 400 to Stripe | rotate webhook secret per ADR-0007; investigate source (legitimate Stripe retry with old secret? attacker?) | `runbook-suspected-fraud.md` |
| Duplicate webhook event delivery | silent — handled by `stripe_webhook_events.event_id` PK conflict | n/a (designed behavior per ADR-0005) | — |
| `kill-stripe-webhook` left on too long | Stripe retries exhaust (Stripe retries for 3 days); events lost from Stripe's queue | replay events from Stripe Dashboard within 3-day window; for events older than 3 days, manual reconciliation via Stripe API + reconciliation viewer | `runbook-stripe-webhook-down.md` |
| Authority guard bypassed (bug) | covered by integration test in CI; runtime fallback is the RLS `manager+` policy on `refund_requests` | revert the offending PR; audit log shows who initiated; refund can be reversed via Stripe Dashboard or a counter-refund through the console | `runbook-payment-dispute.md` |
| Member-facing card update fails (Billing Portal session expired) | member reports; admin regenerates portal link | regenerate via Stripe Billing Portal session API | `runbook-refund-flow.md` (subsection) |

## Testing strategy

Per ADR-0021 tiers:

### Unit (Vitest, `lib/`)

- `assertRefundAuthority` against every cell of the authority matrix — including all denial paths. One test per (role, refundType, amountCents-bucket) tuple = ~30 tests.
- `formatMoney` / `formatMinutes` rendering for edge cases (negative balances, zero).
- Webhook idempotency: handler called twice with same `event.id` → side effects run once.
- Server actions for refund/adjust/override called with malformed input → Zod validation errors.

### Integration (Vitest + pglite + Stripe test mode, per ADR-0021 anti-mock-DB policy)

- Full refund flow with Stripe in test mode: create test payment_intent, fire refund through server action, assert `refund_requests` row + audit row + ledger row (for time-bank) + Stripe refund object exist with matching idempotency keys.
- Webhook handler with Stripe CLI fixture (`stripe trigger payment_intent.succeeded`): assert `payments` row written, `time_ledger` purchase + promo_bonus entries written, audit log entries written, second delivery is a no-op.
- Authority guard at the RLS layer: a `cashier`-role session that tries to `INSERT refund_requests` directly is rejected by RLS even if the application guard is bypassed.
- Membership override flow: manager calls `subscriptions.update(cancel_at_period_end=true)` → verify `memberships.cancel_at_period_end = true` after webhook → settle.

### E2E (Playwright vs preview)

- Happy path: manager signs in (with MFA per ADR-0003), navigates to `/admin/payments/refunds/new`, fills form, submits, sees success state, audit log row visible at `/admin/audit-log` (ADR-0035 viewer).
- Authority denial: cashier (in a `cashier`-role test user) attempts to load `/admin/payments/refunds/new` → redirected; if endpoint is hit directly → 403 with `InsufficientAuthorityError`.
- Kill-switch toggle: manager toggles `kill-stripe-webhook` → next webhook delivery is 200'd without side effects → audit row exists.

### Property-based (fast-check, deferred per ADR-0021 §open-questions)

Reserved for Slice 4+: time-bank ledger arithmetic invariants (sum of ledger amount_minutes == balance_minutes at all times).

## Slice plan

Each slice is independently shippable, in the sense that it does not break anything previously shipped. Slices are sequenced by data-dependency, not by user value.

### Slice A — schema + webhook handler (UNBLOCKS EVERYTHING)

- Migrations: `payments`, `memberships`, `time_wallets`, `time_ledger`, `disputes`, `stripe_webhook_events`, `refund_requests`, time-ledger-to-wallet trigger, RLS policies.
- Server route: `POST /api/webhooks/stripe` with signature verification + idempotent event insert + dispatch to event-type handlers.
- Sentry/PostHog wiring for webhook events.
- Tests: webhook idempotency, RLS enforcement, schema correctness.
- **Hard-blocks ship of Slices B–E.** No admin UI yet.
- **External hard-blocks:** Stripe account activation + live keys (ADR-0007), CPA opinion on TX escheatment (ADR-0011 — gates the bonus expiration logic in `time_ledger` writes), counsel opinion on member-agreement disclaimer language (ADR-0011).

### Slice B — ledger viewer + reconciliation viewer (read-only, ships first)

- Routes: `/admin/payments`, `/admin/payments/members/[id]`, `/admin/payments/reconciliation`.
- No mutations; safe to ship as soon as Slice A's data is flowing.
- Lets staff *see* the system before any of them can change it. High-confidence first delivery.

### Slice C — refund approval workflow (the core)

- Routes: `/admin/payments/refunds`, `/admin/payments/refunds/new`, `/admin/payments/refunds/[id]`.
- `assertRefundAuthority` + `stripe.refunds.create` + transactional audit + ledger writes.
- Receipt email integration (Resend per ADR-0025).
- E2E test gated on Stripe test-mode wiring.

### Slice D — manual adjustments + membership state override

- Routes: `/admin/payments/members/[id]/adjust`, `/admin/payments/members/[id]/membership`.
- Cashier-authority adjust form (≤$25 cap enforced); manager+ override form.
- Server actions calling `stripe.subscriptions.update` / `.cancel` with idempotency.

### Slice E — webhook health panel + kill-switch panel

- Routes: `/admin/payments/webhooks`, `/admin/payments/kill-switches`.
- Read-only event log with filterable status/event_type.
- Kill-switch panel is a thin filtered view onto `/admin/flags` (ADR-0020) — toggles audit through the same flag-toggle audit event with an additional `kill_switch_payment_op` tag.

## Dependencies & blockers

### Hard blockers (block code ship)

- **Stripe account activation + live keys** (ADR-0007) — Slice A's webhook handler needs the test keys; Slices B–E need both. Owner action.
- **CPA opinion on TX escheatment** (ADR-0011) — gates the bonus-expiration logic in `time_ledger.action='dormancy_conversion'`. Slice A can ship the schema without the policy; the dormancy job can't ship without the opinion. Manual time-bank adjustment (Slice D) does not depend on the escheatment opinion.
- **Counsel opinion on member-agreement disclaimer** (ADR-0011) — gates pre-launch communication, not the console itself.

### Soft blockers (don't block code; block public launch)

- **Owner pricing decisions** (ADR-0010 open questions) — annual prepay, founding-member coupon, family memberships. Console is pricing-agnostic; refunds work against whatever the price was.

### Code-only dependencies

- **ADR-0035 (admin operations console)** — ships the `/admin/**` shell, the role gate middleware, and the audit-log viewer. This ADR plugs into that shell.
- **ADR-0034 (timestamp policy)** — webhook event timestamps and audit log rendering depend on the UTC + Central rendering policy. Already ratified.
- **ADR-0014 (observability)** — Sentry + PostHog wiring already exists.

## Consequences

### Positive

- **Operational visibility** — a manager can answer "what's the state of payments right now?" from one page in five seconds.
- **Audit trail for every dollar moved** — refund, manual adjustment, membership override, webhook side effect — all in `audit_log`, all queryable by member, actor, action, date.
- **Authority enforcement is runtime, not prose** — ADR-0027's matrix is a TypeScript function that's unit-tested against every cell. The matrix can't drift from the code.
- **Kill-switch safety net** — `kill-stripe-webhook`, `kill-refunds`, `kill-time-topup` are one toggle away. A 11 PM Saturday outage is a flag flip, not a deploy.
- **Idempotency end-to-end** — refund form mount → server action → Stripe API → DB transaction all carry the same key. Retries are safe at every layer.
- **PCI scope unchanged** — staying in SAQ A is structurally enforced: no card form, no card display, no PAN in any table.

### Negative

- **More surface area for manager+ users** — the console is non-trivial to learn. Mitigation: runbooks (ADR-0027 references already-planned `runbook-refund-flow.md` etc.), in-app contextual help.
- **More Stripe API surface to maintain** — 11 read + 4 write endpoints + 9 webhook events. Each is a contract that can break on Stripe SDK upgrades. Mitigation: integration tests run against Stripe's CLI fixtures on every CI run (ADR-0021).
- **Refund-as-primary-support-action locks in a posture** — we commit to "refund first, ask questions in audit log" for member friction reduction. Tradeoff: easy for staff to over-issue refunds. Authority matrix caps per-role exposure.
- **Owner approval queue deferred** — managers cannot escalate over-authority refunds in-app; they must contact owner out-of-band. Acceptable at <1K members; revisit when support volume warrants.
- **Dispute response stays out-of-app** — managers must respond to disputes from the Stripe Dashboard. Per ADR-0027 §open-questions, accepted for v1.

### Locks in

- **Stripe as the sole payment processor** for v1. No ACH, no Zelle, no cash reconciliation. Out-of-band cash payments would require a manual `payments` row insert + manual `time_ledger` entry, both with audit trails — workable but not first-class.
- **USD-only.** A non-USD charge raises an alert (ADR-0004).
- **Refund-as-the-primary-reversal-mechanism.** We do not implement charge voids, ACH reversals, or any other Stripe operation that isn't `refunds.create`.

## Open questions (deferred)

- **Owner approval queue UX** — a queue of over-authority refund requests that an owner can approve in-app. Deferred post-v1; v1 blocks the action with an explanatory error per ADR-0027. Revisit at the 500-member or first-over-authority-request-from-a-manager threshold, whichever comes first.
- **Automated reconciliation job** — a nightly job that compares Stripe vs local and posts drift to Sentry. Deferred to Slice 5+; v1 is manual triage via the reconciliation viewer.
- **Bulk refund operations** — declined for v1. A bulk refund (e.g., refunding all members of a canceled tournament) is exactly the operation that benefits least from idempotency-per-row; the right design is a job-queue model that's out of scope here. Revisit if the operation becomes a recurring need.
- **Tax / financial CSV export beyond ledger CSV** — deferred to a future tax-reporting ADR. v1 ships a basic CSV export from the ledger viewer (member, action, amount, date, idempotency_key, source_payment_id).
- **In-app Stripe dispute response UI** — deferred per ADR-0027 §open-questions. Stripe Dashboard handles disputes natively; an in-app mirror is duplicate work until volume warrants.
- **Automated webhook event replay** — deferred. v1 replay is manual via Stripe Dashboard. Build automated replay when first incident shows it's needed.
- **Refund reason taxonomy fidelity** — v1 uses Stripe's standard reasons (`duplicate`, `fraudulent`, `requested_by_customer`, plus our `goodwill`, `other`). If the IRS or CPA requests a richer taxonomy for tax reporting, extend then.

## References

- **ADR-0003** (authorization model — roles & RLS) — the `manager+` / `cashier+` role precedence this console relies on.
- **ADR-0004** (money handling — integer cents) — `Cents` branded type, `formatMoney`, USD-only.
- **ADR-0005** (idempotency — exactly-once semantics) — every refund and ledger row carries a key; Stripe webhooks idempotent via `event.id`.
- **ADR-0006** (audit log — append-only) — every state change writes an audit row in the same transaction.
- **ADR-0007** (secrets management) — Stripe API keys and webhook signing secret storage.
- **ADR-0010** (membership subscription model) — Stripe Products, Prices, collection_method, dunning cadence.
- **ADR-0011** (time-bank model) — ledger schema, dormancy and escheatment policy, refund-as-ledger-entry convention.
- **ADR-0014** (observability) — Sentry, PostHog, dashboards.
- **ADR-0015** (alerting & incident response) — severity ladder for payment alerts.
- **ADR-0018** (database migrations) — migration template defaults to `timestamptz`.
- **ADR-0020** (feature flags) — `kill-stripe-webhook`, `kill-refunds`, `kill-time-topup`, plus `/admin/flags` host UI.
- **ADR-0021** (testing strategy) — unit/integration/E2E tiers, anti-mock-DB policy via pglite.
- **ADR-0022** (PCI scope) — SAQ A boundary; no card data in our domain.
- **ADR-0025** (email & SMS communications) — Resend for refund receipt emails.
- **ADR-0027** (support operations) — the canonical refund authority matrix this ADR enforces at runtime.
- **ADR-0032** (cost model & scaling thresholds) — Stripe fee policy.
- **ADR-0034** (timestamp & timezone policy) — UTC storage + Central annotation in audit and webhook viewers.
- **ADR-0035** (admin operations console) — the shell this console plugs into.
