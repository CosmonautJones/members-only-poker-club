# Branch protection — main

GitHub branch protection for `main` is configured manually in the GitHub
repository settings UI. There is no checked-in artifact that enforces these
settings (the GitHub Repository Rulesets API exists but is not in scope for
Slice 1 of [ADR-0017](../adr/0017-ci-cd.md)). This document enumerates the
exact checkboxes the owner must enable so a future reviewer can verify the
configuration matches the ADR.

## Required configuration

Enable each of the following on the `main` branch protection rule:

- **Require a pull request before merging** — minimum **1 approving review**
  (1 PR review minimum). The single-developer phase keeps this at 1; a
  second-reviewer rule is a deferred Open Question in ADR-0017.
- **Require status checks to pass before merging** — All CI checks passing.
  The exact required checks must match the `jobs.<id>.name` values in
  `.github/workflows/ci.yml`:
  - `Install`
  - `Typecheck`
  - `Lint`
  - `Test`
  - `E2E (Playwright)`
  - `Lighthouse`
  - `Backstop greps`
  - `Migrate staging (placeholder — pending ADR-0018)` — listed for
    completeness against the workflow job inventory; this job only runs on
    push-to-main and is not a PR merge gate today (a no-op step until
    ADR-0018 ratifies).
  If a job is renamed in `ci.yml`, the corresponding required-check entry
  here must be updated in the same PR — the cross-consistency vitest
  (`tests/ci/ops-docs.test.ts`) gates on this.
- **Require branches to be up to date before merging** — Branch up-to-date
  with main before merge.
- **Require signed commits** — Signed commits required. See
  [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the one-time GPG/SSH setup.
- **Restrict who can push to matching branches** — only the repository
  owner. Direct push to `main` is reserved for emergency hotfix only (see
  the Emergency hotfix path section below).

## Verifying

- GitHub UI: open the branch protection settings at
  https://github.com/CosmonautJones/members-only-poker-club/settings/branches
  and confirm each checkbox matches the list above.
- Programmatic inspection (read-only):
  ```bash
  gh api repos/CosmonautJones/members-only-poker-club/branches/main/protection
  ```
  This returns the live protection JSON; compare it against the
  configuration above whenever auditing the gate (e.g. before a release
  cut, or as part of a quarterly secrets-and-controls review).

## Emergency hotfix path

ADR-0017 explicitly allows the repository owner to push directly to `main`
when a production-breaking incident requires bypassing CI (for example, a
broken Vercel deploy that needs a one-line revert and the gauntlet's
e2e/Lighthouse jobs would add 10+ minutes to recovery).

The procedure:

1. Owner temporarily disables the required status checks on the `main`
   protection rule (uncheck "Require status checks to pass before merging"
   in the GitHub UI, or update via `gh api`).
2. Owner pushes the hotfix commit directly to `main` (signed; signed-commit
   enforcement stays on).
3. Owner immediately re-enables required status checks.
4. Owner files a journal entry in [`docs/journal/`](../journal/) recording:
   - Date/time of the bypass.
   - Commit SHA(s) pushed during the bypass window.
   - One-line reason ("preview deploy regression after merge of #NNN; ran
     `pnpm test` locally before pushing").
   - Confirmation that step 3 (re-enabling checks) completed.

Routine use of this bypass is a smell. If the bypass is invoked more than
once per quarter, that is a signal to revisit the gauntlet's runtime budget
or to add a faster fast-path for trivial reverts — open an ADR rather than
making bypass routine.

## References

- [ADR-0017 — CI/CD](../adr/0017-ci-cd.md) — Decision section enumerates
  the four required protection settings and the bypass path.
- [ADR-0007 — Secrets management](../adr/0007-secrets-management.md) —
  context for why signed commits are required (commit identity is part of
  the audit trail referenced in ADR-0006).
