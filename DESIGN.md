# ISKBets — Design System

Wall Street × WallStreetBets. Financial-terminal seriousness undercut by
absurdity. This document is the source of truth for the visual system: tokens,
type, spacing, the card, hierarchy, motion, and voice.

> The rule that overrides all others: **keep the joke, systematise the light,
> let one thing be loud at a time.** Emoji are load-bearing, not decoration.
> Don't drift toward generic dark-mode SaaS.

Tokens live in [`app/globals.css`](app/globals.css) `:root`. Layout uses Tailwind
utilities; everything visual (color, glow, type, spacing) resolves through the
tokens below — no raw hex in components.

---

## 1. Color

One green-cooled neutral for surfaces, a four-step text ramp, two brand accents,
and a diverging mood scale. Elevation is **one surface step lighter — never a new
hue**.

### Surfaces & borders
| Token | Value | Use |
| --- | --- | --- |
| `--surface-0` | `#080b0a` | page background |
| `--surface-1` | `#0d1110` | cards, panels |
| `--surface-2` | `#181d1b` | raised / featured surfaces |
| `--border` | `#252e2a` | default hairline |
| `--border-strong` | `#37433d` | hover / raised borders |

### Text (all AA on `--surface-1`)
| Token | Value | Use |
| --- | --- | --- |
| `--text-0` | `#d7e6dd` | primary — names, prices |
| `--text-1` | `#a9b8b0` | body / analyst commentary |
| `--text-2` | `#7c8a83` | tickers, labels, meta |
| `--text-3` | `#43514a` | disabled / faint / empty-state prose |

### Accents
| Token | Value | Use |
| --- | --- | --- |
| `--gold` | `#f5c842` | structure, dateline, the `$`, neutral pivot |
| `--interactive` | `#00e676` | links & active states **only** — not decoration |

> **Do not** reintroduce the legacy `rgba(0,255,65)` / `#00ff41` green or the
> `#c5d3c9` one-off. Both were removed in the token migration; there is exactly
> one green (`--interactive`) and body text is `--text-1`.

### The mood family (diverging scale)

The six mood states are **one perceptually-even OKLCH ramp**, not six unrelated
colors — so hue encodes direction and lightness/chroma encode magnitude.
Mid-negative is **orange caution**, not red, so a −1% wobble never looks like a
−6% bloodbath.

| Token | OKLCH | Hex | Band | Emoji |
| --- | --- | --- | --- | --- |
| `--mood-moon` | `oklch(.86 .19 158)` | `#33f5a0` | `> +5%` | 🚀 |
| `--mood-bullish`¹ | `oklch(.80 .17 156)` | `#45dd8e` | `+2–5%` | 📈 |
| `--mood-up` | `oklch(.74 .13 160)` | `#53c48e` | `+0.5–2%` | 💎 |
| `--mood-neutral` | `oklch(.82 .13 92)` | `#e2c157` | `±0.5%` | 😐 |
| `--mood-down` | `oklch(.72 .15 55)` | `#eb883b` | `−0.5–2%` | ⚠️ |
| `--mood-rekt` | `oklch(.63 .20 28)` | `#e9483d` | `−2–5%` | 📉 |
| `--mood-liquidated` | `oklch(.50 .19 22)` | `#b7162d` | `< −5%` | 💀 |

¹ `--mood-bullish` is an optional intermediate; `deriveSentiment()` in
[`lib/derive.ts`](lib/derive.ts) collapses to five tiers (`moon / up / neutral /
down / rekt`). Keep the badge labels (`deriveRating`) and the color tiers driven
by the **same thresholds** so a badge and its glow never disagree.

**Contrast rule:** `--mood-neutral` and `--mood-down` fail AA as small body text
on dark. Use mood colors for borders / spines / fills; render actual glyphs in a
`--text-*` token or a darkened `color-mix` when the color must carry text.

### Glow / elevation (the token that used to be missing)

Glow is a **token, not a per-card literal**. Three elevations:

- `--elev-0` — flat grid card: `--border`, no shadow.
- `--elev-1` — featured / raised: `--surface-2`, `--border-strong`, ambient drop
  `0 8px 24px rgba(0,0,0,.5)`.
- `--glow-mood` — state accent: `0 0 24px color-mix(in oklch, var(--mood) 30%, transparent)`.

---

## 2. Typography

Two families, one ratio. **Bebas Neue** = display; **Share Tech Mono** = data +
body. Letter-spacing is assigned by **role**, not by feel.

