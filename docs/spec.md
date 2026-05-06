# Members Only Poker Social Club — Web App Spec & Architecture

**Status:** approved 2026-05-04 · **Repository:** [CosmonautJones/members-only-poker-club](https://github.com/CosmonautJones/members-only-poker-club)

## Context

A new Texas-style social poker club is opening, currently BYOB while pursuing a TABC liquor license. The owner needs a public-facing website and a member-facing app that handles membership signup, recurring billing (with an autopay discount), prepaid time-bank purchases, tournament listings + registration, and 21+ ID verification. The room runs PokerAtlas TableCaptain hardware/software for in-room operations (waitlist, dealer rotation, tournament management, ID scanning).

**Business model (TX private social club):**

- Members-only, **age 21+** (house policy; tracks Texas alcohol-service requirements once the TABC license is issued — see ADR-0033)
- Membership: $30/month invoice, **$25/month on autopay** ($5 incentive)
- Seat time: $12/hour, deducted from a prepaid time-bank wallet
- Promo: $200 buys $300 of time-bank credit (~25 hours @ $12/hr)
- No house rake (TX requires the club's revenue come from membership/seat fees, not a cut of pots)

**Strategic constraints:**

- **PokerAtlas does not appear to publish a public API.** No developer portal, no documented webhooks. Verified 2026-05-04 via web search and the PokerAtlas Zendesk. Treating TableCaptain as integratable is a load-bearing risk. Spec defers integration to Phase 2 and proceeds with manual cashier-side reconciliation in v1.
- **A2P 10DLC carrier registration is a 2–6 week paperwork process.** Required for any business SMS to US numbers. Must start in week 1 even though SMS doesn't ship until week 7, otherwise it becomes a launch blocker.
- **Stored-value time-bank may trigger TX unclaimed-property law** if balances sit dormant. ADR-011 documents the posture (likely: 3-year inactivity → outreach → conversion to non-refundable promo credit; CPA review before launch).

**Why this matters now:** the owner has signed off on the room, pricing, and visual identity. The website + member system are the gating dependency for taking sign-ups, processing autopay enrollments, and giving the club a credible web presence ahead of opening.

---

## Locked-in decisions

| Decision | Choice | Why |
|---|---|---|
| Stack | Next.js 14 (App Router) + Supabase + Stripe + shadcn/ui + TanStack Query | Fastest path to production; matches design handoff; one deployable |
| Hosting | Vercel (web) + Supabase (db/auth/storage) | Zero-ops, preview envs per PR, regional Postgres |
| Payments | Stripe (Subscriptions for membership, PaymentIntents for time-bank top-ups and tournament entries) | Industry standard; PCI scope kept to "SAQ A" via Stripe Elements / Checkout |
| PokerAtlas integration | **Deferred to Phase 2.** v1 reconciles manually at cashier window | No public API exists; no point gating launch on a vendor conversation we haven't started |
| Phasing | Approach A — five vertical slices, each shipped to production | Earliest revenue, real feedback loops, ops-hardening doesn't get squeezed at the end |
| Tournaments | In v1 (listing + registration + Stripe entry-fee). Tournament *structure* stays in TableCaptain | Owner explicitly requested |
| SMS | In v1 (transactional only — receipts, low-balance alerts, tournament reminders) | Owner explicitly requested. Marketing SMS = ADR-025 Phase 2 |
| Jurisdiction | Texas social club | Owner confirmed |
| Age | 21+ | House policy; aligns with TABC age requirement once licensed (see ADR-0033) |
| Domain | `membersonlypoker.com` (primary), `membersonlypokerclub.com` (alt — already considered) | Owner to confirm registration; site infrastructure is domain-agnostic |
| Repository | [CosmonautJones/members-only-poker-club](https://github.com/CosmonautJones/members-only-poker-club) | Public; will be made private before any sensitive code lands |
| Design system | See [`design-system.md`](design-system.md) | Tokens lifted from `_design/brand.css` |

---

## Architecture overview

A **single Next.js 14 app** on Vercel. No separate API server, no separate marketing CMS, no microservices. All surfaces (marketing site, member portal, cashier console, admin) are folders inside one Next.js project that share the same auth session, database, and deploy pipeline.

```
                                       ┌──────────────────────────┐
                                       │  Vercel (Next.js 14)     │
                                       │                          │
  Browsers ─── HTTPS ───────────────▶  │  app/(marketing)         │
  (members,   middleware, RSC,         │  app/(member)            │
   staff,     server actions           │  app/(staff)/cashier     │
   public)                             │  app/(staff)/admin       │
                                       │  app/api/webhooks/*      │
                                       └──────────┬───────────────┘
                                                  │ supabase-js (RLS-enforced)
                                                  ▼
                                       ┌──────────────────────────┐
                                       │  Supabase (Postgres)     │
                                       │  - profiles, memberships │
                                       │  - time_wallets, ledger  │
                                       │  - tournaments, regs     │
                                       │  - audit_log             │
                                       │  Auth, Storage (ID pics) │
                                       └──────────────────────────┘
                                                  ▲
                  Stripe Webhooks ────────────────┤
                  (signed)                        │
                  Twilio Webhooks (STOP/HELP) ────┘
```

External services: **Stripe** (money), **Twilio** (SMS), **Resend** (transactional email), **Sentry** (errors), **PostHog** (product analytics + feature flags).

For the prototype-route → Next.js-path → primary-ADR mapping, see [`route-map.md`](route-map.md).

---

## Component map

| Surface | Path | Auth | Purpose |
|---|---|---|---|
| Marketing | `app/(marketing)/*` | none | Home, The Club, Games & Tournaments (public), Membership (pricing), Find Us, Privacy, Terms, Member Agreement |
| Member portal | `app/(member)/*` | member | Dashboard, Buy Time, Billing, Activity, Profile |
| Cashier console | `app/(staff)/cashier/*` | cashier+ role | Member lookup (email/phone/QR), redeem time, manual credit/debit, daily reconciliation, mark "in TableCaptain now" |
| Admin | `app/(staff)/admin/*` | manager+ role | Members list, role assignment, refunds, audit log viewer, financial reports, tournament CRUD, content edits, feature flags |
| Auth | `app/(auth)/*` | none → member | Sign up (multi-step: email → DOB → phone → ID upload → e-sign agreement → Stripe checkout), Sign in |
| Stripe webhooks | `app/api/webhooks/stripe/route.ts` | signature-verified | Subscription state, payment intents, invoices, disputes |
| Twilio webhooks | `app/api/webhooks/twilio/route.ts` | signature-verified | STOP/HELP handling, delivery receipts |
| Health/status | `app/api/health/route.ts` | none | Liveness probe for uptime monitor |

Mutations from any UI surface go through Next.js **Server Actions** (idempotency-keyed where they touch money). Client-side reads use TanStack Query against Supabase with RLS doing the access enforcement.

---

## Domain modules (DDD-light)

Each module owns its types, queries, and server actions. Modules don't reach into each other's tables — they call each other's functions.

| Module | Owns | Tables |
|---|---|---|
| `lib/identity/` | Profile creation, DOB gate (21+), ID upload + verification, member-agreement signature | `profiles` |
| `lib/membership/` | Stripe Subscription lifecycle, autopay/invoice switch, cancel/resume, dunning | `memberships` |
| `lib/time-bank/` | Wallet balance, purchase, redemption, refund, expiration, reconciliation | `time_wallets`, `time_ledger` |
| `lib/tournaments/` | CRUD, registration, waitlist, entry-fee Stripe flow | `tournaments`, `tournament_regs` |
| `lib/payments/` | Stripe abstraction (PaymentIntent, Subscription, webhook signature, dispute) | `payments` |
| `lib/audit/` | Append-only audit log writes, query helpers | `audit_log` |
| `lib/auth/` | Supabase Auth wrappers, role checks, MFA enforcement for staff | (uses `auth.users`, `profiles.role`) |
| `lib/sms/` | Twilio integration, opt-in management, template rendering, STOP handling | `sms_messages` |
| `lib/email/` | Resend integration, transactional templates | (uses external) |
| `lib/flags/` | Feature flags read/write, percent rollout | `feature_flags` |
| `lib/sessions/` | In-room session tracking (PokerAtlas bridge — Phase 2) | `sessions_in_room` |

---

## Data model (core tables, sketch)

```sql
profiles            id (=auth.users.id), full_name, dob, phone, email, member_number,
                    id_verified_at, id_doc_path, member_agreement_signed_at,
                    role (member|cashier|manager|owner), sms_opt_in_at, deleted_at

memberships         id, profile_id, status (trialing|active|past_due|canceled|paused),
                    stripe_subscription_id, billing_kind (autopay|invoice),
                    current_period_end, canceled_at, cancel_reason

time_wallets        profile_id (pk), balance_minutes, balance_cents_at_purchase,
                    last_activity_at, dormancy_state (active|warning|dormant)

time_ledger         id, wallet_id, kind (purchase|redemption|adjustment|refund|expire|promo_bonus),
                    delta_minutes, delta_cents, source (stripe_pi|cashier|system|admin),
                    actor_id, idempotency_key, stripe_pi_id, note, created_at

payments            id, profile_id, stripe_object_id, kind (membership|time_topup|tournament_entry),
                    amount_cents, currency, status, raw_event jsonb, created_at

tournaments         id, slug, name, starts_at, buy_in_cents, structure_md, capacity,
                    status (scheduled|registering|live|complete|canceled), created_by

tournament_regs     id, tournament_id, profile_id, status (registered|waitlisted|canceled|no_show),
                    payment_id (nullable), registered_at

sessions_in_room    id, profile_id, started_at, ended_at, minutes_consumed,
                    cashier_id, table_captain_session_ref (nullable in v1)

audit_log           id, actor_id, action, target_type, target_id,
                    before jsonb, after jsonb, ip, user_agent, created_at

content_blocks      slug (pk), body_md, updated_by, updated_at

feature_flags       key (pk), enabled bool, percent int, rules jsonb, updated_at

sms_messages        id, profile_id, to_number, template, body, twilio_sid,
                    status, sent_at, error
```

### Key invariants

- **`time_ledger` is append-only.** `time_wallets.balance_minutes` is a materialized projection — can be rebuilt at any time from the ledger.
- **Idempotency keys on every money-touching server action.** Stripe webhooks fire twice; cashiers double-click "redeem 1 hour."
- **RLS enabled on every table.** Members see their own row; cashiers see all members but not other staff's audit entries; managers see audit; owner sees everything.
- **Money = integer cents. Time = integer minutes.** No floats anywhere in the schema or app code.
- **Stripe is source of truth for subscription state.** Postgres is source of truth for time wallet, identity, and audit.
- **Soft delete via `deleted_at`** for profiles; ledger and audit never deleted (compliance).
- **MFA required for cashier+ roles.**

---

## Phased delivery (Approach A)

Each slice is independently shippable to production behind the same Vercel deployment. Each slice ships with the ADRs it introduces.

### Slice 1 — Marketing + Tournament listings (wk 1–2)

**Ships:** public marketing pages, public tournament list (read-only), contact form, SEO basics, cookie banner, analytics, Sentry, A2P 10DLC paperwork *kicked off* (not blocking).

**Routes (per [route-map.md](route-map.md)):** `/`, `/club`, `/games`, `/membership`, `/contact`, `/privacy`, `/terms`, `/member-agreement`.

**ADRs introduced:** 001–008 (foundation), 022 (PCI), 024 (cookie consent), 026 (a11y), 030 (SEO).

**Out of scope:** auth, payments, member portal, tournament registration.

**Acceptance:** site live at production domain, ≥90 Lighthouse perf/SEO/a11y, cookie banner gates analytics, contact form delivers email, owner previews via Vercel.

### Slice 2 — Membership + Auth + SMS skeleton (wk 3–6)

**Ships:** member can sign up (21+ gate), verify ID, sign agreement, choose autopay or invoice billing, pay via Stripe, manage card, cancel/resume.

**Routes:** `/signup`, `/login`, `/dashboard`, `/billing`, `/profile`.

**ADRs introduced:** 009 (identity), 010 (membership), 023 (privacy/GDPR), 025 (email/SMS), 027 (support).

**Out of scope:** time bank, tournament registration, cashier tools.

**Acceptance:** end-to-end Playwright test from signup → autopay → receipt SMS → cancel → reactivate. Real Stripe webhook deliveries pass signature verification. Dunning emails fire on `past_due`.

### Slice 3 — Time bank + Cashier console + Tournament registration (wk 7–10)

**Ships:** members buy time online; cashiers look up + redeem; tournaments take entry payments.

**Routes:** `/buytime`, `/activity`, `/cashier`, `/cashier/[memberId]`, `/games/[tournamentSlug]/register`, plus admin tournament CRUD.

**ADRs introduced:** 011 (time bank), 012 (tournaments), 013 (PokerAtlas — placeholder).

**Acceptance:** member buys $200, sees $300 credited; cashier redeems 60 min, ledger reflects idempotently even on double-click; tournament registration with paid buy-in works end-to-end; reconciliation CSV opens cleanly in Excel.

### Slice 4 — Ops hardening (wk 11–13)

**Ships:** the iceberg.

**ADRs introduced:** 014 (observability), 015 (alerting), 016 (rate limit), 017 (CI/CD), 018 (migrations), 019 (DR), 020 (flags), 021 (testing strategy formalized), 028 (analytics), 029 (A/B), 031 (vendor lock-in), 032 (cost model).

**Includes:** audit log viewer, feature flags admin UI, rate limiting via Edge Middleware, observability dashboard, DR drill, GDPR/CCPA self-serve flow, cookie/consent center, support runbooks, A/B framework, accessibility audit, k6 load test.

**Acceptance:** PITR restore drill completes; runbooks reviewed by owner; load test p95 < 500ms; a11y audit shows no WCAG 2.1 AA blockers.

### Slice 5 — PokerAtlas probe (wk 14+)

Direct outreach to PokerAtlas. Either build the bridge, or harden the manual cashier workflow with barcode scanning + nightly CSV import + mismatch detection.

---

## ADR index

See [`adr/README.md`](adr/README.md) for the canonical index. The 32 ADRs are grouped:

- **Foundation (001–008):** stack, auth, RBAC/RLS, money, idempotency, audit, secrets, environments — written before code.
- **Domain (009–013):** identity, membership, time bank, tournaments, PokerAtlas — written in their slice.
- **Reliability (014–021):** observability, alerting, rate limit, CI/CD, migrations, DR, flags, testing — Slice 4.
- **Compliance & customer (022–027):** PCI, GDPR/CCPA, cookies, email/SMS, a11y, support — across slices.
- **Growth (028–030):** analytics, A/B, SEO — across slices.
- **Strategy (031–032):** vendor lock-in, cost model — Slice 4.

---

## Critical files to be created (Slice 1 day-1 list)

```
package.json, tsconfig.json, next.config.mjs, tailwind.config.ts, postcss.config.mjs
.env.local.example                                        — every required env var
.github/workflows/ci.yml                                  — typecheck, lint, unit, e2e on PR
.github/workflows/deploy-preview.yml                      — Vercel preview per branch
supabase/migrations/0001_init.sql                         — profiles, audit_log, content_blocks
supabase/seed.sql                                         — owner role seeded
app/layout.tsx, app/page.tsx, app/(marketing)/layout.tsx
app/(marketing)/{club,games,membership,contact,privacy,terms,member-agreement}/page.tsx
components/ui/*                                           — shadcn primitives (button, input, card, etc.)
components/brand/{chip,wordmark,suit,laurel,icon}.tsx     — port from _design/primitives.jsx
components/site-{header,footer,nav}.tsx
lib/supabase/{server,client,middleware}.ts
lib/sentry.ts, lib/posthog.ts
middleware.ts                                             — rate-limit + cookie consent gate for analytics
```

---

## Verification (per slice + overall)

| Layer | How we verify |
|---|---|
| Type safety | `tsc --noEmit` on every PR |
| Lint | ESLint + Prettier on every PR |
| Unit | Vitest, ≥80% line coverage on `lib/` |
| Integration | Vitest + Stripe test mode + Supabase local — full webhook→ledger flow |
| E2E | Playwright against preview deploy: signup, autopay, top-up, redeem, tournament reg, cancel |
| Load | k6 vs staging at ~200 concurrent + 5 cashiers (Slice 4) |
| DR | Quarterly PITR-restore drill into staging (Slice 4 onward) |
| Security | `npm audit`, weekly Snyk, manual review of every RLS policy |
| Owner UAT | Owner walks through each slice in staging before prod cutover |

---

## Open questions

1. **Domain registration** — owner to confirm `membersonlypoker.com` is registered (now the primary). `membersonlypokerclub.com` retained as alt / redirect target if already registered. Vercel hosts either.
2. **Brand assets in vector form** — chip-logo, signage, room-layout PNGs are in `_design/assets/`. Need SVG/AI versions for high-res print and favicon.
3. **TABC permit number** — must appear on Privacy/Terms once issued.
4. **Member agreement legal text** — needs counsel review. We draft from a TX private-club template; owner's lawyer signs off.
5. **Time-bank refund/expiration policy** — ADR-011 proposes; owner approves before Slice 3.
6. **Twilio A2P 10DLC brand** — register as the LLC that owns the room. Owner provides EIN + business address.
7. **Owner's CPA contact** — for sales-tax and stored-value escheatment opinion.
8. **Repo visibility** — currently public. Switch to private before any sensitive logic (auth, Stripe, PII) lands.

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PokerAtlas refuses or delays API access | High | Medium | v1 doesn't depend on it; manual workflow in Slice 3 |
| A2P 10DLC registration delays SMS | Medium | Low | Kicked off week 1; SMS gracefully degrades to email-only if not approved by week 7 |
| TX stored-value escheatment forces refund obligations | Low | Medium | ADR-011 documents conservative posture; CPA reviews before Slice 3 |
| Stripe disputes / chargebacks erode margin | Low | Low | Clear receipts, member-agreement ToS, 3DS for $200+ payments, dispute response runbook in Slice 4 |
| Owner pivots scope mid-build | Medium | Medium | Phased delivery means each slice is shippable; we re-plan between slices, not mid-slice |
| Member ID-doc PII breach | Low | Severe | Storage in Supabase encrypted bucket; access restricted to manager+ role; ADR-009 retention policy + auto-purge after verification |
| Vendor outage (Vercel, Supabase, Stripe) | Low | Medium | ADR-019 documents acceptable downtime; status page; manual cashier workflow degrades gracefully |
| Repo public during sensitive-code commits | Medium | High | Switch to private before Slice 2 |
