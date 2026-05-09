---
date: 2026-05-07
adrs: [0017]
slice: 1
type: implementation
status: complete
---

# Conductor run — ADR-0017 CI/CD

## Context

Second `/conductor` run since the harness landed, picking the next slice-1 Stub ADR off the queue immediately after `/conductor 30` (SEO). ADR-0017 (CI/CD) was the natural pick: it's foundational for the rest of slice 1, it unblocks the deferred Lighthouse-CI and Playwright runtime gates from the SEO run, and several remaining slice-1 ADRs (0024 cookie consent, 0028 analytics, 0026 a11y, 0016 rate-limiting, 0012 tournament read-path, 0014 observability skeleton, 0021 testing strategy skeleton, 0018 DB migrations) all assume a working CI venue exists.

The run rode the same `feature/conductor-seo-adr-0030` branch the SEO run finished on (no branch flip mid-run this time — see Notes). The live `docs/adr/0017-ci-cd.md` remained Stub on disk per the post-/conductor-30 amendment; the canonical ratified content lives at `.conductor/0017/ratification-proposal.md` until Phase 5 shipper writes it back.

End-to-end: ratifier (Phase 0) → spec-writer + critic → planner (`.conductor/0017/plan.json`, 9 tasks T0–T8) → 4 worker dispatches in 3 waves through Phase 2 → slice-level validator + critic + scope-judge in Phase 3 (critic iter-1 said REVISE; iter-2 said SHIP after fix-up dispatch 0014 landed) → this Phase 4 documentation step.

## Changes

Concrete things landed in the working tree (uncommitted; Phase 5 shipper will compose the commits):

**CI workflow surface (T2, T3, T4, T6, dispatch 0008 — wave 2A):**

- `.github/workflows/ci.yml` — 8 jobs: `install` (cached pnpm install), `typecheck`, `lint`, `test` (vitest), `e2e` (Playwright against a Vercel preview URL passed in via `PLAYWRIGHT_BASE_URL`), `lighthouse` (driver from ADR-0030 against the same preview), `backstop-greps` (semantic guardrails), and `migrate-staging` (placeholder, see Decisions). Required-status job display names match `docs/ops/branch-protection.md` exactly.
- `lib/ci/backstop-greps.ts` — TypeScript module that owns the source-of-truth regex for both backstop patterns:
  - `CENTS_FLOAT_TYPE_PATTERN` — flags any `cents.*: number` or `: number.*cents` shape, per ADR-0004 (cents-as-bigint).
  - `SERVICE_ROLE_KEY_BARE_PATTERN` — flags any unguarded `SUPABASE_SERVICE_ROLE_KEY` reference outside server-only paths, per ADR-0007 (client/server-tree boundary).
- `.github/workflows/ci.yml` `backstop-greps` job duplicates the literal regex strings in bash because GitHub Actions can't import a TS module at workflow time; a vitest test (`tests/ci/backstop-greps.test.ts`) cross-checks the workflow YAML and the TS module hold the same patterns.

**Vercel + Playwright wiring (T2, T6, dispatch 0008):**

- `vercel.json` at repo root — `framework: "nextjs"`, `installCommand: "corepack pnpm install --frozen-lockfile"`, `buildCommand: "corepack pnpm build"`, `regions: ["iad1"]`. First time this file existed; the SEO run had Vercel autodetect.
- `playwright.config.ts` — `baseURL` now reads `PLAYWRIGHT_BASE_URL` from env (was hard-coded to `http://localhost:3000`); `webServer.reuseExistingServer` gated to `!process.env.CI` so CI never tries to spawn its own `next start` (it points at the Vercel preview URL instead).

**Documentation (T1, T5, T8, dispatch 0009 — wave 2B):**

