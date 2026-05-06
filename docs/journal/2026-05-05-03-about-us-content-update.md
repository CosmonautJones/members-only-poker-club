---
date: 2026-05-05
adrs: []
slice: 1
type: implementation
status: partial
---

# About Us copy refresh on ClubScreen

## Context

The owner sent over an authoritative new About Us copy block for the club page, branded as "Members Social Club" and describing the venue as a BYOB-while-pending-liquor-license establishment with promotions, giveaways, and player-first service.

The marketing About / club page is the prototype `ClubScreen` (per `docs/route-map.md`, slated for Next.js `/club` in Slice 1). The Next.js app pages haven't been ported yet, so the prototype JSX is still the visual source of truth.

This entry only updates the prose in the About Us hero of `ClubScreen`. It does **not** rename the product, touch ADRs, change the spec/README, or alter the alcohol/age model anywhere outside the About Us block — those are reconciliation decisions for the owner (see "Next").

## Changes

- **`_design/project/screens-public-2.jsx`** — `ClubScreen` hero section:
  - Eyebrow changed `About` → `About Us`.
  - `<h1>` changed `The Club` → `Members Social Club` (the new copy refers to the venue by this name throughout — kept inside the About block per task scope).
  - The single existing intro `<p>` ("We are a member-funded social poker club. The doors are private…") was replaced with a 6-paragraph block wrapped in a single left-aligned container `<div>`. Paragraph mapping:
    1. Mission / value prop ("premier private poker destination…")
    2. Cash games & tournaments / upscale environment
    3. BYOB while pending liquor license
    4. Promotions, giveaways, special events
    5. Player-first service / staff
    6. Community closer ("you're not just playing poker — you're part of a community")
  - Surrounding section structure preserved: outer `<section>`, eyebrow, `<h1>`, `<hr className="gold-rule-short"/>`, max-width 680, top padding 32px. The "Twelve tables. One bar." Room section, House Rules, Dress Code, and Gallery sections were left untouched — they're not generic About prose, they're topical sub-sections.
- No other files were modified. `app/page.tsx`, `app/layout.tsx` (metadata description), and `screens-public-1.jsx` `PublicFooter` (footer one-liner / © line / 21+ disclaimer) were intentionally left alone — see contradictions below.

## Decisions

- **Distributed all 6 paragraphs into the hero About slot rather than scattering them across the page.** The existing topical sections (Room, House Rules, Dress Code, Gallery) have their own concrete content with house-specific facts (12 tables, TDA rules, dress code lists). Trying to graft new generic prose into them would either duplicate or contradict that content. The hero is the only "free-form About" slot, so all 6 paragraphs go there. The hero `<p>` was promoted to a `<div>` of `<p>`s so the multi-paragraph flow renders correctly without restructuring the section.
- **Switched the hero text alignment from centered to left-aligned within the prose container.** Six stacked centered paragraphs read as a wall; left-align on a 680px column reads as readable copy while keeping the eyebrow / h1 / gold rule centered above. The visual rhythm of the section is preserved.
- **Kept the new "Members Social Club" name inside the About block only.** Task scope explicitly says do not rename the product elsewhere. The footer `© MMXXIV Members Only Poker Social Club` and the `app/layout.tsx` metadata `title`/`description` still use the original product name. This is intentional — the owner needs to decide which name is canonical before we propagate.
- **Did not touch the `21+ · ID required at the door` line in `PublicFooter` or `app/page.tsx`.** That language is downstream of ADR-0009 (member identity) and `docs/spec.md`, both off-limits per task scope. The new BYOB language doesn't directly contradict 21+ (BYOB venues can still have a 21+ door policy), but the owner's note that the liquor license is "still pending" is at odds with `docs/spec.md`'s claim that a TABC license is in place and *drives* the 21+ requirement. Leaving the 21+ line as-is until the owner decides.

## Tests

None added — content-only change to a prototype JSX file that isn't yet wired into a Next.js route. The contract tests we'd want here (UI copy doesn't drift from canonical content) don't exist yet because the marketing pages haven't been ported. A snapshot or copy-source-of-truth test for the About block would make sense once `app/(marketing)/club/page.tsx` lands in Slice 1.

## Next

Two contradictions surfaced that need owner reconciliation before the rest of the marketing site is built:

1. **Product name.** New copy says **Members Social Club** throughout. Existing artifacts (`README.md`, `docs/spec.md`, `package.json` `name`, footer copyright in `screens-public-1.jsx`, `app/layout.tsx` metadata, the domain `membersonlypokerclub.com`) say **Members Only Poker Social Club**. Owner needs to pick one:
   - (a) New name is the marketing brand, legacy name stays the legal/registered entity → leave everything outside the About block alone, but write a brand-vs-entity ADR.
   - (b) Full rebrand to Members Social Club → cascade rename across spec, README, package.json, domain, footer copyright, metadata, etc. (substantial change; would need its own ADR + slice).
   - (c) Revert the About block to the legacy name → re-edit `ClubScreen` h1 back to "The Club" / "Members Only Poker Social Club" and treat the new copy's naming as a typo.

2. **Alcohol model — BYOB pending liquor license vs TABC license + 21+.** New copy says we **are BYOB while obtaining our liquor license**. `docs/spec.md` says we **hold a TABC license** and that license drives the 21+ door requirement enforced by ADR-0009. The two cannot both be true at launch. Owner needs to confirm:
   - Are we pre-license (BYOB) and the spec is aspirational? → ADR-0009's age gate may need re-justification (Texas private poker clubs and 21+ aren't strictly TABC-coupled, but the *reasoning* in the spec/ADR currently is).
   - Or is the new copy stale and TABC is in place? → strike "BYOB while we complete the process of obtaining our liquor license" before this About block ships to a real `/club` route.

3. **Out-of-scope discrepancy noticed:** `docs/route-map.md` lists `ClubScreen` as living in `_design/project/screens-public-1.jsx`, but it actually lives in `_design/project/screens-public-2.jsx`. Not part of this task's scope; flagged here so a future doc-cleanup pass can fix it.

## Notes for future me

- The hero `<p>` → `<div>` of `<p>`s pattern is the right move whenever owner copy expands from one paragraph to many. Don't try to compress 6 paragraphs into one — it loses the rhythm of the original.
- When the owner sends "authoritative copy," scan it for naming and policy claims that contradict the spec **before** dropping it in. The two contradictions above weren't subtle once you were looking for them; they would have been easy to silently propagate.
- The route-map ClubScreen path bug (`screens-public-1.jsx` vs `screens-public-2.jsx`) is the kind of thing a contract test would catch. Worth wiring into the slice 1 marketing port.
