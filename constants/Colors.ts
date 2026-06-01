// Design tokens for QuinckleCrew — light "pro-POS", monochrome-first.
// Single source of truth for colour, spacing, radius, elevation, typography.
// See DESIGN_SYSTEM.md. North star: ink on paper — colour is signal, not decoration.

export const QuinckleColors = {
  // ── Accent (the ONE brand colour — used sparingly: active / focus / one hero CTA) ──
  primary: '#F35D3B',
  primaryDark: '#C8421F',
  primaryLight: '#FBD0C8',
  primarySoft: 'rgba(243,93,59,0.10)',
  primarySoftBorder: 'rgba(243,93,59,0.30)',

  // ── Canvas & surfaces (paper) ──────────────────────────────────────
  background: '#F6F5F2',          // app canvas — warm off-white (not pure #FFF)
  surface: '#FFFFFF',             // cards, sheets
  surfaceElevated: '#FFFFFF',     // elevation via shadow, not tint
  surfaceSunken: '#EFEEEB',       // inputs, insets, track backgrounds
  surfaceMuted: 'rgba(22,22,26,0.04)',       // hover / pressed wash
  surfaceMutedHover: 'rgba(22,22,26,0.07)',

  // ── Lines ──────────────────────────────────────────────────────────
  border: 'rgba(22,22,26,0.12)',
  borderStrong: 'rgba(22,22,26,0.20)',
  borderSubtle: 'rgba(22,22,26,0.07)',

  // ── Ink (text & structure) — near-black, never pure #000 ───────────
  textPrimary: '#17171B',
  textSecondary: '#54545C',
  textTertiary: '#86868F',
  textMuted: '#B4B4BB',

  // ── Ink button (the monochrome workhorse) ──────────────────────────
  ink: '#17171B',
  onInk: '#FFFFFF',

  // ── Status (the ONLY saturated colours — darkened for light-bg legibility) ──
  success: '#0F8A43',
  successSoft: 'rgba(15,138,67,0.10)',
  successBorder: 'rgba(15,138,67,0.28)',
  danger: '#D62F22',
  dangerSoft: 'rgba(214,47,34,0.10)',
  dangerBorder: 'rgba(214,47,34,0.28)',
  warning: '#A85A00',
  warningSoft: 'rgba(168,90,0,0.10)',
  warningBorder: 'rgba(168,90,0,0.28)',
  info: '#1D4ED8',
  infoSoft: 'rgba(29,78,216,0.10)',
  infoBorder: 'rgba(29,78,216,0.28)',
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
};

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 999,
};

// Elevation — light theme lifts surfaces with a whisper of shadow, never tint.
// Most cards are `flat` (hairline border only). `card` for the primary actionable
// card; `overlay` only for true floating layers (sheets, menus, dialogs).
export const Elevation = {
  flat: {},
  card: {
    shadowColor: '#17171B',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  overlay: {
    shadowColor: '#17171B',
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
};

export const Typography = {
  display: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -1 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.4 },
  subtitle: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '500' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '500' as const },
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1, textTransform: 'uppercase' as const },
  micro: { fontSize: 11, fontWeight: '500' as const },
  // Money — the on-screen hero. Always the largest element in its card.
  amount: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.6, fontVariant: ['tabular-nums'] as const },
  // Refs, codes, counts — scannable tabular figures.
  mono: { fontSize: 13, fontWeight: '600' as const, fontVariant: ['tabular-nums'] as const },
};