| Role | Family | Size | Tracking |
| --- | --- | --- | --- |
| Display | Bebas Neue | 64px | 0.04em |
| Title | Bebas Neue | 32px | 0.04em |
| Card name | Bebas Neue | 24px | 0.04em |
| Data-lg (price) | Share Tech Mono | 21px | 0 |
| Body / commentary | Share Tech Mono | 15px | 0.02em |
| Label / meta | Share Tech Mono | 11px | 0.18em, uppercase |

Scale is ~1.25. Don't invent per-component sizes; pick the nearest role.
Letter-spacing: display 0.04em · data 0 · labels 0.18em. That's the whole rule.

---

## 3. Spacing

One 4px base. No parallel rem/utility systems — everything snaps to the scale.

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`

Common assignments: inner rows `8`, card padding `12`, grid gap `16`, section
pad-x `24`, section gap `48`. Use Tailwind's spacing utilities that map to these;
don't hand-roll `0.85rem`-style one-offs inside components.

---

## 4. The stock card

The atom of the site. Structure: **header** (name + ticker, mood chip) →
**price row** (price, currency, change) → **divided info strip** (commentary or
derived line) → optional meta.

- Mood color rides a **3px left spine + a chip**. The chip fills **solid only at
  the extremes** (`moon`, `liquidated`); mild tiers use a tinted/outlined chip so
  loud states actually feel loud.
- Sentiment glow (`--glow-mood`) is reserved for featured / high-magnitude cards.
  Not every card glows, or nothing leads.

### Empty state is a first-class variant

A card with no AI commentary must **not** just render shorter. Rich and empty
share the same skeleton and near-identical height. The empty variant swaps the
quote for a mood-tinted derived line (e.g. the `fromGlory` meta or a
`// no take today` stub in `--text-3`). See
[`components/StockCard.tsx`](components/StockCard.tsx) — the `analysis?.comment`
branch always has an `else`.

---

## 5. Page hierarchy

Above the fold, **one thing leads**. The descent:

1. **The daily brief** is the hero — the one human-readable sentence, in its own
   block, not buried inside the mood-banner glow.
2. **Featured pair** is asymmetric: winner leads, loser supports. No infinite
   pulse.
3. **Sort control** demotes to a quiet row.

Ticker tape and masthead recede to **ambient** contrast so the brief + featured
win. If everything glows, nothing reads.

---

## 6. Motion

- Featured cards glow **one-shot on data change** (reuse the `.ai-update`
  pattern) — never `infinite`.
- Bloodbath / clean-sweep washes, the mood strip, and all recent additions
  **must** have a `prefers-reduced-motion` branch.
- **Exception:** the ticker tape marquee runs regardless of reduced-motion by
  design — it's core identity, and tap-to-pause is its escape hatch. Don't add a
  reduced-motion override to it.

---

## 7. Day-mood skins

When `detectSweep()` reports a true sweep of eligible stocks, `<main>` carries
`data-daymood="bloodbath" | "clean-sweep"` and the whole terminal reskins
(desaturate the off-direction, low color wash below the scanline layer, copy
leans into gallows humor / tendies). Require a real sweep — never a partial-red
day. Keep price text AA-readable through the wash; test with the mobile vignette
off.

---

## 8. Iconography

The favicon/app icon is the masthead's gold `$` on the terminal tile (gradient +
green hairline border + scanlines). One mark, every size. Assets + Next.js
placement in [`icon-output/README.md`](icon-output/README.md). The legacy
💎+🚀 diamond-rocket is retired from the icon slot (illegible < 32px) and
reserved for the boot sequence / OG-image accent.

---

## 9. Voice

Financial-terminal register, WSB punchline. "The People's Terminal." Rating
labels (`TO THE MOON`, `DIAMOND HANDS`, `TURBULENCE`, `GET REKT`,
`LIQUIDATED`) and sort chips (`MAX CHAOS`, `FAT STACKS`, `OUR BAGS`) carry the
tone. Emoji are meaning, not garnish — remove one and a rating loses information.
Data is cached / scheduled, **not** real-time: never imply live streaming.
Always land on **not financial advice 🦍**.

---

## 10. Contributing checklist

- [ ] No raw hex / rgba in components — use a token.
- [ ] Any mood color used as text passes AA (or moves to a `--text-*` glyph).
- [ ] New animations have a `prefers-reduced-motion` branch (tape excepted).
- [ ] New card-like surfaces ship a designed empty state, not a fall-through.
- [ ] Type uses a named role; spacing snaps to the 4px scale.
- [ ] It still works at 320px wide.
- [ ] It's funnier, not just bigger.
