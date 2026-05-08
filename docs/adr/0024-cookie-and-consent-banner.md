# ADR-0024: Cookie & consent banner

- **Status:** Accepted
- **Date:** 2026-05-04
- **Slice:** 1

## Context

The site sets cookies for three purposes: authentication (essential — Supabase session), product analytics (PostHog — funnel events per ADR-0028), and error tracking (Sentry session ID per ADR-0014). Authentication cookies are strictly necessary; analytics and error-tracking cookies are not, and most jurisdictions (GDPR for EU travelers, CCPA/CPRA for California visitors, and emerging US state laws) require informed user consent before non-essential cookies are written or read.

The TX-resident customer base does not directly trigger GDPR/CCPA, but visitors to a public marketing site travel and move; the cheapest defensible posture is to obtain consent globally rather than geo-fence the banner. ADR-0023 (privacy posture) and ADR-0030 (SEO acknowledges that consent default-deny narrows funnel data) both depend on what this ADR decides.

## Decision

We ship a **first-party, default-deny consent banner** owned in-repo. No third-party CMP.

### Default posture

Non-essential cookies — PostHog analytics and Sentry session ID — stay off until the visitor grants consent. Authentication and CSRF cookies are exempt as "strictly necessary" and are set without prompting.

### Banner UI

- Appears on first visit (no `mopc-consent` cookie present), sticky bottom-right of the viewport.
- Three actions: **Accept all**, **Essential only**, **Customize**.
- Brand-aligned visuals: ink-850 background, gold border, body text in the marketing type scale.
- Respects `prefers-reduced-motion` — no entrance/exit animation when the user's OS opts out.
- Dismisses on any of the three actions; the banner does not block interaction with the page.

### Customize panel

Selecting **Customize** opens a panel with a per-category toggle:

- **Essential** (always on, locked) — auth, CSRF, consent state itself.
- **Analytics** — PostHog product events.
- **Errors** — Sentry session-ID cookie used to correlate exceptions across a user's session.

A footer link **Cookie preferences** re-opens the panel from any marketing page so members and visitors can revise consent later.

### Storage

Consent state is stored in a first-party `mopc-consent` cookie with a 1-year TTL. Shape:

```
{ essential: true, analytics: boolean, errors: boolean, version: 1 }
```

The `version` field allows us to re-prompt if the cookie taxonomy changes materially (e.g., a new category is added).

### Implementation

- Banner component at `components/site/cookie-banner.tsx` (client component).
- Provider that reads the consent cookie on mount and exposes a `useConsent()` hook for downstream gates.
- The `<PostHogProvider>` wrapper (per ADR-0028) and Sentry's client `init()` call (per ADR-0014) are both gated on `consent.analytics === true` and `consent.errors === true` respectively. When consent is denied, neither library is initialized at all — no opt-out flag, no anonymous mode; the SDK simply does not load.
- Server-rendered marketing pages emit the banner as part of the marketing layout so it ships in initial HTML and does not flash on hydration.
- Per ADR-0028, analytics events fired before consent are buffered client-side and flushed on consent grant; if consent is denied, the buffer is dropped.

> **Open question:** Behavior on consent revocation — when a member toggles Analytics from on to off via the Cookie preferences panel, the SDKs stop firing immediately, but already-collected PostHog and Sentry data is **not** retroactively deleted (deletion is the ADR-0023 "Delete my account" flow). Confirm this is acceptable to counsel before launch.

> **Open question:** Banner copy ("We use cookies to…") needs counsel review prior to public launch; the current draft is engineering-authored.

> **Open question:** Localization for non-English visitors. TX market is overwhelmingly English; defer until member analytics show a non-English visitor share large enough to justify translation.

## Consequences

**Positive:**

- Defensible legal posture for TX, broader US (CCPA/CPRA), and incidental EU/CA visitors at $0 recurring cost — no CMP SaaS line item.
- Default-deny means we cannot accidentally leak analytics PII before consent; the SDKs are gated at load time, not just at event-send time, eliminating a whole class of "we forgot to check the flag" bugs.
- Visible, granular consent UI is a trust signal for a member-driven club whose Privacy and Member Agreement also lean on plain-language transparency.
- First-party implementation keeps brand control (typography, color, motion) — no third-party widget that fights the design system.

**Negative:**

- The banner ships as a client component on every marketing page, adding bundle weight to routes whose Lighthouse budget (ADR-0030, ≥90 perf) is already tight; LCP and CLS need watching.
- "Essential only" is the path of least resistance for cautious visitors, so a meaningful slice of the funnel will be missing from PostHog. ADR-0030 already acknowledges that SEO-funnel data in PostHog is partial as a consequence; we backstop with Vercel Analytics (server-side, no cookie) and Search Console for top-of-funnel shape.
- The Cookie preferences footer link adds a small surface (a re-openable panel) that the design system, copy, and accessibility audit all have to maintain.
- Banner legal copy needs counsel review before launch; engineering-authored placeholder text is not sufficient for a public posture.
- Client-side cookie code introduces a render path that the SEO-critical first paint must coexist with; care is needed to avoid a flash-of-banner or a layout shift that hurts CLS.
- Errors that happen before a visitor consents are not captured in Sentry — the error-tracking trade-off of default-deny. We accept this for marketing routes; member-app routes (`/dashboard`, `/cashier`, `/admin`) sit behind authentication and inherit consent decisions made during signup.

## Alternatives considered

- **Third-party CMP (Osano, Cookiebot, OneTrust).** Turnkey legal coverage, pre-translated copy, automatic cookie scanning. Rejected because our cookie load is small (three categories, two non-essential SDKs), the recurring SaaS cost is non-trivial relative to the value, and the embedded widget fights brand control. Re-evaluate if our cookie surface materially expands or if we operate in a higher-risk regulatory regime.
- **Silent default-deny without a banner.** Cheapest implementation: just don't load PostHog/Sentry until a settings toggle is flipped somewhere obscure. Rejected because GDPR's "informed consent" and CCPA's notice-at-collection both expect the user to be told what is happening; surfacing the choice is the point.
- **Browser-API approach (Permissions Policy headers, no UI).** Lean on `Permissions-Policy` and similar HTTP headers to disable categories. Rejected: the headers do not give the per-category granularity we want (Analytics vs Errors), they do not surface the choice to the user (so they don't satisfy "informed" consent), and they don't provide a re-visit affordance equivalent to the Cookie preferences footer link.
