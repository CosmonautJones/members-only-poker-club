# ADR-0025: Email & SMS communications

- **Status:** Stub
- **Date:** 2026-05-04
- **Slice:** 2 (email transactional) → 3 (SMS transactional) → 4+ (marketing)

## Context

Members need: signup verification email, payment receipts, dunning notices, SMS reminders for tournaments and low-balance alerts. Each channel has compliance requirements (CAN-SPAM, TCPA, A2P 10DLC).

## Decision

To be drafted across Slices 2/3. Direction:

### Email

- **Provider:** Resend.
- **From:** `noreply@membersonlypokerclub.com`. Reply-to: `members@...`.
- **DNS:** SPF, DKIM, DMARC configured in Slice 1.
- **Templates:** React Email components in `lib/email/templates/`. Server-rendered.
- **Categories:**
  - Transactional (always sent regardless of opt-out): receipts, password reset, dunning, security alerts
  - Marketing (requires explicit opt-in, unsubscribe link mandatory): tournament newsletter, club updates
- **CAN-SPAM:** marketing emails carry physical mailing address + one-click unsubscribe. Unsubscribes processed within 10 business days (we'll do real-time).

### SMS

- **Provider:** Twilio.
- **Number:** A2P 10DLC-registered, brand = LLC owning the club, campaign = "Members Only Poker Club Notifications".
- **Registration starts week 1** (2–6 wk timeline).
- **Categories:**
  - Transactional: receipts, low-balance alerts, tournament reminders T-1hr and T-15min
  - Marketing: deferred to Slice 4+
- **TCPA:** double opt-in (checkbox at signup + confirmation reply). HELP and STOP keywords handled by `/api/webhooks/twilio`.
- **Quiet hours:** no SMS between 9pm and 9am local (TX = Central Time) unless transactional + member-initiated.
- **STOP enforcement:** STOP message sets `profiles.sms_opt_in_at = NULL`; future sends are blocked at the Twilio layer.

### Storage

- `sms_messages` table records every send (template, body, twilio_sid, status, error). 1-year retention.
- Email sends recorded in `payments.raw_event` for transactional financial emails; otherwise relying on Resend's own log.

## Open questions

- Whether to add WhatsApp / iMessage business in a later phase
- Localization (Spanish for TX market — defer to post-launch)
