---
adr: 0017
slice: 1
risk: medium
---

# Spec: CI/CD — Slice 1 implementation

- **ADR:** [0017](../adr/0017-ci-cd.md)
- **Status:** Draft
- **Date:** 2026-05-05

## Goal

Land the GitHub Actions CI workflow, the Vercel CD wiring (preview/staging/production), the migration-application step, the branch-protection guidance doc, and the contributor onboarding for signed commits — so every PR gets typecheck + lint + unit + e2e + Lighthouse against a real preview URL, and every merge to `main` deploys staging without manual ssh-into-the-DB toil.

## Acceptance criteria

Numbered, testable. Each AC is verifiable by `pnpm test` (vitest), `pnpm test:e2e` (Playwright), or static-file inspection. **The "real" CI/CD test is opening a PR and watching the checks run; that is an end-of-Phase-5 manual verification, not part of the conductor's automated gauntlet.** Every AC below is verifiable from outside the GitHub Actions runtime so the conductor can gate on them locally.

1. `.github/workflows/ci.yml` exists and parses as valid YAML; verifiable by `tests/ci/workflow-shape.test.ts` (vitest) which loads the file as a string from disk, parses it via `yaml.load()` from the `js-yaml` package (default `JSON_SCHEMA` loader), and asserts the parsed object has `name`, `on`, and `jobs` top-level keys. The `js-yaml` dep is installed by T7's first step.
2. The CI workflow runs on both `pull_request` and `push: branches: [main]` triggers; verifiable by the same vitest suite asserting `on.pull_request` is present and `on.push.branches` includes `'main'`.
3. The CI workflow contains, in order, named steps that match the substrings `install`, `typecheck`, `lint`, `test` (or `unit`), `e2e` (or `playwright`), `lighthouse` somewhere in the flattened step sequence. **Iteration order is pinned:** `js-yaml`'s `yaml.load()` returns the `jobs` object as a plain JS object whose own-property iteration order matches **YAML document order** (insertion order). The test iterates `Object.keys(parsed.jobs)` in that order, then iterates each job's `steps` array in array order, collecting the lowercased value of each step's `name` (falling back to `run` if `name` is absent) into a single flattened list. The test then performs a **left-to-right pointer scan** asserting each of the six substrings appears in order, with arbitrary other steps allowed between matches. Splitting steps across jobs is permitted (the Phase-5 manual PR verification is what actually proves merge-gating; vitest only proves the steps exist in the right relative order).
4. The Lighthouse step in the workflow invokes `pnpm lighthouse` (or `node scripts/lighthouse.mjs`) and sets the `LIGHTHOUSE_BASE_URL` env var to the Vercel preview deployment URL (read from a workflow-level expression such as `${{ steps.<id>.outputs.preview_url }}` or a Vercel-deploy-action output); verifiable by a vitest test that asserts the Lighthouse step's `env.LIGHTHOUSE_BASE_URL` is set and references either `preview` or `vercel` in the expression. The driver itself already accepts `LIGHTHOUSE_BASE_URL` (verified at `scripts/lighthouse.mjs:14`).
5. The CI workflow contains a step that runs the ADR-0004 cents-schema backstop grep against `supabase/migrations/`, failing the build if any migration file declares a `*_cents` column with `decimal | numeric | float | real | double precision`. Verifiable by `tests/ci/backstop-greps.test.ts` (vitest), which **imports the canonical regex string from `lib/ci/backstop-greps.ts`** (the single-source module — see T4), constructs a JS `RegExp` from it, runs it against an inline fixture (`amount_cents numeric`, `total_cents decimal(10,2)`) and asserts a match; runs the same regex against a clean fixture (`amount_cents bigint`) and asserts no match. The same regex literal is templated into `ci.yml`'s grep step (T0/T4) so the workflow shell `grep -E` and the JS test gate on the same source of truth — eliminating the false-green risk of the JS regex drifting from the YAML.
6. The CI workflow contains a step that runs the ADR-0007 service-role-key boundary grep against `app/(member)/`, `app/(marketing)/`, and `components/`, failing the build if `SUPABASE_SERVICE_ROLE_KEY` appears in any of those trees. Verifiable by `tests/ci/backstop-greps.test.ts` importing the canonical pattern from `lib/ci/backstop-greps.ts`, constructing a JS `RegExp`, running it against an inline fixture string containing `process.env.SUPABASE_SERVICE_ROLE_KEY` and asserting a match; running it against a clean fixture (`SUPABASE_ANON_KEY`) and asserting no match. The same pattern string is templated into the `ci.yml` shell `grep` invocation so JS test and shell grep share the same source.
7. `docs/ops/branch-protection.md` exists and enumerates, by name, the exact required status checks the owner must enable in GitHub repo settings: `Lint, typecheck, and unit tests`, `e2e`, `lighthouse` (names must match the `jobs.<id>.name` values in `ci.yml`); verifiable by a vitest test (`tests/ci/branch-protection-doc.test.ts`) that reads `docs/ops/branch-protection.md` and asserts each required-check name string is present, AND that each name also appears as a `name:` field in the parsed `ci.yml` jobs map (cross-consistency check — if you rename a job, the doc fails until updated).
8. `docs/ops/branch-protection.md` documents the four branch-protection settings from ADR-0017 — "1 PR review minimum", "All CI checks passing", "Branch up-to-date with main before merge", "Signed commits required" — verifiable by the same vitest test asserting each phrase is present (case-insensitive substring match).
9. `docs/ops/ci-secrets.md` exists and enumerates every Actions secret the workflow needs by name (e.g. `VERCEL_TOKEN`, `LIGHTHOUSE_BASE_URL` source, Supabase preview keys, Stripe test keys), and contains a "**Never** add production secrets to GitHub Actions" warning paragraph; verifiable by a vitest test (`tests/ci/ci-secrets-doc.test.ts`) that asserts the file exists, contains the warning string `Never add production secrets to GitHub Actions` (case-insensitive), and lists every `secrets.<NAME>` reference that appears in `.github/workflows/ci.yml` (cross-consistency: if the workflow references a secret, the doc must enumerate it).
10. `CONTRIBUTING.md` includes structured setup sections for signed commits and pre-commit hooks. Verifiable by a vitest test (`tests/ci/contributing-signed-commits.test.ts`) that asserts the file contains:
    - **a heading matching `/^##\s+(Signed commits|Setting up commit signing)/m`** (signed-commit section is explicit, not buried),
    - **either a substring matching `docs.github.com/.*signing` (any GitHub Docs URL about commit signing) OR the literal substring `git config --global commit.gpgsign true`** (a real one-liner setup step, not just hand-waving),
    - **a heading matching `/^##\s+(Pre-commit hooks|Husky)/m`** (Husky/pre-commit section is explicit),
    - **the substrings `gpg` and `ssh` (case-insensitive)** so both signing modes are mentioned.
    A trivial 3-line stub fails this AC; the test requires real structure plus at least one concrete setup-step substring.
