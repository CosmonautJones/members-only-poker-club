# Design System

Brand tokens, typography, and component primitives. Lifted from `_design/brand.css` and `_design/primitives.jsx` and made the source-of-truth for the Tailwind config (`tailwind.config.ts`) once the scaffold lands.

> **Aesthetic:** Private gentlemen's club × Vegas high-stakes room. Deep matte black, brushed metallic gold, warm ivory. Restrained. Cinematic. Never cheerful.

---

## Color palette

### Ink — primary surface (matte black, never `#000`)

| Token | Hex | Use |
|---|---|---|
| `ink-900` | `#0B0B0B` | primary surface (body bg) |
| `ink-850` | `#121110` | panel |
| `ink-800` | `#1A1816` | card |
| `ink-750` | `#221F1B` | card hover |
| `ink-700` | `#2B2722` | divider strong |
| `ink-600` | `#3A342C` | divider faint |
| `ink-500` | `#524A3F` | muted ink |

### Gold — metallic, brushed

| Token | Hex | Use |
|---|---|---|
| `gold-100` | `#F8E6B6` | highlight |
| `gold-200` | `#F4D27A` | light gold (button text) |
| `gold-300` | `#E5BA63` | mid gold (links, focused state) |
| `gold-400` | `#C9A24A` | **primary gold** (borders, accents) |
| `gold-500` | `#A8842F` | deep gold |
| `gold-600` | `#6E5520` | shadow gold |

**Gradients:**

- `--gold-grad`: `linear-gradient(135deg, #F4D27A 0%, #E5BA63 35%, #C9A24A 60%, #A8842F 100%)` — primary button fill, gold-text effect
- `--gold-grad-soft`: `linear-gradient(180deg, #F4D27A 0%, #C9A24A 100%)`
- `--gold-grad-brushed`: `linear-gradient(180deg, #C9A24A 0%, #F4D27A 30%, #C9A24A 50%, #A8842F 100%)` — used by `.gold-text` for the brushed-metal effect

### Ivory — warm off-white text

| Token | Hex | Use |
|---|---|---|
| `ivory-100` | `#FBF7EE` | brightest |
| `ivory-200` | `#F4EDE0` | **primary text on dark** |
| `ivory-300` | `#E8DFCC` | secondary text |
| `ivory-400` | `#C9BFA9` | tertiary text |
| `ivory-500` | `#8C8470` | muted text on dark |

### Accent

| Token | Hex | Use |
|---|---|---|
| `crimson` | `#B43A2E` | hearts/diamonds, danger |
| `crimson-light` | `#D6584C` | hover crimson |
| `felt-green` | `#1F3A2E` | poker felt deep |
| `felt-green-2` | `#2A4A3C` | poker felt light |

### Semantic

| Semantic | Token |
|---|---|
| `bg` | `ink-900` |
| `bg-panel` | `ink-850` |
| `bg-card` | `ink-800` |
| `bg-card-hover` | `ink-750` |
| `bg-elevated` | `#16140F` |
| `text` | `ivory-200` |
| `text-muted` | `ivory-500` |
| `text-dim` | `#6B6356` |
| `border` | `rgba(201, 162, 74, 0.18)` (gold @ 18%) |
| `border-strong` | `rgba(201, 162, 74, 0.35)` |
| `border-faint` | `rgba(244, 237, 224, 0.06)` |
| `success` | `#6F9E6F` |
| `warning` | `gold-400` |
| `danger` | `crimson` |

---

## Typography

| Token | Stack | Use |
|---|---|---|
| `font-display` | `"Cormorant Garamond", "Cormorant SC", "Trajan Pro", Georgia, serif` | Headlines, hero, brand-heavy moments |
| `font-serif` | `"Cormorant Garamond", Georgia, serif` | Long-form serif |
| `font-sans` | `"Inter", -apple-system, "Söhne", system-ui, sans-serif` | UI body, buttons, labels |
| `font-mono` | `"JetBrains Mono", ui-monospace, monospace` | Hours, blinds, ticker, tabular data |

