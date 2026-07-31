# CI Secrets

This document enumerates the GitHub Actions secrets that the CI workflow
(`.github/workflows/ci.yml`) consumes, how to populate each one, and how
often each is expected to rotate.

Per [ADR-0007 (secrets management)](../adr/0007-secrets-management.md) and
[ADR-0008 (environments)](../adr/0008-environments.md), **only non-production
secrets live in GitHub Actions**. Production credentials are held exclusively
in Vercel project environment variables (Production scope) and are never
exposed to the Actions runtime.

> Never add production secrets to GitHub Actions. If you find yourself
> reaching for a production credential to make a CI step pass, stop and
> reconsider — CI runs against preview/staging surfaces only.

## Actions secrets the CI workflow needs

| Secret name | Used by | How to populate | Lifecycle |
|---|---|---|---|
| `VERCEL_PREVIEW_URL` | `e2e` job (Playwright `PLAYWRIGHT_BASE_URL`); `lighthouse` job (`LIGHTHOUSE_BASE_URL`) | Populated automatically by the Vercel-GitHub integration as the deploy step's output (`steps.<deploy-id>.outputs.preview_url`); not a static repo secret. | Rotates per-PR (every push produces a new preview URL — automatic). |
| `VERCEL_TOKEN` | Vercel deploy action used to surface the preview URL | Generate at https://vercel.com/account/tokens (scope: limited to this project). Add via `Repo → Settings → Secrets and variables → Actions → New repository secret`. | Rotate every 90 days per ADR-0007. |
| `VERCEL_ORG_ID` | Vercel deploy action | Read once from `vercel link` output or from the Vercel project settings page; copy verbatim into Actions secret. | Static (rotate only on org migration). |
| `VERCEL_PROJECT_ID` | Vercel deploy action | Same as above — `vercel link` output or project settings page. | Static (rotate only on project recreation). |
| `LIGHTHOUSE_TOKEN` | Reserved for future LHCI server upload (not used by the current vanilla `scripts/lighthouse.mjs` driver) | Placeholder; populate when/if `@lhci/cli` server upload is wired up. Currently unset is fine. | Not yet active. |
| `SUPABASE_PREVIEW_URL` | `e2e` job (Playwright fixtures that hit Supabase) | Copy `Project URL` from the **staging/preview** Supabase project (never the production project). | Rotates rarely (on project re-provisioning). |
| `SUPABASE_PREVIEW_ANON_KEY` | `e2e` job (public anon key for the preview project) | Copy from Supabase preview project → Settings → API → `anon` `public` key. | Rotates rarely; safe to expose in client-side code by design (anon key is a JWT-issuing public credential, not a secret in the cryptographic sense — but kept in Actions for environment parity). |
| `STRIPE_TEST_SECRET_KEY` | `e2e` job (billing flows that exercise the Stripe SDK against test mode) | Copy `Secret key` from Stripe Dashboard → Developers → API keys → **Test mode**. Must start with `sk_test_`. | Rotate per Stripe-policy advice (typically annually) or immediately on any suspected leak. |

## Production secrets (NOT in Actions)

The following secrets MUST NEVER appear in GitHub Actions secrets, workflow
files, or any repo-checked-in file. They live exclusively in Vercel
(Production environment scope) and are injected at runtime by the Vercel
serverless platform:

- `SUPABASE_SERVICE_ROLE_KEY` (production project) — bypasses RLS; ADR-0007
  classifies this as a top-tier credential.
- `SUPABASE_DATABASE_URL` (production project) — Supavisor transaction-mode
  credential used only by the server-side audited-mutation adapter; must use
  port 6543 per ADR-0040.
- `STRIPE_LIVE_SECRET_KEY` — production payment authority; must start with
  `sk_live_`. Compromise = real-money fraud surface.
- `RESEND_API_KEY` (production) — outbound email capability; compromise =
  phishing surface against members.
- `TWILIO_AUTH_TOKEN` (production) — SMS capability; compromise = SMS spend
  + member-impersonation surface.

If any of these names appears in `.github/workflows/*.yml`, the PR review
must reject the change. The ADR-0007 backstop grep
(`SUPABASE_SERVICE_ROLE_KEY` substring search against `app/(member)/`,
`app/(marketing)/`, and `components/`) catches the analogous client-bundle
leak; the workflow-secrets discipline is a separate human-review gate.

## References

- [ADR-0007 — Secrets management](../adr/0007-secrets-management.md) for the
  rotation cadence, classification tiers, and the "Actions never holds
  production credentials" rule.
- [ADR-0008 — Environments](../adr/0008-environments.md) for the
  preview / staging / production environment definitions and which secrets
  belong to which scope.
- [ADR-0017 — CI/CD](../adr/0017-ci-cd.md) for the workflow that consumes
  these secrets and the branch-protection model that gates merges on the
  workflow's success.
