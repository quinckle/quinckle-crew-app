// Design tokens for QuinckleCrew.
// Single source of truth for colors, spacing, radius, typography.

export const QuinckleColors = {
  // Brand
  primary: '#F35D3B',
  primaryDark: '#B21F0C',
  primaryLight: '#FBD0C8',
  primarySoft: 'rgba(243,93,59,0.12)',
  primarySoftBorder: 'rgba(243,93,59,0.28)',

  // Surfaces
  background: '#0A0A0B',
  surface: '#141416',
  surfaceElevated: '#1B1B1F',
  surfaceMuted: 'rgba(255,255,255,0.04)',
  surfaceMutedHover: 'rgba(255,255,255,0.08)',

  // Borders
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.14)',
  borderSubtle: 'rgba(255,255,255,0.05)',

  // Text
  textPrimary: '#FAFAFA',
  textSecondary: '#A1A1AA',
  textTertiary: 'rgba(255,255,255,0.4)',
  textMuted: 'rgba(255,255,255,0.25)',

  // Status
  success: '#22C55E',
  successSoft: 'rgba(34,197,94,0.12)',
  successBorder: 'rgba(34,197,94,0.28)',
  danger: '#EF4444',
  dangerSoft: 'rgba(239,68,68,0.12)',
  dangerBorder: 'rgba(239,68,68,0.28)',
  warning: '#F59E0B',
  warningSoft: 'rgba(245,158,11,0.12)',
  warningBorder: 'rgba(245,158,11,0.28)',
  info: '#3B82F6',
  infoSoft: 'rgba(59,130,246,0.12)',
  infoBorder: 'rgba(59,130,246,0.28)',
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

export const Typography = {
  display: { fontSize: 32, fontWeight: '800' as const, letterSpacing: -1 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.4 },
  subtitle: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '500' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '500' as const },
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1, textTransform: 'uppercase' as const },
  micro: { fontSize: 11, fontWeight: '500' as const },
};
