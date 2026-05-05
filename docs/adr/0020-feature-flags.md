# ADR-0020: Feature flags

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 4

## Context

We want to ship dark — turn features on for owner/staff first, then a small percent of members, then everyone. We also want kill-switches for things that break in production.

## Decision

To be drafted in Slice 4. Direction:

- **Storage:** `feature_flags` Postgres table. Each row: key, enabled (bool), percent (0–100), rules (jsonb for advanced targeting), updated_at, updated_by.
- **Read path:** Edge Middleware loads flags from a Postgres view cached in memory for 60s; flag check is a lookup, not a query per request.
- **Write path:** `/admin/flags` UI for managers+; toggles audit-logged.
- **Targeting:**
  - Boolean (on for everyone or no one)
  - Percent rollout (deterministic — `hash(profile_id) % 100 < percent`)
  - Allowlist (specific member numbers — for staff dogfooding)
  - Role gate (e.g., "only show for cashier+")
- **Naming:** kebab-case (`tournament-waitlist-v2`, `cashier-bulk-redeem`). Prefix with `kill-` for kill-switches (`kill-stripe-webhook`, `kill-sms-sends`).
- **Lifecycle:** flags must have an owner and an expiry. Stale flags (>90 days at 100% or 0%) are flagged for cleanup in a monthly review.

### Integration with PostHog

For UI experiments where we want PostHog's funnel analysis, use PostHog feature flags. For backend kill-switches and operational toggles, use our own table (faster, more reliable, no external dependency for critical paths).

## Open questions

- Whether to graduate to LaunchDarkly when team grows
- Whether to add JSON-rules engine for advanced targeting (probably not needed v1)
