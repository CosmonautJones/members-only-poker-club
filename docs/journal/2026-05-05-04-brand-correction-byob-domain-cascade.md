---
date: 2026-05-05
adrs: [0009, 0033]
slice: 1
type: fix
status: complete
---

# Brand correction + BYOB ratification + domain cascade

## Context

Three things converged into one corrective shift:

1. **Brand correction.** Entries 02→03 of this journal carried a misread: the owner had referenced "Members Only Social Club" in a domain context (he was thinking about `membersonlypoker.com` as a shorter URL), and an agent + I both treated that as a brand rename. Two commits on `main` (`b2df1c5`, `be8b2cb`) shipped "Members Only Social Club" into the ClubScreen prototype prose. The actual brand is still **Members Only Poker Social Club**; nothing else was changing.
2. **BYOB ratification.** Separately and correctly: the owner confirmed the club opens **BYOB** while the TABC liquor license is in process. `docs/spec.md` and `docs/adr/0009-member-identity-and-id-verification.md` had framed the venue as TABC-licensed and used that license as the legal basis for the 21+ door rule. Both needed correcting.
3. **Domain shift.** Owner is moving toward `membersonlypoker.com` as the primary domain; `membersonlypokerclub.com` becomes alt / redirect candidate.

This entry documents the single commit that fixed all three.

## Changes

**Brand revert in prototype prose:**

- `_design/project/screens-public-2.jsx`
  - h1 (line 11): "Members Only Social Club" → "The Club" (the prototype's original section title for the about-us slot — eyebrow "About Us" stays, h1 becomes title)
  - 4 prose substitutions: every "Members Only Social Club" → "Members Only Poker Social Club" in the body paragraphs

**Journal entry 03 corrected:**

- `docs/journal/2026-05-05-03-about-us-content-update.md`
  - Added a `> CORRECTION (2026-05-05, see entry 04)` admonition at the top
  - Original "Owner reconciliation" item 1 marked struck-through with the corrected statement
  - "Decisions" section marked the false brand assertion as corrected
  - "Next" section superseded by a pointer to this entry
  - Front-matter status changed `complete` → `complete-with-correction`

**BYOB cascade applied:**

- `docs/spec.md`
  - Line 7 context paragraph: "with a full bar (TABC license)" → "currently BYOB while pursuing a TABC liquor license"
  - Business-model bullet (line 11): "Members-only, **age 21+** (liquor license requires it)" → "Members-only, **age 21+** (house policy; tracks Texas alcohol-service requirements once the TABC license is issued — see ADR-0033)"
  - Locked-in decisions table (line 39): "Liquor license (TABC) requires" → "House policy; aligns with TABC age requirement once licensed (see ADR-0033)"
- `docs/adr/0009-member-identity-and-id-verification.md`
  - Line 9: "21+ (TX liquor license)" → "21+ (house policy; will sync with TABC requirements once the liquor license is issued — see ADR-0033)"

**Domain cascade applied:**

- `app/layout.tsx`: `metadataBase` URL `https://membersonlypokerclub.com` → `https://membersonlypoker.com`
- `.env.local.example`: `RESEND_FROM_EMAIL=noreply@membersonlypokerclub.com` → `noreply@membersonlypoker.com`
- `docs/spec.md`: locked-in decisions "Domain" row swapped — `membersonlypoker.com` is now primary, `membersonlypokerclub.com` is alt
- `docs/spec.md`: open-question 1 rephrased to reflect new direction

**New ADR:**

- `docs/adr/0033-alcohol-model-byob-pre-license.md` (Status: Accepted, Slice: 1)
- `docs/adr/README.md`: new "Operations" group added containing ADR-0033

**Bonus drift fix:**

- `docs/route-map.md`: `#club` row corrected to point at `_design/screens-public-2.jsx ClubScreen` (was incorrectly listed as `screens-public-1.jsx`)

## Decisions

- **No brand-rename ADR.** The brand isn't changing — there is no decision to record. Entry 03 + this entry are sufficient history.
- **No domain-change ADR.** Domain selection is operational, not architectural. The change is a one-line rewrite in two config locations and a spec table; CONTRIBUTING.md's ADR-worthy threshold ("hard to reverse, affects more than one module, trades off security/performance/cost/correctness") does not clear.
- **ADR-0033 captures only the alcohol model.** The 21+ requirement's legal basis (house policy independent of TABC licensure) is the genuinely architectural decision. Bundle of "BYOB now → TABC later" + "21+ holds in either era" is one decision; one ADR.
- **Preserve corrupted history in entry 03 rather than overwriting.** Future-me needs to see the misread and the recovery, not just the final state. Strikethrough + correction admonition makes the wrong claims visible without losing them.
- **Owner action items NOT executed in this commit:**
  - GitHub repo name (`CosmonautJones/members-only-poker-club`) — unchanged
  - `package.json#name` field (`members-only-poker-club`) — unchanged
  - Vercel project name — unchanged (owner-side, has knock-on effects)
  - A2P 10DLC campaign name in ADR-0025 ("Members Only Poker Club Notifications") — brand didn't change, this stays correct as-is
  - `.env.local.example` `NEXT_PUBLIC_APP_URL` defaults to `localhost`, no change needed there

## Tests

None added. All edits are content/configuration changes:
- Prototype JSX prose (not yet wired to a Next.js route)
- Journal markdown
- Spec markdown
- ADR markdown
- ENV example file
- One TypeScript constant (`metadataBase` URL — the type still satisfies)

CI's two grep guardrails (added in entry 02) continue to pass: no `SUPABASE_SERVICE_ROLE_KEY` in client surfaces, no decimal/numeric/float on `*_cents` columns. No new migrations to scan.

## Next

Phase B from the implementation plan begins next: **landing page MVP** for owner preview. Goal — ship a credible `/` route by porting `_design/project/screens-public-1.jsx HomeScreen` to `app/(marketing)/page.tsx` with extracted PublicHeader/PublicFooter/primitives components. Defer the Signage Feature section (needs missing image assets) as a styled placeholder. Push to a `slice-1/marketing-home-mvp` branch, open a PR, share the Vercel preview URL with the owner.

## Notes for future me

- **When owner sends a name, cross-check it against the existing brand artifacts before cascading.** The agent + my second pass both expanded "Members Only Social Club" — neither caught that the owner's existing artifacts (README, spec, footer copyright, metadata, package.json) all said "Members Only Poker Social Club." A 30-second grep before commit would have caught the misread.
- **The owner says short things; I cascade them long.** When the owner sends a short directive ("Members only social club"), it's usually a *reference* to a longer existing thing (the brand) or to *another* thing entirely (a domain). Stop and ask before committing a multi-file rename — even in Auto mode.
- **House-policy 21+ vs license-derived 21+ matters.** In Texas, the legal posture differs between the two; a private club's 21+ rule is enforceable as a membership condition independent of TABC. ADR-0033 captures this. If a future regulator asks "where does your 21+ come from?", the answer is house policy first, TABC alignment second.
- **The route-map drift (`screens-public-1.jsx` vs `screens-public-2.jsx`) is the kind of thing a small contract test could catch.** Add to the slice-1 marketing port as a follow-up — a build-time check that the prototype paths in `route-map.md` actually exist.
