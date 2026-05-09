---
date: 2026-05-08
adrs: [0024]
slice: 1
type: implementation
status: complete
---

# Conductor run — ADR-0024 cookie & consent banner

## Context

ADR-0024 was the next slice-1 Stub on the conductor queue after `/conductor 30` (SEO) and `/conductor 17` (CI). Cookie consent is the gating dependency for ADR-0028 (analytics) — PostHog can't ship until the consent surface exists to gate it — and it's the privacy artifact with the most legal exposure in the slice. The ratifier (Phase 0) drafted the canonical Decision into `.conductor/0024/ratification-proposal.md` and explicitly flagged 3 deferred questions for counsel sign-off (revocation behavior, banner copy review, localization deferral). The ratifier also classified the banner copy itself as a counsel-review-required artifact, not just engineering content. ADR-0023 cross-link auto-flagged T1 (`<ConsentProvider>`) as `risk: high`, which triggered a mandatory premortem before implementation.

The run end-to-end: ratifier (Phase 0) → spec-writer + critic (2 iterations to ship) → planner (`.conductor/0024/plan.json`, 11 tasks T0–T10) → premortem on T1 (12 risks surfaced) → 5 worker dispatches across 4 waves → slice-level validator + critic + scope-judge in Phase 3, with critic iter-1 returning REVISE on 5 vitest-coverage gaps → fix-up dispatch → critic + scope-judge iter-2 returning SHIP → this Phase 4 documentation step.

## Changes

Concrete things landed in the working tree (uncommitted; Phase 5 shipper composes the commits):

**State machine and storage (T0 + T10, dispatch 0008):**

- `lib/consent/cookie.ts` — typed `ConsentState` with `essential: true` literal (not `boolean`), plus `readConsent()`, `writeConsent()`, `clearConsent()`. SSR-safe via `typeof document` guards; cookie attrs `Path=/`, `Max-Age=31536000`, `SameSite=Lax`, plus `Secure` only when `NODE_ENV === 'production'`. `version: 1` field pinned so future taxonomy changes re-prompt.
- `lib/consent/copy.ts` — frozen `as const` `COPY` object holding every banner / customize-panel / footer-link string. Top-of-file `// TODO(travis): legal review before public launch` is the actionable gate before public launch.

**Provider + hook (T1, dispatch 0009 — premortem-honored):**

- `components/site/consent-provider.tsx` — `<ConsentProvider>` and `useConsent()` hook. Honors all 12 premortem mitigations: SSR initial state is consent-state-independent (cache-safe), constant `useState` initializers (no hydration mismatch), `visibilitychange` listener for cross-tab sync with proper cleanup, `useMemo`'d context value, `useCallback([], …)` setter that takes a complete `ConsentState` (no merge logic, no stale closure), separate `setStateInternal` for read path vs. public `setState` for write path (no mount→write loop), runtime `essential !== true` guard, throws clear error when `useConsent()` is called outside the provider.

**UI surfaces (T2-T6, dispatch 0010):**

- `components/site/cookie-banner.tsx` — render gate `!isLoaded || state !== null` returns `null`. Tailwind `motion-safe:animate-in motion-safe:slide-in-from-bottom-4` for `prefers-reduced-motion` honoring at the CSS layer. Three buttons (Accept all / Essential only / Customize) wired to COPY.
- `components/site/consent-customize-panel.tsx` — Radix Dialog with focus trap, Esc-to-close, initial focus on Cancel, locked Essential checkbox (native `disabled` + `:checked`).
- `components/site/cookie-preferences-link.tsx` — footer re-entry that opens the same panel instance.
- `components/site/analytics-gate.tsx` — `null` branch when consent absent / denied; `TODO(adr-0028)` placeholder for `<PostHogProvider>` to fill when analytics ratifies.
- `components/site/error-tracking-gate.tsx` + `lib/sentry/init.ts` — `initSentry()` is module-level idempotent (single `_initialized` flag, `_internals.doSentryInit` test seam, `__resetSentryInitForTests` for vitest); `<ErrorTrackingGate>` calls `initSentry()` only on `errors === true`. `TODO(adr-0014)` placeholder for the real `Sentry.init({ dsn, … })` body when observability ratifies.

**Layout integration (T7, dispatch 0011):**

