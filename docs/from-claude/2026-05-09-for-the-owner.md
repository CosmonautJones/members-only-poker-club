# Members Only Poker Club — what we need from you to launch

**Where we are:** the marketing website is built. The behind-the-scenes plumbing is built. To turn it into a working club system — where members sign up, pay, buy table time, and register for tournaments — we need a handful of accounts, decisions, and a couple of professional sign-offs. Everything below can be done in parallel; many take 30 minutes or less.

**The one thing that's time-sensitive** is the SMS carrier registration (item #1). It takes 2–6 weeks just for the cell carriers to approve us, and we can't send a single text message until they do. Please start that today even though we won't actually be texting anyone for another month or two.

---

## 1. SMS carrier registration (start today — paperwork takes weeks)

**What it is:** before any business in the U.S. can text members from a regular phone number, the cell carriers (AT&T, Verizon, T-Mobile) require us to register with them — name of the business, what kinds of texts we'll send, sample messages. It's bureaucratic but mandatory. Without it, our texts get blocked.

**What we'll use it for:** payment receipts, tournament reminders ("your tournament starts in an hour"), low-balance alerts on time-bank wallets.

**What I need you to do:**
- Sign up for a Twilio account (Twilio is the company we'll use to send the texts)
- Buy one Texas-area-code phone number through them (about $2/month)
- Fill out their "10DLC" registration form using the LLC's legal name and EIN

I've written out the exact answers for the registration form in `docs/from-claude/2026-05-09-blockers-brief.md` — Travis can walk you through it.

**What I need back from you:** the account credentials and the new phone number, once approved.

**Time:** 1 hour to submit. 2–6 weeks for carrier approval (they review on their schedule).

---

## 2. Lawyer questions (one short email — about an hour of their time)

**What it is:** three Texas-specific legal questions that need a lawyer's confirmation before launch. We've designed everything to follow the law as we understand it, but we need a Texas attorney to put their name on it.

**The three questions, in plain language:**

1. **Tournament fees.** Texas private clubs are not allowed to take a "rake" (a cut of pots). We're structuring tournament entry as: 100% of the buy-in goes to the prize pool, and we charge a separate "seat fee" for use of the table and dealer. We need a lawyer to confirm this structure is legal.

2. **Time-bank expiration.** When a member prepays $200 for $300 of table time, can the agreement say that time credit doesn't expire? We want to put that language in the member agreement, but we need a lawyer to confirm it's enforceable in Texas.

3. **Online signature.** When a member signs the membership agreement online (checks a box, types their name), is that enough under Texas law? Or do we need them to do something more formal like notarization? Same lawyer can also tell us how long we have to keep their ID photo on file.

**What I need you to do:** find a Texas attorney with experience in private membership clubs or gaming law and forward them the email I've drafted (it's in `docs/from-claude/2026-05-09-blockers-brief.md`, under section #2 — Travis can pull it for you). Should be one billable hour.

**What I need back:** their answers to the three questions.

**Time:** depends on the lawyer's calendar; typically a few days to a week.

**Important:** we can ship the build with our best-guess defaults while we wait. The lawyer's answers are the final sign-off, not a blocker.

---

## 3. CPA question (one short email)

**What it is:** when members prepay into a "time-bank" wallet (like a gift card balance, but for table time), Texas has an unclaimed-property law that may apply if the balance sits unused for years. We need our CPA to tell us how to handle that.

**What I need you to do:** forward the email I've drafted to the CPA who'll handle the LLC's books. The email is in `docs/from-claude/2026-05-09-blockers-brief.md`, section #3.

**What I need back:** the CPA's answer on (1) whether stored time-bank balances qualify as gift cards (which are exempt) or as unclaimed property (which we'd have to report to the State Comptroller after a few years), and (2) how long balances need to sit unused before triggering anything.

**Time:** typically a few days.

**Important:** like the lawyer, we can ship the build using a sensible default. CPA confirmation is the final sign-off.

---

## 4. Email service signup (about 30 minutes)

**What it is:** an account with Resend — the service that sends transactional emails (payment receipts, password resets, dunning notices for failed payments).

**What I need you to do:**
- Sign up at https://resend.com (free for our volume)
- Add the club's domain (probably `membersonlypokerclub.com`) and paste 3 records into the domain's DNS settings — they give you the exact text to paste

**What I need back:** the API key Resend generates, and confirmation that the domain shows "verified" in their dashboard.

**Time:** 30 minutes setup, under an hour for DNS to propagate.

---

