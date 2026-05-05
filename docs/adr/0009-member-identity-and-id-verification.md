# ADR-0009: Member identity & ID verification

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 2

## Context

The club is members-only and **21+** (TX liquor license). Every signup must verify date of birth and identity. The PokerAtlas equipment bundle includes a physical ID scanner at the door, but online signup happens before a member ever shows up.

We need to:

- Capture DOB at signup and gate at 21
- Collect a government-issued photo ID (driver's license, passport)
- Verify the ID is genuine and matches the applicant (manual review by manager in v1, automated KYC vendor in a later slice)
- Store the ID document securely with a retention policy
- Issue a member number on approval
- Print a digital membership card (PokerAtlas TableCaptain offers this; we can also generate ours and integrate later)

## Decision

To be drafted in Slice 2. Direction:

- DOB validation client-side and server-side. Computed `is_21` flag, not raw age (handles leap-day edge case at boundary).
- ID upload via Supabase Storage in a private bucket, server-signed upload URL, max 10MB, JPEG/PNG/PDF only.
- File path includes a UUID, never the user's name. Path: `id-docs/{user_id}/{uuid}.{ext}`.
- Manual review queue: `manager+` role can approve or reject from `/admin/verifications`.
- Approved → write `id_verified_at`, generate `member_number` from a Postgres sequence.
- ID document **deleted** after 30 days of approval (we keep verification metadata but not the document image — minimizes PII surface). The `id_verified_at` and the manager who approved are kept forever in audit log.
- Member-agreement e-signature stored as a hash + signed timestamp + IP. Full text is versioned in `content_blocks`.

## Open questions

- Manual review SLA: how long can the queue be before signup-to-play time becomes a complaint?
- Do we need OCR or KYC vendor (Persona, Stripe Identity) in v1 or Slice 4?
- TX-specific: do we need a notarized member-agreement, or is e-sign sufficient under TUETA (Texas Uniform Electronic Transactions Act)? (Likely e-sign suffices; counsel to confirm.)
- Do we need to retain ID for any minimum period for AML/BSA reasons? (Probably not for a club this size, but counsel to confirm.)

## Alternatives to consider

- Stripe Identity (turnkey, ~$1.50/verification)
- Persona, Veriff, Onfido (premium KYC)
- Manual-only forever (if volume stays low and the club hires a verifier)
