# Members Only Poker Social Club

A private, members-funded social poker club in Texas. This repo holds the public website, member portal, cashier console, and admin tools — one Next.js 14 app deployed on Vercel, talking to Supabase Postgres + Auth and Stripe for money.

> **Members must be 21+. ID required at the door. Play responsibly.**

---

## What's here

- `_design/` — the original Claude Design handoff bundle (HTML/CSS/JSX prototypes). The screen files are the visual source of truth; we recreate them in real Next.js.
- `docs/spec.md` — the canonical product + architecture spec. Read this first.
- `docs/design-system.md` — brand tokens (colors, typography, spacing) extracted from `_design/brand.css`. Source of truth for the Tailwind config.
- `docs/route-map.md` — mapping of prototype routes → Next.js paths → primary ADRs → screen files.
- `docs/adr/` — 32 Architecture Decision Records. Foundation 8 (ADR-001 through ADR-008) are written; the rest are stubs that flesh out as their slice is built.

## Stack

- **Frontend / API** — Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, TanStack Query
- **Database / Auth / Storage** — Supabase (Postgres with RLS, Supabase Auth, Storage for ID uploads)
- **Payments** — Stripe (Subscriptions for membership, PaymentIntents for time-bank top-ups and tournament entries)
- **Email** — Resend
- **SMS** — Twilio (A2P 10DLC registered)
- **Errors** — Sentry
- **Analytics + Feature Flags** — PostHog
- **Hosting** — Vercel (web), Supabase (db)

## Phasing

Five vertical slices, each shipped to production:

| Slice | Ships | Approx. week |
|---|---|---|
| 1 | Marketing site + tournament listings (read-only) + cookie banner + analytics + Sentry | wk 1–2 |
| 2 | Auth + member signup + Stripe Subscription ($30 invoice / $25 autopay) + dashboard | wk 3–6 |
| 3 | Time-bank top-up + cashier console + tournament registration with Stripe entry fees | wk 7–10 |
| 4 | Ops hardening — audit log UI, feature flags, rate limiting, DR drill, GDPR/CCPA, runbooks, A/B framework | wk 11–13 |
| 5 | PokerAtlas integration probe (or formalize the manual cashier workflow) | wk 14+ |

See [`docs/spec.md`](docs/spec.md) for full detail.

## Local development

### Prerequisites

- Node 20.11+ (`.nvmrc` pins; `nvm use` will switch)
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9.14.2 --activate`)
- Docker Desktop (for `supabase start`)
- Supabase CLI (`pnpm i -g supabase` or [official install](https://supabase.com/docs/guides/cli/getting-started))

### First-time setup

```bash
pnpm install                            # install deps
cp .env.local.example .env.local        # fill in keys; see ADR-007 for boundary rules
supabase start                          # spin up local Postgres + Studio
pnpm dev                                # http://localhost:3000
```

### Common commands

| Task | Command |
|---|---|
| Dev server | `pnpm dev` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` (or `lint:fix`) |
| Format | `pnpm format` (or `format:check`) |
| Unit tests | `pnpm test` (or `test:watch`, `test:coverage`) |
| E2E tests | `pnpm test:e2e` |
| Reset local DB | `pnpm db:reset` |
| Generate migration | `pnpm db:diff -f <name>` |
| Production build | `pnpm build && pnpm start` |

## License

See [LICENSE](LICENSE).