- `docs/ops/ci-secrets.md` — full Actions secrets matrix: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_PREVIEW_URL`, `SUPABASE_*` (URL, anon, service-role), `LHCI_GITHUB_APP_TOKEN`. Includes the production-secret carve-out (no production secrets in CI; CI uses staging-tier values only) per ADR-0007.
- `docs/ops/branch-protection.md` — required-status-checks list pinned to the exact job display names emitted by `ci.yml`, plus the "include administrators" + "require signed commits" + "require linear history" settings. This is docs-not-code because GitHub branch protection is repo-settings-managed; the `tests/ci/branch-protection.test.ts` file cross-checks the doc against the workflow YAML's job list to keep them in sync.
- `CONTRIBUTING.md` — signed-commit setup (gpg + ssh paths), Husky as an optional local layer (CI is the source of truth, Husky is convenience), pnpm-via-corepack invocation conventions.

**Test infrastructure (T7, dispatch 0010):**

- 5 vitest files under `tests/ci/`:
  - `workflow-yaml-structure.test.ts` — parses `ci.yml` with `js-yaml`, asserts the 8 jobs exist with the expected `needs:` graph and the required step shapes.
  - `backstop-greps.test.ts` — imports `lib/ci/backstop-greps.ts` and parses the workflow's `backstop-greps` step, asserts the regex literals match.
  - `ops-docs-cross-consistency.test.ts` — reads `docs/ops/branch-protection.md` and `ci.yml`, asserts every job display name in the doc appears in the workflow and vice versa.
  - `playwright-config.test.ts` — source-grep on `playwright.config.ts` (not dynamic import — see Decisions) for `PLAYWRIGHT_BASE_URL` and `reuseExistingServer: !process.env.CI`.
  - `vercel-json.test.ts` — JSON-parses `vercel.json`, asserts framework, install/build commands, and `regions: ["iad1"]`.
- `package.json` — added `js-yaml@^4.1.0` and `@types/js-yaml@^4.0.9` as devDeps for the workflow YAML parsing test.
- Total vitest count after this run: 83/83 across 17 files (up from 51/51 across 10 files at end of /conductor 30).

**Foundational task (T0, dispatch 0007):**

- T0 was the foundational "create lib/ci/ tree, add js-yaml dep, scaffold tests/ci/ directory, and audit existing CI-adjacent files" task. Ran solo before any other wave because every later task depended on its outputs.

**Fix-ups (Phase 3 critic iter-1, dispatch 0014):**

- `tests/ci/ops-docs-cross-consistency.test.ts` was too loose — original version asserted "every required-status check in branch-protection.md is a substring of any line in ci.yml", which would pass even if the jobs were renamed. Tightened to parse both docs and assert exact match on the set of job display names.
- `tests/ci/backstop-greps.test.ts` had asserted the workflow's grep step "contained" the patterns; tightened to assert the workflow uses the exact same regex strings the TS module exports.
- `vercel.json` was missing from the wave-2A dispatch entirely — the iter-1 critic flagged that the spec called for it but no worker had been assigned to it. Fix-up dispatch added it.

**Deferred to Phase 5 shipper:**

- Writing `.conductor/0017/ratification-proposal.md` content back to the live `docs/adr/0017-ci-cd.md` file (status: Stub → Accepted). Same Phase-5 territory as /conductor 30's ADR-0030 write.

## Decisions

- **Continue wave-bundling rather than strict per-task TDD.** Plan had 9 tasks; workers ran 4 dispatches: T0 solo (foundational, every later wave reads its outputs), wave 2A bundling T2+T3+T4+T6 (all touch `ci.yml`, bundling avoided same-file merge conflicts between parallel workers), wave 2B in parallel bundling T1+T5+T8 (all docs, disjoint files), then T7 standalone (all the new vitest CI files). This is the same pattern /conductor 30 used and it held up again — no merge friction within or across waves, one validator gauntlet pass per wave, ~10 min/dispatch saved vs. running each task as its own triplet.
- **Backstop-greps source-of-truth in TS, duplicated literally in bash, parity-checked by vitest.** GitHub Actions can't import a TS module from `lib/` at workflow time without bundling, and bundling for two regexes is overkill. The workflow's `backstop-greps` job hardcodes the regex strings inline in bash (`grep -rE "<pattern>" .`); the `tests/ci/backstop-greps.test.ts` test loads both the TS module and the workflow YAML and asserts the literal strings match. Two-place-truth, one-place-enforcement. The alternative — a Node script in the workflow that imports the TS module — adds setup overhead that swamps the benefit for two patterns. Revisit when the pattern count exceeds ~5 or when patterns get complex enough that drift becomes plausible.
- **`migrate-staging` job is a structural placeholder, not a wait-for-0018 block.** ADR-0018 (DB migrations) is still Stub. The choice was: (a) leave the migration step out of `ci.yml` entirely and add it when 0018 ratifies, or (b) add a placeholder job now with a `run: echo "TODO: replace with supabase db push when ADR-0018 ratifies"` step. Picked (b) so the workflow shape is in place — required-status-checks list is stable, the `needs:` graph is correct, and the 0018 implementation becomes a one-step body swap rather than a workflow rewrite. The placeholder always succeeds, so it doesn't gate PRs falsely; it does occupy a required-status slot, which forces the 0018 dispatch to fill it rather than skip it.
- **Source-grep strategy for `playwright-config.test.ts`, not dynamic import.** The test could `await import('../playwright.config.ts')` and assert on the resolved config object, but that would execute the config file's module-level code (which calls `defineConfig` and resolves env vars at import time). A simple file-read + regex match on the source text gives the same coverage with zero runtime side effects. The trade-off is the test is sensitive to formatting; offset by the fact that `playwright.config.ts` is touched maybe twice a year.
- **`docs/ops/branch-protection.md` as docs, not code.** GitHub branch-protection rules live in repo settings (or Terraform if we ever add IaC), not in the codebase. The doc is the authoritative checklist for the human applying settings. The `ops-docs-cross-consistency.test.ts` keeps the doc honest about which job names are actually emitted by `ci.yml`.
- **Don't gate the run on actual CI runtime.** None of the validator gauntlets ran the workflow itself — the first real Actions execution will be the PR that lands this slice. The vitest tests verify workflow *structure* (YAML parses, jobs present, regex parity, doc/code cross-consistency) which catches every category of bug except "the runner environment behaves differently from local". That last category is verified at PR time, which is the natural venue.

## Tests

**Ran:**

- `corepack pnpm typecheck` — clean at every validator gate.
- `corepack pnpm lint` — clean at every validator gate.
- `corepack pnpm test` — 83/83 across 17 files at the Phase-3 slice validator gate. New files this run: `tests/ci/workflow-yaml-structure.test.ts`, `tests/ci/backstop-greps.test.ts`, `tests/ci/ops-docs-cross-consistency.test.ts`, `tests/ci/playwright-config.test.ts`, `tests/ci/vercel-json.test.ts`. Re-run after the iter-1 fix-up; still 83/83.

**Did NOT run:**

- The CI workflow itself. Real GitHub Actions runtime verification happens on the first PR that opens against this branch — that's the natural venue and is part of the slice's ship plan.
- `corepack pnpm test:e2e` and `corepack pnpm lighthouse` — same port-3000 / WinNAT blocker as /conductor 30. The new `playwright.config.ts` env-driven `baseURL` change makes these *runnable* in CI now (against the Vercel preview), which was the point of this slice.

## Next

- **Configure repo branch protection** per `docs/ops/branch-protection.md` — required-status-checks, signed commits, linear history, include-administrators. This is a one-time settings change in GitHub.
- **Populate Actions secrets** per `docs/ops/ci-secrets.md` — especially `VERCEL_PREVIEW_URL` integration via the Vercel-GitHub app (gives every PR a deterministic preview URL the e2e + lighthouse jobs can target).
- **Phase 5 shipper** finishes ADR-0017: writes `.conductor/0017/ratification-proposal.md` content into `docs/adr/0017-ci-cd.md` (Stub → Accepted) and composes the slice commit.
- **Continue slice-1 conductor queue** in order: ADR-0024 (cookie consent) → ADR-0028 (analytics) → ADR-0026 (a11y) → ADR-0016 (rate limiting) → ADR-0012 (tournament read) → ADR-0014 (observability skeleton) → ADR-0021 (testing strategy skeleton) → ADR-0018 (DB migrations).
- **Once ADR-0018 ratifies,** swap the `migrate-staging` placeholder body for a real `supabase db push` step against the staging project (no workflow shape changes needed).

## Notes for future me

- **Phase-3 critic + scope-judge caught real semantic gaps the validator missed, again.** The mechanical gauntlet (typecheck + lint + test) was green before the critic ran. The critic surfaced three substantive issues: (1) backstop-grep semantics were inverted in the spec text in one place (asserted "matches must succeed" when the gate fires on "matches must NOT exist"), (2) `vercel.json` was named in the spec but missed in the wave-2A worker dispatch entirely — the validator can't catch a missing-file bug because nothing references it yet, (3) the cross-consistency tests were substring-loose. Iter-2 critic shipped clean. The 3-iteration critic budget is overkill for a well-scoped slice like this; iter-1 was the only one that earned its keep this run.
- **The branch-name issue from /conductor 30 didn't bite this run.** That run's working tree drifted onto a fix branch mid-run because the orchestrator opened a fix-up branch for the iter-1 fixups; this run started + finished on `feature/conductor-seo-adr-0030` and applied the fix-up dispatch to the same tree. Worth investigating whether /conductor 30's branch-flip was actually necessary or just a habit from earlier scaffolding.
- **API errors hit during dispatches twice — once mid-T0, once mid-fixup. Both transient, both retried cleanly.** The conductor's wave-by-wave structure made retry painless because each wave's outputs are deterministic from the dispatch prompt — re-running the same dispatch produces the same diff (modulo whitespace), so the orchestrator can re-issue with no state untangling. Worth keeping that determinism property as a design invariant: dispatches should be idempotent on a clean tree.
- **Backstop greps are now generic enough to extend.** Adding a new pattern means: append to `BACKSTOP_GREPS` in `lib/ci/backstop-greps.ts`, add the literal regex to the workflow's `backstop-greps` step, and add a vitest assertion to `tests/ci/backstop-greps.test.ts`. Three places, all in a tight cluster, all parity-checked. Worth a knowledge-curator entry so the next "we should add a guardrail for X" instinct lands as a 10-line PR rather than an afternoon.
- **`migrate-staging` placeholder is a deliberate footgun for the 0018 conductor run.** When ADR-0018 dispatches start, the orchestrator MUST notice that the placeholder exists and route an explicit task to swap its body — otherwise the placeholder will quietly persist past 0018 ship. Worth flagging in the 0018 ratifier dispatch input as a known pre-existing surface that needs to be touched.
- **`docs/ops/*` as the source of truth for repo-settings-managed config is a useful pattern.** Branch protection is the obvious case; secrets matrix is another; could extend to environment-protection rules, deployment-approval reviewers, dependabot config (where it overlaps with `.github/dependabot.yml`), Vercel project settings. The lever is `tests/ci/ops-docs-cross-consistency.test.ts` — anywhere there's a code surface that can drift from the doc, a structural cross-check test keeps them honest. Cheap to write, high signal.
