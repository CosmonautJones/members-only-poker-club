# Site audit — `membersonlypokersocial.com` — 2026-05-15

Live-site walkthrough on desktop (1440×900) and mobile (390×844, iPhone 14 Pro) via Playwright. DNS cutover just completed; SSL valid; Vercel deploy healthy. Below is what needs work before this is ready to share with prospective members.

**Screenshots are saved locally at** `.playwright-mcp/screenshots-2026-05-15/` (gitignored). 11 desktop captures + 4 mobile.

## Severity legend

- **P0 — Blocker.** Visitor hits a dead end, a broken page, or can't reach key parts of the site. Fix before any soft-launch.
- **P1 — Polish.** Visible quality gap; site looks unfinished but functions.
- **P2 — Nit.** Small consistency issues a careful reader will notice.

---

## P0 — Blockers

### 1. Four marketing pages are "Under construction" stubs

Every one of these is one click from the homepage hero:

| Route          | Linked from                                                          | File                                    |
|----------------|----------------------------------------------------------------------|-----------------------------------------|
| `/membership`  | Hero "Apply for Membership" CTA, nav, footer — **most-clicked path** | `app/(marketing)/membership/page.tsx`   |
| `/club`        | "Tour The Club" CTA, footer "The Room/House Rules/Dress Code"        | `app/(marketing)/club/page.tsx`         |
| `/games`       | "Tonight's Games" CTA, nav — has 3 lines of static tournament names  | `app/(marketing)/games/page.tsx`        |
| `/terms`       | Footer Policies                                                      | `app/(marketing)/terms/page.tsx`        |

**Worst funnel break:** the prominent "Apply for Membership" button on the hero goes to `/membership` (stub), not `/signup`. The secondary "Apply for Membership" button further down DOES go to `/signup`. Pick one destination and use it consistently — recommended target is `/signup` for both, with `/membership` becoming a pricing/explainer page once content exists.

### 2. `/login` is unstyled

`app/(auth)/login/page.tsx` renders bare HTML — no `className` on the form, inline labels, no spacing, no card layout. Looks like a 1996 demo. By contrast `/signup` is fully styled. Functional, but visually broken.

**Fix:** mirror `app/(auth)/signup/page.tsx`'s structure — wrap in the same auth card, use the same label + input classes, add the gold CREATE-ACCOUNT-style primary button.

### 3. No mobile navigation

`components/marketing/public-header.tsx` uses inline-flex with no responsive variants (zero `md:` breakpoint refs, zero `@media` rules in the inline `style` prop). On mobile (390px), only the logo and `Apply` button are visible — the 5 nav links (Home / The Club / Games / Membership / Find Us) and Member Sign In get clipped off-screen with no hamburger menu replacement.

**Impact:** mobile users cannot reach login, the club page, games, or anything else from the header. They can only get there via the footer.

**Fix:** add a hamburger button at `md:hidden`, hide the nav-link row at `md:flex`, render a slide-down drawer on click. Radix Dialog or a simple disclosure pattern works.

---

## P1 — Polish

### 4. Privacy policy renders as a wall of text

`/privacy` shows the just-shipped 9-section content with no visible heading hierarchy — `<h2>`s look identical to body paragraphs. Root cause:

- `tailwind.config.ts` does NOT include `@tailwindcss/typography` plugin
- `app/(marketing)/privacy/page.tsx` applies `className="prose"` expecting plugin styles
- The class has zero effect; the policy reads as one solid paragraph

**Fix options:**
- **A (recommended):** `pnpm add -D @tailwindcss/typography`, add to `tailwind.config.ts` plugins array. Five minute change. Restores intended typography across all `.prose`-using pages.
- **B:** rewrite `lib/legal/privacy-policy.tsx` to apply explicit Tailwind classes on each `<h2>` (`text-2xl font-semibold mt-8 mb-3` etc) — mirrors what `/accessibility` does today.

### 5. Cookie banner overlaps the hero on first paint

The default-deny banner sits over the right edge of the hero, partially covering "A chair waiting for you." It's functional but reduces hero impact for first-time visitors.

**File:** `components/site/cookie-banner.tsx`

**Fix options:** narrow `max-width`, push it lower (`bottom-8` → `bottom-2`), or delay the entry animation (`animate-in delay-1000`) so the hero gets a clean first second.

### 6. `/contact` is missing the hours

Footer "Hours" link points to `/contact`, but `/contact` only shows the address (16525 North Fwy, Houston, TX 77090). The hours table lives only on the home page.