11. `vercel.json` exists at the repo root with at minimum a `buildCommand`, `installCommand`, and a `framework: "nextjs"` declaration; verifiable by a vitest test (`tests/ci/vercel-json.test.ts`) that parses the JSON and asserts the three keys. The migration-application hook (whether `vercel.json` "build" hook or a workflow-step `supabase db push` against the staging project) is **structural-only** in this slice — see Open Questions.
12. `supabase/migrations/` directory exists with at minimum a `.gitkeep` (already present); verifiable by a vitest test asserting the directory exists. No actual migration is added in this slice; ADR-0018 owns migration content and the `MIGRATION-REVIEW` checklist.
13. The `pnpm test:e2e` step in the workflow targets the Vercel preview URL via `PLAYWRIGHT_BASE_URL` env, and `playwright.config.ts` honours it. Strategy: **source-grep** (not dynamic config import — the `defineConfig` return collapses the env read at call time, and source-grep matches how other config-shape tests in this repo work and avoids runtime side effects). Verifiable by `tests/ci/playwright-config.test.ts` (vitest) which:
    - reads `playwright.config.ts` from disk as a UTF-8 string,
    - asserts the string **contains the substring `process.env.PLAYWRIGHT_BASE_URL`** (T2 makes this true by editing the existing hardcoded `'http://localhost:3000'` at line 19 to `process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'`),
    - asserts the string contains `reuseExistingServer: !process.env.CI` (already present at line 30) so CI does not race the workflow's ambient preview URL against a locally spawned dev server.
    The workflow's e2e step sets `PLAYWRIGHT_BASE_URL` from the Vercel deploy step's preview URL output. This unblocks the deferred ADR-0030 e2e verification (`tests-e2e/seo-faq.spec.ts`) since CI is not bound by the Hyper-V port-3000 reservation that blocks local runs on the dev host.

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`. Sized at 2-8 hours each. **9 tasks total.**

- **T0 — `.github/workflows/ci.yml` upgrade (replaces existing skeleton).** The current `ci.yml` already has install + typecheck + lint + format-check + test + the two backstop greps. T0 keeps those, restructures into named steps that satisfy AC3's pattern check, ensures the cents and service-role greps are dedicated named steps that **read their patterns from `lib/ci/backstop-greps.ts`** (via a small templating step or a `cat <module> | jq` shell extraction — T4 lands the module first), and lays groundwork (env-var passthrough, job naming) for T2 and T3 to add steps without restructuring. The Vercel preview URL needed by T2 and T3 is sourced via the `amondnet/vercel-action@v25` (or `vercel/actions/vercel`) action invocation that this task adds as a setup step gated to PR + push runs. **Does not** add the e2e or Lighthouse steps yet — those are T2 and T3.
- **T1 — `docs/ops/ci-secrets.md`.** Doc-only. Enumerate every `secrets.<NAME>` the workflow will reference by the end of this slice: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, Supabase preview env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — preview project only), Stripe test keys, optional `LHCI_GITHUB_APP_TOKEN`. Include the "**Never** add production secrets to GitHub Actions" warning paragraph (AC9). No real values — this is a checklist for the owner to provision.
- **T2 — Add Playwright e2e step targeting Vercel preview URL.** Depends on T0. Two concrete sub-steps:
    1. **Modify `playwright.config.ts:19`** — replace the hardcoded `baseURL: 'http://localhost:3000'` with `baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'` so CI's env-injected Vercel preview URL drives Playwright's `use.baseURL` while local dev still defaults to localhost. The existing `reuseExistingServer: !process.env.CI` at line 30 stays; together they let CI run against the preview without spawning a local Next.js server.
    2. **Add the e2e workflow step** — uses the preview URL surfaced by T0's deploy step. Sets `PLAYWRIGHT_BASE_URL` env on the e2e step. The workflow-shape vitest (T7) covers the YAML side; `tests/ci/playwright-config.test.ts` (T7, source-grep strategy) covers the config side per AC13.
