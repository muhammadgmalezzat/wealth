import type { TextStyle } from 'react-native';

// Calm Wealth design tokens. Components read colors, spacing, radii and type from here — never
// raw hex. Light theme only for now; `colors` is the single switch point for a future dark theme
// (add palette.dark and pick it here).

export const palette = {
  light: {
    background: '#F8F7F3',
    surface: '#FFFFFF',
    surfaceSubtle: '#F2F1EC',
    border: '#E4E2DA',
    borderStrong: '#C9C6BB',
    progressTrack: '#E8E6DF',
    text: '#17201D',
    textSecondary: '#65706B',
    // Placeholders / disabled only: fails 4.5:1 contrast on background.
    textMuted: '#8A938F',
    primary900: '#064E3B',
    primary800: '#065F46',
    primary700: '#047857',
    primary600: '#059669',
    primary500: '#10B981',
    primary50: '#E8F3EE',
    onPrimary: '#FFFFFF',
    gold: '#C99A3D',
    goldSurface: '#FBF4E3',
    goldText: '#8A6420',
    warning: '#B45309',
    warningSurface: '#FDF3E1',
    danger: '#B42318',
    dangerSurface: '#FBECEB',
    scrim: 'rgba(23,32,29,0.4)',
  },
} as const;

export type ThemeColors = typeof palette.light;
export type ColorToken = keyof ThemeColors;
// Single switch point for future dark mode.
export const colors: ThemeColors = palette.light;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

type TypeStyle = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight'>;

// Money styles are rendered with fontVariant: ['tabular-nums'] (see Money / AmountInput).
export const type = {
  moneyHero: { fontSize: 34, lineHeight: 44, fontWeight: '700' },
  moneyLg: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  moneyMd: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  moneyRow: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  display: { fontSize: 32, lineHeight: 42, fontWeight: '700' },
  titleLg: { fontSize: 26, lineHeight: 36, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 30, fontWeight: '700' },
  section: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 26, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 26, fontWeight: '600' },
  secondary: { fontSize: 14, lineHeight: 22, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 20, fontWeight: '500' },
  micro: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
} as const satisfies Record<string, TypeStyle>;
export type TypeVariant = keyof typeof type;
// Same object; `type` reads awkwardly in imports.
export const typography = type;

export const shadow = {
  card: { shadowColor: '#17201D', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  raised: { shadowColor: '#17201D', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 6 },
} as const;
export const opacity = { pressed: 0.85, disabled: 0.4 } as const;
export const size = { touchMin: 44, fab: 56, icon: 24, progress: 8 } as const;

// ---------------------------------------------------------------------------
// Temporary aliases so screens not yet redesigned keep compiling. Values stay 6-digit hex
// because some call sites append an alpha suffix (e.g. `Colors.light.tint + '22'`).
// ---------------------------------------------------------------------------

const legacyLight = {
  text: colors.text,
  background: colors.background,
  tint: colors.primary700,
  icon: colors.textSecondary,
  tabIconDefault: colors.textSecondary,
  tabIconSelected: colors.primary700,
};

/** @deprecated use colors/space/radius/type */
export const Colors = {
  light: legacyLight,
  // The app is locked to the light theme.
  dark: { ...legacyLight },
};

/** @deprecated use colors/space/radius/type */
export const FinanceColors = {
  primary: colors.primary700,
  income: colors.primary700,
  expense: colors.danger,
  gold: colors.gold,
  progressTrack: colors.progressTrack,
  cardBackground: colors.surfaceSubtle,
};

/** @deprecated use colors/space/radius/type (system fonts only) */
export const Fonts = {
  sans: 'System',
};
