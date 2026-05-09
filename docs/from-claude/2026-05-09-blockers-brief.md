# What I need from you to unblock the rest of the build

**Status as of 2026-05-09:** all 34 ADRs are ratified. Marketing site + ops backbone are shipped. The transactional core (Slices 2 & 3 — auth, identity, membership, time-bank, tournament registration, SMS/email) is **0% built** because each piece needs an external decision, key, or vendor signup before code can begin.

This is the punch list. Most items are parallelizable — fire them all the same week.

---

## 🔥 Start TODAY (calendar-blocking, 2–6 week paperwork)

### 1. A2P 10DLC SMS registration

This is the **single longest critical-path item**. SMS to US numbers requires brand registration through The Campaign Registry. You can't send a single transactional SMS until this clears, and it doesn't ship until Slice 2/3 — but if we don't start now it becomes a launch blocker.

**What to do:**

1. Create a **Twilio account** at https://www.twilio.com/try-twilio (use the LLC's email)
2. Buy one US local number (Twilio Console → Phone Numbers → Buy a Number; pick a TX area code — local presence helps deliverability)
3. Submit **A2P 10DLC Brand registration** (Twilio Console → Trust Hub → A2P 10DLC):
   - Brand: the LLC's legal name (must match EIN paperwork exactly)
   - EIN, legal address, website (use `membersonlypoker.com` once DNS is live; otherwise `membersonlypokerclub.com`)
   - Vertical: `Recreation`