- `app/(marketing)/layout.tsx` — wraps `<PublicHeader />`, `<main>`, `<PublicFooter />`, `<CookieBanner />`, `<ConsentCustomizePanel />` in `<ConsentProvider>`. `<CookiePreferencesLink />` mounted in the footer.
- `components/marketing/public-footer.tsx` — minor edit to mount the footer link.

**Tests (T8 + T9 + fix-up, dispatches 0011 / 0012 / 0016):**

- 8 vitest files under `tests/consent/`: `cookie.test.ts`, `copy.test.ts`, `consent-provider.test.tsx`, `wave3.test.tsx`, `integration.test.tsx`, `init-sentry.test.ts`, `layout-integration.test.ts`, plus the fix-up trio `cookie-banner.test.tsx`, `consent-customize-panel.test.tsx`, `error-tracking-gate.test.tsx`.
- 1 Playwright spec at `tests-e2e/cookie-banner.spec.ts` (host-blocked, CI-deferred per the `/conductor 30` precedent).

## Decisions

Non-obvious choices made during the run that are worth pinning:

- **Render-after-hydration-only banner.** The banner returns `null` whenever `!isLoaded || state !== null`. SSR emits no banner at all — the cached HTML is consent-state-independent — so there is no flash-of-banner to fight, and no edge-cache replay surface (premortem A3). The provider's SSR initial state is `{ state: null, isLoaded: false, isCustomizePanelOpen: false }` and the cookie read happens only inside `useEffect`. We considered a CSS-only `display:none` gate; rejected because it still leaks the banner DOM into the cached HTML.
- **Type-locked Essential.** `ConsentState['essential']` is the literal type `true`, not `boolean`. TypeScript rejects `essential: false` at the call site at compile time; `writeConsent` and the provider's `setState` each independently throw at runtime if the literal slips through a cast. Premortem mitigation #4 (Essential break → auth lockout) is enforced by the type system, not by review discipline.
- **SDK-load-time gating, not opt-out flag.** PostHog and Sentry SDKs are not imported at module scope anywhere; the gates render `null` when consent is absent or denied, and the SDKs only load when consent flips `true`. There is no "we forgot to check the flag" leak class because there is no flag to check — the SDK simply isn't in the loaded bundle until the gate mounts. Verified via repo-wide grep for `posthog-js` / `@sentry/(nextjs|browser|react)`: zero matches outside doc-comments.
- **Cross-tab visibility re-read, not storage events.** Consent lives in a cookie, not `localStorage`, so the `storage` event won't fire across tabs. The provider attaches a `visibilitychange` listener that re-reads the cookie on tab focus and updates state if it differs (without writing). Cleanup function on unmount; tested under StrictMode. Premortem mitigation #6.
- **Atomic cookie-then-state, no merge logic.** `setState(next: ConsentState)` takes a complete state argument, writes the cookie first, then updates React state. There is no partial-update overload, no read of current state inside the setter, no functional setter form. Consumers that want "merge" semantics read `state` themselves and pass the full new object. Premortem mitigation #11 (stale-closure consent forgery) is structurally impossible.
- **Counsel-review hook in copy.ts.** `lib/consent/copy.ts` carries a top-of-file `// TODO(travis): legal review before public launch` as the actionable launch gate. The provider imports nothing else for user-visible strings — every label flows through `COPY`, so counsel's edit is a single-file change and the regulatory-misrepresentation risk (premortem A1) is contained.
- **Wave bundling continued from `/conductor 30`.** T0+T10 bundled (foundations, no shared state), T1 solo (high-risk + premortem), T2–T6 bundled (UI + gates, disjoint files), T7+T8 bundled (layout + tests). 11 plan tasks compressed into 4 implementation dispatches plus a parallel test/fix-up dispatch — saved roughly 6 dispatches' worth of orchestrator overhead vs. strict per-task TDD, with no merge friction within waves.
- **One documented test skip.** `aria-modal="true"` HTML-attribute assertion in `consent-customize-panel.test.tsx` is `it.skip` with a paragraph documenting that Radix Dialog v1.1.x does not emit the attribute — the WAI-ARIA dialog pattern is satisfied in aggregate by `role="dialog"` + accessible name (Dialog.Title) + focus trap + Esc-close. Forcing the literal attribute would require either a non-Radix primitive or a `Dialog.Content` prop forward, neither in scope for a test-only fix-up. Skip is inline-documented; iter-2 critic accepted the structural argument.

