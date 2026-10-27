import type { TextStyle } from 'react-native';

// "Dark Glassy Wealth" design tokens: deep midnight charcoal with emerald undertones, frosted
// translucent surfaces, restrained emerald light and a little gold for gold. Components read
// colors, spacing, radii and type from here — never raw hex. Dark is the only appearance (no
// switcher); `colors` stays the single switch point.
//
// Token names from the earlier light theme are kept so every screen keeps working; their meaning
// maps onto the dark palette:
//   primary700  the emerald (buttons, links, active states)     primary900  its pressed shade
//   primary800  light emerald for text on soft emerald grounds   primary50   the soft emerald ground
//   surface / surfaceSubtle  solid cards / flat insets            border*     translucent hairlines
// `onPrimary` is DARK text for emerald fills (white on emerald fails contrast).

export const palette = {
  dark: {
    background: '#0A1014',
    backgroundElevated: '#101A20',
    surface: '#15232A',
    surfaceElevated: '#1B2D34',
    // Flat insets and subtle cards: one step above the solid card.
    surfaceSubtle: '#1B2D34',
    border: 'rgba(210, 245, 231, 0.13)',
    borderStrong: 'rgba(210, 245, 231, 0.28)',
    divider: 'rgba(210, 245, 231, 0.10)',
    progressTrack: 'rgba(210, 245, 231, 0.12)',

    // Glass: translucent fills (readable without blur), their hairline and top highlight.
    glassSubtle: 'rgba(27, 45, 52, 0.40)',
    glass: 'rgba(27, 45, 52, 0.62)',
    glassStrong: 'rgba(27, 45, 52, 0.84)',
    glassBorder: 'rgba(210, 245, 231, 0.13)',
    glassHighlight: 'rgba(233, 245, 240, 0.07)',
    // The soft emerald light near the top of every screen.
    emeraldGlow: 'rgba(40, 197, 154, 0.16)',

    text: '#E9F5F0',
    textSecondary: '#A7B8B2',
    // Placeholders and disabled text. 5:1 on surface, below the secondary text.
    textMuted: '#81958F',

    primary: '#28C59A',
    primaryPressed: '#19A981',
    primarySoft: 'rgba(40, 197, 154, 0.13)',
    primary900: '#19A981',
    primary800: '#5BDDB8',
    primary700: '#28C59A',
    primary600: '#22B28B',
    primary500: '#3DD9AE',
    primary50: 'rgba(40, 197, 154, 0.13)',
    // Dark text on emerald fills: 7.6:1 on primary.
    onPrimary: '#06231A',

    gold: '#D8AD62',
    goldSurface: 'rgba(216, 173, 98, 0.13)',
    goldText: '#E3BB74',

    success: '#28C59A',
    warning: '#F2BD69',
    warningSurface: 'rgba(242, 189, 105, 0.13)',
    danger: '#EF8585',
    dangerSurface: 'rgba(239, 133, 133, 0.13)',
    scrim: 'rgba(0, 0, 0, 0.6)',

    // Chart palette (muted hues that stay apart on dark; emerald and gold come from above).
    chartSky: '#6BAED6',
    chartViolet: '#A99BD8',
    chartRose: '#D79AB5',
  },
} as const;

export type ThemeColors = typeof palette.dark;
export type ColorToken = keyof ThemeColors;
// Single switch point for the palette.
export const colors: ThemeColors = palette.dark;

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

// On dark, depth comes from the hairline and the glass fill; shadows are only a soft lift.
export const shadow = {
  card: { shadowColor: '#000000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 6, elevation: 2 },
  raised: { shadowColor: '#000000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 18, elevation: 8 },
} as const;
export const opacity = { pressed: 0.85, disabled: 0.4 } as const;
// readableMax: content width cap on wide (web/desktop) windows; phones are narrower anyway.
export const size = { touchMin: 44, fab: 56, icon: 24, progress: 8, readableMax: 640 } as const;
