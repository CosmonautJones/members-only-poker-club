# ADR-0024: Cookie & consent banner

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 1

## Context

We set cookies for: auth (essential), analytics (PostHog), error tracking (Sentry session ID). Most jurisdictions require user consent before non-essential cookies fire.

## Decision

To be drafted in Slice 1. Direction:

- **Default: deny non-essential cookies.** Analytics and error-tracking session cookies stay off until consent.
- **Banner** appears on first visit, sticky bottom-right, with "Accept all" / "Essential only" / "Customize" options.
- **Customize** opens a panel listing each cookie category (Essential, Analytics, Errors) with a toggle.
- **Storage:** consent state stored in a `mopc-consent` cookie, 1-year TTL, revisitable via footer link "Cookie preferences".
- **Implementation:**
  - Tiny component in `components/site/cookie-banner.tsx`
  - Provider that reads the consent cookie and exposes a `useConsent()` hook
  - `<PostHogProvider>` and Sentry `init()` are gated on `consent.analytics === true`
  - Server-side cookies (auth) are exempt — they're "strictly necessary"
- **Visual:** matches brand (gold border, ink-850 background), respects `prefers-reduced-motion`

## Open questions

- Whether to use a third-party CMP (Osano, Cookiebot, OneTrust) — probably overkill for our cookie load
- Whether to localize for non-English visitors (TX market is mostly English)