4. Submit **Campaign registration**:
   - Campaign name: `Members Only Poker Club Notifications`
   - Use case: `Mixed` (we'll send transactional receipts + tournament reminders + low-balance alerts)
   - Sample messages — copy these:
     ```
     Members Only Poker Club: Receipt for $50 time-bank purchase. Balance: 4h 10m. Reply HELP for help, STOP to opt out.
     Members Only Poker Club: Tournament "Friday Bounty" starts in 1 hour at 7pm. Reply STOP to opt out.
     Members Only Poker Club: Time-bank balance below 1 hour. Top up at https://membersonlypoker.com/buytime. Reply STOP to opt out.
     ```
   - Opt-in description: "Member checks the SMS opt-in box during signup at membersonlypoker.com/signup. Double opt-in via reply confirmation."
   - Opt-out keyword: `STOP`
   - HELP keyword: `HELP`

**What to send me when done:**

- Twilio Account SID + Auth Token (for `.env.local` and Vercel preview env)
- The 10DLC-approved phone number
- Campaign SID

**Blocks:** ADR-0025 SMS work (Slice 2/3). Email side of 0025 is independent — see #4 below.

---

## 🟢 Parallel external asks (email these out today)

### 2. Counsel — Texas poker club legal asks

The club's three pending legal questions can go in **one email to a TX gaming/business attorney**. Cost: probably one billable hour each, and you can ship Slice 2/3 with the *defaults* if counsel hasn't replied yet — these are confirmation asks, not gates.

**Who:** any TX attorney with §47.02 / private-club familiarity. If you don't have one, the [TX Bar Lawyer Referral](https://www.legalhotline.org/) plus a search for "Texas poker club private membership counsel" will surface specialists.

**Subject:** `Three opinion asks for Members Only Poker Social Club (TX private membership, BYOB pre-TABC)`

**Body — copy verbatim:**

```
We're standing up a TX private social poker club (members-only, 21+, BYOB
pre-TABC license; operating under Texas Penal Code §47.02 / §47.01 private-place
exception, member-vs-member play, no house bank). I've attached our member
agreement v1 (15 sections) for context. Three questions:

1. **Tournament rake / seat-fee structure** (ADR-0012). Our model: tournament
   buy-in is 100% prize pool with a separate "seat fee" line item that the club
   keeps for facility/dealer cost. Is this seat-fee structure acceptable under
   TX rake prohibitions for private clubs, or do we need a different framing?

2. **Stored-value time-bank — disclaim-of-expiration in member agreement**
   (ADR-0011). We'd like our agreement to disclaim *expiration* of purchased
   time credit (per CPA-pending escheatment posture). Texas escheatment is
   statutorily not disclaimable — we won't try. The question: is the
   expiration-disclaimer language enforceable, and what wording would you
   prefer?

3. **Member agreement e-signature sufficiency under TUETA** (ADR-0009).
   Our default flow: member checks box, types name, server records the agreement
   text hash + UTC timestamp + IP. Is this e-signature posture sufficient under
   the Texas Uniform Electronic Transactions Act, or do you require notarization
   (Notarize.com or equivalent)? AML / BSA — do you require us to retain ID
   document images longer than 30 days?

We can ship the build using the defaults above; counsel confirmation is the
gate to launch. Happy to send the full ADRs if useful.
```

**What to send me when done:**

- Counsel's verdicts on each of the 3 questions
- Any preferred wording changes for the member agreement

**Blocks:** ADR-0009 (KYC/e-sign), ADR-0011 (time-bank), ADR-0012 (tournament). All have working defaults — counsel confirmation is final, not blocking.

---

### 3. CPA — Texas escheatment posture (ADR-0011)

Stored-value wallets in TX may trigger Texas Property Code Chapter 72 (unclaimed property). Goes to your existing CPA — same one who'll handle the LLC's books.

**Subject:** `Question on TX unclaimed-property posture for prepaid time-bank`

**Body — copy verbatim:**

```
We're launching a private social poker club. Members will prepay into a
"time-bank" wallet (e.g., $200 buys $300 of credit), redeemable as table time
at $12/hour. Money values stored in Postgres in cents; time stored in minutes.

Our default policy:
- No expiration on purchased credit
- 18-month expiration on promo-bonus credit
- Dormancy notice at 18 months of zero activity
- Conversion to non-refundable promo credit at 36 months

Question: does this posture comply with TX unclaimed-property law (Property
Code Chapter 72)? Does the time-bank qualify under the gift-card exemption,
or do we need to escheat dormant balances to the State Comptroller? Are there
reporting obligations we should plan for?

Happy to share the relevant ADR (0011) if useful.
```

**What to send me when done:**

- CPA's posture: gift-card-exempt vs. escheatable
- If escheatable: dormancy threshold and reporting cadence
- Any ledger-schema implications (we already support `expires_at` per row)

**Blocks:** ADR-0011 launch. Default schema works either way — CPA decides the policy constants.

---

### 4. Resend account + DNS records (ADR-0025 email side)

Resend is the transactional email provider. Independent of A2P 10DLC. ~30 minutes of work.

**What to do:**

1. Sign up at https://resend.com (free tier ~3000 emails/month is enough for the pilot)
2. Add domain `membersonlypokerclub.com` (or whichever you want as `From:`)
3. Resend will give you 3 DNS records to add (SPF TXT, DKIM CNAME, DMARC TXT) — paste these into your domain registrar's DNS panel
4. Wait for verification (usually < 1 hour)

**What to send me when done:**

- Resend API key
- The verified `From:` domain (we'll use `noreply@<that domain>` for transactional, `members@<that domain>` for reply-to)

**Blocks:** ADR-0025 email work (Slice 2 onward — receipts, dunning, password reset).

---

### 5. Stripe account + product setup (ADR-0010, chains to 0011/0012)

The single biggest unlock. ~1 hour to set up + waiting on owner pricing decisions (see #6).

**What to do:**

1. Create a **Stripe account** at https://dashboard.stripe.com/register (use the LLC's name + EIN)
2. Activate the account (verify EIN, bank account for payouts)
3. Once activated, create the products listed in #6 below
4. Configure webhooks to point at:
   - `https://membersonlypoker.com/api/webhooks/stripe` (production — we'll wire this in Slice 2)
   - For now, a placeholder; we'll regenerate signing secret per env

**What to send me when done:**

- **Test-mode** publishable + secret keys (for `.env.local` and Vercel preview)
- **Live-mode** publishable + secret keys (for Vercel production — we'll lock these into Vercel env, not commit)
- Webhook signing secret (test + live)

**Blocks:** ADR-0010 (membership), ADR-0011 (time-bank checkout), ADR-0012 (tournament entry-fee Stripe flow). All three of those Slice 2/3 ADRs need Stripe.

---

## ⚪ Owner pricing decisions (one Slack-style answer per question)

These are pure decisions — no external party. Pick a default per item; we can change later, but I need a v1 starting position to write the code against.

### 6. Membership pricing (ADR-0010)

Defaults are in the ADR; questions are about *additions*:

| Question | Default v1 | What I need from you |
|---|---|---|
| Monthly autopay rate | $25/mo | confirm or override |
| Monthly invoice rate | $30/mo | confirm or override |
| **Annual prepay SKU?** | NOT shipped (monthly only) | yes/no — if yes, what price? Common is "11 months for the price of 12" = $275/yr autopay |
| **Founding-member charter rate?** | NOT shipped | yes/no — if yes, what rate, how many seats, how long does the rate hold (forever, 1 year, 2 years)? |
| **Family / spousal tier?** | DEFERRED post-launch | confirm OK to defer |

### 7. Time-bank pricing (ADR-0011)

| Question | Default v1 | What I need from you |
|---|---|---|
| Hourly rate | $12/hr | confirm or override |
| Top-up tiers | $50, $100, **$200 (gets $300)**, $500 | confirm or override |
| Refund-on-cancellation | 5% restocking fee, manager-approved | confirm or override |

### 8. Tournament policies (ADR-0012)

| Question | Default v1 | What I need from you |
|---|---|---|
| **No-show penalty?** | TBD (no penalty) | charge no-show? warn? ban after N? |
| Cancellation cutoff | 1 hour before start | confirm or override |
| Refund on legitimate cancel | automatic Stripe refund | confirm |

---

## 🟣 Owner-scheduled call (no email, calendar)

### 9. PokerAtlas discovery call (ADR-0013)

Slice 5. Lowest priority — we ship v1 with manual cashier reconciliation between our system and TableCaptain. The call decides if a future bridge is possible.

**Who to contact:** PokerAtlas sales (their Zendesk, contact form on https://www.pokeratlas.com/, or whoever sold you the TableCaptain hardware).

**Questions to ask** (also in ADR-0013):

1. Do you offer an API to partners?
2. Do you offer webhook delivery on player events (signed in / signed out / time consumed)?
3. Do you offer a database read-replica or scheduled CSV exports?
4. Do you have a POS integration kit?

**What to send me when done:** call notes / their answer to those four questions.

**Blocks:** ADR-0013 only. Doesn't block launch — manual reconciliation is the v1 default.

---

## Sequencing (parallelize aggressively)

```
WEEK 1 (calendar today)
├─ A2P 10DLC submission (#1) — clock starts
├─ Email counsel (#2)
├─ Email CPA (#3)
├─ Resend signup + DNS (#4)
├─ Stripe signup (#5)
├─ Pricing decisions (#6, #7, #8) — answer in this doc, paste back
└─ PokerAtlas call schedule (#9)

WEEK 1–2 (responses arrive, mostly parallel)
├─ Resend verified → email work begins (Slice 2)
├─ Stripe activated + keys arrive → membership + time-bank + tournament code begins (Slice 2 + 3)
├─ CPA + counsel verdicts arrive → policy constants confirmed
└─ PokerAtlas call → bridge vs. manual decision

WEEK 2–6 (clock continues)
└─ A2P 10DLC clears → SMS code can ship

WEEK 1–WEEK N (in parallel as keys arrive)
└─ Conductor cycles through Slice 2 + 3 ADRs:
     0009 → 0010 → 0025-email → 0011 → 0012 → 0025-sms (when 10DLC clears)
```

## What you DON'T need to do

- **Domain registration:** ADR-0001 says owner to confirm `membersonlypoker.com`. If it's not yet bought, buy it; if it is, no action.
- **Vercel / Supabase accounts:** already set up.
- **Sentry / PostHog accounts:** already set up.
- **Branch protection / repo settings:** already in place.

## Estimated unblock-to-launch timeline (from when external items clear)

- Slice 2 (auth + identity + membership + email): **~3 weeks of conductor cycles** (4 ADRs, ~1 PR each)
- Slice 3 (time-bank + cashier + tournament reg): **~2 weeks of conductor cycles** (3 ADRs)
- Slice 5 (PokerAtlas bridge OR manual reconcile UI): **~1 week** depending on discovery outcome
- A2P 10DLC clearance is the long pole if it slips — gate Slice 3 SMS reminders behind it but don't block Slice 3 itself

**Total:** if all external items clear in week 1–2, launch-ready in **~6–8 weeks of build time**. If A2P 10DLC takes the full 6 weeks, SMS ships behind launch.
