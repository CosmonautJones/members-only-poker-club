---
adr: 0020
slice: 1
risk: low
acceptance_commands:
  - 'pnpm test tests/flags/'
---

# Spec: Feature flags (ADR-0020 slice 1)

- **ADR:** [0020](../adr/0020-feature-flags.md)
- **Status:** Draft
- **Date:** 2026-05-09

## Goal

Establish the flag-evaluation primitives: a typed flag key set, a pure
evaluator that handles boolean / percent / allowlist / role-gate targeting,
and a small public `isEnabled(key, ctx)` API. Migration for the eventual
`feature_flags` table lands here too. The admin UI and Edge Middleware
caching are explicitly out of scope.

## Acceptance criteria

1. `lib/flags/types.ts` defines `FlagKey` (a union of all currently-known
   flag keys), `FlagDefinition` (shape per ADR: `{ key, enabled, percent,
   allowlist, role_gate, owner, expires_at }`), and `FlagContext` (the
   evaluation context: `{ profileId?, role? }`).
2. `lib/flags/evaluate.ts` exports `evaluateFlag(def, ctx)` as a pure
   function. Targeting precedence: `enabled=false` wins (kill-switch
   short-circuit), then allowlist match, then role-gate match, then percent
   rollout (deterministic hash on `profileId`), default false.
3. Percent rollout is deterministic: same `profileId` + same `key` always
   yields the same allocation. Different keys produce independent
   allocations (two 50% flags don't both roll the same 50% of users).
4. `lib/flags/registry.ts` exports the current `FLAGS` constant — the in-code
   source of truth for flag definitions until the DB-backed read path lands
   in a follow-up slice. Currently includes one example kill-switch
   (`kill-stripe-webhook`) at `enabled: false` so the type system has a real
   key to bind to.
5. `lib/flags/index.ts` exposes `isEnabled(key: FlagKey, ctx?: FlagContext):
   boolean` as the consumer-facing API. Reads from `FLAGS` registry.
6. Migration `supabase/migrations/0001_feature_flags.sql` creates the
   `feature_flags` table per ADR-0020 (key TEXT PRIMARY KEY, enabled BOOLEAN
   NOT NULL DEFAULT false, percent INTEGER NOT NULL DEFAULT 0 CHECK 0..100,
   allowlist TEXT[] NOT NULL DEFAULT '{}', role_gate TEXT NULL, owner TEXT
   NOT NULL, expires_at TIMESTAMPTZ NULL, updated_at TIMESTAMPTZ NOT NULL
   DEFAULT now(), updated_by UUID NULL). RLS-disabled (admin-only access via
   service role; member access goes through the cached `lib/flags/` API
   later).
7. Vitest coverage at `tests/flags/`: (a) evaluator decision matrix —
   boolean on/off, allowlist hit/miss, role-gate hit/miss, percent at 0/50/100;
   (b) deterministic percent allocation (same profileId+key always same
   answer; cross-key independence); (c) kill-switch short-circuit.
8. Migration safety scanner passes on the new migration file.
9. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` all pass.

## Task decomposition hints

- t0 — types module
- t1 — evaluator module (pure)
- t2 — registry module + initial flag
- t3 — public API module
- t4 — migration file
- t5 — vitest coverage

## Touched-files inventory

- Create: `lib/flags/types.ts`
- Create: `lib/flags/evaluate.ts`
- Create: `lib/flags/registry.ts`
- Create: `lib/flags/index.ts`
- Create: `supabase/migrations/0001_feature_flags.sql`
- Create: `tests/flags/evaluate.test.ts`
- Create: `tests/flags/index.test.ts`

## Risk flags

- **0029 (A/B testing) downstream:** ADR-0029 will wrap this lib. If the
  evaluator's decision matrix changes after 0029 lands, every experiment
  needs a re-validation pass.

## Out of scope

- `/admin/flags` UI (deferred to later slice; needs auth wired)
- Edge Middleware caching layer (deferred; no cache means every flag read
  is a DB query, fine at v1 traffic)
- DB-backed read path (deferred; `registry.ts` is the source for now)
- Audit log on flag toggles (deferred; ties to ADR-0006 once admin UI lands)
- Lifecycle automation (90-day stale-flag cleanup) — manual review v1

## Open questions

None at planning time.
