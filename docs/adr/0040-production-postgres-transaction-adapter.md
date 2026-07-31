# ADR-0040: Production Postgres transaction adapter

- **Status:** Accepted
- **Date:** 2026-07-30
- **Slice:** Luna wave 1 (transaction atomicity)
- **Supersedes:** the production-only `defaultDb()` shims used by audited mutations; does not supersede [ADR-0006](0006-audit-log-append-only.md)'s caller-owned transaction contract.

## Context

[ADR-0006](0006-audit-log-append-only.md) requires each mutation and its audit row to commit in one Postgres transaction. [`withAudit`](../../lib/audit/withAudit.ts) already accepts a transaction-scoped `query(sql, params)` client, but production callers currently implement `transaction(fn)` by invoking `fn` over a translator that makes separate `supabase-js` REST calls. A later audit failure therefore cannot roll back an earlier mutation. Tests use real callback transactions in pglite, so they currently prove a property production does not have.

## Decision

Use [Postgres.js](https://github.com/porsager/postgres) through the Supabase [Supavisor transaction-mode pooler](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers) for server-side atomic writes.

The only application-facing database contract is:

```ts
interface TransactionClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

interface TransactionRunner {
  transaction<T>(
    work: (tx: TransactionClient) => Promise<T>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
}
```

Production adapts `sql.begin(...)` and `sql.unsafe(text, params)` to this contract. Tests adapt pglite to the same contract. Business actions do not import either driver and cannot issue `BEGIN`, `COMMIT`, or `ROLLBACK`.

If `work`, a mutation, `withAudit`, an audit insert, serialization, or cancellation throws before commit, the adapter rolls back and rethrows. It always releases the reserved connection. An aborted request cancels the active Postgres.js query; cancellation is a rollback signal, not a successful return. No catch may convert one of these failures into a commit.

Runtime and pooling posture:

- Run only in the default Vercel Node.js runtime (Fluid Compute), never an Edge runtime.
- Create one module-scoped Postgres.js client per warm function instance with `max: 1`, bounded connect/idle/lifetime timeouts, and `prepare: false`.
- Connect with the environment's Supavisor transaction-mode URL (port 6543). Do not use a direct database connection or create a pool per request.
- Reserve one connection for the complete callback; every read, lock, mutation, and audit insert in that callback uses the provided `tx`.

Secrets boundary:

- Add one server-only, per-environment `SUPABASE_DATABASE_URL`; it is never `NEXT_PUBLIC_*`, never returned or logged, and is read only by the transaction-adapter module guarded by `import 'server-only'`.
- Store and rotate it under [ADR-0007](0007-secrets-management.md)'s high-impact production-secret policy. Local, preview/staging, and production use different Supabase projects/credentials per [ADR-0008](0008-environments.md).
- This credential is for audited server mutations only. Existing browser/session reads continue through `supabase-js`; role checks remain mandatory before privileged mutations. The adapter does not widen use of `SUPABASE_SERVICE_ROLE_KEY`.

### Required migration inventory

The following production flows are non-atomic at commit `3b0a593` and must move to the shared runner:

| Area | Flows |
|---|---|
| Feature flags | `app/(admin)/admin/flags/_actions/updateFlag.ts` |
| Members | `changeRole.ts`, `initiateMemberDeletion.ts`, `openRefundFlow.ts`, and `requestReverification.ts` under `app/(admin)/admin/members/[id]/_actions/` |
| Payments | `app/(admin)/admin/payments/refunds/new/_actions/initiateRefund.ts` |
| Privacy | `approveDeletion.ts`, `approveExport.ts`, and `rejectRequest.ts` under `app/(admin)/admin/privacy/_actions/`; `app/api/privacy/delete/route.ts` |
| Verification | `approveVerification.ts`, `rejectVerification.ts`, and `requestVerificationInfo.ts` under `app/(admin)/admin/verifications/_actions/` |
| Tournaments | `cancelTournament.ts` and `setTemplateActive.ts` under `app/(admin)/admin/tournaments/_actions/`; tournament inserts plus the run audit in `app/api/cron/tournament-materialize/route.ts` |

Audit-only sign-in/authorization-denial events have no paired state mutation and are outside this migration. Future audited mutations must use this runner when first shipped.

This ADR does not choose an ORM, change read paths, redesign authorization/RLS, or define business-action SQL.

## Consequences

**Gain:** production and tests share one transaction seam; mutation and audit rows either both commit or both roll back; duplicated SQL-shape translators disappear; cancellation and connection cleanup become centrally testable.

**Accept:** a new privileged database credential and TCP connection path must be provisioned per environment; `max: 1` serializes transactions within a warm instance; actions must express atomic work as parameterized SQL instead of chained PostgREST calls.

## Alternatives considered

- **Keep the `supabase-js` translators.** Rejected: separate HTTP requests cannot provide cross-request rollback.
- **One Supabase RPC per business action.** Rejected: atomic, but duplicates the transaction seam across functions and makes the shared production/test interface meaningless.
- **Direct Postgres connection.** Rejected: Vercel autoscaling can exhaust database connections; Supavisor transaction mode is the serverless boundary.
- **`node-postgres` (`pg`).** Viable, but rejected for this adapter because Postgres.js supplies callback rollback and cancellable query objects with less lifecycle code while still fitting the existing structural client.

## Validation

Implementation is complete only when one contract suite runs against pglite and the production adapter and proves: audit failure rolls back its mutation; mutation failure writes no audit row; abort cancels and rolls back; and every connection is reusable or discarded after success, throw, and cancellation. A staging Supabase integration test must exercise the Supavisor URL before production promotion. Source checks must show no production `defaultDb()` transaction shim and no inventory item retaining separate mutation/audit Supabase calls.

## Evidence

- [`withAudit` caller-owned transaction contract](../../lib/audit/withAudit.ts)
- [Audit-log knowledge base](../kb/audit-log.md)
- [Member self-delete's documented partial-commit path](../../app/api/privacy/delete/route.ts)
- [Tournament cancellation's documented partial-commit path](../../app/%28admin%29/admin/tournaments/_actions/cancelTournament.ts)
- [Postgres.js transaction and cancellation documentation](https://github.com/porsager/postgres)
- [Supabase serverless connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers)

## Owner review questions

None block acceptance. LUNA-006 has no human gate, and this ADR ratifies Postgres.js plus the server-only `SUPABASE_DATABASE_URL` boundary.

Provisioning that per-environment secret remains an owner action before staging or production can exercise the adapter. It is an implementation gate, not an open architecture decision.
