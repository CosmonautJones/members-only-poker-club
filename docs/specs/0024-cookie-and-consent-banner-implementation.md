---
adr: 0024
slice: 1
risk: medium
# Acceptance commands MUST be runnable shell commands that exit 0 only when
# every numbered acceptance criterion is satisfied. The validator runs each
# one in order during the slice/integration pass; scope-judge refuses to
# return ship_ready=true if any was not run-and-passed. Bare `pnpm test`
# does NOT count — list the specific e2e/integration commands that bind
# the spec's acceptance language to runnable behavior.
acceptance_commands:
  - 'pnpm typecheck'
  - 'pnpm lint'
  - 'pnpm test'
  # Runtime-deferred per ADR-0017 (CI/CD) ratification — Windows host
  # cannot bind port 3000 (Hyper-V / WinNAT reserves 2983-3082 range).
  # Listed for completeness; the slice scope-judge accepts vitest +
  # source-grep structural substitutes (per the lesson from /conductor 30).
  # AC13 is explicitly CI-only (Lighthouse + Vercel preview); see ACs.
  # - 'pnpm test:e2e cookie-banner'
  # - 'pnpm lighthouse'
---

# Spec: Cookie & consent banner — Slice 1 implementation

- **ADR:** [0024](../adr/0024-cookie-and-consent-banner.md)
- **Status:** Draft (v2 — incorporates critic-iter1 resolutions)
- **Date:** 2026-05-05

## Goal

Ship the first-party, default-deny cookie consent banner on every marketing route — including the consent state machine (cookie I/O + provider hook with `isLoaded` hydration gate), the banner UI, the Radix-Dialog customize panel, the Cookie preferences re-entry link bound to the same provider tree, and the structural gates that PostHog (ADR-0028) and Sentry (ADR-0014) will plug into when they ratify — so the public site writes only strictly-necessary cookies until the visitor grants explicit, granular consent and renders zero flash-of-banner on hydration.

## Acceptance criteria

Numbered, testable. Each is verifiable by `pnpm test` (vitest), source-grep / structural assertions, or — explicitly CI-only — Lighthouse on a Vercel preview URL. Per the /conductor 30 lesson, AC13 has no local vitest substitute; verification is the Lighthouse CI run on the Vercel preview when ADR-0017's CI workflow ratifies.

1. `lib/consent/cookie.ts` exports three pure-ish functions against the typed shape `ConsentState = { essential: true; analytics: boolean; errors: boolean; version: 1 }`, with the precise contract pinned per concern 2:
   - **`readConsent(): ConsentState | null`** — returns the parsed state, or `null` if (a) the cookie is absent, (b) the JSON is malformed, (c) the parsed `version` field does not match the current `1` literal (re-prompt). Must be SSR-safe: returns `null` when `typeof document === 'undefined'`.
   - **`writeConsent(state: ConsentState): void`** — JSON-serializes and writes the `mopc-consent` cookie with `Path=/`, `Max-Age=31536000` (1 year), `SameSite=Lax`, and `Secure` when `process.env.NODE_ENV === 'production'`. `HttpOnly` is **NOT** set (the cookie must be readable from client JS). On server (no `document`), the function is a graceful no-op.
   - **`clearConsent(): void`** — writes the cookie with `Max-Age=0` and the same `Path`, `SameSite`, and `Secure` attributes used by `writeConsent`, so the browser actually expires the entry.
   - The module is vanilla TypeScript (no `'use client'` directive), so it is importable from server actions if ever needed; effects on `document.cookie` are guarded by the `typeof document` check.

   Verifiable by `tests/consent/cookie.test.ts` covering: round-trip (`writeConsent` → `readConsent` returns equal state); malformed-JSON branch (preset cookie to `mopc-consent=not-json{`, assert `readConsent()` returns `null`); version-mismatch branch (preset cookie with `version: 99`, assert `null`); SSR-no-document branch (delete the global `document`, assert `readConsent()` returns `null` and `writeConsent`/`clearConsent` do not throw); attribute-string assertions (mock `document.cookie` setter, assert serialized string contains `Path=/`, `Max-Age=31536000`, `SameSite=Lax`, `Secure` only when `NODE_ENV === 'production'`); `clearConsent` writes `Max-Age=0` with the same attribute set.

2. `useConsent()` hook (in `components/site/consent-provider.tsx`) reads from the cookie on mount and exposes `{ state: ConsentState | null, setState: (next: ConsentState) => void, isLoaded: boolean, openCustomizePanel: () => void, closeCustomizePanel: () => void, isCustomizePanelOpen: boolean }`. `isLoaded` is `false` during SSR and during the initial client render before hydration; it flips to `true` after the cookie is read on client mount via `useEffect`. Verifiable by a vitest test that renders a consumer component inside `<ConsentProvider>` with a pre-seeded `mopc-consent` cookie and asserts: (a) the consumer sees `isLoaded === false` on initial render, (b) after `act(() => { ... })` flushes effects, the consumer sees `isLoaded === true` and `state` matches the cookie's payload.

