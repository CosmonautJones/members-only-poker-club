# ADR-0009: Member identity & ID verification

- **Status:** Accepted
- **Date:** 2026-05-04
- **Ratified:** 2026-05-08
- **Slice:** 2

## Context

The club is members-only and **21+** (house policy; will sync with TABC requirements once the liquor license is issued — see ADR-0033). Every signup must verify date of birth and identity. The PokerAtlas equipment bundle includes a physical ID scanner at the door, but online signup happens before a member ever shows up.

We need to:

- Capture DOB at signup and gate at 21
- Collect a government-issued photo ID (driver's license, passport)
- Verify the ID is genuine and matches the applicant (manual review by manager in v1, automated KYC vendor in a later slice)
- Store the ID document securely with a retention policy
- Issue a member number on approval
- Print a digital membership card (PokerAtlas TableCaptain offers this; we can also generate ours and integrate later)

## Decision

- DOB validation client-side and server-side. Computed `is_21` flag, not raw age (handles leap-day edge case at boundary).
- ID upload via Supabase Storage in a private bucket, server-signed upload URL, max 10MB, JPEG/PNG/PDF only.
- File path includes a UUID, never the user's name. Path: `id-docs/{user_id}/{uuid}.{ext}`.
- Manual review queue: `manager+` role can approve or reject from `/admin/verifications`.
- Approved → write `id_verified_at`, generate `member_number` from a Postgres sequence.
- ID document **deleted** after 30 days of approval (we keep verification metadata but not the document image — minimizes PII surface). The `id_verified_at` and the manager who approved are kept forever in audit log.
- Member-agreement e-signature stored as a hash + signed timestamp + IP. Full text is versioned in `content_blocks`.

## Open questions (deferred — tracked for Slice 2 implementation)

- **Manual review SLA** — target 4 business hours during member-onboarding pilot, escalate to KYC vendor if queue depth exceeds 20 pending verifications. Owner staffs the queue v1.
- **OCR / KYC vendor (Persona, Stripe Identity)** — deferred to Slice 4. v1 ships manual review only. Vendor selection is a Slice-4 decision driven by signup volume; if v1 demand exceeds 50 verifications/week, fast-track to Stripe Identity (lowest-friction integration given existing Stripe footprint).
- **TUETA / e-sign sufficiency** — counsel-pending. Default proceeds with e-sign + signed-timestamp + IP hash; if counsel requires notarization, swap the signature flow at signup for Notarize.com or equivalent. No code blocks on this — the signature module abstracts the storage.
- **AML/BSA retention** — counsel-pending. Default retention: 30 days post-verification (per ADR body). If counsel requires longer (5-7 years for AML), extend the bucket lifecycle policy to match. Tracked as a configurable retention constant in `lib/identity/`.

## Alternatives to consider

- Stripe Identity (turnkey, ~$1.50/verification)
- Persona, Veriff, Onfido (premium KYC)
- Manual-only forever (if volume stays low and the club hires a verifier)