**Fix:** copy the hours block to `/contact`, OR change the footer link to `/#hours`.

### 7. Auth pages use a stripped-down "Poker Club" header

`/signup` and `/login` show plain white "Poker Club" text in the corner instead of the branded `POKER ♦ Social Club` chip + wordmark used everywhere else.

**File:** `app/(auth)/layout.tsx`

**Fix:** import `<Chip />` and `<Wordmark />` from `components/marketing/primitives` and use the same layout the public header uses.

---

## P2 — Nits

### 8. 404 on `/favicon.ico`

No `app/favicon.ico` or `app/icon.tsx` exists. Browsers and Google's crawler keep requesting it.

**Fix:** drop a favicon file in `app/`, or generate one with Next 14's `app/icon.tsx` pattern.

### 9. Brand naming inconsistency on `/contact`

The h1 on `/contact` is "Members Only Poker Social Club" in plain serif — doesn't match the stylized `POKER ♦ Social Club` brand mark used in the header/footer. Either use the brand mark component or accept that the contact h1 is plain text, but pick one.

### 10. Signup/login `<title>` is generic

Both pages have `<title>Members Only Poker Social Club</title>` instead of `Sign in | ...` or `Apply for Membership | ...`. Minor SEO + tab-clutter issue.

---

## What looks good (don't break this)

- **Brand identity is strong.** Dark + cream + gold palette consistent, serif/sans pairing intentional, chip mark works.
- Home page hero, live ticker, "Built for the people at the table," and hours sections all render well on both viewports.
- `/accessibility` is correctly built — good prose, real content, working contact email — this is the template the other static pages should follow.
- `/signup` form is mobile-friendly and visually consistent.
- DNS / SSL / Vercel deployment is correct — `server: Vercel`, valid cert, no mixed-content warnings.
- Footer stacks cleanly on mobile.
- Cookie consent flow is intact and the recently-shipped `/api/privacy/*` endpoints are reachable (not tested end-to-end here but route bundle exists in production build).

---

## Recommended fix order

Roughly cheapest-impact-first. Items 1–4 are all P0/P1 code fixes that don't need owner content input.

1. **Unify the hero CTA destination.** Change `/membership` link in the hero to `/signup`. 5 min.
2. **Mobile hamburger menu.** Biggest UX gap right now. ~1–2 hr.
3. **Login page styling.** Mirror `/signup` structure. ~30 min.
4. **Install `@tailwindcss/typography`.** Makes `/privacy` readable. ~5 min config + verify tests pass.
5. **Content for `/membership`, `/club`, `/games`, `/terms`** — owner-track or AI-assisted copy work.
6. **Cookie banner positioning, `/contact` hours, auth header brand mark, favicon, page titles.** Mop-up batch — could be a single ~30 min PR.

## File pointer cheat sheet (for the next agent)

| Issue                 | File                                              |
|-----------------------|---------------------------------------------------|
| Hero CTA target       | `app/(marketing)/page.tsx` (home), check the hero `<Link href="/membership">` |
| Mobile nav            | `components/marketing/public-header.tsx`          |
| Login styling         | `app/(auth)/login/page.tsx`, `app/(auth)/layout.tsx` |
| Tailwind typography   | `tailwind.config.ts` (plugins array)              |
| Cookie banner overlap | `components/site/cookie-banner.tsx`               |
| Contact hours         | `app/(marketing)/contact/page.tsx`                |
| Auth header brand     | `app/(auth)/layout.tsx`                           |
| Favicon               | `app/icon.tsx` (create) or `app/favicon.ico` (drop) |
| Stub pages content    | `app/(marketing)/{membership,club,games,terms}/page.tsx` |
| Page titles           | `app/(auth)/{login,signup}/page.tsx` — `export const metadata` |

## Notes for follow-up sessions

- Live URL: <https://www.membersonlypokersocial.com>
- DNS managed at Squarespace, app on Vercel — see `~/.claude/projects/.../memory/project_squarespace_domain.md`
- Email is Google Workspace, MX/SPF/DKIM records on this domain are untouchable
- `NEXT_PUBLIC_APP_URL` env var in Vercel may need to be set to `https://membersonlypokersocial.com` if not already; code fallbacks in `app/sitemap.ts`, `app/robots.ts`, `app/layout.tsx` still point at the old `membersonlypoker.com` and should be updated in a small PR.
