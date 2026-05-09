# ADR-0026: Accessibility

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 1 (basics) → 4 (formal audit)

## Context

The design uses gold-on-black with serif display type. We need to ensure it's accessible — both for ethical reasons and because TX has been a venue for ADA-related accessibility lawsuits against business websites.

## Decision

### Target

WCAG 2.1 Level AA across all member-facing surfaces.

### Practices

- **Semantic HTML.** Use `<button>`, `<a>`, `<nav>`, `<main>`, etc. correctly. No `<div onclick>` for actionable elements.
- **Focus states.** Every interactive element shows a visible focus ring. Default Tailwind ring overridden with the gold-glow shadow tokens.
- **Color contrast.** All body text ≥4.5:1 against bg. The gold-on-black palette already passes (see `design-system.md` accessibility section). The risky case is gold-text gradient over images — overlay enforced.
- **Keyboard nav.** Every flow operable without a mouse. Tab order matches visual order. Skip-to-main link on the homepage.
- **Screen reader.** Aria-label on icon-only buttons. Aria-live for important announcements (e.g., "Time top-up successful").
- **Forms.** Labels associated with inputs. Error messages tied via `aria-describedby`. Validation announced.
- **Motion.** Respect `prefers-reduced-motion`: disable shimmer, grain, marquee tickers.
- **Imagery.** All meaningful images have alt text. Decorative imagery has `alt=""`.
- **Document outline.** One `<h1>` per page. Heading hierarchy unbroken.

### Tooling

- ESLint plugin `jsx-a11y` enforced in CI.
- `axe-core` Playwright tests on every public page in Slice 4.
- Lighthouse CI a11y budget ≥90.

### Audit (Slice 4)

- Manual keyboard-only walkthrough of every critical flow.
- Manual screen-reader test (NVDA on Windows, VoiceOver on macOS).
- External audit if budget allows.

## Open questions (deferred)

- **Dedicated `/accessibility` statement page** — resolved yes. Add to the marketing surface in Slice 4 with the formal audit pass; references this ADR + the WCAG 2.1 Level AA target.
- **High-contrast mode preference toggle** — declined for v1. The default gold-on-black palette already exceeds 4.5:1 contrast; adding a toggle adds maintenance complexity and theme drift risk. Re-evaluate if member feedback surfaces a concrete need.