### Scale

| Token | px |
|---|---|
| `t-xs` | 11 |
| `t-sm` | 12 |
| `t-base` | 14 |
| `t-md` | 15 |
| `t-lg` | 17 |
| `t-xl` | 20 |
| `t-2xl` | 26 |
| `t-3xl` | 36 |
| `t-4xl` | 52 |
| `t-5xl` | 72 |
| `t-display` | 96 |

### Special treatments

- **`.gold-text`** — `background: var(--gold-grad-brushed)` with `-webkit-background-clip: text`. Used for brand wordmark, italic hero accents, numerals.
- **`.eyebrow`** — `t-xs`, `letter-spacing: 0.32em`, uppercase, `gold-300`. Section pre-headers.
- **`.field-label`** — `t-xs`, `letter-spacing: 0.18em`, uppercase, `gold-300`. Form labels.
- **`.section-title`** — `t-3xl`, `font-display`, italic gold spans for emphasis.

---

## Spacing — 8px grid

| Token | px |
|---|---|
| `s-1` | 4 |
| `s-2` | 8 |
| `s-3` | 12 |
| `s-4` | 16 |
| `s-5` | 20 |
| `s-6` | 24 |
| `s-8` | 32 |
| `s-10` | 40 |
| `s-12` | 48 |
| `s-16` | 64 |
| `s-20` | 80 |
| `s-24` | 96 |

---

## Radii

| Token | px | Use |
|---|---|---|
| `r-sm` | 2 | tight inputs |
| `r` | 4 | **default** (buttons, inputs) |
| `r-md` | 6 | mid |
| `r-lg` | 10 | cards |
| `r-xl` | 14 | large cards |
| `r-pill` | 999 | pills |

---

## Shadows — restrained, gold-tinted

| Token | Value |
|---|---|
| `shadow-xs` | `0 1px 0 rgba(0,0,0,0.4)` |
| `shadow-sm` | `0 2px 8px -2px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.3)` |
| `shadow-md` | `0 12px 32px -10px rgba(0,0,0,0.7), 0 2px 6px rgba(0,0,0,0.4)` |
| `shadow-lg` | `0 32px 80px -20px rgba(0,0,0,0.8), 0 4px 12px rgba(0,0,0,0.5)` |
| `gold-glow` | `0 0 0 1px rgba(201,162,74,0.5), 0 0 24px -4px rgba(201,162,74,0.4)` |
| `gold-glow-soft` | `0 0 16px -4px rgba(201,162,74,0.25)` |

---

## Motion

| Token | Value |
|---|---|
| `ease` | `cubic-bezier(0.2, 0.6, 0.2, 1)` (default) |
| `ease-press` | `cubic-bezier(0.4, 0, 0.4, 1)` (button press) |
| `dur-fast` | `140ms` |
| `dur` | `220ms` |
| `dur-slow` | `380ms` |
| `dur-cinematic` | `720ms` (hero shimmer, reveal) |

---

## Component primitives (`_design/primitives.jsx`)

Ports must preserve visual fidelity. Implementations live in `components/brand/` (brand-heavy SVG) and `components/ui/` (shadcn-extended generic primitives).

### Brand SVG primitives — port verbatim

- **`<Chip size label showLaurel />`** — the round poker chip with alternating ivory/black wedges, gold inner ring, optional laurel garland, gold-gradient center label. Hero element.
- **`<Wordmark size showSubtitle />`** — "POKER" / `♦` / "Social Club" stacked, brushed-gold text effect.
- **`<Suit kind size color />`** — `spade` | `heart` | `diamond` | `club`. Hearts/diamonds default to crimson, spades/clubs to ivory.
- **`<Laurel width opacity />`** — decorative gold laurel arch, used behind CTAs.
- **`<Icon name size stroke color />`** — Lucide-style stroked icon set (menu, x, check, user, clock, calendar, creditCard, mapPin, phone, settings, logout, plus, minus, receipt, trophy, activity, barcode, download, shield, sparkle, pause, refresh, info, alert, search, edit, flag, users, layers, chevronRight/Left/Down, arrowRight). Use `lucide-react` in production with the same names where available; recreate the few that aren't with `<svg>` paths from primitives.jsx.

