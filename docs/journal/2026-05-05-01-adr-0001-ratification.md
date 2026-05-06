---
date: 2026-05-05
adrs: [0001]
slice: 1
type: ratification
status: complete
---

# ADR-0001 ratification + journal infra

## Context

Starting an end-to-end pass through the 32 ADRs to bring the codebase to "production-ready for our first big customer." Working ADR-by-ADR, ratifying or designing each in order so we don't backtrack.

ADR-0001 is a *decision* ADR — it picks the stack (Next.js + Supabase + Stripe + Resend + Twilio + Sentry + PostHog + shadcn/ui + TanStack Query, all on Vercel). The decision itself is already ratified in `package.json`. The question for this pass was whether to also wire every vendor *now*, or only as their consuming ADR demands it.

We chose **decision-level coverage** over implementation-level coverage. Each later ADR's slice owns its own vendor wiring (Stripe → ADR-0010, Twilio/Resend → ADR-0025, Sentry → ADR-0014, PostHog → ADR-0028). Front-loading vendor stubs would create dead code we'd revisit and would obscure real integration questions when the consuming feature arrives.

## Changes

- Audited the current scaffold against every line of ADR-0001; documented gaps below (none blocking).
- Created `docs/journal/` as a new top-level documentation surface.
- Wrote `docs/journal/README.md` (purpose, filename convention, entry template, index).
- Wrote this entry as the first journal record.

No application code changed.

## Decisions

- **Decision-level over implementation-level coverage of stack ADRs.** Reason: ADRs 9–32 each name their own slice and own their own vendor wiring. Front-loading creates dead code that gets revisited anyway and hides real integration questions until they're already wrong. The bar ADR-0001 must clear at this stage is "we can build the next slice without re-architecting the foundation" — which it does.
- **Journal lives at `docs/journal/`** (not `docs/log/`, not `docs/superpowers/`, not `CHANGELOG.md`). Reason: this is project-specific documentation distinct from formal specs (`docs/superpowers/specs/` per the brainstorming skill) and distinct from a per-release changelog. The journal is the running ledger; specs are point-in-time artifacts; CHANGELOG is for shipped versions.
- **Per-ADR git branches** following the existing convention (`chore/...`, `slice-N/...`). This shift sits on `chore/journal-infra`. ADR-0002 will branch separately when we get there.

## Audit — ADR-0001 vs current state

| Item from ADR-0001 | State | Notes |
|---|---|---|
| Next.js 14 App Router + TypeScript | ✓ | `next 14.2.18`, `app/` dir, `experimental.typedRoutes: true` |
| Tailwind CSS | ✓ | `tailwind.config.ts` with brand tokens, `app/globals.css` |
| shadcn/ui | configured, no components yet | `components.json` set; first components scaffolded when needed |
| TanStack Query | dep installed, no provider | provider added when first client query lands |
| Supabase client / server / middleware | ✓ | `lib/supabase/{client,server,middleware}.ts` |
| Supabase Storage (ID uploads) | not yet | wired in ADR-0009 (member identity & ID verification) |
| Stripe | dep installed only | wired in ADR-0010 / ADR-0011 / ADR-0012 |
| Resend | dep installed only | wired in ADR-0025 (email/SMS) |
| Twilio (A2P 10DLC) | dep installed only | wired in ADR-0025; A2P registration is operational, not code |
| Sentry | dep installed only | wired in ADR-0014 (observability) |
| PostHog | dep installed only | wired in ADR-0028 (analytics + feature flags) |
| Vercel deploy | repo-side ready | Next.js auto-detected; no `vercel.json` needed at this stage |
| `.env.local.example` | ✓ | covers all 8 vendors |
| `.nvmrc` (20.11.0) | ✓ | matches `package.json#engines.node` |
| `.eslintrc.json`, `.prettierrc` | ✓ | format-check + lint wired to CI |
| CI (typecheck, lint, format, unit) | ✓ | `.github/workflows/ci.yml`, 10-min timeout, concurrency cancel |
| Security headers | ✓ | `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, locked-down `Permissions-Policy` in `next.config.mjs` |
| Money types | ✓ (early) | `lib/money/types.ts` + tests; advances ADR-0004 |

No blocking gaps for slice-1 progress. ADR-0001 is ratified.

## Tests

None added. Stack ratification is structural, not behavioural — there is no behaviour to assert. The last commit on `main` (`d08bb16 chore(review): apply validation-pass fixes`) suggests CI was green at that point; I did not re-run `pnpm typecheck && pnpm lint && pnpm test` locally for this entry (no `node_modules`, no `pnpm` on PATH). When ADR-0002 work begins we'll run the full suite as part of the implementation cycle's verification step.

## Next

- Move to **ADR-0002 — Authentication & session management**. Status `Accepted`, but it deliberately splits into a slice-1 *skeleton* and a slice-2 *full* auth stack. Brainstorm slice-1 scope with the user before writing a plan.
- Open a draft ADR-0002 implementation spec under `docs/superpowers/specs/` once scope is agreed.

## Notes for future me

- The repo exists at two paths on disk that are identical at HEAD: `members-only-poker-club` (canonical name) and `members-only-pokers-club` (typo, but the path the user pointed at). Same git origin, same HEAD as of `d08bb16`. Working in the typo'd path; if they diverge, treat the user-pointed path as canonical for this work.
- Resist the urge to scaffold dead vendor wiring "while we're here." Each later ADR owns its slice's wiring. The cost of premature wiring is dead code reviewed twice.
- The `_design/` directory holds the visual handoff bundle. It's the source of truth for screen visuals — when we get to UI work, recreate from there rather than improvising.
- TDD policy from `CONTRIBUTING.md` is **required** for `lib/` code touching money, identity, RLS, idempotency, or webhooks. The brainstorming skill's TDD red-flag checklist applies — do not skip the failing test.