## 5. Stripe signup (about 1 hour, plus pricing decisions in #6)

**What it is:** Stripe is the payment processor. They handle the actual credit-card charges, monthly subscription billing, refunds, and the receipts. They're the industry standard — practically every modern business uses them.

**What I need you to do:**
- Create a Stripe account at https://dashboard.stripe.com/register using the LLC's name and EIN
- Activate the account by verifying the EIN and connecting the LLC's bank account (where Stripe will deposit the money)
- Once activated, set up the membership and time-bank "products" in their dashboard — we have a list of exactly what to create, depending on your answers in #6 below

**What I need back:** their API keys (Stripe gives you both a "test" and a "live" key — we need both) and the webhook signing secret.

**Time:** 1 hour to set up. EIN verification is usually instant; bank verification takes 1–2 business days.

---

## 6. Pricing decisions (just answer these — no one else needed)

These are decisions only you can make. Pick a starting answer; we can change any of them later. I just need a position to build the v1 against.

### Membership

| Question | What we have planned for v1 | Your call |
|---|---|---|
| Monthly autopay rate | $25/month | confirm or change |
| Monthly invoice rate | $30/month | confirm or change |
| **Should we offer an annual prepay option?** | Not in v1 — monthly only | Yes/no. If yes, common pattern is "11 months for the price of 12" = $275/year on autopay. |
| **Founding-member charter rate?** | Not in v1 | Yes/no. If yes — what rate, how many seats, and does it lock in forever or for a set period? |
| **Family / spousal memberships?** | Deferred to after launch | Confirm OK to defer |

### Time-bank (table time)

| Question | What we have planned for v1 | Your call |
|---|---|---|
| Hourly rate | $12/hour | confirm or change |
| Top-up tiers | $50, $100, **$200 (gets $300 of credit)**, $500 | confirm or change |
| Refund on cancellation | 5% restocking fee, requires manager approval | confirm or change |

### Tournaments

| Question | What we have planned for v1 | Your call |
|---|---|---|
| **No-show penalty?** | Not decided | Charge a fee? Just warn them? Ban after N no-shows? |
| Cancellation cutoff | 1 hour before start | confirm or change |
| Refund on legitimate cancellation | Automatic | confirm |

---

## 7. PokerAtlas discovery call (lowest priority — doesn't block launch)

**What it is:** PokerAtlas / TableCaptain (the in-room software running the tables) may or may not let outside systems integrate with it. Most software companies offer this; PokerAtlas's documentation doesn't say one way or the other. We'd like to know.

**Why it matters:** if they offer integration, our online system can automatically deduct table time from a member's wallet when they sit down at a table — no cashier work needed. If they don't, the cashier handles it manually at the desk (which works fine, just more clicks).

**What I need you to do:** schedule a call with PokerAtlas — try their sales contact or the rep who sold you the TableCaptain hardware. Four questions to ask them:

1. Do you offer an API for partners?
2. Can you send us a notification (a "webhook") when a player signs in or signs out at a table?
3. Can you give us read-only access to your database, or scheduled CSV exports?
4. Do you have a "POS integration kit"?

**What I need back:** their answers to those four questions, or just a forwarded email if they reply in writing.

**Time:** 30-minute call, schedule whenever convenient.

**Important:** if the answer is "no, we don't offer that," we proceed with manual cashier reconciliation in v1. The call is information-gathering, not a blocker.

---

## What you DON'T need to do

- The website is already live (deployed and tested)
- All the foundational decisions are documented and signed off
- The error monitoring, analytics, security, and ops tooling are all already running
- The server hosting (Vercel) and database (Supabase) accounts are already set up
- The membership agreement document you sent us is already in the system, ready to go

---

## How long until we launch (after all the above is in motion)

- **Items #1, #4, #5** are accounts and forms. As soon as they're done, we can start coding the parts that need them.
- **Items #2, #3** can run in parallel — we'll build to our defaults and update if the lawyer/CPA send back changes.
- **Item #6** is pure decisions — answer them in this document and you're done.
- **Item #7** is a 30-minute call.

If everything starts within a week:
- **Account creation + decisions:** week 1
- **Member signup, identity verification, membership billing:** weeks 2–4
- **Time-bank purchases, cashier console, tournament registration:** weeks 5–6
- **SMS reminders:** clears whenever the carrier registration finishes (sometime weeks 3–7)

**Realistic launch window:** 6 to 8 weeks from the day the accounts and decisions are done.

---

**Questions on any of this:** reach out to Travis, or just leave notes in this document and he'll see them.
