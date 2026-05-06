---
date: 2026-05-05
adrs: []
slice: 1
type: implementation
status: complete
---

# About Us copy refresh on ClubScreen

## Context

The owner sent over an authoritative new About Us copy block for the club page, originally branded as "Members Social Club" (the agent's pasted draft) and describing the venue as a BYOB-while-pending-liquor-license establishment with promotions, giveaways, and player-first service.

The marketing About / club page is the prototype `ClubScreen` (per `docs/route-map.md`, slated for Next.js `/club` in Slice 1). The Next.js app pages haven't been ported yet, so the prototype JSX is still the visual source of truth.

This entry updates the prose in the About Us hero of `ClubScreen`. It intentionally does **not** propagate the rename or BYOB statement beyond that hero block — those cascade across spec/README/metadata/footer/ADRs and are tracked as the **rebrand-cascade follow-up** (see "Next").

### Owner reconciliation — answered 2026-05-05

After the contradictions were surfaced (see below), the owner answered both:

1. **Product name:** **Members Only Social Club** (drops "Poker", keeps "Members Only"). Neither the agent's draft ("Members Social Club") nor the legacy name ("Members Only Poker Social Club"). The about-us prose was rewritten to use this name before the branch was pushed.
2. **Alcohol model:** **BYOB pre-license** confirmed. Spec.md's TABC-licensed claim is now stale and will be revised in the rebrand-cascade follow-up. ADR-0009's 21+ justification chain needs re-grounding away from TABC (a 21+ house policy can stand independently, but the reasoning in the spec/ADR currently leans on TABC).
3. **Branch shipping:** option (i) — merge + push as-is after the prose rename. Decision-cascade tracked as separate follow-up.

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
- **Brand name in this prose is "Members Only Social Club"** per the owner's reconciliation. The footer `© MMXXIV Members Only Poker Social Club` and the `app/layout.tsx` metadata `title`/`description` still use the legacy long name — those will be reconciled in the rebrand-cascade follow-up so this PR stays scoped to one prose change.
- **Did not touch the `21+ · ID required at the door` line in `PublicFooter` or `app/page.tsx`.** That language is downstream of ADR-0009 (member identity) and `docs/spec.md`. With BYOB-pre-license confirmed, ADR-0009's TABC-driven 21+ justification needs re-grounding, but that's the rebrand-cascade follow-up's job. Leaving the 21+ line in place because a 21+ house policy stands on its own — only the *justification chain* needs revisiting, not the requirement itself.

## Tests

None added — content-only change to a prototype JSX file that isn't yet wired into a Next.js route. The contract tests we'd want here (UI copy doesn't drift from canonical content) don't exist yet because the marketing pages haven't been ported. A snapshot or copy-source-of-truth test for the About block would make sense once `app/(marketing)/club/page.tsx` lands in Slice 1.

## Next

Both surfaced contradictions are now owner-resolved (see "Owner reconciliation" above), but the *cascade work* triggered by those decisions is open:

1. **Rebrand cascade — Members Only Poker Social Club → Members Only Social Club.** Files that need updating (in priority order):
   - `app/layout.tsx` — `metadata.title.default` / `template`, `description`, `openGraph.siteName`
   - `_design/project/screens-public-1.jsx` — `PublicFooter` © line and any other long-name references
   - `README.md` — title + description
   - `docs/spec.md` — title + every prose reference
   - `docs/adr/*` — every ADR that names the product (search needed)
   - `package.json` — `name` field (`members-only-poker-club` → `members-only-social-club`?) and `description`
   - `docs/design-system.md` — title only, probably
   - **Domain question:** `membersonlypokerclub.com` is registered. Keep as-is and acquire `membersonlysocialclub.com` as primary? Or redirect-only? Owner action.
   - This deserves its own ADR: "Brand rename: Members Only Social Club" capturing the why and the deferred items (legal entity, domain).

2. **BYOB cascade — TABC-licensed → BYOB pre-license.**
   - `docs/spec.md` — strike or qualify the TABC-licensed claim; the line "Members must be 21+. ID required at the door. Play responsibly." in `README.md` still holds, but its justification chain changes.
   - `docs/adr/0009-member-identity-and-id-verification.md` (currently a Stub anyway) — re-ground the 21+ requirement on house policy / Texas private-club rules, not TABC. Worth doing as part of writing that ADR.
   - PublicFooter line `21+ · ID required at the door` is unchanged.

3. **Out-of-scope discrepancy noticed:** `docs/route-map.md` lists `ClubScreen` as living in `_design/project/screens-public-1.jsx`, but it actually lives in `_design/project/screens-public-2.jsx`. Tiny doc fix; bundle into the rebrand-cascade PR.

## Notes for future me

- The hero `<p>` → `<div>` of `<p>`s pattern is the right move whenever owner copy expands from one paragraph to many. Don't try to compress 6 paragraphs into one — it loses the rhythm of the original.
- When the owner sends "authoritative copy," scan it for naming and policy claims that contradict the spec **before** dropping it in. The two contradictions above weren't subtle once you were looking for them; they would have been easy to silently propagate.
- The route-map ClubScreen path bug (`screens-public-1.jsx` vs `screens-public-2.jsx`) is the kind of thing a contract test would catch. Worth wiring into the slice 1 marketing port.