- **T3 — Add Lighthouse step using preview URL.** Depends on T0 and T2 (T2 wires the preview-URL plumbing; T3 reuses it). Step runs `pnpm lighthouse` with `LIGHTHOUSE_BASE_URL` set to the preview deployment URL. The driver at `scripts/lighthouse.mjs` already accepts `LIGHTHOUSE_BASE_URL`; this task only wires the workflow env. Acceptance criterion 4 covers the YAML-shape check.
- **T4 — Backstop-grep shared regex module + branch-protection doc.** Two-part task that lands together because the backstop module is small and AC5/AC6/AC7 all key off it.
    1. **Create `lib/ci/backstop-greps.ts`** — a tiny TypeScript module exporting the canonical regex strings as constants. Exports (at minimum):
        - `export const DOLLARS_COLUMN_PATTERN = '_cents.*(decimal|numeric|float|real|double precision)';` (ADR-0004 — money columns must be `bigint`, never floating-point)
        - `export const SERVICE_ROLE_KEY_PATTERN = 'SUPABASE_SERVICE_ROLE_KEY';` (ADR-0007 — never in client surfaces)
        Both as **plain strings** (not `RegExp` objects) so they can be embedded equally in JS `new RegExp(p)` and shell `grep -E "$p"`. The vitest test (T7) imports these constants and asserts hits/misses against fixtures. The `ci.yml` workflow grep steps (T0) read the same constants — a small shell line like `pat=$(node -e "console.log(require('./lib/ci/backstop-greps').DOLLARS_COLUMN_PATTERN)")` extracts the pattern, then `grep -E "$pat" supabase/migrations/` runs it. JS regex and shell grep both gate on the same string literal, eliminating the divergence-false-green risk that motivated this module.
    2. **Create `docs/ops/branch-protection.md`** — Doc-only. Enumerate the exact required-check names (must match the `jobs.<id>.name` values in `ci.yml` — cross-consistency enforced by AC7's vitest), the four branch-protection settings (1 review, all checks, up-to-date, signed commits), the bypass paths (owner emergency-hotfix exception per ADR-0017), and a "how to enable in GitHub repo settings" walkthrough with screenshots-or-text. Include a paragraph on the manual-config-not-code reality of GitHub branch protection.
- **T5 — `vercel.json` outline.** Create `vercel.json` with `framework: "nextjs"`, `buildCommand: "pnpm build"`, `installCommand: "pnpm install --frozen-lockfile"`. The migration-application hook is **deliberately omitted** in this slice (see Open Questions and Out of scope) — ADR-0018 will add the `supabase db push` invocation. T5 lands the structural file so the eventual ADR-0018 task is a one-line edit, not a "create vercel.json" task.
- **T6 — `CONTRIBUTING.md` updates — signed-commit + Husky setup.** Append a `## Signed commits` section that includes:
    - a one-line `git config --global commit.gpgsign true` setup line (so AC10's regex sees a real setup step, not just prose),
    - links to GitHub's docs for both GPG and SSH commit signing (`docs.github.com/...signing` URLs that AC10's regex also accepts as the satisfying substring),
    - the substrings `gpg` and `ssh` so both signing modes are documented.
    Append a `## Pre-commit hooks` (or `## Husky`) section with a one-line note that local Husky hooks are optional and CI is the merge gate. Existing CONTRIBUTING.md content (workflow, TDD policy, domain language, ADRs) is preserved verbatim.
- **T7 — Workflow-shape vitest tests.** Create the test files referenced in AC1-AC13. **Step 1: install `js-yaml` and `@types/js-yaml` as devDependencies** — `corepack pnpm add -D js-yaml @types/js-yaml` — and verify the lockfile updates. (AC1 references `yaml.load()` from `js-yaml`, so this dep is load-bearing.) Step 2: create the test files:
    - `tests/ci/workflow-shape.test.ts` (AC1, AC2, AC3, AC4)
    - `tests/ci/backstop-greps.test.ts` (AC5, AC6 — imports patterns from `lib/ci/backstop-greps.ts`)
    - `tests/ci/branch-protection-doc.test.ts` (AC7, AC8)
    - `tests/ci/ci-secrets-doc.test.ts` (AC9)
    - `tests/ci/contributing-signed-commits.test.ts` (AC10)
    - `tests/ci/vercel-json.test.ts` (AC11)
    - `tests/ci/playwright-config.test.ts` (AC13 — source-grep strategy)
    Each test is small (one or two assertions); this is the load-bearing way the conductor gates on CI/CD shape locally. T7 is sized larger (closer to 8 hours) than the doc tasks because it covers seven test files plus the dep install.
- **T8 — Verify ADR-0030 e2e unblock.** Smoke-test that `tests-e2e/seo-faq.spec.ts` (already on `feature/conductor-seo-adr-0030` branch, blocked locally by Hyper-V port-3000 reservation) is shape-compatible with the CI runner — i.e., its `test()` calls use `page.goto('/...')` which Playwright resolves against `PLAYWRIGHT_BASE_URL`. Doc-only verification: a one-paragraph note in `.conductor/0017/dispatches/` confirms the seo-faq spec will run green in CI once T2 lands. No code change in T8 — just a confirmatory read of the spec file. (The actual green run is end-of-Phase-5 manual verification.)

**Dependency graph:**
- T0 depends on T4 (T0's grep steps read patterns from `lib/ci/backstop-greps.ts`, which T4 creates).
- T4 is a prerequisite for T0.
- T0 is the prerequisite for T2 and T3.
- T1, T5, T6 are independent doc-or-config tasks; they can run in parallel with T0/T4.
- T7 depends on T0, T1, T2, T3, T4, T5, T6 (each test asserts on the artifact the corresponding task produces, and T7's first step installs `js-yaml`) — T7 lands last as part of the final wave.
- T8 depends on T2 (T8 reads the playwright config T2 hardens).

## Touched-files inventory

Best estimate; workers may exceed if needed.

- **Create**
  - `docs/ops/branch-protection.md` (T4)
  - `docs/ops/ci-secrets.md` (T1)
  - `lib/ci/backstop-greps.ts` (T4 — shared regex module so workflow YAML and vitest tests share patterns)
  - `vercel.json` (T5)
  - `tests/ci/workflow-shape.test.ts` (T7)
  - `tests/ci/backstop-greps.test.ts` (T7 — JS regex against fixtures, patterns imported from `lib/ci/backstop-greps.ts`)
  - `tests/ci/branch-protection-doc.test.ts` (T7)
  - `tests/ci/ci-secrets-doc.test.ts` (T7)
  - `tests/ci/contributing-signed-commits.test.ts` (T7)
  - `tests/ci/vercel-json.test.ts` (T7)
  - `tests/ci/playwright-config.test.ts` (T7 — source-grep strategy)
- **Modify**
  - `.github/workflows/ci.yml` — restructure (T0), add e2e step (T2), add Lighthouse step (T3), thread backstop-grep patterns from `lib/ci/backstop-greps.ts` (T0)
  - `CONTRIBUTING.md` — append `## Signed commits` and `## Pre-commit hooks` (or `## Husky`) sections (T6)
  - `playwright.config.ts` — line 19: replace hardcoded `'http://localhost:3000'` with `process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'` (T2). The existing `reuseExistingServer: !process.env.CI` at line 30 stays.
  - `package.json` + `pnpm-lock.yaml` — T7 step 1 adds `js-yaml` and `@types/js-yaml` to devDependencies via `corepack pnpm add -D js-yaml @types/js-yaml`.
  - `docs/adr/0017-ci-cd.md` — replaced wholesale by Phase 5 shipper from `.conductor/0017/ratification-proposal.md` (not this spec's job; called out so the planner does not put an edit on this file).

## Risk flags

None of the auto-flag ADRs ({0003, 0004, 0005, 0006, 0009, 0023}) are linked from this slice (the cents-schema backstop *enforces* ADR-0004 but does not modify ADR-0004 territory). Risk frontmatter is **medium** because CI/CD touches deploy + secret-distribution surface even without an auto-flag linkage. Sub-task and cross-cutting risks called out individually:

- **Secret-leakage on Actions config — risk: medium.** Every Actions secret added to the repo is one more rotation step every 90 days (per ADR-0007) and one more place a screenshot of a workflow log can leak. Mitigation: T1's `docs/ops/ci-secrets.md` enumerates only the non-production secrets the pipeline actually needs and prints the explicit "**Never** add production secrets to GitHub Actions" warning. AC9's vitest cross-checks workflow `secrets.<NAME>` references against the doc so a worker who adds a new secret to the YAML without documenting it fails the build. The owner is the human gate on actually provisioning the secrets in repo settings — this spec just lays the inventory.
- **Migration step ordering — risk: medium, cross-ADR (0018).** Production migrations must run *before* code traffic swap, never after. ADR-0018 owns the `supabase db push` invocation and the `MIGRATION-REVIEW` checklist; if 0018 has not ratified by Phase 5, T5's `vercel.json` lands without the migration hook. The risk is the temptation for a worker to "just add `supabase db push` to the workflow" without 0018's zero-downtime rules — Out-of-scope and Open-questions sections call this out explicitly. **Premortem not auto-required (no auto-flag ADR linked) but the planner should consider one if T5 grows beyond the structural-only scope.**
- **Signed-commit onboarding friction — risk: low-medium.** Required signed commits will trip up any contributor without GPG/SSH signing set up. Mitigation: T6's `CONTRIBUTING.md` updates document the one-time setup with a real `git config` line (AC10 enforces this is more than a 3-line stub) and link the GitHub docs. The owner is the only contributor today, so the friction window is small; the cost rises if a second engineer onboards before this doc lands.
- **Bypass paths — risk: medium.** ADR-0017 explicitly allows owner direct-push to `main` for emergency hotfix. T4's `docs/ops/branch-protection.md` documents this bypass; the risk is that "emergency" creep makes the bypass routine. Mitigation is procedural (logging direct pushes, retrospective on each use) and lives in the runbook (ADR-0027); this spec only ensures the bypass is documented, not that the procedure is followed.
- **GitHub Actions outage — risk: low (acknowledged in ADR-0017 Negative consequences).** Mitigation is the same bypass path above. Not actioned in this spec.
- **`js-yaml` dependency — risk: low.** `js-yaml` is a mature, widely-used parser (~50M weekly downloads, no CVEs in current major). T7 step 1 makes the install explicit. The dep is dev-only; it never ships to production. No risk-flag escalation.
- **Backstop-grep regex divergence — risk: low (mitigated by T4's shared module).** The motivating fear was that the JS test regex and the YAML shell `grep` could drift, producing false greens. T4's `lib/ci/backstop-greps.ts` makes both the JS and shell sides import the same string constant, eliminating that drift. The residual risk is that a worker edits the constant without re-reading both call sites — mitigated by AC5/AC6 being symmetrically structured around the shared module.

## Out of scope

What this slice deliberately does not do.

- **`release-please` integration.** ADR-0017 Open Question 1; deferred until release cadence justifies it.
- **2-reviewer rule.** ADR-0017 Open Question 2; deferred until team grows past one developer.
- **Slice-4 production-promotion automation.** ADR-0017 leaves staging→production as manual via the Vercel dashboard. Slice 4 may automate behind a smoke-test gate; this spec does not.
- **Production-secret distribution to Actions.** Per ADR-0007 and ADR-0017, Actions never holds a production credential. T1's doc forbids this explicitly.
- **Shadow-DB for migration testing.** ADR-0018 Open Question; not solved here. CI cannot detect a slow migration without one (per ADR-0017 Negative consequences). Acknowledged, not actioned.
- **Husky / local pre-commit hooks (actual config).** Optional convenience layer per ADR-0017 Alternatives; T6 documents that they are optional and that CI is the merge gate. No `.husky/` directory or `husky install` script is added in this slice — the doc section exists so AC10's structural test passes and so the optional-hooks stance is on record.
- **Branch-protection enforcement as code.** GitHub branch protection is repo-settings UI, not a checked-in artifact (the GitHub Repository Rulesets API exists but is not in scope for Slice 1). T4 ships the doc; the owner enables in repo settings.
- **Migration content (any actual `.sql` file beyond the existing `.gitkeep`).** ADR-0018's slice owns this. T5 ships `vercel.json` without the migration hook.
- **MIGRATION-REVIEW checklist file.** ADR-0018 owns this artifact.
- **Coverage thresholds and test-quality rules.** ADR-0021 owns these; CI runs `pnpm test` and `pnpm test:e2e` in this slice without enforcing coverage gates beyond what the existing `vitest` config already does.
- **Lighthouse a11y category.** ADR-0026 owns the a11y floor; this slice's Lighthouse run is perf-only (matching what `scripts/lighthouse.mjs` already does at `scripts/lighthouse.mjs:42-43`). When ADR-0026 ratifies, that slice extends the driver to also assert `categories.accessibility`.
- **Twilio / Stripe webhook signature replay testing in CI.** Out of scope for ADR-0017; ADR-0021 (testing strategy) and the slice that ratifies it will own this.
- **Real PR run.** The conductor cannot trigger a real GitHub Actions run from inside the gauntlet. The "real test" of CI/CD is the owner opening a PR after Phase 5 commits land and confirming the checks render and gate merge. This is a manual end-of-Phase-5 step, not a vitest assertion.

## Open questions

Resolved during planning where possible; remaining items flagged for owner input.

1. **`vercel.json` migration hook timing.** ADR-0018 (database migrations) is currently Stub. Three options for T5: (a) ship `vercel.json` with no migration hook now (recommended; lowest coupling, one-line edit when 0018 ratifies); (b) ship a placeholder `"buildCommand": "pnpm build && supabase db push"` with a TODO comment (couples to 0018 prematurely); (c) defer T5 entirely until 0018 ratifies (blocks the rest of Slice 1 CI/CD on a Stub ADR). **Default position: option (a).** Planner confirms before T5 starts.
2. **Vercel deploy action choice.** Two reasonable options: `amondnet/vercel-action@v25` (community, mature, used widely) vs writing a thin `vercel deploy --prebuilt` invocation directly using `VERCEL_TOKEN`. The first is one fewer thing to maintain; the second is one fewer GitHub Action to audit. **Default position: `amondnet/vercel-action@v25`.** Planner confirms; if the answer is "write our own," T0 grows by ~2 hours.
3. **Lighthouse perf-budget gate location.** AC10 of ADR-0030's spec said `pnpm lighthouse` is the manual acceptance command if 0017 has not ratified. 0017 is now ratifying, so this slice owns the CI wiring. Confirm: the Lighthouse step blocks merge (sets `exit 1` failure-blocks the workflow), it does not just upload an artifact and pass. **Default position: blocks merge.** Planner confirms.
4. **Required-check names for branch protection.** AC7 cross-consistency-checks the doc against `jobs.<id>.name` in `ci.yml`. T0 picks the canonical names (current file uses `Lint, typecheck, and unit tests` for the lone job). T2 and T3 add jobs/steps — the planner decides whether e2e and Lighthouse are separate jobs (each shows as its own status check on the PR) or steps within one job (one status check, more legible logs). **Default position: separate jobs**, because GitHub branch protection requires-status-check granularity is per-job. Planner confirms.
5. **Concurrency / matrix.** Current `ci.yml` already uses `concurrency: cancel-in-progress`. No matrix is needed in Slice 1 (single Node version per `.nvmrc`). Flagged here so the planner does not waste time on a matrix design.
6. **Sentry source-map upload.** ADR-0014 (observability) is Stub. The Sentry source-map upload step (typically a workflow step that runs `sentry-cli releases files upload-sourcemaps`) is a natural CI/CD concern but belongs to the slice that ratifies 0014. Out-of-scope for this slice; flagged so the planner does not add it to T0.
