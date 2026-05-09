# ADR-0021: Testing strategy

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 1 (skeleton) → 4 (formalized)

## Context

Without tests, money-touching code rots. With too many tests, every change feels like a chore. We need a tiered strategy that puts effort where the cost of bugs is high.

## Decision

### Tiers

| Tier | Tool | Coverage target | Required for |
|---|---|---|---|
| **Unit** | Vitest | ≥80% line on `lib/` | Every new lib function, every bug fix |
| **Integration** | Vitest + Supabase local + Stripe test mode | Every server action that mutates state | Every webhook handler, every money-touching action |
| **E2E** | Playwright vs. preview | Every cross-boundary user flow | Signup, autopay, top-up, redeem, tournament reg, cancel |
| **Visual regression** | Playwright + screenshot diff | Critical pages (home, signup, dashboard) | Pre-launch only; high maintenance |
| **Load** | k6 | Slice 4 | Pre-launch |
| **A11y** | axe-core + Playwright | Every public page | Slice 4 |

### TDD policy

- **Rigid TDD for `lib/`** — write the failing test first, smallest implementation to pass, refactor. See [CONTRIBUTING.md](../../CONTRIBUTING.md).
- **Test-after for components** — test the contract (props in → DOM out), not pixels.
- **No tests for**:
  - Marketing copy (use snapshot only if regression-prone)
  - Generated code (e.g., shadcn primitives we copy in unmodified)
  - Throwaway scripts

### Integration test strategy

- Spin up Supabase locally (`supabase start`).
- Stripe in test mode, webhook events triggered via Stripe CLI fixtures.
- Tests run in transactions, rolled back at end. Schema reset only between test files.
- Each test owns its fixtures; no shared "seed-and-pray" data.

### Anti-mock policy for DB

- Don't mock the DB in unit tests for `lib/`. Use real local Postgres. Mock-DB tests have caught zero bugs in industry surveys; integration-style tests catch most. Brain project's CLAUDE.md explicitly notes this lesson.

### Coverage enforcement

- CI fails if `lib/` line coverage drops below 80%.
- Coverage reports posted to PR comments.

### Test data

- `tests/fixtures/` for canned fixtures
- `tests/factories/` for Faker-style builders (`buildMember()`, `buildMembership()`)

## Open questions (deferred)

- **Property-based testing (fast-check) for ledger arithmetic** — deferred to Slice 4 when ADR-0011 (time-bank) lands. Add fast-check at that point for the cents-arithmetic invariants only; not worth the setup cost before there's ledger code.
- **Contract tests vs Stripe (Pactflow)** — declined at this scale. Stripe's webhook signature verification + integration tests against Stripe's CLI fixtures cover the same ground without the contract-test infrastructure cost. Re-evaluate if we ever ship a second payment provider.
