---
date: 2026-07-31
adrs: [0006, 0035, 0037, 0040]
slice: 1
type: validation
status: complete
---

# LUNA-009 transaction rollback gauntlet

## Context

LUNA-008 replaced production-only fake transaction shims with the
ADR-0040 Postgres transaction runner. LUNA-009 audited the integrated
result from main at `37e3eca3ff4a73ea2af316b1c90c395d983ccf62`
before promotion, with the failure contract as the release gate:

- mutation failure writes no audit row;
- audit failure rolls the mutation back;
- post-commit side effects do not run inside the transaction;
- authorization and role-ladder checks still run before database work;
- audit snapshots retain the existing no-PII taxonomy.

## Migrated call sites reviewed

The gauntlet covered all 16 migrated entry points:

- flags: `updateFlag`;
- members: `changeRole`, `initiateMemberDeletion`, `openRefundFlow`,
  `requestReverification`;
- payments: `initiateRefund`;
- privacy admin: `approveDeletion`, `approveExport`, `rejectRequest`;
- member privacy API: `POST /api/privacy/delete`;
- verification: `approveVerification`, `rejectVerification`,
  `requestVerificationInfo`;
- tournaments: `cancelTournament`, `setTemplateActive`;
- cron/materializer: `GET /api/cron/tournament-materialize`.

The review also covered the shared Postgres.js runner, its cancellation
path, production-runner source guards, RLS suites, role-ladder defense,
and the admin/privacy PII taxonomy guards.

## Changes

- Added seven missing high-value rollback/order tests:
  - destructive profile deletion now proves an audit failure restores
    the profile and leaves the privacy request pending;
  - export approval now proves phase 1 rolls back before storage signing
    and proves the signer runs only after the approval transaction commits;
  - privacy-request rejection, verification approval, and verification
    rejection now prove audit failure rolls their mutations back;
  - verification-info requests now prove audit failure prevents the
    post-commit email stub and cache invalidation.
- Corrected the ADR-0037 implementation status. It no longer describes
  production tournament audit pairing as best-effort: ADR-0040 is
  accepted and the tournament actions/materializer use the shipped
  shared atomic runner.

## Results

Initial focused audit:

```text
pnpm exec vitest run <19 transaction/auth/RLS/PII files>
19 files passed, 217 tests passed
```

New rollback/order cases:

```text
pnpm exec vitest run <6 changed action files>
6 files passed, 77 tests passed
```

Full portable suite and build:

```text
pnpm exec vitest run --exclude tests/skills/run-hooks-parsing.test.ts
186 files passed, 2,124 tests passed, 1 skipped, 1 todo

pnpm build
passed
```

The unfiltered Windows run produced the same 2,124 passing tests but the
nine cases in `tests/skills/run-hooks-parsing.test.ts` exited 127 because
the host has no bash executable. Those hook tests are Linux-only in this
environment; GitHub CI remains their authoritative gate.

The seven new cases found no runtime defect in the integrated transaction
implementation. The stale ADR-0037 production-status note was a real
LUNA-008 acceptance defect and is fixed in this change.

## Residual deployment exceptions

- A non-production Supabase environment must provide a transaction-mode
  Supavisor `SUPABASE_DATABASE_URL` on port 6543 and run the ADR-0040
  staging integration check before production promotion.
- The tournament cron remains gated on production migration 0017,
  the correct active Supabase project linkage, `CRON_SECRET`, operational
  seed/count checks, and manager pause/resume/cancel smoke tests before
  `tournament-schedule-live` is enabled.
- Stripe-backed refund execution is still configuration-gated; the
  current `initiateRefund` path audits the denied/configuration state and
  does not perform an external refund.
- GitHub CI supplies the Playwright and Lighthouse gates.

## Next

- Provision the staging Supavisor credential and run the real database
  integration before production promotion.
- Complete the cron and authenticated production smoke gates above.

## Notes for future me

The export workflow is intentionally two-phase. The pending-to-in-progress
transition and its approval audit are atomic; storage signing and the
completion/failure stamp are post-commit work. Treating all three phases
as one transaction would hold a database connection across an external
storage call and would erase the forensic approval breadcrumb when that
external call fails.
