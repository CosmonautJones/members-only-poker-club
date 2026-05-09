# ADR-0013: PokerAtlas TableCaptain integration

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 5

## Context

The room runs PokerAtlas TableCaptain for in-room operations: live game management, waitlist, dealer rotation, tournament management, player time tracking, ID scanning, digital membership cards. Their pricing sheet (H1 2026) confirms: $1,200/yr/table software license, $1,650/table optional touchscreen, plus $5–12K equipment.

**Verified 2026-05-04:** PokerAtlas does not appear to publish a public API. Their info pages, Zendesk, and developer-focused community threads mention a POS integration but only as a partner-arranged, case-by-case engagement. There is no documented webhook delivery, REST endpoint, or database read-replica option that we can plan against.

This means: in v1 our app and TableCaptain are independent systems. The cashier reconciles between them manually at the desk.

## Decision

- **Discovery first.** Before building, contact PokerAtlas (they have a Zendesk and a sales contact). Ask:
  - Do you offer an API to partners?
  - Do you offer webhook delivery on player events (signed in / signed out / time consumed)?
  - Do you offer a database read-replica or scheduled CSV exports?
  - Do you have a POS integration kit?
- **If yes** → build the bridge:
  - Stripe-equivalent webhook handler at `/api/webhooks/pokeratlas` if they offer push
  - Or scheduled poll job (`/api/cron/sync-pokeratlas`) if they offer pull
  - Map TableCaptain `player_id` ↔ our `profiles.id` via member_number
  - Translate "time consumed in TC" → automatic ledger debit in our system
  - Reconcile drift nightly; alert on mismatch
- **If no** → harden the manual workflow:
  - Cashier prints daily TableCaptain time export (CSV, hand-typed if no export exists)
  - Imports into `/admin/reconcile` page, which proposes ledger entries for review
  - Manager approves the batch, ledger writes happen
  - Mismatch detection: any member with TC time > our wallet balance flagged for follow-up

## Open questions (deferred — discovery call required)

- **What does PokerAtlas actually offer?** — owner-action: schedule the PokerAtlas discovery call. Until completed, the manual-reconciliation branch of the decision tree is in effect.
- **Cost of partner integration** — discovery-pending. Code path is conditional on the discovery outcome.
- **Latency tolerance: real-time vs eventual** — resolved if/when bridge exists: eventual reconciliation (5-minute polling or end-of-day batch). Real-time is overkill for the volume.
- **TableCaptain seats a player our system shows as no-balance** — resolved: cashier overrides via `/admin/reconcile`; the override is audit-logged with reason. Drift alert fires on overnight reconcile.

## Alternatives considered (not chosen)

- **Replace TableCaptain entirely** — rejected. Massive scope creep; the existing hardware works.
- **Skip integration forever (manual SOP)** — rejected. Manual reconciliation is the v1 default but the bridge ramp is the long-term direction once discovery confirms the integration path.
- **Third-party reconciliation tool** — none known to exist for poker rooms. Re-evaluate annually.
