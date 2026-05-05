# ADR-0006: Audit log — append-only, who-did-what

- **Status:** Accepted
- **Date:** 2026-05-04
- **Slice:** 1 (table + first writes), 4 (admin viewer UI)

## Context

Money flows through this app, identity is verified, refunds happen, roles are assigned. When a dispute or anomaly arises ("who refunded that $200?", "when did this account get promoted to manager?", "did the cashier really redeem 6 hours?"), we need an authoritative record.

Application logs (Sentry, Vercel) are not authoritative — they can be lost, sampled, or rotated. The audit log lives in Postgres alongside the data it describes, written in the same transaction as the change.

## Decision

A single `audit_log` table, append-only:

```sql
create table audit_log (
  id           bigserial primary key,
  actor_id     uuid references auth.users(id),       -- nullable: system actions
  action       text not null,                         -- e.g. 'membership.cancel'
  target_type  text not null,                         -- e.g. 'profile', 'membership'
  target_id    text not null,                         -- the row's id
  before       jsonb,                                 -- snapshot before the change
  after        jsonb,                                 -- snapshot after the change
  ip           inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);
create index audit_log_actor_idx     on audit_log (actor_id, created_at desc);
create index audit_log_target_idx    on audit_log (target_type, target_id, created_at desc);
create index audit_log_action_idx    on audit_log (action, created_at desc);
```

**No `update` or `delete` policies.** RLS allows `select` for `manager+` and `insert` from any authenticated session. Service role bypasses RLS for system-level entries (Stripe webhook side effects).

### What gets logged

- Every membership state transition (`active → past_due`, `past_due → canceled`, manual override)
- Every role change
- Every refund issued
- Every manual time-bank adjustment by a cashier or admin
- Every ID verification (the verifier, not the document content)
- Every member-initiated data export or deletion request
- Every staff sign-in (with IP/UA) — for security forensics

### What does NOT get logged

- Read access (too noisy; use Vercel logs if needed)
- Time-bank purchases (already captured immutably in `time_ledger`)
- Tournament registrations (in `tournament_regs.registered_at`)

### Write convention

Server actions that change auditable state wrap the write + audit insert in a transaction:

```ts
await db.transaction(async (tx) => {
  const before = await tx.from('memberships').select().eq('id', id).single();
  await tx.from('memberships').update({ status: 'canceled' }).eq('id', id);
  await tx.from('audit_log').insert({
    actor_id: session.user.id,
    action: 'membership.cancel',
    target_type: 'membership',
    target_id: id,
    before: before.data,
    after: { status: 'canceled' },
    ip, user_agent,
  });
});
```

A helper `lib/audit/withAudit(action, target, fn)` enforces the pattern.

### Retention

Audit log entries are kept **forever** in production. Even GDPR/CCPA "delete my account" requests do not redact the log — the actor's email is replaced with a token (`del:<hash>`) but the action history remains. ADR-023 covers this.

## Consequences

**Positive:**

- Every state-changing action is reviewable. Disputes resolve in minutes, not days.
- Compliance asks ("who accessed this member's record on date X?") have a real answer.
- Audit-log writes in the same transaction as the change means we can never have a state-without-history inconsistency.

**Negative:**

- Disk usage grows linearly with activity. Acceptable at our scale; we'll partition by month if it ever exceeds 10 GB.
- A bug that misses a `withAudit` wrapper means we silently lose history for that action. Mitigation: lint rule (`audit-policy`) that flags writes to listed audit-required tables outside `withAudit`. Plus integration test that asserts an audit row is written for each canonical action.

## Alternatives considered

- **Triggers writing audit on every UPDATE.** Captures everything, but loses the actor (Postgres triggers don't natively know who's calling) and the surrounding context (ip, ua). Could be made to work with `current_setting`, but the application-level pattern is clearer.
- **Streaming WAL to a separate audit DB.** Overkill at this scale.
- **AWS CloudTrail-style external service.** Vendor lock-in for a feature we can build in 50 lines of SQL.
