# ADR-0033: Alcohol model — BYOB pre-license

- **Status:** Accepted
- **Date:** 2026-05-05
- **Slice:** 1
- **Supersedes:** —
- **Superseded by:** —

## Context

Earlier specification work (`docs/spec.md` and ADR-0009) framed the club as opening with a TABC-licensed full bar in place, and used that license as the legal basis for the **21+ door requirement** that ADR-0009 enforces during signup ID verification.

The actual operational reality, confirmed by the owner on 2026-05-05: the club is opening **BYOB** while the TABC liquor-license application is in process. A TABC license takes weeks-to-months in Texas; the club cannot delay opening on it, and the venue does not need a license to allow members to bring their own beverages onto private-club premises.

This decouples two things the prior spec had welded together:

1. **The alcohol model** — what we serve, what members consume, and under what authority.
2. **The 21+ rule** — who can become a member and walk in the door.

The 21+ rule must hold whether or not the TABC license is in place. We need an explicit decision about why.

## Decision

The club operates as a **BYOB establishment** until the TABC liquor license is issued. After the license issues, the venue may serve alcohol on premises and the BYOB policy is rescinded (or retained at owner discretion).

The **21+ door requirement is held by house policy**, independent of the alcohol-licensure status:

- House policy 21+ is enforced at signup (DOB capture + `is_21` gate per ADR-0009) and at the door (physical ID check by staff or PokerAtlas TableCaptain ID scanner).
- This policy holds whether the venue is BYOB, TABC-licensed, or operates under any future regulatory regime.
- When the TABC license is issued, the TABC age requirement (≥21 for any establishment serving alcohol on-premises) **aligns with** the existing house policy; nothing about the door rule changes.
- Members, customer-facing copy, and operations runbooks all reference the same 21+ rule with no carve-outs for BYOB vs licensed periods.

The decision **does not** preempt other alcohol-related ADRs that may arrive once the license is issued (e.g., point-of-sale integration for served alcohol, age-verification at the bar separate from the door, pour-cost reporting). Those become their own decisions when they're real.

### Customer-facing language

Marketing prose (e.g., the About Us section in `_design/project/screens-public-2.jsx`) may state plainly: "BYOB while we complete the process of obtaining our liquor license." Member-facing legal documents (Privacy, Terms, Member Agreement) state the 21+ requirement without reference to TABC licensure status.

When the TABC permit number issues, ADR-0009's open-question item ("TABC permit number — must appear on Privacy/Terms once issued") gets executed as a follow-up content edit. No structural change to ID verification, member onboarding, or door operations.

## Consequences

**Positive:**

- The club opens on schedule without TABC licensure as a launch dependency.
- The 21+ rule has a defensible, license-independent justification, so the door policy survives any change in alcohol service model.
- Customer-facing copy ("BYOB while we complete the process of obtaining our liquor license") is honest and matches operational reality.
- ADR-0009 (member identity & ID verification) does not need to be redrafted when the license issues.

**Negative:**

- House-policy 21+ is enforceable on club property as a private membership condition, but it is not the same legal posture as TABC-mandated 21+. If a future regulatory body (TABC, Texas alcohol regulators, or local authorities) takes the position that the BYOB venue is *also* subject to age regulation, we accept that the house-policy already meets the higher bar.
- Reverse case: BYOB law in Texas may have requirements we haven't accounted for (storage rules, on-premises consumption, glassware, etc.). Those are operational, not architectural; runbook (ADR-0027) territory once defined.
- Some members may misread "BYOB" as "no age check." Mitigation: the marketing copy and member agreement state 21+ explicitly; the door check happens regardless of what a member walked in with.

## Alternatives considered

- **Open with TABC license in hand.** Originally planned; deferred when application timeline became real. Rejected because we cannot delay opening on a multi-week regulatory process when the rest of the club is ready.
- **House-policy 18+ during BYOB phase, escalate to 21+ at TABC issuance.** Rejected. Two age policies in the lifecycle introduces a per-member legal status (grandfathered vs not) and creates door-staff training burden. The simpler, defensible posture is one age rule from day one.
- **Defer this ADR until license issues.** Rejected. The BYOB phase is the actual launch state; the spec must reflect the actual launch state, and the 21+ rule's justification chain must be sound *before* signups open, not retroactively.
