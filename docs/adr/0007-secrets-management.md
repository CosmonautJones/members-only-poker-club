# ADR-0007: Secrets management

- **Status:** Accepted
- **Date:** 2026-05-04
- **Slice:** 1

## Context

The app holds high-impact secrets: Supabase service-role key (RLS bypass), Stripe secret key (charge-anything authority), Stripe webhook signing secret, Twilio account SID + auth token, Resend API key, Sentry auth token. A leak of any of these is a paging-level incident.

Vercel offers per-environment encrypted environment variables. Supabase offers per-project secrets. We don't need a separate secret manager (Vault, AWS Secrets Manager) at this scale — but we do need clear policy.

## Decision

### Storage

- **Production secrets** live only in Vercel environment variables, scoped to the production environment.
- **Preview/staging secrets** are separate values (separate Stripe test-mode keys, separate Supabase staging project).
- **Development secrets** live in `.env.local` on each developer's machine. `.env.local` is `.gitignore`d.
- **`.env.example` is committed** with every key listed and a placeholder value, so a new developer knows what they need.

### Boundary enforcement

- Secret-bearing code marked `import 'server-only'` at the top of the file (Next.js runtime check that fails the build if imported into a Client Component).
- Supabase service-role key used only in:
  - `lib/supabase/admin.ts`
  - `app/api/webhooks/stripe/route.ts`
  - `app/api/webhooks/twilio/route.ts`
  - `lib/admin/*` modules
- Stripe secret key used only in `lib/payments/stripe.ts`. All Stripe calls flow through this module.
- A grep in CI fails the build if `process.env.SUPABASE_SERVICE_ROLE_KEY` appears in any file under `app/(member)/`, `app/(marketing)/`, or `components/`.

### Rotation policy

| Secret | Rotation cadence | Trigger for early rotation |
|---|---|---|
| Stripe secret key | Quarterly | Suspected leak, employee offboarding |
| Stripe webhook signing secret | Quarterly + on every endpoint URL change | URL change |
| Supabase service-role key | Quarterly | Suspected leak |
| Supabase JWT secret | Annually | Suspected leak (forces all sessions to invalidate) |
| Twilio auth token | Annually | Suspected leak |
| Resend API key | Annually | Suspected leak |
| Sentry auth token | Annually | Suspected leak |

Rotation is a runbook item (ADR-027); the runbook lives at `docs/runbooks/rotate-secrets.md` (Slice 4).

### Detection

- GitHub secret scanning enabled at the repo level.
- Vercel deploy logs alert on any `SUPABASE_SERVICE_ROLE_KEY` appearing in build output.
- Sentry scrubs known secret patterns before sending events.

### Naming convention

- `*_SECRET_KEY` — server-only, never NEXT_PUBLIC_-prefixed
- `*_PUBLIC_KEY` or `NEXT_PUBLIC_*` — safe to ship in client bundle
- Stripe public key is `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- Supabase anon key is `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Supabase service-role key is `SUPABASE_SERVICE_ROLE_KEY` — never NEXT_PUBLIC_

## Consequences

**Positive:**

- Vercel + Supabase native secret storage is encrypted at rest and not visible in deploy logs.
- The `'server-only'` import is a build-time guard, not just a convention.
- Rotation is calendared, not vibes-based.

**Negative:**

- Multiple-environment secret synchronization is manual. A developer adding a new env var must remember to add it to local, preview, and prod. Mitigation: `.env.example` + a CI check that warns when a new `process.env.X` reference appears without a corresponding `.env.example` entry.
- No secret manager means we can't audit who accessed what secret when. Acceptable at this scale; revisit if team grows past 5.

## Alternatives considered

- **HashiCorp Vault / AWS Secrets Manager.** Stronger audit, dynamic secrets, secret leasing. Overkill for our team size and cost.
- **Doppler / Infisical.** Useful for multi-developer teams; reconsider if onboarding > 3rd person.
- **Committing encrypted secrets (`git-crypt`, `sops`).** Brittle, leaks through git history if a key ever escapes. Rejected.
