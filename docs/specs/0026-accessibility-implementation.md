---
adr: 0026
slice: 1
risk: low
acceptance_commands:
  - 'pnpm test tests/a11y/'
---

# Spec: Accessibility — slice 1 (ADR-0026)

- **ADR:** [0026](../adr/0026-accessibility.md)
- **Status:** Draft
- **Date:** 2026-05-09

## Goal

Ship the slice-1 a11y skeleton: an /accessibility statement page, axe-core
e2e wiring, and vitest-level structural checks. Manual screen-reader audit
and the formal external audit are explicitly Slice 4 work.

## Acceptance criteria

1. `app/(marketing)/accessibility/page.tsx` exists with a written
   accessibility statement: WCAG 2.1 Level AA target, a brief plain-language
   description of the practices we follow (semantic HTML, focus rings, color
   contrast, keyboard nav, screen-reader support, motion respect, alt text),
   and a contact email for accessibility issues.
2. Per-page `metadata` export on `/accessibility` follows the ADR-0030
   pattern (title, description, openGraph card with the marketing OG route).
3. The statement page is linked from the public footer (next to the
   privacy and terms links).
4. New e2e test `tests-e2e/a11y.spec.ts` runs axe-core (via
   `@axe-core/playwright`) against every Slice-1 marketing route (`/`,
   `/games`, `/contact`, `/faq`, `/membership`, `/club`, `/privacy`,
   `/terms`, `/member-agreement`, `/accessibility`). Asserts no
   `serious` or `critical` axe violations.
5. New vitest `tests/a11y/structural.test.ts` asserts every marketing page's
   server-rendered HTML contains required landmark tags (`<main>`,
   `<header>`, `<footer>`, exactly one `<h1>`). Source-grep is sufficient
   here — no DOM render needed.
6. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check` all pass.
   `pnpm test:e2e` is gated by Playwright availability; when run, axe e2e
   passes.

## Out of scope

- Manual screen-reader walkthrough (Slice 4)
- High-contrast mode toggle (declined per ADR-0026 ratification)
- External a11y audit (Slice 4 if budget allows)
- Lighthouse a11y budget enforcement (already gated by lighthouse job;
  threshold tuning is a Slice 4 task)

## Touched-files inventory

- Create: `app/(marketing)/accessibility/page.tsx`
- Modify: `components/marketing/public-footer.tsx` (add link)
- Create: `tests-e2e/a11y.spec.ts`
- Create: `tests/a11y/structural.test.ts`
- Modify: `package.json` (add `@axe-core/playwright`)

## Risk flags

None — pure additive UI + test surface.

## Open questions

None at planning time.
