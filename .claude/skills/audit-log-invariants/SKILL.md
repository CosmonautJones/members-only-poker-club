---
name: audit-log-invariants
description: Use when writing or modifying server actions that wrap `withAudit`, the `audit_log` table migration/policies, the role-change trigger, or any "fail-loud" action that must audit before throwing. Triggers on `withAudit` callsites, `audit_log` schema work, audit-policy migration changes, custom Error class definitions for action callbacks, or "audit row missing / duplicated / out-of-order" debugging. Critical for spec-writers, action authors, migration authors.
---

# audit-log-invariants — append-only forensic-record discipline

The `audit_log` table is the forensic record-of-record. Append-only at the RLS layer (no UPDATE/DELETE policies). Written in the same transaction as the change it describes. Load this skill before any action wrapping or audit-log schema change.

## The seven invariants

### 1. Caller-owns-transaction contract

`withAudit(tx, params, mutate)` does NOT manage the transaction itself. The caller wraps in `db.transaction(async (tx) => withAudit(tx, params, mutate))`. The helper assumes it is already inside a transaction-scoped context. Three forbidden implementations:

- Two separate transactions for mutate and audit-INSERT
- try/catch around audit-INSERT that swallows the error and commits the mutation anyway
- Best-effort / fire-and-forget audit pattern

A worker who refactors for "cleanliness" by adding any of these silently breaks the audit log's anti-state-without-history posture.

### 2. The helper does NOT catch any throw

The only try/catch inside `withAudit` is around `JSON.stringify(before/after)` — a pre-call serializability check that converts BigInt / circular-ref to a clear TypeError BEFORE the audit INSERT runs. Everything else propagates. If `mutate` throws, the caller's `db.transaction` rolls back. If the audit-INSERT throws, same rollback. This is the load-bearing safety property: no state change without history.

### 3. INSERT WITH CHECK denies anon — service-role succeeds via Postgres BYPASSRLS, NOT policy weakening

The policy is `WITH CHECK (auth.uid() IS NOT NULL)`. Service-role inserts (webhook handlers, admin scripts, the role-change trigger run as superuser) succeed because their Postgres role has BYPASSRLS — the policy never evaluates. Three drift patterns are explicitly forbidden:

- Relaxing to `WITH CHECK (true)`
- Adding a second permissive policy
- Adding an `OR auth.uid() IS NULL` disjunct

A worker who "fixes" the apparent tension by weakening the policy has broken the contract.

### 4. No UPDATE/DELETE policies — service-role bypass is an acknowledged escape hatch

Production policy is "service-role does NOT UPDATE/DELETE audit_log" — enforced by code review and the `audit-policy` ESLint rule (ADR-0006 Slice 4). Until that lint ships, any cycle that adds a service-role-context audit-log mutation MUST have a critic flag for "this is the documented escape hatch, NOT a normal path."

### 5. Role-change emits TWO audit rows — both must commit or both roll back

`changeRole` server action wraps the role mutation in `withAudit('admin.member.role_changed', ...)` (application-level row with actor + reason). The cycle-1 trigger `profiles_protect_role_change` also writes a `profile.role_change` row (DB-level row, role column actually changed). Both in the same transaction. Both axes are forensically distinct: trigger row proves "the column changed"; action row proves "manager X invoked changeRole for reason Z." Removing either silently breaks the forensic invariant. Pin via:

- `tests/admin/role-ladder-defense.test.ts` — assert EXACTLY 2 rows for the target_id within a 1-second window
- `tests/migrations/role-change-trigger-shape.test.ts` — regex the latest trigger-touching migration for the `INSERT INTO audit_log` literal

### 6. Custom error classes used inside `withAudit` callbacks MUST extend `Error` AND set `this.name`

`throw 'SelfEditViolation'` (string) trips the helper's JSON-serializability check AND breaks `classifyAdminActionError(error.name)` which returns `'unknown'` instead of the meaningful tag. Pattern:

```ts
export class SelfEditViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfEditViolation';
  }
}
```

Discipline pinned by `tests/admin/withAudit-throw-discipline.test.ts` walking `app/(admin)/admin/**/_actions/*.ts`.

### 7. `actor_id` FK to `auth.users(id)` is implicit NO ACTION, NOT CASCADE

`ON DELETE CASCADE` would silently delete every audit row referencing a deleted user — a privacy law violation. ADR-0023's anonymization model replaces the actor record with a `del:<hash>` token but the audit row itself is NEVER deleted. Shape test asserts no `CASCADE` / `SET NULL` ON DELETE clause in the AST.

ADR-0023 anonymization MAY later change to `ON DELETE SET NULL` for the actor_id — but the action history must remain. Cycle 2 posture: implicit NO ACTION.

## Fail-loud action ordering (audit BEFORE throw)

For actions that fail loud on a system condition (e.g. Stripe not configured), the ordering is non-negotiable:

```ts
async function initiateRefund(params) {
  await requireRole('manager');            // 1. auth gate (no audit on denial — see §asymmetry below)
  const parsed = schema.parse(params);     // 2. Zod validation (no audit on bad input)
  await assertRefundAuthority(parsed);     // 3. authority gate (no audit on denial)
  await runner.transaction(async (tx) => {
    await withAudit(tx, 'admin.refund.denied', 'refund_request', '__stripe_not_configured__', ...); // 4. audit-tx commits FIRST
  });
  await assertStripeConfigured();          // 5. probe-throw AFTER audit committed
  // ... actual refund call
}
```

A "tidy" refactor that wraps the body in try/catch around the probe-throw would silently revert to "throw first, never audit" — invisible until forensic analysis. The `target_id` carries a literal sentinel (`'__stripe_not_configured__'`) to distinguish "fail-loud breadcrumb" from "pending refund."

## Audit asymmetry by design

`InsufficientAuthorityError` throws WITHOUT writing an audit row (user error at the gate). `StripeNotConfiguredError` writes `admin.refund.denied` BEFORE throwing (system error after the gate). The rationale is audit-log volume + attack-surface asymmetry — spray-attacking the form shouldn't fill the audit log. Document this in a load-bearing comment block above `assertRefundAuthority`; a future "consistency" refactor would re-audit authority-denial paths and silently inflate the log.

## Role-change trigger function-only extension

When extending the role-change trigger logic in a later migration, use `CREATE OR REPLACE FUNCTION` only — do NOT re-issue the `CREATE TRIGGER` declaration. Re-issuing risks dropping the column-mention semantics (`BEFORE UPDATE OF role`) or inverting the alphabetical firing order vs `set_updated_at`. Shape test asserts no `CreateTrigStmt` for the trigger name in any later migration touching the function.

## Cited evidence

- ADR-0006 cycle 2 — caller-owns-tx contract, anti-catch invariant, WITH CHECK anon-deny, no UPDATE/DELETE policies, FK NO ACTION, trigger function-only extension
- ADR-0035 cycle 4 — two-row pattern + role-ladder-defense test, throw-discipline (Error subclass + name)
- ADR-0036 Slice 1 — fail-loud audit-before-throw ordering, sentinel target_id, asymmetric authority vs system denial