3. `<CookieBanner />` (in `components/site/cookie-banner.tsx`) implements the **render-after-hydration-only** gate per concern 1: it returns `null` when `!isLoaded` OR when `state !== null`; it renders the banner UI **only** when `isLoaded && state === null`. This pattern produces zero flash-of-banner: SSR renders nothing for the banner, the client renders nothing pre-hydration, and post-hydration the banner appears only when the cookie is absent. Verifiable by a vitest test that:
   - Renders `<CookieBanner />` (inside a `<ConsentProvider>`) with `isLoaded: false` (default initial state) and asserts no banner element appears (`queryByRole('region', { name: /cookie/i })` returns `null`).
   - Re-renders with `isLoaded: true, state: null` (cookie absent on hydrated client) and asserts the banner appears with three accessible buttons.
   - Re-renders with `isLoaded: true, state: { essential: true, analytics: true, errors: true, version: 1 }` and asserts no banner appears.
   - SSR snapshot test: `renderToString(<ConsentProvider><CookieBanner /></ConsentProvider>)` produces empty markup for the banner (no banner container in the initial HTML).

4. The banner renders an `aria-label="Cookie consent"` `region` containing three accessible buttons whose visible labels match `COPY.banner` from `lib/consent/copy.ts`: `Accept all`, `Essential only`, `Customize`. Clicking `Accept all` calls `setState({ essential: true, analytics: true, errors: true, version: 1 })`; clicking `Essential only` calls `setState({ essential: true, analytics: false, errors: false, version: 1 })`; clicking `Customize` calls `openCustomizePanel()`. Verifiable by vitest tests using `userEvent.click` plus assertions on the cookie state after the click via `readConsent()` (for the first two) and on `isCustomizePanelOpen === true` for the third.

5. `<CookieBanner />` respects `prefers-reduced-motion`: when `window.matchMedia('(prefers-reduced-motion: reduce)').matches` is `true`, the rendered banner has no animation utility classes (no `animate-in`, no `transition-*`). Verifiable by a vitest test that mocks `matchMedia` to return both branches and asserts the rendered className list.

6. `<ConsentCustomizePanel />` (in `components/site/consent-customize-panel.tsx`) is a **Radix Dialog modal** (`@radix-ui/react-dialog`) — not inline, not a drawer (concern 8 — Open Q 2 deleted; modal is the committed choice). It mandates the following a11y assertions per concern 3:
   - Renders a `<Dialog.Title>` with the accessible name `COPY.customize.title` (`"Cookie preferences"`).
   - **Focus trap**: focus stays inside the dialog on Tab cycle. Verified by `userEvent.tab()` repeated past the last focusable, asserting focus wraps to the first focusable element inside the dialog.
   - **Esc closes**: `userEvent.keyboard('{Escape}')` triggers `onOpenChange(false)`. Verified via a spy on the provider's `closeCustomizePanel` (or a direct assertion that `isCustomizePanelOpen` flips to `false`).
   - **Initial focus** lands on the first interactive element — committed choice: the `Cancel` button (so a keyboard user can dismiss without committing changes). Verified via `expect(document.activeElement).toBe(getByRole('button', { name: /cancel/i }))` immediately after open.
   - **`aria-modal="true"`** is present on the dialog content (Radix default). Verified by `expect(getByRole('dialog')).toHaveAttribute('aria-modal', 'true')`.

   The panel renders three labeled toggles whose copy matches `COPY.customize.categories.{essential,analytics,errors}`: `Essential` is `aria-disabled="true"`, hardcoded checked, with helper text from `COPY.customize.categories.essential.description`; `Analytics` and `Errors` are interactive. `Cancel` (label from `COPY.customize.cancel`) closes without writing; `Save` (label from `COPY.customize.save`) writes the panel's local toggle state through `setState` and closes. Verifiable by vitest tests covering: locked Essential (cannot be toggled off via click or keyboard); toggle persistence on Save (assert `readConsent()` reflects the toggled values); no-op on Cancel (assert `readConsent()` is unchanged).

7. `<AnalyticsGate />` (in `components/site/analytics-gate.tsx`) renders `{children}` only when `isLoaded && state?.analytics === true`; otherwise it renders `null`. Per concern 6, the gate plug-in contract is pinned: the component body includes a `// TODO(adr-0028): wrap children in <PostHogProvider> when ADR-0028 ratifies. PostHogProvider receives posthog_key + host from env at the call site, not via props through this gate.` comment. Verifiable by a vitest test covering all three branches (`isLoaded: false`, `isLoaded: true / analytics: false`, `isLoaded: true / analytics: true`) and a source-grep assertion that the TODO comment is present.

