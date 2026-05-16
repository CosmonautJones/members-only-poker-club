# Route Map

Mapping from the prototype's hash routes to Next.js App Router paths, the screens that implement them, and the ADRs each route hits.

---

## Public marketing — `app/(marketing)/`

| Prototype route | Next.js path | Screen file | Auth | Primary ADRs |
|---|---|---|---|---|
| `#home` | `/` | `_design/screens-public-1.jsx` `HomeScreen` | none | 024 (cookie), 028 (analytics), 030 (SEO) |
| `#club` | `/club` | `_design/screens-public-2.jsx` `ClubScreen` | none | 030 (SEO) |
| `#games` | `/games` | `_design/screens-public-2.jsx` `GamesScreen` | none | 012 (tournaments — read-only listing in Slice 1, full registration in Slice 3) |
| `#membership` | `/membership` | `_design/screens-public-2.jsx` `MembershipScreen` | none | 010 (membership pricing display), 022 (PCI — links to Stripe) |
| `#contact` | `/contact` | `_design/screens-public-3.jsx` `ContactScreen` | none | 016 (rate limit on contact form), 023 (privacy of submitted data) |
| — | `/faq` | (new — Slice 1) | none | 030 (SEO content) |
| — | `/privacy` | (new — Slice 1) | none | 023, 024 |
| — | `/terms` | (new — Slice 1) | none | 023 |
| — | `/member-agreement` | (new — Slice 1, finalized in Slice 2) | none | 009, 011 (legal disclaimers for ID + time-bank) |

---

## Auth — `app/(auth)/`

| Prototype route | Next.js path | Screen file | Auth | Primary ADRs |
|---|---|---|---|---|
| `#signup` | `/signup` | `_design/screens-auth.jsx` `SignupScreen` | none → member | 002 (auth), 009 (ID + 21+ gate), 010 (Stripe checkout), 022 (PCI), 023 (privacy) |
| `#login` | `/login` | `_design/screens-auth.jsx` `LoginScreen` | none → member | 002 (auth), 016 (rate limit on login) |
| — | `/auth/callback` | (Supabase OAuth callback) | none → member | 002 |
| — | `/forgot-password` | (new — Slice 2) | none | 002 |

---

## Member portal — `app/(member)/`

| Prototype route | Next.js path | Screen file | Auth | Primary ADRs |
|---|---|---|---|---|
| `#dashboard` | `/dashboard` | `_design/screens-portal-1.jsx` `DashboardScreen` | member | 003 (RLS), 010, 011 |
| `#buytime` | `/buytime` | `_design/screens-portal-1.jsx` `BuyTimeScreen` | member | 011 (time bank), 004 (money), 005 (idempotency), 022 (PCI) |
| `#billing` | `/billing` | `_design/screens-portal-2.jsx` `BillingScreen` | member | 010 (subscription mgmt), 022 (Stripe billing portal handoff) |
| `#activity` | `/activity` | `_design/screens-portal-2.jsx` `ActivityScreen` | member | 011 (ledger view), 003 (RLS) |
| `#profile` | `/profile` | `_design/screens-portal-2.jsx` `ProfileScreen` | member | 009, 023 (data export/delete) |

The portal uses a shared shell (`PortalShell` in `_design/primitives.jsx`) with a left-rail nav. Implementation: `app/(member)/layout.tsx` provides the shell.

---

## Staff — `app/(staff)/`

| Prototype route | Next.js path | Screen file | Auth | Primary ADRs |
|---|---|---|---|---|
| `#admin` | `/admin/members` | `_design/screens-system.jsx` `AdminScreen` | manager+ | 003, 006 (audit), 027 (support) |
| — | `/cashier` | (new — Slice 3, designed) | cashier+ | 003, 006, 011, 005 (idempotency) |
| — | `/cashier/[memberId]` | (new — Slice 3) | cashier+ | 003, 011 |
| — | `/admin/audit` | (new — Slice 4) | manager+ | 006 |
| — | `/admin/flags` | (new — Slice 4) | manager+ | 020 |
| — | `/admin/payments` | (new — Slice 4 via ADR-0036 Slice 1) | manager+ | 010, 011, 022, 027, 036 |
| — | `/admin/payments/refunds/new` | (new — Slice 4 via ADR-0036 Slice 1; fail-loud until ADR-0010 Stripe activation) | manager+ | 010, 022, 027, 036 |
| — | `/admin/tournaments` | (new — Slice 3) | manager+ | 012 |

