/**
 * Base (structural) tokens — shared across ALL themes.
 * Mirrors packages/ui/src/tokens/base.css.
 */

export const spacing = {
  0: 0,
  0.5: 1,
  1: 2,
  1.5: 3,
  2: 4,
  3: 6,
  4: 8,
  5: 10,
  6: 12,
  8: 16,
  10: 20,
  12: 24,
  16: 32,
} as const;

export const iconSize = {
  sm: 12,
  md: 16,
  lg: 20,
} as const;

export const dotSize = {
  sm: 8,
  md: 10,
} as const;

export const avatarSize = {
  xs: 14,
  sm: 20,
  md: 24,
  lg: 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const fontSize = {
  '2xs': 10,
  xs: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 15,
  xl: 17,
  '2xl': 24,
  '3xl': 32,
} as const;

export const lineHeight = {
  none: 1,
  tight: 1.3,
  snug: 1.4,
  normal: 1.5,
  relaxed: 1.6,
} as const;

export const zIndex = {
  submenu: 10,
  dropdown: 50,
  sticky: 100,
  popover: 200,
  tab: 900,
  dm: 1000,
  videocall: 1100,
  banner: 2000,
  lightbox: 3000,
} as const;