8. `<ErrorTrackingGate />` (in `components/site/error-tracking-gate.tsx`) calls `initSentry()` (from `lib/sentry/init.ts`) inside a `useEffect` only when `isLoaded && state?.errors === true`, and never when `!isLoaded` or when `state?.errors !== true`. The component renders `{children}` regardless (the gate is for SDK initialization, not children visibility — per concern 6's pinned contract). Verifiable by a vitest test that mocks `initSentry` (e.g., `vi.spyOn`) and asserts call count across the three branches: 0 for `!isLoaded`, 0 for `errors: false`, 1 for `errors: true`.

9. `lib/sentry/init.ts` exports `initSentry(): void` with a module-level idempotency flag per concern 6. Calling `initSentry()` twice in the same module lifetime invokes the underlying init logic exactly once. The function body includes a `// TODO(adr-0014): real Sentry init when ADR-0014 ratifies.` comment as the plug-in marker. Verifiable by a vitest test (`tests/consent/sentry-init.test.ts`) that uses `vi.spyOn` on a stubbed inner init helper, calls `initSentry()` twice, and asserts the inner helper ran exactly once. (For the stub, the inner work can be a no-op `console.debug` call or a non-exported helper that the test spies on via module-level export-for-testing pattern; planner picks the cleanest approach.)

10. `components/marketing/cookie-preferences-link.tsx` is a `'use client'` component that calls `useConsent()` to obtain `openCustomizePanel`. It renders a button (or anchor styled as a button) with the visible label `COPY.footer_link` (`"Cookie preferences"`); on click, it calls `openCustomizePanel()`. Per concern 5, the customize panel's open/close state lives in the `<ConsentProvider>` (not in the panel or banner), so the footer link and the banner's `Customize` button both control the **same** modal instance. Verifiable by `tests/consent/marketing-layout.test.ts`: render the marketing layout (which includes the footer + the panel + the provider) with a pre-seeded cookie (so the banner does not render), click the footer link, and assert the customize panel is now visible (`getByRole('dialog')` returns the panel).

11. `app/(marketing)/layout.tsx` wraps the **entire layout body** in `<ConsentProvider>` per concern 4. The provider must be an ancestor of every component that calls `useConsent()` — the banner AND the footer's `<CookiePreferencesLink />`. The committed JSX shape is:

    ```tsx
    // app/(marketing)/layout.tsx
    export default function MarketingLayout({ children }) {
      return (
        <ConsentProvider>
          <PublicHeader />
          <main>{children}</main>
          <PublicFooter />
          <CookieBanner />
        </ConsentProvider>
      );
    }
    ```

    `<AnalyticsGate />` and `<ErrorTrackingGate />` mount inside the provider tree (placement decided by planner — likely just before `</ConsentProvider>`). Verifiable by a structural vitest test (`tests/consent/marketing-layout.test.ts`) that imports the layout module and asserts: `<ConsentProvider>` is the outermost wrapper of the body; `<PublicHeader />`, `<main>`, `<PublicFooter />`, and `<CookieBanner />` are descendants of the provider. A complementary source-grep assertion confirms the JSX structure in the file matches the shape (no children-only wrapping that excludes header/footer/banner).

12. `lib/consent/copy.ts` exists per concern 9 and exports a single `COPY` object with the exact named-key shape pinned in the concerns file: `COPY.banner.{title, body, accept_all, essential_only, customize}`, `COPY.customize.{title, description, categories.{essential, analytics, errors}.{name, description}, save, cancel}`, `COPY.footer_link`. The module includes a top-of-file `// TODO(travis): legal review before public launch` comment as the actionable hook for legal sign-off (Open question 1, carried from ADR-0024). Verifiable by `tests/consent/copy.test.ts` that imports `COPY` and asserts every key in the pinned shape resolves to a non-empty string; tests fail loudly if any key is missing or empty.

13. **CI-only deferral (concern 7).** Lighthouse performance score on `/` stays ≥90 with `<CookieBanner />`, `<ConsentProvider>`, the customize panel, and the two gates present. **AC13 has no local vitest substitute; verification is the Lighthouse CI run on the Vercel preview URL when ADR-0017's CI workflow ratifies.** This matches the structural-deferral lesson from /conductor 30: bundle weight and CLS regressions are surfaced by Lighthouse on a Linux runner against a real preview build. The slice scope-judge accepts the explicit CI-only path; no source-grep or vitest equivalent is attempted (a fake structural test would not catch the actual regression).

## Task decomposition hints

Rough cuts; the planner refines into `plan.json`. Sized at 2-8 hours each. **11 tasks total** (T0–T10; T10 is `lib/consent/copy.ts` per concern 9).

- **T0 — Consent cookie I/O (`lib/consent/cookie.ts`).** Pure-ish vanilla-TS module. Pin the contract per concern 2: `readConsent(): ConsentState | null`, `writeConsent(state: ConsentState): void`, `clearConsent(): void`. Cookie name `mopc-consent`, JSON-encoded value, `Path=/`, `Max-Age=31536000`, `SameSite=Lax`, `Secure` only when `process.env.NODE_ENV === 'production'`, `HttpOnly` NOT set. SSR-safe: every function checks `typeof document === 'undefined'` and no-ops gracefully on the server (`readConsent` returns `null`; `writeConsent`/`clearConsent` return without writing). The `version: 1` literal type means a future taxonomy change bumps to `version: 2` and `readConsent` returns `null` for stale cookies, triggering the banner to reappear. Vitest covers: round-trip; malformed JSON; version mismatch; SSR-no-document branches; serialized-attribute assertions; `clearConsent` `Max-Age=0` with matching attributes. (~3h)

- **T1 — `useConsent()` hook + `<ConsentProvider>` (`components/site/consent-provider.tsx`).** Client component (`'use client'`). Owns three pieces of state: `state: ConsentState | null` (read from cookie via `readConsent()` in `useEffect`), `isLoaded: boolean` (false initially, true after the mount effect runs — concern 1's render gate hinges on this), `isCustomizePanelOpen: boolean` (controls the modal that both the banner's `Customize` button and the footer link open — concern 5). Exposes via context: `{ state, setState, isLoaded, openCustomizePanel, closeCustomizePanel, isCustomizePanelOpen }`. `setState` calls `writeConsent` and updates context. Vitest covers: `isLoaded: false` on initial render, flips to `true` after effect; setter persistence; panel open/close transitions. (~4h)

- **T2 — `<CookieBanner />` component (`components/site/cookie-banner.tsx`).** Client component. Per concern 1, returns `null` when `!isLoaded` OR `state !== null`; renders the banner UI only when `isLoaded && state === null`. Imports user-visible strings from `lib/consent/copy.ts` (concern 9) — no hardcoded copy in the component. Renders `aria-label="Cookie consent"` `region` with three buttons whose labels are `COPY.banner.accept_all`, `COPY.banner.essential_only`, `COPY.banner.customize`. Brand styling: ink-850 background, gold-400 border, marketing type scale (read tokens from `app/globals.css`). `prefers-reduced-motion` check via `useEffect` + `matchMedia` toggles a `motion-reduce` boolean that controls whether animation classes are added. The `Customize` button calls `openCustomizePanel()` (state lives in the provider per T1). Vitest covers: render gate (4 cases: `!isLoaded`, `isLoaded && state===null`, `isLoaded && state!==null`, SSR snapshot empty); button-click → `setState` payload assertions; `Customize` → `isCustomizePanelOpen===true`; `prefers-reduced-motion` className branches. (~5h)

- **T3 — `<ConsentCustomizePanel />` component (`components/site/consent-customize-panel.tsx`).** Client component, **Radix Dialog modal** (concern 8 — committed; no inline alternative). Use `@radix-ui/react-dialog` (already a dependency via `shadcn/ui`). Per concern 3, mandates: `<Dialog.Title>` with `COPY.customize.title` accessible name; focus trap (Radix default — assert via `userEvent.tab()` cycle stays inside); Esc closes (Radix default — assert via `userEvent.keyboard('{Escape}')` and `onOpenChange(false)` fires); initial focus on the `Cancel` button (committed choice — assert via `document.activeElement`); `aria-modal="true"` (Radix default — assert via attribute query). Three labeled toggles using `COPY.customize.categories.*`: Essential is `aria-disabled="true"` and locked; Analytics and Errors are interactive. Cancel/Save labels from `COPY.customize.{cancel,save}`. `Save` writes the panel's local state through `setState` and calls `closeCustomizePanel()`. `Cancel` calls `closeCustomizePanel()` without writing. Open state is bound to `isCustomizePanelOpen` from `useConsent()`; Radix `<Dialog open={...} onOpenChange={...}>` wires `closeCustomizePanel` to `onOpenChange(false)`. Vitest covers: all five a11y assertions; locked Essential; Save persists; Cancel no-ops. (~6h)

- **T4 — Footer `Cookie preferences` link (`components/marketing/cookie-preferences-link.tsx` create + `components/marketing/public-footer.tsx` modify).** Per concern 5, `<CookiePreferencesLink />` is a `'use client'` component that calls `useConsent()` to obtain `openCustomizePanel`. The modal state lives in the provider, so this link and the banner's `Customize` button control the **same** instance — there is no second dialog. The link's visible label is `COPY.footer_link`. The footer (`public-footer.tsx`) is currently a server component; T4 keeps it server-rendered by importing the small `<CookiePreferencesLink />` `'use client'` island into the existing footer JSX (option (a) from the iter1 spec — preserves SSR static content; planner may revise if option (b) full client conversion is preferred, but the default is (a)). Vitest test renders the marketing layout with a pre-seeded cookie (banner suppressed), clicks the link, asserts `getByRole('dialog')` returns the panel — this binds the provider-tree contract from concern 5. (~3h)

- **T5 — `<AnalyticsGate />` (`components/site/analytics-gate.tsx`).** Per concern 6, the exact contract:

    ```tsx
    // components/site/analytics-gate.tsx
    'use client';
    export function AnalyticsGate({ children }: { children: React.ReactNode }) {
      const { state, isLoaded } = useConsent();
      if (!isLoaded || state?.analytics !== true) return null;
      // TODO(adr-0028): wrap children in PostHogProvider when ADR-0028 ratifies.
      // PostHogProvider receives posthog_key + host from env at the call site,
      // not via props through this gate.
      return <>{children}</>;
    }
    ```

   The gate logic is real and tested; the `PostHogProvider` wrap is a TODO comment pending ADR-0028. ADR-0028's slice plugs in `<PostHogProvider>` without retrofitting the gate's API (the gate exposes consent state via `useConsent()` rather than its own private API). Vitest covers all three branches and a source-grep that confirms the TODO comment is present. (~2h)

- **T6 — `<ErrorTrackingGate />` + `lib/sentry/init.ts` (`components/site/error-tracking-gate.tsx`, `lib/sentry/init.ts`).** Per concern 6, the exact contract:

    ```tsx
    // components/site/error-tracking-gate.tsx
    'use client';
    import { initSentry } from '@/lib/sentry/init';
    import { useEffect } from 'react';
    import { useConsent } from '@/components/site/consent-provider';

    export function ErrorTrackingGate({ children }: { children: React.ReactNode }) {
      const { state, isLoaded } = useConsent();
      useEffect(() => {
        if (isLoaded && state?.errors === true) initSentry();
      }, [isLoaded, state]);
      return <>{children}</>;
    }
    ```

    And:

    ```typescript
    // lib/sentry/init.ts
    let initialized = false;
    export function initSentry(): void {
      if (initialized) return;
      initialized = true;
      // TODO(adr-0014): real Sentry init when ADR-0014 ratifies.
    }
    ```

   The module-level idempotency flag is the load-bearing detail (concern 6, AC9): two calls do not cause two inits. Vitest covers: gate calls `initSentry` exactly once across the three branches (0/0/1); a separate `tests/consent/sentry-init.test.ts` resets the module between tests (`vi.resetModules()`) and asserts that within a single module lifetime two `initSentry()` calls invoke the inner work exactly once. (~3h)

- **T7 — Marketing layout wiring (`app/(marketing)/layout.tsx` modify).** Per concern 4, the provider must wrap the entire layout body — header, main, footer, banner — not just children. Commit the exact JSX shape from the AC11 example. The provider is a `'use client'` boundary; the layout file itself can stay a server component because the `'use client'` directive lives on `consent-provider.tsx`, not the layout. `<AnalyticsGate />` and `<ErrorTrackingGate />` mount inside the provider tree (planner picks placement; likely just before `</ConsentProvider>` or wrapping a no-op slot). Source-grep + structural vitest test confirms the wiring. (~2h)

- **T8 — Vitest coverage (consolidated, written alongside T0-T7).** Tests under `tests/consent/`: `cookie.test.ts` (T0 / AC1), `consent-provider.test.ts` (T1 / AC2), `cookie-banner.test.ts` (T2 / AC3, AC4, AC5), `consent-customize-panel.test.ts` (T3 / AC6), `cookie-preferences-link.test.ts` (T4 / AC10), `analytics-gate.test.ts` (T5 / AC7), `error-tracking-gate.test.ts` (T6 / AC8), `sentry-init.test.ts` (T6 / AC9), `marketing-layout.test.ts` (T7 / AC10 + AC11), `copy.test.ts` (T10 / AC12). Each file targets the AC for its component. The test-writer dispatch can run in parallel with the implementation waves (per the /conductor 30 wave-bundling pattern). (~6h)

- **T9 — Playwright e2e (`tests-e2e/cookie-banner.spec.ts`, runtime deferred).** Spec covers: first visit shows banner; `Essential only` dismisses + writes the cookie; reload doesn't show banner; footer `Cookie preferences` re-opens the panel; `Customize` → toggle `Analytics` on → `Save` persists `analytics: true`. The spec ships structurally but is not run on this host (port 3000 reservation per the /conductor 30 lesson). It runs in CI once ADR-0017 ratifies, against a Vercel preview deploy. Until then, the vitest coverage in T8 is the binding gate. (~3h)

- **T10 — Banner copy module (`lib/consent/copy.ts`).** Per concern 9, ship the copy module from day 1. Exports a single `COPY` object with the exact shape:

    ```typescript
    // lib/consent/copy.ts
    // TODO(travis): legal review before public launch
    export const COPY = {
      banner: {
        title: 'Cookies',
        body: 'We use cookies to keep you signed in and to learn how the site is used. You decide what we collect.',
        accept_all: 'Accept all',
        essential_only: 'Essential only',
        customize: 'Customize',
      },
      customize: {
        title: 'Cookie preferences',
        description: 'Choose which cookies we set when you use the site.',
        categories: {
          essential: { name: 'Essential', description: 'Required for sign-in and security. Always on.' },
          analytics: { name: 'Analytics', description: 'Helps us understand how the site is used. PostHog.' },
          errors: { name: 'Error tracking', description: 'Reports JavaScript errors so we can fix bugs. Sentry.' },
        },
        save: 'Save preferences',
        cancel: 'Cancel',
      },
      footer_link: 'Cookie preferences',
    } as const;
    ```

   The TODO comment is the actionable hook for legal sign-off (Open Q 1, carried from ADR-0024). All component code (T2, T3, T4) imports from this module — no hardcoded user-visible strings outside `lib/consent/copy.ts`. Vitest (`tests/consent/copy.test.ts`) imports `COPY` and asserts every key in the pinned shape resolves to a non-empty string. (~1h)

Tasks **T5** and **T6** follow the **structural-placeholder-pending-ADR** pattern (per the /conductor 17 lesson): the gate component is real and tested; the wrapped third-party SDK is a `TODO` comment with the ratifying ADR cited. ADR-0014 and ADR-0028 each plug into their own gate when they ratify. Task **T9** follows the **e2e-CI-deferred** pattern (per the /conductor 30 lesson): the spec ships, the runtime gate moves to CI. AC13 (Lighthouse) is **explicitly CI-only** (concern 7) — no local substitute attempted.

## Touched-files inventory

Best estimate; workers may exceed if needed.

- **Create**
  - `lib/consent/cookie.ts` — typed cookie I/O with SSR-safe guards (T0)
  - `lib/consent/copy.ts` — single-source-of-truth copy module with `COPY` named export (T10, concern 9)
  - `lib/sentry/init.ts` — `initSentry()` idempotent stub with module-level flag + ADR-0014 TODO (T6)
  - `components/site/consent-provider.tsx` — context + `useConsent()` hook + panel open/close state + `isLoaded` hydration gate (T1)
  - `components/site/cookie-banner.tsx` — banner UI with render-after-hydration-only gate (T2)
  - `components/site/consent-customize-panel.tsx` — Radix Dialog modal + per-category toggles (T3)
  - `components/site/analytics-gate.tsx` — PostHog gate placeholder per pinned contract (T5)
  - `components/site/error-tracking-gate.tsx` — Sentry gate per pinned contract (T6)
  - `components/marketing/cookie-preferences-link.tsx` — `'use client'` footer-link island bound to provider tree (T4)
  - `tests/consent/cookie.test.ts` (T8)
  - `tests/consent/consent-provider.test.ts` (T8)
  - `tests/consent/cookie-banner.test.ts` (T8 — includes SSR snapshot empty assertion)
  - `tests/consent/consent-customize-panel.test.ts` (T8 — includes 5 a11y assertions)
  - `tests/consent/analytics-gate.test.ts` (T8)
  - `tests/consent/error-tracking-gate.test.ts` (T8)
  - `tests/consent/sentry-init.test.ts` (T8 — idempotency assertion)
  - `tests/consent/cookie-preferences-link.test.ts` (T8)
  - `tests/consent/marketing-layout.test.ts` (T8 — provider-wraps-everything structural assertion)
  - `tests/consent/copy.test.ts` (T8 — every named export non-empty)
  - `tests-e2e/cookie-banner.spec.ts` — runtime-deferred (T9)
- **Modify**
  - `app/(marketing)/layout.tsx` — wrap entire body in `<ConsentProvider>` (header + main + footer + banner inside the provider; concern 4) (T7)
  - `components/marketing/public-footer.tsx` — embed `<CookiePreferencesLink />` island (T4)

## Risk flags

Linked ADRs and why each is risky in this slice. Auto-flag set is {0003, 0004, 0005, 0006, 0009, 0023}; **ADR-0023 (privacy/GDPR)** is in the set and is linked here.

- **0023 (privacy / GDPR / CCPA) — Phase 1 premortem (mandatory — linked ADR-0023 in auto-flag set).** This slice ships the user-facing surface that legal posture depends on. The Premortem inputs section below enumerates the four failure modes the orchestrator should pre-feed when dispatching premortem (concern 10). The ADR-0024 ratification proposal explicitly carries forward "Banner copy needs counsel review" and "Consent revocation does not retroactively delete data" as Open questions; both feed into the premortem. ADR-0023 itself is Stub at the time of this spec — its eventual ratification will own the deletion / export / DSR flow that complements this consent surface.
- **0028 (analytics / PostHog) — Stub.** The `<AnalyticsGate />` is a structural placeholder pending ADR-0028's ratification (the gate is real; the wrapped provider is a TODO comment per concern 6's pinned contract). Risk: if 0028 ratifies with a different gating contract (e.g., it expects a `ConsentContext` shape we don't expose), the plug-in site has to be retrofitted. Mitigation: the gate exposes consent state via `useConsent()` rather than its own private API; the TODO comment also pins the call-site convention (`PostHogProvider receives posthog_key + host from env at the call site, not via props through this gate.`).
- **0014 (observability / Sentry) — Stub.** Same pattern as 0028. The gate's call-site contract — idempotent `initSentry()`, called only when `isLoaded && state?.errors === true` — is the binding interface. The module-level idempotency flag in `lib/sentry/init.ts` is load-bearing (AC9, concern 6): without it, repeated mounts would double-init the SDK once ADR-0014 ratifies.
- **0030 (SEO) — Accepted, on main.** ADR-0030's Lighthouse perf budget (≥90 on `/`, `/games`, `/contact`, `/faq`) is the binding constraint on this slice's bundle weight. This spec adds the consent surface inside `app/(marketing)/layout.tsx` which already exists on this branch. Risk: the consent surface adds client-component JS to every marketing page. Mitigation: code-split the customize panel (Radix dialog is the heaviest piece; mount only when `isCustomizePanelOpen === true`); keep `<CookieBanner />` minimal (no dialog deps inside it); the gates render `null` pre-consent and have near-zero footprint. The Lighthouse runtime check (AC13) is **CI-only** per concern 7.
- **0017 (CI/CD) — Stub.** This spec's Playwright e2e and Lighthouse runtime gates are deferred to ADR-0017's CI venue (per the /conductor 30 lesson; the Windows host can't bind port 3000). Risk: if 0017 takes longer than expected, this slice ships with vitest-only verification and the e2e + Lighthouse gates ride on top of 0017's work. Mitigation: the vitest suite is comprehensive enough that the structural-substitute path is acceptable per the existing scope-judge precedent. AC13 specifically has no local substitute (concern 7).
- **UX regression risk (CLS / flash-of-banner).** The render-after-hydration-only gate (concern 1, AC3) is the load-bearing fix: SSR renders nothing for the banner, the client renders nothing pre-hydration, post-hydration renders the banner only when the cookie is absent. Vitest's SSR snapshot test catches the regression locally; the Lighthouse CLS metric catches any subtle flash in CI.
- **Brand fidelity.** The banner is the most visible client surface added in this slice; it has to read brand tokens (`--ink-850`, `--gold-400`, marketing type scale) and not introduce new colors or fonts. Mitigation: T2 explicitly references existing brand tokens; user-visible copy lives only in `lib/consent/copy.ts` (T10, concern 9), so a brand-string-drift bug like the one /conductor 30 fixed cannot recur here — there is exactly one place to update copy and it is reviewable by the diff critic.

## Premortem inputs

Per concern 10, the planner pre-loads these four failure modes when dispatching the Phase 1 premortem (mandatory because ADR-0023 is in the auto-flag set):

1. **Banner copy misrepresents data collection.** Counsel review gate; treat banner copy as a legal artifact. The TODO in `lib/consent/copy.ts` (`// TODO(travis): legal review before public launch`) is the actionable hook. Failure mode: shipping engineering-authored placeholder copy to public launch and discovering it overstates or understates what cookies do, exposing the club to a regulatory complaint or a trust-eroding correction. Mitigation: counsel sign-off blocks public-launch criteria, not Slice 1 ship-to-staging.
2. **SDK leak before consent.** SDK-load-time gating is the whole premise of default-deny. Failure mode: a stray top-level `import posthog from 'posthog-js'` or `import * as Sentry from '@sentry/nextjs'` in some module that is reachable from a marketing route would load the SDK before the gate ever runs. Mitigation: vitest assertion that no PostHog/Sentry imports exist at module scope outside the gates (a source-grep test in `tests/consent/sdk-leak-guard.test.ts` — planner adds if not already in T8). Defense-in-depth: the gates render `null` for children pre-consent so even if a misconfigured import sneaks in, the wrapped provider never mounts.
3. **Cross-user replay via Vercel edge cache.** The consent cookie is per-user; if the marketing routes are edge-cached without including the consent cookie value in the cache key (or marking the response private), one user's consent decision could be served as another user's initial render — which would either show the wrong banner state or, worse, leak SDK loading across users. Mitigation: verify cache headers on marketing routes (`Cache-Control: private` or vary on the `mopc-consent` cookie). Premortem should pull this back to the cache config in `next.config.mjs` and the layout-level cache directives.
4. **Essential toggle breaks auth.** The Essential toggle is locked at the UI layer (`aria-disabled="true"`, hardcoded `essential: true`). Failure mode: a CSS or keyboard-nav bug allows a user to flip the toggle, the panel writes `essential: false` to the cookie, and downstream code that reads `state.essential` decides to clear auth cookies or block sign-in. Defense-in-depth: auth cookies are server-set with `HttpOnly` regardless of consent state — they are not subject to the consent banner's gating. The locked toggle is belt-and-suspenders, not load-bearing. Mitigation: vitest test (in T3) that asserts the Essential toggle cannot be flipped via click or keyboard; type-level enforcement that `ConsentState['essential']` is the literal `true` (already pinned in T0's type).

## Out of scope

What this slice deliberately does not do.

- **Third-party CMP integration** (Osano, Cookiebot, OneTrust). Rejected in the ADR's Alternatives — re-evaluate only if cookie surface materially expands.
- **Localization / i18n.** Banner ships in English. ADR-0024 Open question 3 defers non-English copy until member analytics show a non-English visitor share large enough to justify translation.
- **Geo-fenced banner.** Banner shows globally to all visitors; we do not detect EU vs US vs CA visitors and tailor the prompt.
- **Retroactive data deletion on consent revocation.** When a member toggles Analytics from on to off, the SDKs stop firing immediately; already-collected PostHog and Sentry data is **not** retroactively deleted. Deletion is the ADR-0023 "Delete my account" flow, owned by a future slice.
- **Real PostHog SDK initialization.** `<AnalyticsGate />` ships with a `TODO(adr-0028)` comment per concern 6's pinned contract; ADR-0028's slice plugs in `<PostHogProvider>` and the SDK's `init()` call.
- **Real Sentry SDK initialization.** `lib/sentry/init.ts` ships with an idempotent no-op + `TODO(adr-0014)` comment; ADR-0014's slice swaps in `@sentry/nextjs` client `init`. The idempotency flag stays — ADR-0014 inherits it.
- **Member-portal consent surface.** The banner mounts on `app/(marketing)/*` only. Member-app routes (`/dashboard`, `/billing`, `/profile`) sit behind authentication and inherit consent decisions made at signup; that flow is owned by ADR-0009 / ADR-0023's slice (Slice 2+).
- **Server-side consent enforcement.** This spec gates client-side SDK loading. Server-side analytics (e.g., a future `posthog-node` event) are not in scope; if and when server-side tracking lands, it reads the consent cookie via `next/headers` and the gating shifts to a server module (own slice). `lib/consent/cookie.ts` is intentionally vanilla TS (no `'use client'`) so a server-side reader can share the `ConsentState` type.
- **Counsel-reviewed banner copy.** The spec ships engineering-authored placeholder copy in `lib/consent/copy.ts` per concern 9. The `// TODO(travis): legal review before public launch` comment carries Open question 1 forward as the actionable hook. Slice 1 ships to staging; counsel sign-off gates public launch.
- **Cookie-scanning tooling.** No automated audit that detects "the SDK actually wrote a cookie despite the gate." Manual inspection is sufficient at the cookie surface in this slice (3 categories, 2 non-essential SDKs, both gated at SDK-load time per the ADR).
- **A11y audit beyond what is captured in vitest.** The banner and panel use Radix primitives + `aria-label` + keyboard-accessible buttons; AC6 mandates 5 specific Radix-Dialog assertions (concern 3). ADR-0026 (a11y) is Stub; its eventual slice owns the formal WCAG 2.1 AA audit.

## Open questions

Resolved during planning where possible; remaining items flagged for owner / counsel input. Open Q 2 from iter1 (modal vs inline) is **deleted** per concern 8 — the spec commits to Radix Dialog modal in T3 + AC6.

1. **Banner copy review.** The spec ships engineering-authored placeholder copy in `lib/consent/copy.ts`. Counsel review is required before public launch per ADR-0024 Open question 2. Resolution: ship the placeholder; the `// TODO(travis): legal review before public launch` comment in `lib/consent/copy.ts` is the actionable hook (concern 9). The swap is a single-file content edit when counsel returns the reviewed text.
2. **Cookie I/O on server vs client.** `lib/consent/cookie.ts` is vanilla TypeScript with `typeof document` guards (concern 2) — it works on both server (no-op gracefully) and client (effects via `document.cookie`). A future server-side reader that uses `next/headers`'s `cookies()` API would live alongside in `lib/consent/server.ts` and share the `ConsentState` type. Out of scope this slice; flagged for ADR-0023's slice if server-side consent enforcement becomes a requirement.
3. **Lighthouse delta vs no-banner baseline.** The ADR flags bundle weight as a Negative consequence and cites ADR-0030's ≥90 perf budget as binding. AC13 is **CI-only** per concern 7. Open: should the planner pin a numeric perf-delta threshold (e.g., "no more than -2 perf points vs baseline") rather than the absolute ≥90 floor? Defer to ADR-0017's CI venue and the actual Lighthouse runs that surface there.
4. **Footer surface in this branch.** The current `components/marketing/public-footer.tsx` has nav columns and a copyright row only — no fourth column for "Cookie preferences" yet. T4 adds the link; planner decides whether it sits in a new column or in the meta-row alongside the copyright. Low-impact UX call.
5. **`prefers-reduced-motion` test mocking strategy.** AC5 mocks `window.matchMedia`. The vitest setup at `tests/setup.ts` may already provide a global; planner / test-writer to confirm and either reuse the existing mock or add per-test mocks.
6. **Open question carried from ADR-0024 (consent revocation behavior, counsel sign-off).** Stays open at the ADR level; this spec ships the surface where revocation happens (the customize panel saves the new state immediately; the SDKs stop firing immediately; already-collected data is not retroactively deleted). Counsel sign-off is owner-track.