> The full ADR-0036 surface (refunds queue + history, per-member payment view, manual time-bank adjust, membership state override, reconciliation viewer, webhook event log, kill-switch panel) lands in Slices 2–5 of ADR-0036 gated on Stripe activation per ADR-0010. The `/admin/refunds` legacy row is superseded by the `/admin/payments/**` tree.

Staff routes are full-screen (no public nav), gated by middleware at `app/(staff)/layout.tsx`. MFA enforced.

---

## API — `app/api/`

| Path | Method | Purpose | Auth | ADRs |
|---|---|---|---|---|
| `/api/health` | GET | Liveness for uptime monitor | none | 014, 015 |
| `/api/webhooks/stripe` | POST | Stripe events (subscription, payment intent, invoice, dispute) | signature | 005, 010, 011, 022 |
| `/api/webhooks/twilio` | POST | Twilio STOP/HELP/delivery receipts | signature | 025 |
| `/api/contact` | POST | Marketing contact form submission | none + rate-limited | 016, 023 |

---

## Reference — design system viewer

| Prototype route | Next.js path | Screen file | Auth | Notes |
|---|---|---|---|---|
| `#system` | `/_internal/design-system` | `_design/screens-system.jsx` `DesignSystemScreen` | manager+ in prod, public in dev | Living style guide. Hidden behind a flag in production. |

---

## Server actions

Mutations from forms go through Next.js Server Actions, located in `lib/<module>/actions.ts`:

| Action | Module | Idempotency-keyed | Audit |
|---|---|---|---|
| `signupAction` | `lib/identity/actions.ts` | yes | yes |
| `verifyIdAction` | `lib/identity/actions.ts` | no | yes |
| `signMemberAgreementAction` | `lib/identity/actions.ts` | no | yes |
| `startMembershipAction` | `lib/membership/actions.ts` | yes | yes |
| `switchBillingKindAction` | `lib/membership/actions.ts` | yes | yes |
| `cancelMembershipAction` | `lib/membership/actions.ts` | no | yes |
| `resumeMembershipAction` | `lib/membership/actions.ts` | yes | yes |
| `buyTimeTopupAction` | `lib/time-bank/actions.ts` | yes | yes |
| `redeemTimeAction` | `lib/time-bank/actions.ts` | **yes — critical** | yes |
| `manualTimeAdjustmentAction` | `lib/time-bank/actions.ts` | yes | yes |
| `registerForTournamentAction` | `lib/tournaments/actions.ts` | yes | yes |
| `cancelTournamentRegAction` | `lib/tournaments/actions.ts` | no | yes |
| `updateProfileAction` | `lib/identity/actions.ts` | no | yes |
| `requestDataExportAction` | `lib/identity/actions.ts` | no | yes |
| `requestAccountDeletionAction` | `lib/identity/actions.ts` | no | yes |

Every server action that touches money or modifies role/state writes an `audit_log` row in the same transaction.

---

## Slice mapping

| Slice | Routes shipped |
|---|---|
| 1 | `/`, `/club`, `/games` (read-only), `/membership`, `/contact`, `/faq`, `/privacy`, `/terms`, `/member-agreement`, `/api/health`, `/api/contact` |
| 2 | `/signup`, `/login`, `/auth/callback`, `/forgot-password`, `/dashboard`, `/billing`, `/profile`, `/api/webhooks/stripe` (subscription events) |
| 3 | `/buytime`, `/activity`, `/cashier`, `/cashier/[memberId]`, `/games/[slug]/register`, `/admin/tournaments`, `/api/webhooks/stripe` (extended), `/api/webhooks/twilio` |
| 4 | `/admin/audit`, `/admin/flags`, `/admin/refunds`, `/_internal/design-system` (gated) |
| 5 | (no new routes; integration logic) |
