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

// xxs (2) is for hairline gaps inside dense rows; in-between values are sums (e.g. xs + xxs = 6).
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 40 } as const;
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
  // The big centred amount field (AmountInput) and its compact size for long numbers.
  amountInput: { fontSize: 48, lineHeight: 58, fontWeight: '700' },
  amountInputCompact: { fontSize: 40, lineHeight: 50, fontWeight: '700' },
  // FormSheet header title.
  sheetTitle: { fontSize: 18, lineHeight: 26, fontWeight: '700' },
} as const satisfies Record<string, TypeStyle>;
export type TypeVariant = keyof typeof type;
// Same object; `type` reads awkwardly in imports.
export const typography = type;

// Emphasis on top of a type style (e.g. a semibold caption). Line heights come from `type`.
export const weight = { regular: '400', medium: '500', semibold: '600', bold: '700' } as const;

export const shadow = {
  card: { shadowColor: '#17201D', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  raised: { shadowColor: '#17201D', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 6 },
} as const;
export const opacity = { pressed: 0.85, disabled: 0.4 } as const;
// readableMax: content width cap on wide (web/desktop) windows; phones are narrower anyway.
export const size = { touchMin: 44, fab: 56, icon: 24, progress: 8, readableMax: 640 } as const;
