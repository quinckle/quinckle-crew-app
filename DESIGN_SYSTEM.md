# QuinckleCrew — Design System

> The crew app is a **tool**, not a showcase. Waiters collect payments on the floor; cooks read tickets in the kitchen. Both jobs are legibility-critical, fast, and often one-handed under bright/variable lighting. This system optimizes for **speed, accuracy, and calm** — not flourish.

**North star: _ink on paper_.** A light, near-monochrome "pro-POS" interface. Black and white do the work; **colour is information, never decoration.** Orange and status colours appear only where they carry meaning (a primary action, a state). If everything is highlighted, nothing is.

Direction (locked): **Light · Pro ops-console · Balanced density · Distinct utilitarian** (own identity, *not* the partner app's cinematic gradient look).

---

## 1. Principles

1. **Monochrome by default.** Surfaces, text, structure, and most controls are black/grey/white. A screen should read perfectly in greyscale.
2. **Colour = signal.** Reserve saturated colour for status (paid/pending/failed) and exactly one accent for the primary action. Never colour a card just to make it "pop."
3. **Legibility over density.** Balanced density: comfortable tap targets, generous numbers, hairline structure. Money and quantities are the largest, clearest things on screen.
4. **One pattern per job.** A card is a card everywhere. A primary button looks the same on every screen. No bespoke styling per screen — that's what created today's inconsistency.
5. **Flat, not floaty.** Hierarchy comes from **hairlines, weight, and spacing** — not shadows, gradients, or glows. Shadows are a whisper, used only to lift true overlays (sheets, menus).
6. **Quiet motion.** Fast and functional (150–220ms). Nothing decorative; nothing that delays a tap.
7. **Kitchen rule.** On cook/kitchen screens, bump contrast and type size — never rely on tertiary greys for anything a cook must read across a hot line.

---

## 2. Foundations — Colour tokens

Light, warm-neutral, near-monochrome. We **keep the existing `QuinckleColors` export names** so screens migrate by value change, not rename — and add a few semantic tokens. Replace the current dark values in `constants/Colors.ts` with:

```ts
export const QuinckleColors = {
  // ── Accent (the ONE brand colour — used sparingly) ────────────────
  primary:        '#F35D3B',                  // Quinckle orange — active state, focus, the single most-important CTA
  primaryDark:    '#C8421F',
  primarySoft:    'rgba(243,93,59,0.10)',
  primarySoftBorder: 'rgba(243,93,59,0.30)',

  // ── Canvas & surfaces (paper) ─────────────────────────────────────
  background:     '#F6F5F2',                  // app canvas — warm off-white (NOT pure #FFF: calmer, less glare/tableside blast)
  surface:        '#FFFFFF',                  // cards, sheets
  surfaceElevated:'#FFFFFF',                  // same as surface in light; elevation via shadow, not tint
  surfaceSunken:  '#EFEEEB',                  // inputs, insets, track backgrounds
  surfaceMuted:   'rgba(22,22,26,0.04)',      // hover / pressed wash
  surfaceMutedHover: 'rgba(22,22,26,0.07)',

  // ── Ink (text & structure) — near-black, never pure #000 ──────────
  textPrimary:    '#17171B',                  // headlines, amounts, primary text
  textSecondary:  '#54545C',                  // secondary text, labels
  textTertiary:   '#86868F',                  // meta, timestamps
  textMuted:      '#B4B4BB',                  // disabled, placeholders

  // ── Lines ─────────────────────────────────────────────────────────
  border:         'rgba(22,22,26,0.12)',      // card borders, dividers between groups
  borderStrong:   'rgba(22,22,26,0.20)',      // emphasis dividers, input borders
  borderSubtle:   'rgba(22,22,26,0.07)',      // hairline row separators

  // ── Status (the ONLY saturated colours — darkened for light-bg legibility) ──
  success:        '#0F8A43', successSoft: 'rgba(15,138,67,0.10)',  successBorder: 'rgba(15,138,67,0.28)',
  danger:         '#D62F22', dangerSoft:  'rgba(214,47,34,0.10)',  dangerBorder:  'rgba(214,47,34,0.28)',
  warning:        '#A85A00', warningSoft: 'rgba(168,90,0,0.10)',   warningBorder: 'rgba(168,90,0,0.28)',
  info:           '#1D4ED8', infoSoft:    'rgba(29,78,216,0.10)',  infoBorder:    'rgba(29,78,216,0.28)',

  // ── Ink button (the monochrome workhorse) ─────────────────────────
  ink:            '#17171B',                  // primary button fill (black), high-contrast neutral
  onInk:          '#FFFFFF',                  // text/icon on ink

  // ── Shadow (whisper only) ─────────────────────────────────────────
  // Use as: shadowColor '#17171B', see Elevation tokens below.
};
```

**Why darker status colours?** On a light canvas, the dark-theme greens/reds (`#22C55E`, `#EF4444`) fail contrast for text/icons. The values above hit ≥4.5:1 on white.

**Usage law:**
- **Black/ink** for almost everything structural and for the default primary button.
- **Orange (`primary`)** for: active tab/segment, selection, focus ring, and *one* hero CTA per screen where urgency helps (e.g. `Collect ₹540`). Not for decoration.
- **Status colours** only on badges/chips/icons that communicate payment or order state.

---

## 3. Foundations — Typography

Keep the existing scale (it's good); it now renders in **ink on paper**. Money & quantities use **tabular figures** so columns align and digits don't jump.

| Token | Size / Weight | Use |
|---|---|---|
| `display` | 32 / 800, -1 | Screen hero number (rare) |
| `title` | 22 / 700, -0.4 | Screen title |
| `subtitle` | 17 / 600 | Card title, section head |
| `body` | 15 / 500 | Default text |
| `bodyStrong` | 15 / 600 | Emphasis, button text |
| `caption` | 13 / 500 | Secondary/meta |
| `label` | 11 / 700, +1, UPPERCASE | Eyebrows, section labels |
| `micro` | 11 / 500 | Dense meta |
| **`amount`** *(new)* | 28–34 / 700, tabular-nums | **Money** — the biggest thing on payment screens |
| **`mono`** *(new)* | 13 / 600, tabular | Refs, codes, counts |

Rule: **a money figure is always the largest element in its card.** A waiter should read the amount before anything else.

---

## 4. Foundations — Spacing, Radius, Elevation

- **Spacing** — keep the existing scale (`xs 4 … huge 40`). Default screen padding `xl (20)`; card padding `lg (16)`; row vertical `md (12)`.
- **Radius** — pro-POS is slightly crisp: cards `lg (16)`, controls/inputs `md (12)`, chips/badges `pill`, sheets `xxl (24)` top corners. Avoid oversized blobby radii.
- **Elevation** — light theme uses **hairline border + soft shadow**, never surface-tinting:
  ```ts
  export const Elevation = {
    flat:  {},                                                   // inline cards: border only, no shadow
    card:  { shadowColor: '#17171B', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
    overlay:{ shadowColor: '#17171B', shadowOpacity: 0.12, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 }, // sheets, menus, dialogs
  };
  ```
  Most cards are **`flat` (hairline border, no shadow)**. Use `card` only for the primary actionable card on a screen. `overlay` only for true floating layers.

---

## 5. Layout language — screen anatomy

Every screen follows the same skeleton (this alone fixes most of the "non-uniform" feel):

```
┌─────────────────────────────────────┐
│ safe-area top                        │
│ HEADER   ‹ back   Title      ⟳/action│  56px, hairline bottom border, surface bg
├─────────────────────────────────────┤
│                                      │
│ CONTENT  (scroll)                    │  canvas bg, padding xl
│   · section label                    │
│   · cards / rows                     │
│                                      │
├─────────────────────────────────────┤
│ ACTION BAR (optional, sticky)        │  surface bg, hairline top, safe-area bottom
│ [ secondary ] [   PRIMARY CTA    ]   │
└─────────────────────────────────────┘
   BOTTOM NAV (role tabs)              │  only on top-level screens
```

Rules:
- **One header pattern.** Left: back chevron (or logo on home). Center/left: title (`title`). Right: at most one icon action. Hairline bottom border. **No hero photos** (remove the cash-collection banner — see §9).
- **Section labels** (`label`, `textTertiary`) introduce groups. Generous space *above*, tight *below*.
- **Sticky action bar** for the screen's primary verb (Collect, Print, Confirm) — full-width, thumb-reachable, safe-area padded.
- **Balanced density:** row height ~56–64px, card gap `sm (8)`, never cram below 44px touch targets.

---

## 6. Component library

The building blocks. Build these once (in `components/ui/`) and **every screen composes from them** — no per-screen restyling.

### 6.1 `Card`
White surface, `radius lg`, `border` hairline, `flat` elevation (shadow only for the primary card). Padding `lg`. No coloured fills — state is shown via a left status rail or a badge, not a tinted background.

### 6.2 `ListRow`
Height ≥56px, `borderSubtle` separator (not full borders), pressable wash `surfaceMuted`. Left: optional status dot/icon. Center: title + meta. Right: value (tabular) + chevron. This replaces the assorted ad-hoc rows.

### 6.3 `StatusBadge` / chip
Pill, `radius pill`, `Soft` background + status colour text, 11/700 uppercase. Canonical map:

| State | Colour token | Label |
|---|---|---|
| Paid | `success` | PAID |
| Pending (staff/cash) | `warning` | PENDING |
| Failed / unpaid | `danger` | UNPAID |
| UPI Direct | `info` | UPI DIRECT |
| New order | `ink`/`textPrimary` | NEW |

One badge style, one colour map — used in cash-collection, orders, tickets, everywhere.

### 6.4 `Amount`
Tabular `amount` type in `ink`, `₹` prefix slightly smaller/`textSecondary`. Always the visual anchor of a payment card.

### 6.5 Buttons
- **Primary** — `ink` fill, `onInk` text, `radius md`, height 50, `bodyStrong`. The default workhorse.
- **Primary-accent** — same but `primary` (orange) fill. Use for the *single* most urgent money CTA (e.g. `Collect`), max one per view.
- **Secondary** — surface fill, `border`, `textPrimary`.
- **Tertiary/Ghost** — text-only, `textSecondary`.
- **Destructive** — `danger` text on ghost, or `danger` fill for confirm-destructive.
- All ≥44px tall; full-width in action bars.

### 6.6 Segmented control / Tabs
Active segment = `primary` text + `primarySoft` pill (or ink underline). Inactive = `textTertiary`. One implementation (today there are several). Used for Active/Confirmed, Orders/Tables, etc.

### 6.7 `BottomSheet`
`surface`, top `radius xxl`, `overlay` elevation, grab handle, hairline header with title + close. Drag-to-dismiss. All modals use this — including `CollectionSheet`.

### 6.8 `TableChip`
Square-ish `radius md`, `surfaceSunken` bg, `T12` in `bodyStrong`/tabular. The consistent way to show a table everywhere (floor grid, tickets, collection, payment).

### 6.9 `KitchenTicketCard` (cook)
**Kitchen-rule applies:** larger type, max contrast. Big `T12` chip, item lines at `body`/16 minimum, qty in bold tabular, status via a **left colour rail** (not a tinted card). White card, hairline border. Bump everything one step larger than floor screens.

### 6.10 Empty state / Skeleton / Toast
- **Empty:** centered mono icon (`textTertiary`), one line `body` `textSecondary`, optional ghost CTA. One component.
- **Skeleton:** `surfaceSunken` blocks, subtle shimmer. Match the real layout's shape (the existing `*Skeleton` components stay, re-themed light).
- **Toast:** for the non-blocking "Payment received ✓" etc. — `surface`, hairline, status icon, slides from top, auto-dismiss.

---

## 7. POS-specific patterns

- **Money is the hero.** Amount = largest element, tabular, ink. Label above in `label`/tertiary.
- **State via rail or badge, never tinted cards.** A pending vs paid card differs by a 3px left colour rail + a badge — the card stays white. (Today the UPI card is a solid blue block — that's the kind of thing we drop.)
- **Counts & refs** in `mono` tabular so they're scannable.
- **One tap to the verb.** The primary action is always the big bottom-bar button; secondary actions live behind a `⋯` menu, not competing buttons.
- **Glanceability:** a staffer should know *table, amount, state, action* in under a second — those four are the visual priority order on any payment card.

---

## 8. Iconography & motion

- **Icons:** Ionicons, `-outline` variants for default, filled only for active/selected. Sizes 16 (inline), 20 (actions), 24 (nav). Colour `textSecondary` default, `primary` when active, status colour only on status icons.
- **Motion:** 150–220ms, ease-out. Press = quick opacity/scale. Sheets spring in. **No** continuous/decorative animation (kill shimmer-sweeps, glow pulses). Success moments = a brief check + toast, not a celebration.

---

## 9. Anti-patterns — remove these (the source of today's inconsistency)

1. **Hero banner photos** (e.g. cash-collection's `hero banner.webp`) → replace with the standard hairline header. Decorative imagery has no place in a tool.
2. **Solid coloured cards** (e.g. the `#173B6C` UPI block, gradient fills) → white card + status rail/badge.
3. **Hardcoded hex everywhere** — audit found `#93c5fd`, `#86efac`, `#4ade80`, `#173B6C`, `#18a957`, `#9ec0ff`, `#16a34a`, etc. scattered across screens. **All colour comes from `QuinckleColors`.** Zero literals in screen files.
4. **Dual source of truth:** the Expo-boilerplate `constants/theme.ts` (`Colors.light/dark`, `Fonts`) + `components/themed-text.tsx`, `themed-view.tsx`, `ui/collapsible.tsx`, `hooks/use-color-scheme*`, `hooks/use-theme-color` — all unused-by-design or conflicting. **Delete them**; `QuinckleColors` is the only system.
5. **Gradients / glows / cinematic styling** carried over from the partner app — crew is distinct utilitarian. Flat only.
6. **Per-screen bespoke cards/rows/badges** → compose from §6 components.

---

## 10. Accessibility & the kitchen rule

- Body text contrast **≥ 4.5:1**, large text/icons **≥ 3:1** (the token values above comply on `#FFFFFF`/`#F6F5F2`).
- Touch targets **≥ 44×44pt**.
- Never encode state by colour alone — pair every status colour with a **label or icon** (colour-blind safe; also survives glare).
- **Kitchen screens:** minimum body 16, ticket numbers ≥18, no `textTertiary` for must-read content, status via rail + label. Assume bright overhead light and a cook glancing from 1m away.

---

## 11. Migration plan (sequenced, low-risk)

This doc is step 0. Implementation order:

1. **Tokens first.** Rewrite `constants/Colors.ts` values to §2 (keep export names), add `Elevation` + `amount`/`mono` type tokens. Most screens shift to light automatically.
2. **Status bar:** set light content (`StatusBar style="dark"`), update `app/_layout` background to `canvas`.
3. **Delete the boilerplate** (§9.4): `constants/theme.ts`, `themed-text`, `themed-view`, `ui/collapsible`, `use-theme-color`, `use-color-scheme*` — after confirming nothing critical imports them.
4. **Build/refresh core components** (§6) in `components/ui/`: `Card`, `ListRow`, `StatusBadge`, `Amount`, `Button`, `Segmented`, `TableChip`, header, action bar, empty/skeleton/toast.
5. **Migrate screens, highest-traffic first**, swapping bespoke styling for components + removing literals & hero imagery:
   - `(staff)/cash-collection.tsx` + `CollectionSheet` + `payment-collect.tsx` (money path — do first)
   - `(cook)/index.tsx` + `KitchenTicketCard` (apply kitchen rule)
   - `(staff)/index.tsx` (table floor) + `[tableId].tsx`
   - `(staff)/menu / combos / featured / cash-ledger / profile`, `printer`, `login`, `credential`
6. **Sweep:** `grep` for `#` hex literals in `app/` → 0; confirm every colour resolves to `QuinckleColors`.
7. **Verify:** `tsc` clean + on-device pass in **bright** light (kitchen) and **dim** light (floor).

Definition of done: every screen uses the same header, the same card/row/badge/button components, zero hardcoded colours, no hero photos, and reads cleanly in greyscale.

---

## 12. Quick reference

```
Canvas  #F6F5F2   ·  Surface #FFFFFF   ·  Sunken #EFEEEB
Ink     #17171B   ·  2nd #54545C  ·  3rd #86868F  ·  muted #B4B4BB
Hairline rgba(22,22,26,0.07–0.20)
Accent  #F35D3B  (active / focus / one hero CTA)
Paid #0F8A43 · Pending #A85A00 · Unpaid #D62F22 · UPI #1D4ED8
Primary button = INK fill. Money = biggest, tabular. Colour = signal only.
```