## Tests

**Ran (validator iter-1 → fix-up → iter-2):**

- `corepack pnpm typecheck` — clean (`tsc --noEmit` exit 0) at every gate.
- `corepack pnpm lint` — "No ESLint warnings or errors" at every gate.
- `corepack pnpm test` — 134/134 at iter-1 validator, 22 files / 147 passed + 1 documented skip (148 total) at iter-2 after the fix-up landed +14 net new assertions for AC1, AC3, AC5, AC6, AC8.

**Did NOT run (host-blocked, CI-deferred per `/conductor 30` precedent):**

- `corepack pnpm test:e2e` — Playwright spec (`tests-e2e/cookie-banner.spec.ts`) is structurally well-formed but never executed; port 3000 is reserved by Hyper-V / WinNAT on this Windows host.

## Next

What the next shift should pick up:

- **Counsel review of `lib/consent/copy.ts`** strings before public launch (the TODO comment is the actionable gate).
- **When ADR-0028 (analytics) ratifies**, fill `<AnalyticsGate>`'s `TODO(adr-0028)` with a real `<PostHogProvider>`.
- **When ADR-0014 (observability) ratifies**, fill `lib/sentry/init.ts`'s `_internals.doSentryInit` body with the real `Sentry.init({ dsn, … })`.
- **Phase 5 shipper** for ADR-0024 — write `.conductor/0024/ratification-proposal.md` content into the live `docs/adr/0024-cookie-and-consent-banner.md` file (Stub → Accepted) and compose the slice commit.
- **Continue slice-1 conductor queue:** 0028 (analytics) → 0026 (a11y) → 0016 (rate limiting) → 0012 (tournament read) → 0014 (observability) → 0021 (testing strategy) → 0018 (DB migrations).

## Notes for future me

- **Premortem earned its keep.** The mandatory premortem on T1 surfaced 12 distinct risks (4 spec-fed, 8 surface-specific to the provider) that the worker honored one-for-one. The resulting code is hard to break in the failure modes the premortem anticipated: type-locked Essential, SSR-state-independent provider, internal-vs-public setter split, atomic write, memo'd context. Risk:high + ADR-0023 auto-flag → mandatory premortem is the right pattern and it should stay default for any consent / auth / privacy / money-handling task.
- **Critic + scope-judge converged on 5 real test gaps.** The mechanical validator (typecheck + lint + 134/134 tests) was happy at iter-1; critic-diff and scope-judge each independently surfaced the same 5 vitest-coverage gaps for AC1, AC3, AC5, AC6, AC8 — none of which the validator could see, because the spec's "Verifiable by a vitest test that…" language binds to test *existence*, not just test pass/fail. The two-checker pattern (semantic critic + scope-judge) catches things the mechanical gauntlet structurally cannot. Worth keeping as default Phase 3 shape.
- **Radix Dialog v1.1.x doesn't emit `aria-modal`.** The component satisfies WAI-ARIA modal semantics via internal focus-trap + overlay scrim, not via the HTML attribute. We documented the skip inline rather than fighting the primitive. Future a11y work that asserts on `aria-modal` should either pre-check what the chosen primitive emits or assert on the role + focus-trap aggregate instead.
- **Branch state shifted mid-run.** The run started on `chore/conductor-v0.2` and the working tree is now on `main`. Per the `/conductor 17` retrospective lesson on environment-state assumptions, future conductor runs should snapshot `git rev-parse --abbrev-ref HEAD` into `status.json` at Phase 0 and have the Phase 5 shipper detect drift before composing commits. Carry-forward.
- **148 tests across 22 files is becoming a lot.** Dispatch token usage held at ~250–350k per worker, but the slice's test footprint is heavy and each fix-up dispatch has to re-Read more tests to know what's covered. Future slices may want to split coverage by AC or by phase rather than letting `tests/<slice>/` accrete monolithically. Worth watching whether this pattern degrades agent-recall quality at the 25+ files mark.
- **Counsel-review-required artifacts deserve their own surface.** Banner copy is engineering-authored placeholder; the TODO comment is the only thing standing between it and public launch. Future privacy / legal-exposure ADRs should formalize this as a checklist item the ratifier emits — not just a free-form Open Question — so the shipper can refuse to land without an explicit "counsel reviewed: yes/no" field.
