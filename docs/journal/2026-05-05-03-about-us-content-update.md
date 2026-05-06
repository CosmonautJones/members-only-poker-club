---
date: 2026-05-05
adrs: []
slice: 1
type: implementation
status: complete-with-correction
---

# About Us copy refresh on ClubScreen

> **CORRECTION (2026-05-05, see entry 04):** This entry's "Owner reconciliation" originally claimed the brand changed to *Members Only Social Club*. That was a misread of the owner's input. The brand stays **Members Only Poker Social Club** (no rename). What the owner was actually changing was the **domain idea** (toward `membersonlypoker.com`). The BYOB-pre-license part of the resolution stands. The ClubScreen prose was reverted to the long brand name and the h1 was restored to "The Club" (the prototype's original section title) in commit on `main` after this entry was first written. Read entry 04 for the corrected record. The narrative below is preserved unedited *except* where it would have actively misled future-me; corrections are inline-marked.

## Context

The owner sent over an authoritative new About Us copy block for the club page, originally branded as "Members Social Club" (the agent's pasted draft) and describing the venue as a BYOB-while-pending-liquor-license establishment with promotions, giveaways, and player-first service.

The marketing About / club page is the prototype `ClubScreen` (per `docs/route-map.md`, slated for Next.js `/club` in Slice 1). The Next.js app pages haven't been ported yet, so the prototype JSX is still the visual source of truth.

This entry updates the prose in the About Us hero of `ClubScreen`. It intentionally does **not** propagate the rename or BYOB statement beyond that hero block — those cascade across spec/README/metadata/footer/ADRs and are tracked as the **rebrand-cascade follow-up** (see "Next").

### Owner reconciliation — answered 2026-05-05 (CORRECTED — see entry 04)

The original answers I recorded here were wrong on item 1. The corrected record:

1. ~~**Product name:** **Members Only Social Club**~~ → **Brand stays "Members Only Poker Social Club"** (no rename). The owner's reference to "Members Only Social Club" was a description of the *domain* he was thinking about (`membersonlypoker.com`), not a brand rename. The ClubScreen prose was reverted to the long brand name in entry 04's commit.
2. **Alcohol model:** **BYOB pre-license** confirmed. Spec.md's TABC-licensed claim is stale and is corrected alongside this entry's correction. ADR-0009's 21+ justification chain re-grounded on house policy (entry 04 commit + new ADR-0033).
3. **Branch shipping:** option (i) — merge + push as-is after the prose rename. Cascade tracked as entry 04.

## Changes

- **`_design/project/screens-public-2.jsx`** — `ClubScreen` hero section:
  - Eyebrow changed `About` → `About Us`.
  - `<h1>` changed `The Club` → `Members Only Social Club` (the new copy refers to the venue by this name throughout — kept inside the About block per task scope).
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
- ~~**Brand name in this prose is "Members Only Social Club"** per the owner's reconciliation.~~ **CORRECTED (entry 04):** brand stays *Members Only Poker Social Club*. The ClubScreen h1 was restored to "The Club" and prose to the long brand name. The footer `© MMXXIV Members Only Poker Social Club` and `app/layout.tsx` metadata are now consistent with the prose; nothing rebrand-cascading is owed.
- **Did not touch the `21+ · ID required at the door` line in `PublicFooter` or `app/page.tsx`.** That language is downstream of ADR-0009 (member identity) and `docs/spec.md`. With BYOB-pre-license confirmed, ADR-0009's TABC-driven 21+ justification needs re-grounding, but that's the rebrand-cascade follow-up's job. Leaving the 21+ line in place because a 21+ house policy stands on its own — only the *justification chain* needs revisiting, not the requirement itself.

## Tests

None added — content-only change to a prototype JSX file that isn't yet wired into a Next.js route. The contract tests we'd want here (UI copy doesn't drift from canonical content) don't exist yet because the marketing pages haven't been ported. A snapshot or copy-source-of-truth test for the About block would make sense once `app/(marketing)/club/page.tsx` lands in Slice 1.

## Next

**SUPERSEDED by entry 04.** This section originally listed a "rebrand cascade" of files to rename to *Members Only Social Club*. That cascade was abandoned when the brand turned out not to be changing. Entry 04 captures the actual cascade that did happen:

1. **Brand revert:** ClubScreen reverted to "The Club" h1 + *Members Only Poker Social Club* prose. No further rename work elsewhere.
2. **BYOB cascade applied:** `docs/spec.md`, `docs/adr/0009-member-identity-and-id-verification.md`, plus a new ADR-0033 capturing the alcohol-model decision.
3. **Domain cascade applied:** `app/layout.tsx` `metadataBase`, `.env.local.example` `RESEND_FROM_EMAIL`, and the `docs/spec.md` domain row updated to use `membersonlypoker.com` as primary.
4. **Out-of-scope drift fixed:** `docs/route-map.md` `ClubScreen` path corrected from `screens-public-1.jsx` to `screens-public-2.jsx` (bundled into entry 04's commit).

## Notes for future me

- The hero `<p>` → `<div>` of `<p>`s pattern is the right move whenever owner copy expands from one paragraph to many. Don't try to compress 6 paragraphs into one — it loses the rhythm of the original.
- When the owner sends "authoritative copy," scan it for naming and policy claims that contradict the spec **before** dropping it in. The two contradictions above weren't subtle once you were looking for them; they would have been easy to silently propagate.
- The route-map ClubScreen path bug (`screens-public-1.jsx` vs `screens-public-2.jsx`) is the kind of thing a contract test would catch. Worth wiring into the slice 1 marketing port.