### Generic primitives (already in `_design/brand.css`)

- **`.btn`** — outline, gold border, uppercase tracking, transparent fill
- **`.btn-primary`** — gold-gradient fill, ink text, shimmer-on-hover (`::before` translate)
- **`.btn-ghost`** — borderless until hover
- **`.btn-sm` / `.btn-lg`** — size variants
- **`.input`** — ink-850 fill, gold focus glow
- **`.field`** + **`.field-label`** — uppercase, gold-300 label
- **`.card`** / **`.card-bordered`** — ink-800 fill, faint or gold-tinted border
- **`.pill`** — gold-on-dark capsule
- **`.pill-live`** — green pulsing dot for "live now"
- **`.tbl`** — uppercase tracked column heads, gold-tinted hover
- **`.gold-rule`** / **`.gold-rule-short`** — hairline gold dividers
- **`.diamond-divider`** — section divider with ♦ in the middle
- **`.grain`** — film-grain SVG overlay (5% opacity, mix-blend overlay)
- **`.shimmer`** — animated gold gradient

---

## Tailwind mapping (target)

When the scaffold lands in Slice 1, `tailwind.config.ts` will:

- Set `content: ['./app/**/*.{ts,tsx,mdx}', './components/**/*.{ts,tsx}']`
- Disable Tailwind's preflight body bg (we use `--bg`)
- Define `theme.extend.colors` mirroring the tables above (e.g. `colors: { ink: { 900: '#0B0B0B', ... }, gold: { 400: '#C9A24A', ... } }`)
- Define `theme.extend.fontFamily` with `display`, `serif`, `sans`, `mono` from the typography section
- Define `theme.extend.spacing` from the 8px grid
- Define `theme.extend.borderRadius` from the radii table
- Define `theme.extend.boxShadow` for the gold-glow tokens
- Define `theme.extend.transitionTimingFunction` and `theme.extend.transitionDuration` from motion

The `.gold-text`, `.grain`, `.diamond-divider` utilities live in a single `app/globals.css` file as `@layer components` blocks — they're too-specific for Tailwind utility classes.

---

## Asset inventory

In `_design/assets/`:

- `chip-logo.png` — 2.2 MB hero chip render (SVG version pending)
- `venue-exterior.png` — 1.4 MB exterior shot, used in homepage hero
- `signage.png` — 1.4 MB members-only signage shot, used in "The House" feature section
- `poker-room-layout.png` — 1.7 MB top-down layout diagram, used in `/club`

These ship to `public/img/` at scaffold time, with `next/image` optimization (formats: AVIF, WebP). High-res masters live in `_design/`; the `public/img/` versions are downsampled for web.

---

## Accessibility

- Body text on `ink-900`: contrast ratio for `ivory-200` (`#F4EDE0`) is **15.4:1** — far above WCAG AAA (7.0:1).
- Gold text (`gold-200` `#F4D27A`) on `ink-900`: **11.6:1** — passes AAA.
- Gold-300 on ink-900: **8.7:1** — AAA.
- Gold-400 (`#C9A24A`, primary borders/accents): **5.6:1** — passes AA for normal text.
- **Risk:** brand-heavy gold-on-gold gradient text on light backgrounds (rare but present in hero `.gold-text` over images) needs a darkening overlay. The hero already applies a 50% brightness filter to `venue-exterior.png` and a vertical gradient.
- All interactive elements must have visible focus states. Gold-glow shadow on focus is the convention.
- Motion-reduced media query: respect `prefers-reduced-motion` — disable shimmer and grain for users who set it.

See [ADR-026](adr/0026-accessibility.md) for the formal a11y posture.
