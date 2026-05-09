# Legal documents

Source-of-truth artifacts for member-facing legal text.

## Versioned documents

| File | Description | Status |
| --- | --- | --- |
| `membership-agreement-v1.jpg` | Membership Agreement & Liability Waiver, v1 (15 sections — Texas Penal Code §47.02/§47.01 framing, fees-for-facility, surveillance consent, indemnification). | Source from owner. Not yet wired into the signup flow. |

## How this connects to the code

- ADR-0009 specifies the **member-agreement e-signature flow**: full text versioned in a `content_blocks` table; acceptance recorded as `hash + signed timestamp + IP`. The agreement here is the v1 content for that flow.
- ADR-0024 (cookie/consent banner) is a **separate** consent — cookies/analytics only. Membership agreement acceptance is a distinct event captured at signup.

## Versioning rule

Each material change to the legal text bumps the version (`-v2.jpg`, etc.). The signup flow pins acceptance to the version a member signed; older versions stay in the repo for audit.

## Out-of-scope here

This folder holds source artifacts only. The transcribed/structured copy that the app renders should live alongside the implementation when ADR-0009's content-blocks slice ships.
